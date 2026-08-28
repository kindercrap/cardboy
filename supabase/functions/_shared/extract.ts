export type ExtractedCard = {
  title: string;
  code: string;
  series: string;
  image: string;
  nativePrice: number | null;
  currency: "JPY" | "USD";
  sourceUrl: string;
  notice?: string;
};

function allowedHosts() {
  return new Set((Deno.env.get("ALLOWED_SOURCE_HOSTS") || "yuyu-tei.jp,www.yuyu-tei.jp").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function decodeEntities(value = "") {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

function findProduct(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const typeValue = record["@type"];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  if (types.some((type) => String(type).toLowerCase() === "product")) return record;
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const product = findProduct(item);
        if (product) return product;
      }
    } else if (value && typeof value === "object") {
      const product = findProduct(value);
      if (product) return product;
    }
  }
  return null;
}

function metaContent(body: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return decodeEntities(match[1].trim());
  }
  return "";
}

function inferSeries(url: URL, text: string) {
  const source = `${url.pathname} ${text}`.toLowerCase();
  if (source.includes("/opc/") || source.includes("one piece")) return "ONE PIECE";
  if (source.includes("/gcg/") || source.includes("gundam")) return "GUNDAM";
  if (source.includes("tokyo ghoul") || source.includes("/tkg")) return "TOKYO GHOUL";
  if (source.includes("pokemon") || source.includes("/poc/")) return "POKÉMON";
  if (source.includes("dragon ball")) return "DRAGON BALL";
  return "OTHER";
}

function yuyuImage(url: URL) {
  if (!/(^|\.)yuyu-tei\.jp$/i.test(url.hostname)) return "";
  const parts = url.pathname.match(/\/sell\/([^/]+)\/card\/([^/]+)\/(\d+)/i);
  return parts ? `https://card.yuyu-tei.jp/${parts[1]}/front/${parts[2]}/${parts[3]}.jpg` : "";
}

export async function extractCard(source: string): Promise<ExtractedCard> {
  const url = new URL(source);
  if (url.protocol !== "https:") throw new Error("Only HTTPS card pages are supported.");
  if (/(^|\.)card-value\.jp$/i.test(url.hostname)) {
    throw new Error("Card-Value is no longer used. Add the original Yuyutei card-page URL instead.");
  }
  if (!allowedHosts().has(url.hostname.toLowerCase())) throw new Error(`This source is not enabled yet: ${url.hostname}`);
  const fallbackImage = yuyuImage(url);
  if (fallbackImage) {
    return {
      title: "",
      code: "",
      series: inferSeries(url, ""),
      image: fallbackImage,
      nativePrice: null,
      currency: "JPY",
      sourceUrl: url.href,
      notice: "Card image fetched from Yuyutei. Use the CardBoy bookmark or Update Queue to read the current Yuyutei price.",
    };
  }
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: `${url.origin}/`,
    },
  });
  if (!response.ok) {
    throw new Error(`The source returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) throw new Error("The URL is not an HTML card page.");
  const body = await response.text();
  if (body.length > 3_000_000) throw new Error("The source page is too large to process.");

  let product: Record<string, unknown> | null = null;
  for (const match of body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      product = findProduct(JSON.parse(match[1].trim()));
      if (product) break;
    } catch {
      // Continue to metadata fallbacks.
    }
  }
  const rawOffers = product?.offers;
  const offer = (Array.isArray(rawOffers) ? rawOffers[0] : rawOffers || {}) as Record<string, unknown>;
  const rawImage = product?.image;
  const productImage = Array.isArray(rawImage) ? rawImage[0] : typeof rawImage === "object" && rawImage ? (rawImage as Record<string, unknown>).url : rawImage;
  const title = String(product?.name || metaContent(body, "og:title") || body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Imported card");
  const description = String(product?.description || metaContent(body, "description") || metaContent(body, "og:description") || "");
  const code = `${description} ${title}`.toUpperCase().match(/(?:OP|ST|EB|PRB|P|GD|UA|FB|SV)[A-Z0-9/-]{2,20}-\d{2,4}/)?.[0] || "";
  let image = String(productImage || metaContent(body, "og:image") || metaContent(body, "twitter:image") || "");
  if (!image) image = yuyuImage(url);
  if (image) {
    const imageUrl = new URL(image, url);
    image = ["http:", "https:"].includes(imageUrl.protocol) ? imageUrl.href : "";
  }
  const price = Number(String(offer.price ?? (metaContent(body, "product:price:amount") || "")).replace(/[^0-9.]/g, ""));
  const currencyValue = String(offer.priceCurrency || metaContent(body, "product:price:currency") || "JPY").toUpperCase();
  const cleanedTitle = decodeEntities(title.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).split(/\s+(?:販売|\||通販)/)[0];
  return {
    title: cleanedTitle || "Imported card",
    code,
    series: inferSeries(url, `${title} ${description}`),
    image,
    nativePrice: Number.isFinite(price) && price > 0 ? price : null,
    currency: currencyValue === "USD" ? "USD" : "JPY",
    sourceUrl: url.href,
  };
}
