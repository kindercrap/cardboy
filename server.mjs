import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extname, join, normalize } from "node:path";
import { extractCardValueImage, isCardValueCardUrl, parseCardValuePage } from "./supabase/functions/_shared/card-value.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function isPrivateAddress(address) {
  const normalized = address.replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "0.0.0.0") return true;
  if (normalized.startsWith("10.") || normalized.startsWith("127.") || normalized.startsWith("169.254.") || normalized.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true;
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(normalized)) return true;
  return false;
}

async function validatePublicUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs are supported.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not supported.");
  if (url.hostname === "localhost") throw new Error("Local addresses are not supported.");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error("Private network addresses are not supported.");
  return url;
}

async function fetchPage(value, redirects = 0) {
  if (redirects > 3) throw new Error("Too many redirects from this source.");
  const url = await validatePublicUrl(value);
  const result = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(12000),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    },
  });
  if ([301, 302, 303, 307, 308].includes(result.status)) {
    const location = result.headers.get("location");
    if (!location) throw new Error("The source returned an invalid redirect.");
    return fetchPage(new URL(location, url).href, redirects + 1);
  }
  if (!result.ok) throw new Error(`The source returned HTTP ${result.status}.`);
  const contentType = result.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("The URL is not a card detail page.");
  const body = await result.text();
  if (body.length > 3_000_000) throw new Error("The source page is too large to process.");
  return { body, finalUrl: url };
}

function decodeEntities(value = "") {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function findProduct(node) {
  if (!node || typeof node !== "object") return null;
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  if (types.some((type) => String(type).toLowerCase() === "product")) return node;
  for (const value of Object.values(node)) {
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

function metaContent(body, key) {
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

function inferSeries(url, text) {
  const source = `${url.pathname} ${text}`.toLowerCase();
  if (source.includes("/opc/") || source.includes("one piece")) return "ONE PIECE";
  if (source.includes("/gcg/") || source.includes("gundam")) return "GUNDAM";
  if (source.includes("tokyo ghoul") || source.includes("/tkg")) return "TOKYO GHOUL";
  if (source.includes("pokemon") || source.includes("/poc/")) return "POKÉMON";
  if (source.includes("dragon ball")) return "DRAGON BALL";
  return "ONE PIECE";
}

function yuyuteiFallbackCard(url) {
  const parts = url.pathname.match(/\/sell\/([^/]+)\/card\/([^/]+)\/(\d+)/i);
  return {
    title: "",
    code: "",
    series: inferSeries(url, ""),
    image: parts ? `https://card.yuyu-tei.jp/${parts[1]}/front/${parts[2]}/${parts[3]}.jpg` : "",
    nativePrice: null,
    currency: "JPY",
    sourceUrl: url.href,
    notice: "CardBoy does not scrape Yuyutei pages directly. Paste the matching Card-Value card URL or use the bookmark importer.",
  };
}

function extractCard(body, finalUrl) {
  if (isCardValueCardUrl(finalUrl.href)) {
    const parsed = parseCardValuePage(body, finalUrl.href);
    return {
      title: parsed.cardName,
      code: parsed.cardNumber,
      series: "ONE PIECE",
      image: extractCardValueImage(body, finalUrl.href),
      nativePrice: parsed.yuyuteiPrice,
      currency: "JPY",
      sourceUrl: finalUrl.href,
      notice: parsed.yuyuteiPrice === null
        ? "Card-Value does not list a Yuyutei selling price for this variant."
        : "Yuyutei selling price extracted from Card-Value's store-by-store selling table.",
    };
  }
  let product = null;
  const scripts = body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      product = findProduct(JSON.parse(match[1].trim()));
      if (product) break;
    } catch {
      // Ignore invalid third-party JSON-LD and continue to generic metadata.
    }
  }
  const offer = Array.isArray(product?.offers) ? product.offers[0] : product?.offers || {};
  const productImage = Array.isArray(product?.image) ? product.image[0] : typeof product?.image === "object" ? product.image.url : product?.image;
  const title = product?.name || metaContent(body, "og:title") || body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Imported card";
  const description = product?.description || metaContent(body, "description") || metaContent(body, "og:description") || "";
  const codeMatch = `${description} ${title}`.toUpperCase().match(/(?:OP|ST|EB|PRB|P|GD|UA|FB|SV)[A-Z0-9/-]{2,20}-\d{2,4}/);
  let image = productImage || metaContent(body, "og:image") || metaContent(body, "twitter:image");
  if (!image && /(^|\.)yuyu-tei\.jp$/i.test(finalUrl.hostname)) {
    const parts = finalUrl.pathname.match(/\/sell\/([^/]+)\/card\/([^/]+)\/(\d+)/i);
    if (parts) image = `https://card.yuyu-tei.jp/${parts[1]}/front/${parts[2]}/${parts[3]}.jpg`;
  }
  if (image) {
    const resolvedImage = new URL(image, finalUrl);
    image = ["http:", "https:"].includes(resolvedImage.protocol) ? resolvedImage.href : "";
  }
  const rawPrice = offer.price ?? metaContent(body, "product:price:amount");
  const price = Number(String(rawPrice || "").replace(/[^0-9.]/g, ""));
  const currency = String(offer.priceCurrency || metaContent(body, "product:price:currency") || (/[$＄]/.test(body) ? "USD" : "JPY")).toUpperCase();
  const cleanedTitle = decodeEntities(String(title).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).split(/\s+(?:販売|\||通販)/)[0];
  return {
    title: cleanedTitle || "Imported card",
    code: codeMatch?.[0] || "",
    series: inferSeries(finalUrl, `${title} ${description}`),
    image,
    nativePrice: Number.isFinite(price) && price > 0 ? price : null,
    currency: ["JPY", "USD"].includes(currency) ? currency : "JPY",
    sourceUrl: finalUrl.href,
  };
}

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${host}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === "/api/extract") {
      const sourceUrl = requestUrl.searchParams.get("url");
      if (!sourceUrl) return json(response, 400, { error: "A card page URL is required." });
      try {
        const validated = await validatePublicUrl(sourceUrl);
        if (/(^|\.)yuyu-tei\.jp$/i.test(validated.hostname)) {
          return json(response, 200, { card: yuyuteiFallbackCard(validated) });
        }
        const { body, finalUrl } = await fetchPage(sourceUrl);
        return json(response, 200, { card: extractCard(body, finalUrl) });
      } catch (error) {
        return json(response, 422, { error: error.message || "The card page could not be read." });
      }
    }
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const normalized = normalize(relative);
    if (normalized.startsWith("..")) throw new Error("Invalid path");
    let file = join(root, normalized);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) file = join(root, "index.html");
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, host, () => {
  console.log(`CardBoy is running at http://${host}:${port}`);
});
