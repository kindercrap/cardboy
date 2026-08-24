export const MONITOR_STATUS_ACTIVE_POLL_MS = 5000;
export const MONITOR_STATUS_IDLE_POLL_MS = 60000;
export const MONITOR_RUNNING_MAX_AGE_MS = 30 * 60 * 1000;
export const MONITOR_RECENT_RESULT_MS = 10 * 60 * 1000;

export function createInitialMonitorRun() {
  return {
    status: "idle",
    trigger: "scheduled",
    startedAt: null,
    completedAt: null,
    lastSuccessAt: null,
    processedSources: 0,
    totalSources: 0,
    checkedSources: 0,
    observations: 0,
    movements: 0,
    unsupportedSources: 0,
    message: "Waiting for the next scheduled price check.",
  };
}

export function normalizeMonitorRun(row) {
  if (!row) return createInitialMonitorRun();
  return {
    status: row.status || "idle",
    trigger: row.trigger || "scheduled",
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    lastSuccessAt: row.last_success_at || null,
    processedSources: Number(row.processed_sources || 0),
    totalSources: Number(row.total_sources || 0),
    checkedSources: Number(row.checked_sources || 0),
    observations: Number(row.observations || 0),
    movements: Number(row.movements || 0),
    unsupportedSources: Number(row.unsupported_sources || 0),
    message: row.message || "Waiting for the next scheduled price check.",
  };
}

export function monitorRunSignature(run) {
  return JSON.stringify(run || {});
}

function formatPhtTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function monitorStatusView(run, { now = Date.now(), dailyCheckLabel = "9:15 AM PHT" } = {}) {
  const current = run || createInitialMonitorRun();
  const startedAt = current.startedAt ? new Date(current.startedAt).getTime() : NaN;
  const completedAt = current.completedAt ? new Date(current.completedAt).getTime() : NaN;
  const runningIsFresh = current.status === "running"
    && (!Number.isFinite(startedAt) || (now - startedAt >= -60000 && now - startedAt < MONITOR_RUNNING_MAX_AGE_MS));

  if (runningIsFresh) {
    const progress = current.totalSources > 0
      ? ` · ${Math.min(current.processedSources, current.totalSources)}/${current.totalSources}`
      : "";
    return {
      className: "running",
      label: `CHECKING LATEST PRICES${progress}`,
      title: `${current.message || "Checking the latest Yuyutei selling prices via Card-Value."}${current.startedAt ? ` Started ${formatPhtTime(current.startedAt)} PHT.` : ""}`,
      running: true,
    };
  }

  const resultIsRecent = Number.isFinite(completedAt) && now - completedAt >= 0 && now - completedAt < MONITOR_RECENT_RESULT_MS;
  if (current.status === "success" && resultIsRecent) {
    return {
      className: "complete",
      label: `PRICES UPDATED · ${current.checkedSources} CHECKED`,
      title: `${current.message} Completed ${formatPhtTime(current.completedAt)} PHT.`,
      running: false,
    };
  }
  if (current.status === "error" && resultIsRecent) {
    return {
      className: "error",
      label: "PRICE CHECK INTERRUPTED",
      title: `${current.message} The automatic monitor will retry at ${dailyCheckLabel}.`,
      running: false,
    };
  }

  const lastSuccess = current.lastSuccessAt
    ? ` Last completed ${formatPhtTime(current.lastSuccessAt)} PHT with ${current.checkedSources} sources checked.`
    : "";
  return {
    className: "scheduled",
    label: `YUYUTEI VIA CARD-VALUE · ${dailyCheckLabel}`,
    title: `Automatic price monitoring starts daily at ${dailyCheckLabel}.${lastSuccess}`,
    running: false,
  };
}
