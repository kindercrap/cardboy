import test from "node:test";
import assert from "node:assert/strict";

import { cardValueCheckUrl, priceChangePercent } from "../manual-price-check.js";

test("uses an exact saved Card-Value variant before the original source", () => {
  assert.equal(cardValueCheckUrl({
    source_url: "https://yuyu-tei.jp/sell/opc/card/op17/10022",
    card_value_url: "https://card-value.jp/onepiece/cards/op17-022-3/?ref=cardboy#price",
  }), "https://card-value.jp/onepiece/cards/op17-022-3/");
});

test("accepts a Card-Value card page as the original source", () => {
  assert.equal(cardValueCheckUrl({
    source_url: "https://card-value.jp/onepiece/cards/op17-022-3/",
  }), "https://card-value.jp/onepiece/cards/op17-022-3/");
});

test("rejects set pages, Yuyutei pages, and lookalike hosts", () => {
  assert.equal(cardValueCheckUrl({ source_url: "https://card-value.jp/onepiece/cards/pack/op17/" }), null);
  assert.equal(cardValueCheckUrl({ source_url: "https://yuyu-tei.jp/sell/opc/card/op17/10022" }), null);
  assert.equal(cardValueCheckUrl({ source_url: "https://card-value.jp.example.com/onepiece/cards/op17-022-3/" }), null);
});

test("calculates stable percentage movements", () => {
  assert.equal(priceChangePercent(298000, 348000), -14.37);
  assert.equal(priceChangePercent(348000, 298000), 16.78);
  assert.equal(priceChangePercent(1000, 0), 0);
});
