import {
  calculatePriceMovement,
  canonicalExternalUrl,
  createCardValueScraper,
  getYuyuteiSellingPrice,
  isCardValueCardUrl,
  isYuyuteiOnePieceSellingUrl,
  resolveSavedCardValueListings,
  scrapeSetYuyuteiPrices,
} from "../supabase/functions/_shared/card-value.js";

async function rest(path, { method = "GET", body, prefer } = {}) {
  const baseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !secretKey) throw new Error("GitHub secrets CARDBOY_SUPABASE_URL and CARDBOY_SUPABASE_SECRET_KEY are required.");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`database request failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function currentPhpRates() {
  let liveRates = null;
  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=PHP&to=JPY,USD", { signal: AbortSignal.timeout(12_000) });
    if (response.ok) {
      const payload = await response.json();
      liveRates = Object.fromEntries(["JPY", "USD"].map((currency) => [currency, 1 / Number(payload.rates[currency])]));
      const fetchedAt = new Date().toISOString();
      await rest("fx_rates?on_conflict=currency", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: Object.entries(liveRates).map(([currency, phpRate]) => ({ currency, php_rate: phpRate, fetched_at: fetchedAt })),
      });
    }
  } catch {
    // Fall back to the last database rates below.
  }
  if (liveRates) return liveRates;
  const stored = await rest("fx_rates?select=currency,php_rate");
  return Object.fromEntries(stored.map((row) => [row.currency, Number(row.php_rate)]));
}

function philippineObservationDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

async function storeDailyObservation(card, listing, observedAt) {
  const observationDay = philippineObservationDay(new Date(observedAt));
  const identity = `user_id=eq.${encodeURIComponent(card.user_id)}&card_id=eq.${encodeURIComponent(card.id)}&source=eq.yuyutei&source_via=eq.card-value.jp`;
  const existing = await rest(`daily_price_observations?select=id,price,price_change,percentage_change,observed_at&${identity}&observation_day=eq.${observationDay}&limit=1`);
  if (existing.length) {
    return {
      stored: false,
      priceChange: Number(existing[0].price_change ?? 0),
      percentageChange: Number(existing[0].percentage_change ?? 0),
    };
  }

  const previousRows = await rest(`daily_price_observations?select=price,observed_at&${identity}&observation_day=lt.${observationDay}&order=observation_day.desc&limit=1`);
  const previousPrice = previousRows.length ? Number(previousRows[0].price) : null;
  const currentPrice = Number(listing.yuyuteiPrice);
  const { priceChange, percentageChange } = calculatePriceMovement(currentPrice, previousPrice);
  const inserted = await rest("daily_price_observations?on_conflict=user_id,card_id,source,source_via,observation_day", {
    method: "POST",
    prefer: "resolution=ignore-duplicates,return=representation",
    body: {
      user_id: card.user_id,
      card_id: card.id,
      card_number: listing.cardNumber || card.code || "UNKNOWN",
      variant: listing.variant,
      card_value_url: listing.cardValueUrl,
      yuyutei_url: listing.yuyuteiUrl,
      price: currentPrice,
      currency: "JPY",
      source: "yuyutei",
      source_via: "card-value.jp",
      price_change: priceChange,
      percentage_change: percentageChange,
      observed_at: observedAt,
      observation_day: observationDay,
    },
  });
  return { stored: Boolean(inserted?.length), previousPrice, priceChange, percentageChange };
}

async function markUnsupported(sourceUrl, linkedCards, message) {
  const checkedAt = new Date().toISOString();
  await Promise.all(linkedCards.map((card) => {
    const filter = `user_id=eq.${encodeURIComponent(card.user_id)}&id=eq.${encodeURIComponent(card.id)}`;
    return rest(`cards?${filter}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        monitor_status: "unsupported",
        monitor_message: message,
        monitor_checked_at: checkedAt,
        updated_at: checkedAt,
      },
    });
  }));
  console.warn(`[CARD-VALUE] ${sourceUrl}: ${message}`);
}

