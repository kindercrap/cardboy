import test from "node:test";
import assert from "node:assert/strict";

import {
  createManualUpdateQueue,
  manualUpdateCandidates,
  manualUpdateQueueView,
  markManualUpdateComplete,
  markManualUpdateOpened,
  normalizeManualUpdateQueue,
  parseQuickUpdateSource,
} from "../manual-update-queue.js";

const cards = [
  { id: "one", sourceUrl: "https://yuyu-tei.jp/sell/opc/card/op01/10001", title: "One" },
  { id: "two", sourceUrl: "https://www.yuyu-tei.jp/sell/opc/card/op02/10002", title: "Two" },
  { id: "three", sourceUrl: "https://card-value.jp/onepiece/cards/op03-003/", title: "Three" },
];

test("creates a queue only from Yuyutei cards in collection order", () => {
  assert.deepEqual(manualUpdateCandidates(cards).map((card) => card.id), ["one", "two"]);
  assert.deepEqual(createManualUpdateQueue(cards, "2026-08-27T00:00:00.000Z"), {
    version: 1,
    startedAt: "2026-08-27T00:00:00.000Z",
    ids: ["one", "two"],
    completedIds: [],
    activeId: null,
  });
});

test("tracks an opened card and advances after it is completed", () => {
  let queue = createManualUpdateQueue(cards);
  queue = markManualUpdateOpened(queue, "one", cards);
  assert.equal(manualUpdateQueueView(queue, cards).current.active, true);
  const completed = markManualUpdateComplete(queue, "one", cards);
  const view = manualUpdateQueueView(completed.queue, cards);
  assert.equal(completed.changed, true);
  assert.equal(view.completed, 1);
  assert.equal(view.remaining, 1);
  assert.equal(view.current.card.id, "two");
});

test("normalization drops cards that no longer exist and ignores unrelated completions", () => {
  const normalized = normalizeManualUpdateQueue({
    version: 1,
    startedAt: "2026-08-27T00:00:00.000Z",
    ids: ["one", "missing", "two"],
    completedIds: ["missing", "one"],
    activeId: "missing",
  }, cards);
  assert.deepEqual(normalized.ids, ["one", "two"]);
  assert.deepEqual(normalized.completedIds, ["one"]);
  assert.equal(normalized.activeId, null);
});

test("recognizes and removes the quick-update marker used by old bookmarks", () => {
  assert.deepEqual(parseQuickUpdateSource("https://yuyu-tei.jp/sell/opc/card/op09/10155#cardboy-quick"), {
    sourceUrl: "https://yuyu-tei.jp/sell/opc/card/op09/10155",
    quick: true,
  });
  assert.deepEqual(parseQuickUpdateSource("https://yuyu-tei.jp/sell/opc/card/op09/10155"), {
    sourceUrl: "https://yuyu-tei.jp/sell/opc/card/op09/10155",
    quick: false,
  });
});
