import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortCards, normalizeCardOrder, toggleCardPinned } from "../card-order.js";

test("normalizes pinned cards ahead of regular cards without changing group order", () => {
  const cards = normalizeCardOrder([
    { id: "regular-a" },
    { id: "pinned-a", pinned: true },
    { id: "regular-b" },
    { id: "pinned-b", pinned: true },
  ]);

  assert.deepEqual(cards.map((card) => card.id), ["pinned-a", "pinned-b", "regular-a", "regular-b"]);
  assert.deepEqual(cards.map((card) => card.sortOrder), [0, 1, 2, 3]);
});

test("pinning places a card first and unpinning places it at the regular-group boundary", () => {
  const initial = normalizeCardOrder([
    { id: "pinned-a", pinned: true },
    { id: "regular-a" },
    { id: "regular-b" },
  ]);
  const pinned = toggleCardPinned(initial, "regular-b");
  assert.deepEqual(pinned.cards.map((card) => card.id), ["regular-b", "pinned-a", "regular-a"]);
  assert.equal(pinned.card.pinned, true);

  const unpinned = toggleCardPinned(pinned.cards, "regular-b");
  assert.deepEqual(unpinned.cards.map((card) => card.id), ["pinned-a", "regular-b", "regular-a"]);
  assert.equal(unpinned.card.pinned, false);
});

test("a new regular card stays at the bottom below pinned cards", () => {
  const cards = normalizeCardOrder([
    { id: "pinned", pinned: true },
    { id: "regular" },
    { id: "new-card" },
  ]);

  assert.deepEqual(cards.map((card) => card.id), ["pinned", "regular", "new-card"]);
});

const viewCards = [
  { id: "watch", title: "Nami", code: "OP01-001", series: "ONE PIECE", owned: false, currency: "JPY", nativePrice: 5000, quantity: 1, change: -8, lastChecked: "2026-08-24T00:00:00Z" },
  { id: "owned", title: "Shanks", code: "OP02-001", series: "ONE PIECE", owned: true, currency: "JPY", nativePrice: 2000, quantity: 4, change: 12, lastChecked: "2026-08-27T00:00:00Z" },
  { id: "pinned", title: "Gundam", code: "GD01-001", series: "GUNDAM", owned: true, pinned: true, currency: "JPY", nativePrice: 100, quantity: 1, change: 1, lastChecked: "2026-08-20T00:00:00Z" },
];

test("filters collection cards by ownership, series, and text", () => {
  assert.deepEqual(filterAndSortCards(viewCards, { ownership: "OWNED" }).map((card) => card.id), ["owned", "pinned"]);
  assert.deepEqual(filterAndSortCards(viewCards, { ownership: "WATCHING" }).map((card) => card.id), ["watch"]);
  assert.deepEqual(filterAndSortCards(viewCards, { series: "ONE PIECE", search: "op02" }).map((card) => card.id), ["owned"]);
});

test("keeps pinned cards first while sorting the remaining collection", () => {
  const sorted = filterAndSortCards(viewCards, { sort: "TOTAL_VALUE_DESC", rates: { JPY: 0.4 } });
  assert.deepEqual(sorted.map((card) => card.id), ["pinned", "owned", "watch"]);
  assert.deepEqual(filterAndSortCards(viewCards, { sort: "CHANGE_ASC" }).map((card) => card.id), ["pinned", "watch", "owned"]);
});
