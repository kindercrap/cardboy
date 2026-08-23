const catalogBaseUrl = "https://opcollector.com/";
const monitorUserAgent = "CardBoyPriceMonitor/1.0 (+https://github.com/kindercrap/cardboy)";

function canonicalSourceUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.href.replace(/\/$/, "").toLowerCase();
}

async function publicJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": monitorUserAgent, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`price catalog returned HTTP ${response.status}`);
  return response.json();
}

function sourceSetCode(sourceUrl) {
  const match = new URL(sourceUrl).pathname.match(/\/sell\/opc\/card\/([^/]+)\//i);
  return match?.[1]?.toLowerCase() || "";
}

async function loadPriceCatalog(sourceUrls) {
  const manifest = await publicJson(new URL("data/manifest.json", catalogBaseUrl));
  const entries = new Map(manifest.sets.map((set) => [String(set.code).toLowerCase(), set.jp]));
  const codes = [...new Set(sourceUrls.map(sourceSetCode).filter(Boolean))];
  const databases = await Promise.all(codes.map(async (code) => {
    const entry = entries.get(code);
    if (!entry?.file) return null;
    return publicJson(new URL(`${entry.file}?v=${entry.v}`, catalogBaseUrl));
  }));
  const catalog = new Map();
  for (const database of databases.filter(Boolean)) {
    for (const card of database.cards || []) {
      if (!card.sourceUrl || card.source !== "Yuyutei") continue;
      catalog.set(canonicalSourceUrl(card.sourceUrl), {
        code: String(card.cardNumber || "").trim(),
        title: String(card.name || "").trim(),
        nativePrice: Number(card.marketValue),
        currency: String(card.currency || "JPY").toUpperCase(),
        image: String(card.imageUrl || ""),
        catalogUpdatedAt: manifest.generatedAt,
      });
    }
  }
  return { catalog, generatedAt: manifest.generatedAt };
}

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
  if (!response.ok) throw new Error(`database request failed with HTTP ${response.status}`);
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

async function monitor() {
  const cards = await rest("cards?select=user_id,id,title,source_url,source_currency,source_price,image_url&source_url=not.is.null&order=source_url.asc");
  const rates = await currentPhpRates();
  const grouped = new Map();
  for (const card of cards) {
    try {
      const host = new URL(card.source_url).hostname;
      if (!/(^|\.)yuyu-tei\.jp$/i.test(host)) continue;
    } catch {
      continue;
    }
    const linked = grouped.get(card.source_url) || [];
    linked.push(card);
    grouped.set(card.source_url, linked);
  }
  const { catalog, generatedAt } = await loadPriceCatalog([...grouped.keys()]);

  let checked = 0;
  let movements = 0;
  let failed = 0;
  for (const [sourceUrl, linkedCards] of grouped) {
    try {
      const listing = catalog.get(canonicalSourceUrl(sourceUrl));
      if (!listing || !Number.isFinite(listing.nativePrice) || listing.nativePrice <= 0) {
        throw new Error("the exact Yuyu-tei variant is not in the daily catalog");
      }
      const checkedAt = new Date().toISOString();
      checked += 1;
      for (const card of linkedCards) {
        const oldPrice = Number(card.source_price);
        const nextPrice = listing.nativePrice;
        const change = oldPrice ? Number((((nextPrice - oldPrice) / oldPrice) * 100).toFixed(1)) : 0;
        const filter = `user_id=eq.${encodeURIComponent(card.user_id)}&id=eq.${encodeURIComponent(card.id)}`;
        await rest(`cards?${filter}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: {
            source_price: nextPrice,
            source_currency: listing.currency,
            image_url: listing.image || card.image_url,
            change_percent: change,
            last_checked: checkedAt,
            updated_at: checkedAt,
          },
        });
        if (nextPrice === oldPrice) continue;
        movements += 1;
        const phpPrice = nextPrice * Number(rates[listing.currency] || 1);
        const direction = change >= 0 ? "increased" : "decreased";
        await Promise.all([
          rest("price_snapshots", {
            method: "POST",
            prefer: "return=minimal",
            body: {
              user_id: card.user_id,
              card_id: card.id,
              source_price: nextPrice,
              source_currency: listing.currency,
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
              title: `${card.title} ${direction} ${Math.abs(change).toFixed(1)}%`,
              message: `Now ${listing.currency} ${nextPrice.toLocaleString("en-US")} (PHP ${Math.round(phpPrice).toLocaleString("en-US")}) per card.`,
              change_percent: change,
              automatic: true,
            },
          }),
        ]);
      }
    } catch (error) {
      failed += 1;
      console.warn(`One saved Yuyu-tei source could not be matched: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  console.log(`CardBoy monitor finished using the OP Collector catalog (${generatedAt || "unknown update time"}): ${checked} sources checked, ${movements} price movements, ${failed} unmatched sources.`);
  if (grouped.size > 0 && checked === 0) throw new Error("No Yuyu-tei source could be checked from this runner.");
}

const probeIndex = process.argv.indexOf("--probe");
if (probeIndex >= 0) {
  const sourceUrl = process.argv[probeIndex + 1];
  const { catalog, generatedAt } = await loadPriceCatalog([sourceUrl]);
  const listing = catalog.get(canonicalSourceUrl(sourceUrl));
  if (!listing) throw new Error("The exact Yuyu-tei listing was not found in the OP Collector daily catalog.");
  console.log(`Catalog probe succeeded: ${listing.code || "card"}, ${listing.currency} ${listing.nativePrice}; catalog updated ${generatedAt || "at an unknown time"}.`);
} else {
  await monitor();
}