async function monitor() {
  const cards = await rest("cards?select=user_id,id,code,title,source_url,card_value_url,source_currency,source_price,image_url,change_percent&source_url=not.is.null&order=source_url.asc");
  const rates = await currentPhpRates();
  const grouped = new Map();
  for (const card of cards) {
    try {
      const sourceKey = canonicalExternalUrl(card.source_url);
      const linked = grouped.get(sourceKey) || [];
      linked.push(card);
      grouped.set(sourceKey, linked);
    } catch {
      // Invalid source URLs are ignored.
    }
  }

  const scraper = createCardValueScraper({
    concurrency: 3,
    minimumDelayMs: 650,
    maximumDelayMs: 1250,
    retries: 3,
  });
  const listings = await resolveSavedCardValueListings(cards, { scraper });

  let checked = 0;
  let movements = 0;
  let failed = 0;
  let observations = 0;
  for (const [sourceKey, linkedCards] of grouped) {
    const sourceUrl = linkedCards[0]?.source_url || sourceKey;
    const listing = listings.get(sourceKey);
    if (!listing || !Number.isFinite(listing.yuyuteiPrice) || listing.yuyuteiPrice <= 0) {
      failed += 1;
      const message = isCardValueCardUrl(sourceUrl) || isYuyuteiOnePieceSellingUrl(sourceUrl)
        ? "Card-Value does not currently list a Yuyutei selling price for this exact variant. Use the bookmark importer for updates."
        : "Automatic monitoring currently supports One Piece variants that Card-Value maps to a Yuyutei selling listing.";
      await markUnsupported(sourceUrl, linkedCards, message);
      continue;
    }

    checked += 1;
    const checkedAt = listing.checkedAt || new Date().toISOString();
    for (const card of linkedCards) {
      const nextPrice = Number(listing.yuyuteiPrice);
      const phpPrice = nextPrice * Number(rates.JPY || 1);
      const observation = await storeDailyObservation(card, listing, checkedAt);
      if (observation.stored) observations += 1;
      const percentageChange = observation.percentageChange;
      const filter = `user_id=eq.${encodeURIComponent(card.user_id)}&id=eq.${encodeURIComponent(card.id)}`;
      await rest(`cards?${filter}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          source_price: nextPrice,
          source_currency: "JPY",
          card_value_url: listing.cardValueUrl,
          ...(observation.stored && percentageChange !== null ? { change_percent: percentageChange } : {}),
          last_checked: checkedAt,
          monitor_status: "active",
          monitor_message: "Automatic daily monitoring reads this exact variant's Yuyutei selling price via Card-Value.",
          monitor_checked_at: checkedAt,
          updated_at: checkedAt,
        },
      });

      if (!observation.stored || observation.priceChange === null || observation.priceChange === 0) continue;
      movements += 1;
      const direction = observation.priceChange > 0 ? "increased" : "decreased";
      await Promise.all([
        rest("price_snapshots", {
          method: "POST",
          prefer: "return=minimal",
          body: {
            user_id: card.user_id,
            card_id: card.id,
            source_price: nextPrice,
            source_currency: "JPY",
            php_price: phpPrice,
            checked_at: checkedAt,
          },
        }),
        rest("notifications", {
          method: "POST",
          prefer: "return=minimal",
          body: {
            user_id: card.user_id,
            card_id: card.id,
            title: `${card.title} ${direction} ${Math.abs(percentageChange).toFixed(2)}%`,
            message: `Yuyutei selling price is now JPY ${nextPrice.toLocaleString("en-US")} (PHP ${Math.round(phpPrice).toLocaleString("en-US")}) per card via Card-Value.`,
            change_percent: percentageChange,
            automatic: true,
          },
        }),
      ]);
    }
  }

  console.log(`CardBoy monitor finished using Card-Value's Yuyutei selling table: ${checked} sources checked, ${observations} daily observations stored, ${movements} price movements, ${failed} unsupported sources.`);
  const eligible = cards.some((card) => isCardValueCardUrl(card.source_url) || isYuyuteiOnePieceSellingUrl(card.source_url));
  if (eligible && checked === 0) throw new Error("No eligible One Piece source could be checked through Card-Value.");
}

const probeIndex = process.argv.indexOf("--probe");
const setIndex = process.argv.indexOf("--set");
if (probeIndex >= 0) {
  const cardUrl = process.argv[probeIndex + 1] || "https://card-value.jp/onepiece/cards/op17-022-3/";
  const listing = await getYuyuteiSellingPrice(cardUrl);
  if (listing.yuyuteiPrice === null) throw new Error("The Card-Value selling table does not list Yuyutei for this variant.");
  console.log(`Card-Value probe succeeded: ${listing.cardNumber} ${listing.variant || "standard"}, JPY ${listing.yuyuteiPrice}.`);
} else if (setIndex >= 0) {
  const setCode = process.argv[setIndex + 1];
  const minimumIndex = process.argv.indexOf("--minimum-price");
  const minimumPrice = minimumIndex >= 0 ? Number(process.argv[minimumIndex + 1]) : undefined;
  const results = await scrapeSetYuyuteiPrices(setCode, { minimumPrice });
  console.log(JSON.stringify(results, null, 2));
} else {
  await monitor();
}
