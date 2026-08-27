export function normalizeCardOrder(cards = []) {
  const pinned = cards.filter((card) => card.pinned === true);
  const regular = cards.filter((card) => card.pinned !== true);
  return [...pinned, ...regular].map((card, index) => ({
    ...card,
    pinned: card.pinned === true,
    sortOrder: index,
  }));
}

export function toggleCardPinned(cards, cardId) {
  const current = cards.find((card) => card.id === cardId);
  if (!current) return { cards: normalizeCardOrder(cards), card: null };

  const card = { ...current, pinned: current.pinned !== true };
  const remaining = cards.filter((item) => item.id !== cardId);
  if (card.pinned) {
    remaining.unshift(card);
  } else {
    const firstRegularIndex = remaining.findIndex((item) => item.pinned !== true);
    remaining.splice(firstRegularIndex < 0 ? remaining.length : firstRegularIndex, 0, card);
  }

  const ordered = normalizeCardOrder(remaining);
  return { cards: ordered, card: ordered.find((item) => item.id === cardId) };
}

function convertedUnitPrice(card, rates) {
  const rate = Number(rates?.[card.currency]);
  return Number(card.nativePrice || 0) * (Number.isFinite(rate) ? rate : 1);
}

export function filterAndSortCards(cards = [], options = {}) {
  const series = String(options.series || "ALL");
  const ownership = String(options.ownership || "ALL");
  const search = String(options.search || "").trim().toLocaleLowerCase();
  const sort = String(options.sort || "CUSTOM");
  const originalIndex = new Map(cards.map((card, index) => [card.id, index]));
  const filtered = cards.filter((card) => {
    if (series !== "ALL" && card.series !== series) return false;
    if (ownership === "OWNED" && card.owned === false) return false;
    if (ownership === "WATCHING" && card.owned !== false) return false;
    if (!search) return true;
    return [card.title, card.code, card.series]
      .some((value) => String(value || "").toLocaleLowerCase().includes(search));
  });
  if (sort === "CUSTOM") return filtered;

  const comparison = (a, b) => {
    if (a.pinned === true && b.pinned !== true) return -1;
    if (a.pinned !== true && b.pinned === true) return 1;
    if (sort === "TOTAL_VALUE_DESC") {
      return convertedUnitPrice(b, options.rates) * Number(b.quantity || 0)
        - convertedUnitPrice(a, options.rates) * Number(a.quantity || 0);
    }
    if (sort === "UNIT_PRICE_DESC") return convertedUnitPrice(b, options.rates) - convertedUnitPrice(a, options.rates);
    if (sort === "CHANGE_DESC") return Number(b.change || 0) - Number(a.change || 0);
    if (sort === "CHANGE_ASC") return Number(a.change || 0) - Number(b.change || 0);
    if (sort === "QUANTITY_DESC") return Number(b.quantity || 0) - Number(a.quantity || 0);
    if (sort === "RECENT_DESC") return Date.parse(b.lastChecked || 0) - Date.parse(a.lastChecked || 0);
    if (sort === "NAME_ASC") return String(a.title || "").localeCompare(String(b.title || ""));
    return 0;
  };
  return [...filtered].sort((a, b) => comparison(a, b) || originalIndex.get(a.id) - originalIndex.get(b.id));
}
