const monitorUserAgent = "Mozilla/5.0 (compatible; CardBoyPriceMonitor/1.0; +https://github.com/kindercrap/cardboy)";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function productRecords(html) {
  const records = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const value = JSON.parse(match[1].trim());
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) records.push(...(Array.isArray(item?.["@graph"]) ? item["@graph"] : [item]));
    } catch {
      // Ignore malformed JSON-LD blocks and continue to the next one.
    }
  }
  return records;
}

async function extractYuyuListing(sourceUrl) {
  const url = new URL(sourceUrl);
  if (!/(^|\.)yuyu-tei\.jp$/i.test(url.hostname)) throw new Error("unsupported source host");
  const response = await fetch(url, {
    headers: {
      "User-Agent": monitorUserAgent,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ja,en;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);
  const product = productRecords(await response.text()).find((item) => item?.["@type"] === "Product");
  if (!product) throw new Error("Product JSON-LD was not found");
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const nativePrice = Number(String(offer?.price ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(nativePrice) || nativePrice <= 0) throw new Error("a valid listed price was not found");
  return {
    code: String(product.description || "").trim(),
    title: String(product.name || "").trim(),
    nativePrice,
    currency: String(offer?.priceCurrency || "JPY").toUpperCase(),
    image: Array.isArray(product.image) ? String(product.image[0] || "") : String(product.image || ""),
  };
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

  let checked = 0;
  let movements = 0;
  let failed = 0;
  for (const [sourceUrl, linkedCards] of grouped) {
    try {
      const listing = await extractYuyuListing(sourceUrl);
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
      console.warn(`One Yuyu-tei source failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    await delay(750);
  }
  console.log(`CardBoy monitor finished: ${checked} sources checked, ${movements} price movements, ${failed} source failures.`);
  if (grouped.size > 0 && checked === 0) throw new Error("No Yuyu-tei source could be checked from this runner.");
}

const probeIndex = process.argv.indexOf("--probe");
if (probeIndex >= 0) {
  const listing = await extractYuyuListing(process.argv[probeIndex + 1]);
  console.log(`Yuyu-tei probe succeeded: ${listing.code || "card"}, ${listing.currency} ${listing.nativePrice}.`);
} else {
  await monitor();
}
