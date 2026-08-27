const QUEUE_VERSION = 1;

function isYuyuteiUrl(value) {
  try {
    return /(^|\.)yuyu-tei\.jp$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function parseQuickUpdateSource(value) {
  try {
    const url = new URL(value);
    const quick = url.hash === "#cardboy-quick";
    if (quick) url.hash = "";
    return { sourceUrl: url.href, quick };
  } catch {
    return { sourceUrl: String(value || ""), quick: false };
  }
}

export function applyPriceOnlyImport(existingCard, importedCard, checkedAt = new Date().toISOString()) {
  if (!existingCard || typeof existingCard !== "object") return null;
  const nativePrice = Number(importedCard?.nativePrice);
  if (!Number.isFinite(nativePrice) || nativePrice < 0) return null;
  return {
    ...existingCard,
    nativePrice,
    lastChecked: checkedAt,
  };
}

export function manualUpdateCandidates(cards = []) {
  return cards.filter((card) => card?.id && isYuyuteiUrl(card.sourceUrl ?? card.source_url));
}

export function createManualUpdateQueue(cards = [], startedAt = new Date().toISOString()) {
  return {
    version: QUEUE_VERSION,
    startedAt,
    ids: manualUpdateCandidates(cards).map((card) => String(card.id)),
    completedIds: [],
    activeId: null,
  };
}

export function normalizeManualUpdateQueue(value, cards = []) {
  if (!value || value.version !== QUEUE_VERSION || !Array.isArray(value.ids)) return null;
  const availableIds = new Set(manualUpdateCandidates(cards).map((card) => String(card.id)));
  const ids = [...new Set(value.ids.map(String))].filter((id) => availableIds.has(id));
  const completedIds = [...new Set((value.completedIds || []).map(String))]
    .filter((id) => ids.includes(id));
  const activeId = ids.includes(String(value.activeId)) && !completedIds.includes(String(value.activeId))
    ? String(value.activeId)
    : null;
  return {
    version: QUEUE_VERSION,
    startedAt: value.startedAt || new Date().toISOString(),
    ids,
    completedIds,
    activeId,
  };
}

export function manualUpdateQueueView(queue, cards = []) {
  const normalized = normalizeManualUpdateQueue(queue, cards);
  if (!normalized) return { queue: null, entries: [], current: null, total: 0, completed: 0, remaining: 0 };
  const byId = new Map(cards.map((card) => [String(card.id), card]));
  const completed = new Set(normalized.completedIds);
  const entries = normalized.ids.map((id) => ({
    card: byId.get(id),
    completed: completed.has(id),
    active: normalized.activeId === id,
  })).filter((entry) => entry.card);
  return {
    queue: normalized,
    entries,
    current: entries.find((entry) => !entry.completed) || null,
    total: entries.length,
    completed: entries.filter((entry) => entry.completed).length,
    remaining: entries.filter((entry) => !entry.completed).length,
  };
}

export function markManualUpdateOpened(queue, cardId, cards = []) {
  const normalized = normalizeManualUpdateQueue(queue, cards);
  const id = String(cardId);
  if (!normalized || !normalized.ids.includes(id) || normalized.completedIds.includes(id)) return normalized;
  return { ...normalized, activeId: id };
}

export function markManualUpdateComplete(queue, cardId, cards = []) {
  const normalized = normalizeManualUpdateQueue(queue, cards);
  const id = String(cardId);
  if (!normalized || !normalized.ids.includes(id)) return { queue: normalized, changed: false };
  const changed = !normalized.completedIds.includes(id);
  const completedIds = changed ? [...normalized.completedIds, id] : normalized.completedIds;
  return {
    queue: { ...normalized, completedIds, activeId: null },
    changed,
  };
}
