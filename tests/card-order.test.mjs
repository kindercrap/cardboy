import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCardOrder, toggleCardPinned } from "../card-order.js";

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
