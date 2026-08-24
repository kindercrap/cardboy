import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialMonitorRun,
  monitorStatusView,
  normalizeMonitorRun,
} from "../monitor-status.js";

const now = new Date("2026-08-24T01:16:00.000Z").getTime();

test("normalizes the public monitor row for the browser", () => {
  const run = normalizeMonitorRun({
    status: "running",
    started_at: "2026-08-24T01:15:00.000Z",
    processed_sources: 8,
    total_sources: 21,
    checked_sources: 7,
  });
  assert.equal(run.startedAt, "2026-08-24T01:15:00.000Z");
  assert.equal(run.processedSources, 8);
  assert.equal(run.totalSources, 21);
  assert.equal(run.checkedSources, 7);
});

test("shows live progress during a fresh monitor run", () => {
  const view = monitorStatusView({
    ...createInitialMonitorRun(),
    status: "running",
    startedAt: "2026-08-24T01:15:00.000Z",
    processedSources: 8,
    totalSources: 21,
    message: "Checked 8 of 21 sources.",
  }, { now });
  assert.equal(view.running, true);
  assert.equal(view.className, "running");
  assert.equal(view.label, "CHECKING LATEST PRICES · 8/21");
});

test("shows a recent successful result before returning to the schedule", () => {
  const view = monitorStatusView({
    ...createInitialMonitorRun(),
    status: "success",
    completedAt: "2026-08-24T01:15:30.000Z",
    checkedSources: 21,
    message: "21 sources checked. 0 price movements found.",
  }, { now });
  assert.equal(view.className, "complete");
  assert.equal(view.label, "PRICES UPDATED · 21 CHECKED");
});

test("shows an interrupted state for a recent failed run", () => {
  const view = monitorStatusView({
    ...createInitialMonitorRun(),
    status: "error",
    completedAt: "2026-08-24T01:15:30.000Z",
    message: "Card-Value did not respond.",
  }, { now });
  assert.equal(view.className, "error");
  assert.equal(view.label, "PRICE CHECK INTERRUPTED");
});

test("ignores stale running states and returns to the daily schedule", () => {
  const view = monitorStatusView({
    ...createInitialMonitorRun(),
    status: "running",
    startedAt: "2026-08-24T00:30:00.000Z",
    lastSuccessAt: "2026-08-23T01:16:00.000Z",
    checkedSources: 21,
  }, { now, dailyCheckLabel: "9:15 AM PHT" });
  assert.equal(view.running, false);
  assert.equal(view.className, "scheduled");
  assert.equal(view.label, "YUYUTEI VIA CARD-VALUE · 9:15 AM PHT");
});
