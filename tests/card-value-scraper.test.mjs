import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePriceMovement,
  createCardValueScraper,
  discoverCardValueVariantUrls,
  parseCardValuePage,
  parseJapanesePrice,
} from "../supabase/functions/_shared/card-value.js";

function cardPage({
  name = "シャンクス",
  number = "OP17-022",
  variant = "スーパーパラレル",
  buyPrice = "¥230,000",
  sellingRows = '<tr><td data-label="店舗"><a href="https://yuyu-tei.jp/sell/opc/card/op17/10029">遊々亭</a></td><td data-label="販売価格" class="price-sell">¥348,000</td></tr>',
} = {}) {
  return `<!doctype html><html><body>
    <div class="cg-card-name-hero">
      <div class="cg-card-name-character">${name}</div>
      <div class="cg-card-name-meta">
        ${variant ? `<a class="cg-card-name-parallel">${variant}</a>` : ""}
        <span class="cg-card-name-number">#${number}</span>
      </div>
    </div>
    <section id="card-toc-shop-buy-prices">
      <h2>${name}の店舗別買取価格</h2>
      <table><thead><tr><th>店舗</th><th>買取価格</th></tr></thead><tbody>
        <tr><td data-label="店舗"><a href="https://yuyu-tei.jp/buy/opc/card/op17/10029">遊々亭</a></td><td data-label="買取価格">${buyPrice}</td></tr>
      </tbody></table>
    </section>
    <section id="card-toc-shop-sell-prices">
      <h2>${name}の店舗別販売価格</h2>
      <div class="average-price-summary"><h3>平均販売価格</h3><div>¥999,999</div></div>
      <table><thead><tr><th>店舗</th><th>販売価格</th></tr></thead><tbody>${sellingRows}</tbody></table>
    </section>
    <section id="card-toc-card-info">
      <h2>${name}の情報</h2>
      <table><tbody>
        <tr><th>カード名</th><td>${name}</td></tr>
        ${variant ? `<tr><th>パラレル</th><td>${variant}</td></tr>` : ""}
        <tr><th>カード番号</th><td>${number}</td></tr>
      </tbody></table>
    </section>
  </body></html>`;
}

test("parseJapanesePrice converts Japanese formatted yen prices", () => {
  assert.equal(parseJapanesePrice("¥348,000"), 348000);
  assert.equal(parseJapanesePrice("¥39,800"), 39800);
  assert.equal(parseJapanesePrice("¥12,800"), 12800);
  assert.equal(parseJapanesePrice("¥1,980,000"), 1980000);
  assert.equal(parseJapanesePrice("price unavailable"), null);
});

test("daily movement calculation compares against the previous observation", () => {
  assert.deepEqual(calculatePriceMovement(298000, 348000), {
    priceChange: -50000,
    percentageChange: -14.37,
  });
  assert.deepEqual(calculatePriceMovement(348000, null), {
    priceChange: null,
    percentageChange: null,
  });
});

test("parser reads only Yuyutei from the store-by-store selling table", () => {
  const result = parseCardValuePage(
    cardPage(),
    "https://card-value.jp/onepiece/cards/op17-022-3/",
    { checkedAt: "2026-08-23T01:15:00.000Z" },
  );
  assert.deepEqual(result, {
    cardName: "シャンクス",
    cardNumber: "OP17-022",
    variant: "スーパーパラレル",
    yuyuteiPrice: 348000,
    currency: "JPY",
    source: "yuyutei",
    sourceVia: "card-value.jp",
    cardValueUrl: "https://card-value.jp/onepiece/cards/op17-022-3/",
    yuyuteiUrl: "https://yuyu-tei.jp/sell/opc/card/op17/10029",
    checkedAt: "2026-08-23T01:15:00.000Z",
  });
});

test("buy prices and selling averages are never used as a fallback", () => {
  const result = parseCardValuePage(
    cardPage({
      buyPrice: "¥1,980,000",
      sellingRows: '<tr><td data-label="店舗"><a href="https://another-store.example/item">別店舗</a></td><td data-label="販売価格">¥12,800</td></tr>',
    }),
    "https://card-value.jp/onepiece/cards/op17-022-3/",
  );
  assert.equal(result.yuyuteiPrice, null);
  assert.equal(result.yuyuteiUrl, null);
});

test("variant is null when Card-Value has no parallel classification", () => {
  const result = parseCardValuePage(
    cardPage({ variant: "", sellingRows: "" }),
    "https://card-value.jp/onepiece/cards/op17-022/",
  );
  assert.equal(result.variant, null);
  assert.equal(result.yuyuteiPrice, null);
});

test("set discovery isolates direct card-variant links", () => {
  const html = `
    <a href="https://card-value.jp/onepiece/cards/unrelated-001/">outside</a>
    <section><h2>[OP17]のレアリティ別カード一覧</h2>
      <a href="/onepiece/cards/op17-022/">normal</a>
      <a href="/onepiece/cards/op17-022-2/">parallel</a>
      <a href="/onepiece/cards/op17-022-3/">super parallel</a>
      <a href="/onepiece/cards/pack/op17/">pack</a>
    </section>`;
  assert.deepEqual(discoverCardValueVariantUrls(html, "https://card-value.jp/onepiece/cards/pack/op17/"), [
    "https://card-value.jp/onepiece/cards/op17-022/",
    "https://card-value.jp/onepiece/cards/op17-022-2/",
    "https://card-value.jp/onepiece/cards/op17-022-3/",
  ]);
});

test("set scraping is cached, rate-limited, sorted, and applies a strict minimum", async () => {
  const setUrl = "https://card-value.jp/onepiece/cards/pack/op17/";
  const firstUrl = "https://card-value.jp/onepiece/cards/op17-022-3/";
  const secondUrl = "https://card-value.jp/onepiece/cards/op17-005-3/";
  const pages = new Map([
    [setUrl, `<section><h2>レアリティ別カード一覧</h2><a href="${firstUrl}">A</a><a href="${secondUrl}">B</a></section>`],
    [firstUrl, cardPage()],
    [secondUrl, cardPage({ name: "エドワード・ニューゲート", number: "OP17-005", sellingRows: '<tr><td data-label="店舗"><a href="https://yuyu-tei.jp/sell/opc/card/op17/10002">遊々亭</a></td><td data-label="販売価格">¥12,800</td></tr>' })],
  ]);
  const calls = new Map();
  const fetchImpl = async (url) => {
    calls.set(url, (calls.get(url) || 0) + 1);
    return new Response(pages.get(url) || "missing", {
      status: pages.has(url) ? 200 : 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
  const scraper = createCardValueScraper({
    fetchImpl,
    minimumDelayMs: 0,
    maximumDelayMs: 0,
    retries: 0,
    logger: null,
  });
  const results = await scraper.scrapeSetYuyuteiPrices("OP17", { minimumPrice: 12800 });
  assert.deepEqual(results.map((result) => result.yuyuteiPrice), [348000]);
  await scraper.getYuyuteiSellingPrice(firstUrl);
  assert.equal(calls.get(firstUrl), 1);
});
