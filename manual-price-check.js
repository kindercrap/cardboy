export function cardValueCheckUrl(card = {}) {
  const candidates = [card.card_value_url, card.source_url];
  for (const value of candidates) {
    try {
      const url = new URL(value);
      if (!/(^|\.)card-value\.jp$/i.test(url.hostname)) continue;
      if (!/^\/onepiece\/cards\/[a-z0-9-]+\/?$/i.test(url.pathname)) continue;
      url.hash = "";
      url.search = "";
      return url.href;
    } catch {
      // Continue to the next saved URL.
    }
  }
  return null;
}

export function priceChangePercent(currentPrice, previousPrice) {
  const current = Number(currentPrice);
  const previous = Number(previousPrice);
  if (!Number.isFinite(current) || current < 0) return null;
  if (!Number.isFinite(previous) || previous <= 0) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(2));
}
