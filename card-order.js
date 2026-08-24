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
