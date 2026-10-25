import test from "node:test";
import assert from "node:assert/strict";

import { createYuyuteiBookmarklet } from "../bookmarklet.js";

test("quick updates depend only on the queue hash, not window.opener", () => {
  const bookmarklet = createYuyuteiBookmarklet("https://kindercrap.github.io/cardboy/");

  assert.match(bookmarklet, /q=s\.hash==='#cardboy-quick'/);
  assert.doesNotMatch(bookmarklet, /window\.opener/);
  assert.match(bookmarklet, /autoSave=1#cards/);
});

test("bookmarklet keeps the configured CardBoy destination", () => {
  const bookmarklet = createYuyuteiBookmarklet("https://kindercrap.github.io/cardboy/");

  assert.match(bookmarklet, /https:\/\/kindercrap\.github\.io\/cardboy\//);
});
