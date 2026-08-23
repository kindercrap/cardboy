const CARD_VALUE_ORIGIN = "https://card-value.jp";
const CARD_VALUE_ONE_PIECE_ROOT = `${CARD_VALUE_ORIGIN}/onepiece/cards/`;
const DEFAULT_USER_AGENT = "CardBoyPriceMonitor/2.0 (+https://github.com/kindercrap/cardboy)";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function randomDelay(minimum, maximum) {
  const low = Math.max(0, Number(minimum) || 0);
  const high = Math.max(low, Number(maximum) || low);
  return Math.round(low + Math.random() * (high - low));
}

export function decodeHtmlEntities(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    yen: "¥",
  };
  return String(value).replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (_match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? _match;
  });
}

function textContent(value = "") {
  return decodeHtmlEntities(String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

function compactText(value = "") {
  return textContent(value).replace(/[\s\u3000]+/g, "");
}

function attributeValue(attributes = "", name) {
  const escaped = escapeRegExp(name);
  const match = String(attributes).match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function elements(html, tagName) {
  const escaped = escapeRegExp(tagName);
  return [...String(html).matchAll(new RegExp(`<${escaped}\\b([^>]*)>([\\s\\S]*?)<\\/${escaped}>`, "gi"))]
    .map((match) => ({ attributes: match[1], html: match[2], full: match[0], index: match.index ?? -1 }));
}

function classElementHtml(html, className) {
  const openingTag = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  for (const match of String(html).matchAll(openingTag)) {
    const classes = attributeValue(match[2], "class").split(/\s+/).filter(Boolean);
    if (!classes.includes(className)) continue;
    const endTag = `</${match[1]}>`;
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = String(html).toLowerCase().indexOf(endTag.toLowerCase(), contentStart);
    return contentEnd >= 0 ? String(html).slice(contentStart, contentEnd) : "";
  }
  return "";
}

function findSectionByHeading(html, headingText) {
  for (const section of elements(html, "section")) {
    const heading = section.html.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || "";
    if (compactText(heading).includes(compactText(headingText))) return section.full;
  }

  const headings = [...String(html).matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const targetIndex = headings.findIndex((heading) => compactText(heading[2]).includes(compactText(headingText)));
  if (targetIndex < 0) return "";
  const target = headings[targetIndex];
  const start = target.index ?? 0;
  const targetLevel = Number(target[1]);
  const next = headings.slice(targetIndex + 1).find((heading) => Number(heading[1]) <= targetLevel);
  return String(html).slice(start, next?.index ?? String(html).length);
}

function tableRows(tableHtml) {
  return elements(tableHtml, "tr").map((row) => ({
    ...row,
    cells: [...row.html.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map((cell) => ({
      tag: cell[1].toLowerCase(),
      attributes: cell[2],
      html: cell[3],
      text: textContent(cell[3]),
    })),
  }));
}

function tableValueByLabel(sectionHtml, label) {
  for (const table of elements(sectionHtml, "table")) {
    for (const row of tableRows(table.html)) {
      if (row.cells.length < 2 || compactText(row.cells[0].text) !== compactText(label)) continue;
      return textContent(row.cells[1].html);
    }
  }
  return "";
}

function linksFromHtml(html, baseUrl) {
  const links = [];
  for (const match of String(html).matchAll(/<a\b([^>]*)>/gi)) {
    const href = attributeValue(match[1], "href");
    if (!href) continue;
    try {
      links.push(new URL(href, baseUrl).href);
    } catch {
      // Ignore malformed third-party links.
    }
  }
  return links;
}

function metaContent(html, key) {
  const escaped = escapeRegExp(key);
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match) return decodeHtmlEntities(match[1].trim());
  }
  return "";
}

export function parseJapanesePrice(value) {
  const match = String(value ?? "").match(/[¥￥]\s*([0-9][0-9,]*)/);
  if (!match) return null;
  const parsed = Number(match[1].replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function calculatePriceMovement(currentPrice, previousPrice) {
  const current = Number(currentPrice);
  const previous = previousPrice === null || previousPrice === undefined ? null : Number(previousPrice);
  if (!Number.isFinite(current) || current < 0) throw new Error("The current price must be a non-negative number.");
  if (previous === null) return { priceChange: null, percentageChange: null };
  if (!Number.isFinite(previous) || previous < 0) throw new Error("The previous price must be a non-negative number.");
  const priceChange = current - previous;
  const percentageChange = previous === 0 ? null : Number(((priceChange / previous) * 100).toFixed(2));
  return { priceChange, percentageChange };
}

export function canonicalExternalUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.href.replace(/\/$/, "").toLowerCase();
}

export function isCardValueCardUrl(value) {
  try {
    const url = new URL(value);
    return /(^|\.)card-value\.jp$/i.test(url.hostname)
      && /^\/onepiece\/cards\/[a-z0-9-]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isYuyuteiOnePieceSellingUrl(value) {
  try {
    const url = new URL(value);
    return /(^|\.)yuyu-tei\.jp$/i.test(url.hostname)
      && /^\/sell\/opc\/card\/[a-z0-9-]+\/\d+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function yuyuteiSetCode(value) {
  if (!isYuyuteiOnePieceSellingUrl(value)) return "";
  return new URL(value).pathname.match(/^\/sell\/opc\/card\/([^/]+)\//i)?.[1]?.toUpperCase() || "";
}

function sellingTableResult(html, cardValueUrl) {
  const section = findSectionByHeading(html, "店舗別販売価格");
  if (!section) return { yuyuteiPrice: null, yuyuteiUrl: null };

  for (const table of elements(section, "table")) {
    const rows = tableRows(table.html);
    const header = rows.find((row) => row.cells.some((cell) => cell.tag === "th"));
    if (!header) continue;
    const sellingColumn = header.cells.findIndex((cell) => {
      const label = compactText(cell.text);
      return label.includes("販売価格") && !label.includes("買取価格");
    });
    if (sellingColumn < 0) continue;

    for (const row of rows) {
      const storeColumn = row.cells.findIndex((cell) => compactText(cell.text).includes("遊々亭"));
      if (storeColumn < 0) continue;
      const priceCell = row.cells.find((cell) => {
        const label = compactText(attributeValue(cell.attributes, "data-label"));
        return label.includes("販売価格") && !label.includes("買取価格");
      }) || row.cells[sellingColumn];
      const yuyuteiUrl = linksFromHtml(row.html, cardValueUrl).find((href) => {
        try {
          const url = new URL(href);
          return /(^|\.)yuyu-tei\.jp$/i.test(url.hostname) && url.pathname.startsWith("/sell/");
        } catch {
          return false;
        }
      }) || null;
      return {
        yuyuteiPrice: parseJapanesePrice(priceCell?.text || ""),
        yuyuteiUrl,
      };
    }
  }
  return { yuyuteiPrice: null, yuyuteiUrl: null };
}

export function parseCardValuePage(html, cardValueUrl, { checkedAt = new Date().toISOString() } = {}) {
  if (!isCardValueCardUrl(cardValueUrl)) throw new Error("A Card-Value One Piece card URL is required.");
  const normalizedCardValueUrl = new URL(cardValueUrl);
  normalizedCardValueUrl.hash = "";
  normalizedCardValueUrl.search = "";
  const infoSection = findSectionByHeading(html, "情報");
  const cardName = textContent(classElementHtml(html, "cg-card-name-character"))
    || tableValueByLabel(infoSection, "カード名")
    || "";
  const cardNumber = (textContent(classElementHtml(html, "cg-card-name-number"))
    || tableValueByLabel(infoSection, "カード番号")
    || textContent(html).match(/\b(?:OP|ST|EB|PRB|P)-?\d{2,3}-\d{2,3}\b/i)?.[0]
    || "").replace(/^#/, "").toUpperCase();
  const rawVariant = textContent(classElementHtml(html, "cg-card-name-parallel"))
    || tableValueByLabel(infoSection, "パラレル")
    || "";
  const variant = rawVariant && !/^(?:-|なし|通常)$/i.test(rawVariant) ? rawVariant : null;
  const selling = sellingTableResult(html, normalizedCardValueUrl.href);
  return {
    cardName,
    cardNumber,
    variant,
    yuyuteiPrice: selling.yuyuteiPrice,
    currency: "JPY",
    source: "yuyutei",
    sourceVia: "card-value.jp",
    cardValueUrl: normalizedCardValueUrl.href,
    yuyuteiUrl: selling.yuyuteiUrl,
    checkedAt,
  };
}

export function extractCardValueImage(html, cardValueUrl) {
  const imageTag = String(html).match(/<img\b([^>]*class=["'][^"']*c-articleThumb__img[^"']*["'][^>]*)>/i);
  const source = imageTag ? attributeValue(imageTag[1], "src") : metaContent(html, "og:image");
  if (!source) return "";
  try {
    const imageUrl = new URL(source, cardValueUrl);
    return ["http:", "https:"].includes(imageUrl.protocol) ? imageUrl.href : "";
  } catch {
    return "";
  }
}

export function discoverCardValueVariantUrls(html, setPageUrl) {
  const listSection = findSectionByHeading(html, "レアリティ別カード一覧") || html;
  const urls = linksFromHtml(listSection, setPageUrl).filter((href) => {
    try {
      const url = new URL(href);
      return /(^|\.)card-value\.jp$/i.test(url.hostname)
        && /^\/onepiece\/cards\/[a-z0-9-]+\/$/i.test(url.pathname);
    } catch {
      return false;
    }
  });
  return [...new Set(urls.map((href) => new URL(href).href))];
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, runWorker));
  return results;
}

export function createCardValueScraper({
  fetchImpl = globalThis.fetch,
  concurrency = 3,
  minimumDelayMs = 650,
  maximumDelayMs = 1250,
  retries = 3,
  requestTimeoutMs = 20_000,
  logger = console,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const cache = new Map();
  let requestGate = Promise.resolve();
  let nextRequestAt = 0;

  async function waitForRequestTurn() {
    let unlock;
    const previous = requestGate;
    requestGate = new Promise((resolve) => { unlock = resolve; });
    await previous;
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await sleep(wait);
    nextRequestAt = Date.now() + randomDelay(minimumDelayMs, maximumDelayMs);
    unlock();
  }

  async function requestHtml(url) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      await waitForRequestTurn();
      try {
        const response = await fetchImpl(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(requestTimeoutMs),
          headers: {
            "User-Agent": userAgent,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
          },
        });
        if (response.ok) {
          const contentType = response.headers?.get?.("content-type") || "text/html";
          if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
            throw new Error("Card-Value returned a non-HTML response.");
          }
          const body = await response.text();
          if (body.length > 3_000_000) throw new Error("The Card-Value page is too large to process.");
          return body;
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === retries) throw new Error(`Card-Value returned HTTP ${response.status}.`);
        const retryAfter = Number(response.headers?.get?.("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * (2 ** attempt));
      } catch (error) {
        lastError = error;
        if (attempt === retries) break;
        await sleep(500 * (2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Card-Value request failed.");
  }

  async function fetchHtml(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(^|\.)card-value\.jp$/i.test(url.hostname)) {
      throw new Error("Only HTTPS pages from card-value.jp are supported.");
    }
    url.hash = "";
    url.search = "";
    const key = url.href;
    if (!cache.has(key)) {
      cache.set(key, requestHtml(key).catch((error) => {
        cache.delete(key);
        throw error;
      }));
    }
    return cache.get(key);
  }

  async function getYuyuteiSellingPrice(cardUrl) {
    if (!isCardValueCardUrl(cardUrl)) throw new Error("A Card-Value One Piece card URL is required.");
    const html = await fetchHtml(cardUrl);
    const result = parseCardValuePage(html, cardUrl);
    logger?.log?.(`[PRICE] ${result.cardNumber || "UNKNOWN"}${result.variant ? ` ${result.variant}` : ""}`);
    logger?.log?.(`[YUYUTEI] ${result.yuyuteiPrice === null ? "not listed" : `¥${result.yuyuteiPrice.toLocaleString("en-US")}`}`);
    logger?.log?.("[SOURCE] card-value.jp");
    logger?.log?.(`[TIME] ${result.checkedAt}`);
    return result;
  }

  async function discoverSet(setCode) {
    const normalized = String(setCode || "").trim().toUpperCase();
    if (!/^[A-Z]{1,5}\d{1,3}$/.test(normalized)) throw new Error(`Invalid One Piece set code: ${setCode}`);
    const setPageUrl = `${CARD_VALUE_ONE_PIECE_ROOT}pack/${normalized.toLowerCase()}/`;
    return discoverCardValueVariantUrls(await fetchHtml(setPageUrl), setPageUrl);
  }

  async function scrapeCardUrls(urls) {
    return mapWithConcurrency([...new Set(urls)], concurrency, async (url) => {
      try {
        return await getYuyuteiSellingPrice(url);
      } catch (error) {
        logger?.warn?.(`[CARD-VALUE] ${url}: ${error instanceof Error ? error.message : "request failed"}`);
        return null;
      }
    });
  }

  async function scrapeSetYuyuteiPrices(setCode, { minimumPrice } = {}) {
    const results = (await scrapeCardUrls(await discoverSet(setCode))).filter(Boolean);
    const filtered = minimumPrice === undefined
      ? results
      : results.filter((result) => result.yuyuteiPrice !== null && result.yuyuteiPrice > Number(minimumPrice));
    return filtered.sort((left, right) => (right.yuyuteiPrice ?? -1) - (left.yuyuteiPrice ?? -1));
  }

  return {
    cache,
    discoverSet,
    fetchHtml,
    getYuyuteiSellingPrice,
    scrapeCardUrls,
    scrapeSetYuyuteiPrices,
  };
}

export async function getYuyuteiSellingPrice(cardUrl, options = {}) {
  return createCardValueScraper(options).getYuyuteiSellingPrice(cardUrl);
}

export async function scrapeSetYuyuteiPrices(setCode, options = {}) {
  const { minimumPrice, ...scraperOptions } = options;
  return createCardValueScraper(scraperOptions).scrapeSetYuyuteiPrices(setCode, { minimumPrice });
}

export async function resolveSavedCardValueListings(cards, { scraper = createCardValueScraper() } = {}) {
  const candidatesBySource = new Map();
  const setUrls = new Map();

  for (const card of cards) {
    const sourceKey = canonicalExternalUrl(card.source_url);
    if (!sourceKey || candidatesBySource.has(sourceKey)) continue;
    if (isCardValueCardUrl(card.source_url)) {
      candidatesBySource.set(sourceKey, [card.source_url]);
      continue;
    }
    if (!isYuyuteiOnePieceSellingUrl(card.source_url)) {
      candidatesBySource.set(sourceKey, []);
      continue;
    }
    if (isCardValueCardUrl(card.card_value_url)) {
      candidatesBySource.set(sourceKey, [card.card_value_url]);
      continue;
    }
    const setCode = yuyuteiSetCode(card.source_url);
    if (!setUrls.has(setCode)) {
      try {
        setUrls.set(setCode, await scraper.discoverSet(setCode));
      } catch {
        setUrls.set(setCode, []);
      }
    }
    const number = String(card.code || "").trim().toLowerCase();
    const pattern = number ? new RegExp(`^${escapeRegExp(number)}(?:-[a-z0-9]+)*$`, "i") : null;
    candidatesBySource.set(sourceKey, (setUrls.get(setCode) || []).filter((cardUrl) => {
      const slug = new URL(cardUrl).pathname.split("/").filter(Boolean).at(-1) || "";
      return pattern?.test(slug);
    }));
  }

  const candidateUrls = [...new Set([...candidatesBySource.values()].flat())];
  const scraped = (await scraper.scrapeCardUrls(candidateUrls)).filter(Boolean);
  const byCardValueUrl = new Map(scraped.map((result) => [canonicalExternalUrl(result.cardValueUrl), result]));
  const byYuyuteiUrl = new Map(scraped
    .filter((result) => result.yuyuteiUrl)
    .map((result) => [canonicalExternalUrl(result.yuyuteiUrl), result]));
  const resolved = new Map();

  for (const [sourceKey, candidates] of candidatesBySource) {
    if (isCardValueCardUrl(sourceKey)) {
      const direct = byCardValueUrl.get(sourceKey);
      if (direct) resolved.set(sourceKey, direct);
      continue;
    }
    const exact = byYuyuteiUrl.get(sourceKey);
    if (exact) {
      resolved.set(sourceKey, exact);
      continue;
    }
    for (const candidate of candidates) {
      const result = byCardValueUrl.get(canonicalExternalUrl(candidate));
      if (result?.yuyuteiUrl && canonicalExternalUrl(result.yuyuteiUrl) === sourceKey) {
        resolved.set(sourceKey, result);
        break;
      }
    }
  }
  return resolved;
}
