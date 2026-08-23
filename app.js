import { backend } from "./backend.js";

const STORAGE_KEY = "cardboy-demo-v1";
const APP_SCHEMA_VERSION = 3;
const DAILY_CHECK_HOUR = 9;
const DAILY_CHECK_LABEL = "9:00 AM PHT";

const SERIES = {
  "ONE PIECE": { color: "#ffd43b", bg: "#cc5d26", shape: "#ffd43b", mark: "OP" },
  GUNDAM: { color: "#55c9ff", bg: "#244b7a", shape: "#78a9cc", mark: "GD" },
  "TOKYO GHOUL": { color: "#ff5a66", bg: "#39233f", shape: "#a72d58", mark: "TG" },
  POKÉMON: { color: "#b88cff", bg: "#443090", shape: "#8d76ee", mark: "PK" },
  "DRAGON BALL": { color: "#ffad4b", bg: "#8c391d", shape: "#ff9448", mark: "DB" },
};

const defaultCards = [
  {
    id: "op08-106",
    series: "ONE PIECE",
    code: "OP08-106",
    title: "Nami",
    quantity: 6,
    sourceUrl: "https://yuyu-tei.jp/sell/opc/card/op09/10155",
    currency: "JPY",
    nativePrice: 39800,
    image: "https://card.yuyu-tei.jp/opc/front/op09/10155.jpg",
    change: 2.3,
    lastChecked: new Date().toISOString(),
    history: [31800, 32400, 33100, 32900, 34200, 35100, 36300, 35800, 37100, 38200, 38900, 39800],
  },
  {
    id: "gd01-019",
    series: "GUNDAM",
    code: "GD01-019",
    title: "Wing Zero",
    quantity: 2,
    sourceUrl: "https://example.com/gundam/gd01-019",
    currency: "JPY",
    nativePrice: 2850,
    image: "",
    change: 4.2,
    lastChecked: new Date().toISOString(),
    history: [1900, 2010, 2080, 2200, 2170, 2310, 2480, 2410, 2550, 2630, 2740, 2850],
  },
  {
    id: "ua47bt-014",
    series: "TOKYO GHOUL",
    code: "UA47BT/TKG-1-014",
    title: "Ken Kaneki",
    quantity: 1,
    sourceUrl: "https://example.com/tokyo-ghoul/ua47bt-014",
    currency: "JPY",
    nativePrice: 4680,
    image: "",
    change: 6.4,
    lastChecked: new Date().toISOString(),
    history: [3510, 3600, 3490, 3770, 3890, 4030, 4210, 4090, 4320, 4470, 4390, 4680],
  },
];

const initialState = {
  schemaVersion: APP_SCHEMA_VERSION,
  page: location.hash === "#cards" ? "cards" : "dashboard",
  filter: "ALL",
  modal: null,
  activeCardId: null,
  user: null,
  rates: { JPY: 0.39, USD: 56.8 },
  liveRates: { JPY: 0.39, USD: 56.8 },
  ratesCustomized: false,
  lastPortfolioCheck: new Date().toISOString(),
  notifications: [],
  cards: defaultCards,
};

let state = loadState();
let pendingImageFile = null;
let backendSyncInProgress = false;
const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return structuredClone(initialState);
    const previousVersion = saved.schemaVersion || 1;
    let migratedCards = saved.cards || [];
    if (previousVersion < 2) migratedCards = migratedCards.filter((card) => !["sv8a-247", "fb04-129"].includes(card.id));
    if (previousVersion < 3) {
      migratedCards = migratedCards.map((card) => card.id === "op08-106" && card.sourceUrl?.includes("yuyu-tei.jp/sell/opc/card/op09/10155")
        ? { ...card, nativePrice: 39800, image: "https://card.yuyu-tei.jp/opc/front/op09/10155.jpg", change: 2.3, history: [31800, 32400, 33100, 32900, 34200, 35100, 36300, 35800, 37100, 38200, 38900, 39800] }
        : card);
    }
    return {
      ...structuredClone(initialState),
      ...saved,
      schemaVersion: APP_SCHEMA_VERSION,
      cards: migratedCards || structuredClone(defaultCards),
      notifications: previousVersion < 3 ? (saved.notifications || []).filter((item) => Math.abs(item.change) < 500) : saved.notifications || [],
      page: location.hash === "#cards" ? "cards" : "dashboard",
      modal: null,
      activeCardId: null,
    };
  } catch {
    return structuredClone(initialState);
  }
}

function saveState() {
  const { modal, activeCardId, page, ...persisted } = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    toast("That image is too large for browser storage. Try a smaller file.");
  }
}

function initialsFor(user) {
  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || "CardBoy Collector";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function padHistory(values, fallback) {
  const clean = values.filter((value) => Number.isFinite(Number(value))).map(Number).slice(-12);
  const seed = clean[0] ?? Number(fallback) ?? 0;
  return [...Array(Math.max(0, 12 - clean.length)).fill(seed), ...clean];
}

async function loadCloudPortfolio() {
  if (!backend.isReady || !backend.user || backendSyncInProgress) return;
  backendSyncInProgress = true;
  try {
    const remote = await backend.loadPortfolio();
    const snapshots = new Map();
    remote.snapshots.forEach((snapshot) => {
      const list = snapshots.get(snapshot.card_id) || [];
      list.push(Number(snapshot.source_price));
      snapshots.set(snapshot.card_id, list);
    });
    state.cards = remote.cards.map((card) => ({
      id: card.id,
      series: card.series,
      code: card.code,
      title: card.title,
      quantity: card.quantity,
      sourceUrl: card.source_url,
      currency: card.source_currency,
      nativePrice: Number(card.source_price),
      image: card.image_url || "",
      change: Number(card.change_percent || 0),
      lastChecked: card.last_checked || card.updated_at,
      history: padHistory(snapshots.get(card.id) || [], card.source_price),
    }));
    const live = Object.fromEntries(remote.fxRates.map((rate) => [rate.currency, Number(rate.php_rate)]));
    state.liveRates = { ...state.liveRates, ...live };
    if (remote.rates) {
      state.ratesCustomized = !remote.rates.use_live_rate;
      state.rates = remote.rates.use_live_rate
        ? { ...state.liveRates }
        : { JPY: Number(remote.rates.jpy_rate), USD: Number(remote.rates.usd_rate) };
    } else {
      state.rates = { ...state.liveRates };
      state.ratesCustomized = false;
    }
    state.notifications = remote.notifications.map((item) => ({
      id: item.id,
      cardId: item.card_id,
      title: item.title,
      message: item.message,
      change: Number(item.change_percent),
      createdAt: item.created_at,
      read: item.read,
      automatic: item.automatic,
    }));
    const latest = state.cards.map((card) => card.lastChecked).filter(Boolean).sort().at(-1);
    if (latest) state.lastPortfolioCheck = latest;
    saveState();
    render();
  } catch (error) {
    toast(`Cloud sync failed: ${error.message}`);
  } finally {
    backendSyncInProgress = false;
  }
}

async function applyBackendUser(user) {
  if (user) {
    state.user = {
      id: user.id,
      name: user.user_metadata?.full_name || user.user_metadata?.name || "CardBoy Collector",
      email: user.email || "",
      initials: initialsFor(user),
    };
    saveState();
    render();
    await loadCloudPortfolio();
  } else {
    state.user = null;
    state.cards = structuredClone(defaultCards);
    state.notifications = [];
    saveState();
    render();
  }
}

async function initializeProductionBackend() {
  if (!backend.isConfigured) return;
  try {
    state.user = null;
    render();
    const user = await backend.initialize((nextUser) => applyBackendUser(nextUser));
    await applyBackendUser(user);
  } catch (error) {
    toast(`Cloud setup could not start: ${error.message}`);
  }
}

function money(value, digits = 0) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function nativeMoney(value, currency) {
  return new Intl.NumberFormat(currency === "JPY" ? "ja-JP" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(value);
}

function phpValue(card) {
  return card.nativePrice * state.rates[card.currency] * card.quantity;
}

function unitPhp(card) {
  return card.nativePrice * state.rates[card.currency];
}

function totalPortfolio() {
  return state.cards.reduce((sum, card) => sum + phpValue(card), 0);
}

function previousPortfolio() {
  return state.cards.reduce((sum, card) => {
    const previous = card.history.at(-2) ?? card.nativePrice;
    return sum + previous * state.rates[card.currency] * card.quantity;
  }, 0);
}

function html(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function icon(name) {
  const icons = {
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7.5h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h12"/><path d="M16 12h5v4h-5a2 2 0 1 1 0-4Z"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h3"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></svg>',
    refresh: '<svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 1M4 17l2 1a7 7 0 0 0 11.9-3"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
  };
  return icons[name] || "";
}

function render() {
  app.innerHTML = `
    <div class="app-shell">
      ${renderHeader()}
      <main>${state.page === "dashboard" ? renderDashboard() : renderCards()}</main>
      ${renderMobileNav()}
      ${renderModal()}
    </div>
  `;
  bindEvents();
}

function renderHeader() {
  const user = state.user;
  const unread = state.notifications.filter((item) => !item.read).length;
  return `
    <header class="topbar">
      <button class="brand-button" data-action="navigate" data-page="dashboard" aria-label="Go to dashboard">
        <img src="images/general/cardboy-logo.svg" alt="CardBoy" />
      </button>
      <nav class="main-nav" aria-label="Primary navigation">
        <button class="nav-link ${state.page === "dashboard" ? "active" : ""}" data-action="navigate" data-page="dashboard" ${state.page === "dashboard" ? 'aria-current="page"' : ""}>DASHBOARD</button>
        <button class="nav-link ${state.page === "cards" ? "active" : ""}" data-action="navigate" data-page="cards" ${state.page === "cards" ? 'aria-current="page"' : ""}>MY CARDS</button>
      </nav>
      <div class="header-actions">
        <button class="notification-button" data-action="notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ""}">
          ${icon("bell")}${unread ? `<span class="notification-badge">${Math.min(unread, 9)}</span>` : ""}
        </button>
        <div class="account-wrap">
          ${
            user
              ? `<button class="account-button" data-action="account" aria-label="Account settings">
                  <span class="account-copy"><strong>MY ACCOUNT</strong><small>${html(user.email)}</small></span>
                  <span class="avatar">${html(user.initials)}</span>
                </button>`
              : '<button class="login-link" data-action="login">LOGIN</button>'
          }
        </div>
      </div>
    </header>
    <div class="rate-strip">
      <div class="rate-summary">
        <span class="rate-dot"></span>
        <span>¥1 = ₱${state.rates.JPY.toFixed(2)}</span>
        <span>·</span>
        <span>$1 = ₱${state.rates.USD.toFixed(2)}</span>
        <button class="rate-edit" data-action="rates">${state.ratesCustomized ? "CUSTOM" : "EDIT RATES"}</button>
      </div>
      <div class="sync-status"><span class="sync-dot"></span><span>DAILY CHECK · ${DAILY_CHECK_LABEL}</span></div>
    </div>
  `;
}

function renderDashboard() {
  const total = totalPortfolio();
  const previous = previousPortfolio();
  const changeAmount = total - previous;
  const changePercent = previous ? (changeAmount / previous) * 100 : 0;
  const units = state.cards.reduce((sum, card) => sum + card.quantity, 0);
  const seriesCount = new Set(state.cards.map((card) => card.series)).size;
  const metrics = [
    { label: "Portfolio value", value: money(total), meta: "Live in Philippine peso", icon: "wallet" },
    { label: "Today's movement", value: `${changeAmount >= 0 ? "+" : ""}${money(changeAmount)}`, meta: `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(1)}% across your cards`, icon: "trend", tone: changeAmount >= 0 ? "positive" : "negative" },
    { label: "Total cards", value: units.toLocaleString(), meta: `${state.cards.length} unique cards`, icon: "cards" },
    { label: "Card series", value: seriesCount, meta: `${seriesCount} collections tracked`, icon: "layers" },
  ];
  return `
    <section class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">Portfolio overview</p>
          <h1>Good ${greeting()}, collector.</h1>
          <p class="page-subtitle">Here’s how your card collection is moving today. Daily check begins at ${DAILY_CHECK_LABEL}.</p>
        </div>
        <button class="primary-button dark" data-action="refresh">${icon("refresh")}<span>CHECK PRICES</span></button>
      </div>
      <div class="metrics-grid">
        ${metrics
          .map(
            (metric) => `
              <article class="metric-card">
                <div class="metric-top"><span class="metric-label">${metric.label}</span><span class="metric-icon">${icon(metric.icon)}</span></div>
                <div class="metric-value ${metric.tone || ""}">${metric.value}</div>
                <div class="metric-meta">${metric.meta}</div>
              </article>`,
          )
          .join("")}
      </div>
      <div class="dashboard-grid">
        <article class="panel chart-panel">
          <div class="panel-head">
            <div><h2 class="panel-title">Portfolio performance</h2><p class="panel-subtitle">Combined value of all card quantities</p></div>
            <div class="range-tabs" aria-label="Chart range">
              ${["1M", "3M", "6M", "1Y"].map((range) => `<button class="range-button ${range === "1Y" ? "active" : ""}">${range}</button>`).join("")}
            </div>
          </div>
          ${renderPortfolioChart()}
        </article>
        ${renderAllocation()}
        ${renderHoldings()}
      </div>
    </section>
  `;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function renderPortfolioChart() {
  const series = Array.from({ length: 12 }, (_, index) =>
    state.cards.reduce((sum, card) => {
      const price = card.history[index] ?? card.history.at(-1) ?? card.nativePrice;
      return sum + price * state.rates[card.currency] * card.quantity;
    }, 0),
  );
  const labels = ["SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG"];
  return chartSvg(series, labels, "#c8ff34", "portfolioGradient", "price-chart");
}

function chartSvg(values, labels, color, gradientId, className = "price-chart") {
  const width = 680;
  const height = className === "detail-chart" ? 160 : 240;
  const pad = { top: 12, right: 12, bottom: 26, left: 12 };
  const minRaw = Math.min(...values);
  const maxRaw = Math.max(...values);
  const spread = Math.max(1, maxRaw - minRaw);
  const min = minRaw - spread * 0.18;
  const max = maxRaw + spread * 0.12;
  const points = values.map((value, index) => {
    const x = pad.left + (index / Math.max(1, values.length - 1)) * (width - pad.left - pad.right);
    const y = pad.top + ((max - value) / (max - min)) * (height - pad.top - pad.bottom);
    return { x, y, value };
  });
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1).x},${height - pad.bottom} L${points[0].x},${height - pad.bottom} Z`;
  const grid = [0.2, 0.5, 0.8]
    .map((ratio) => `<line class="chart-grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${(pad.top + ratio * (height - pad.top - pad.bottom)).toFixed(1)}" y2="${(pad.top + ratio * (height - pad.top - pad.bottom)).toFixed(1)}" />`)
    .join("");
  const step = labels.length > 8 ? 2 : 1;
  const xLabels = labels
    .map((label, index) => (index % step === 0 || index === labels.length - 1 ? `<text class="chart-label" x="${points[index].x}" y="${height - 4}" text-anchor="middle">${label}</text>` : ""))
    .join("");
  return `
    <svg class="${className}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Price history line chart" preserveAspectRatio="none">
      <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.24"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#${gradientId})" />
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      <circle cx="${points.at(-1).x}" cy="${points.at(-1).y}" r="4" fill="${color}" stroke="${className === "detail-chart" ? "#f6f7f8" : "#17191d"}" stroke-width="2" vector-effect="non-scaling-stroke" />
      ${xLabels}
    </svg>
  `;
}

function allocationData() {
  const totals = {};
  state.cards.forEach((card) => {
    totals[card.series] = (totals[card.series] || 0) + phpValue(card);
  });
  return Object.entries(totals)
    .map(([series, value]) => ({ series, value, color: SERIES[series]?.color || "#c8ff34" }))
    .sort((a, b) => b.value - a.value);
}

function renderAllocation() {
  const data = allocationData();
  const total = totalPortfolio() || 1;
  let cursor = 0;
  const stops = data.map((item) => {
    const start = cursor;
    cursor += (item.value / total) * 100;
    return `${item.color} ${start.toFixed(1)}% ${cursor.toFixed(1)}%`;
  });
  return `
    <article class="panel allocation-panel">
      <div class="panel-head"><div><h2 class="panel-title">Series allocation</h2><p class="panel-subtitle">Share of your portfolio value</p></div></div>
      <div class="donut-wrap">
        <div class="donut" style="background: conic-gradient(${stops.join(",")})"></div>
        <div class="donut-copy"><strong>${data.length}</strong><small>series</small></div>
      </div>
      <div class="legend">
        ${data
          .slice(0, 5)
          .map((item) => `<div class="legend-row"><span class="legend-dot" style="background:${item.color}"></span><span>${html(item.series)}</span><strong>${((item.value / total) * 100).toFixed(0)}%</strong></div>`)
          .join("")}
      </div>
    </article>
  `;
}

function renderHoldings() {
  const cards = [...state.cards].sort((a, b) => phpValue(b) - phpValue(a)).slice(0, 4);
  return `
    <article class="panel holdings-panel">
      <div class="holdings-head panel-head"><div><h2 class="panel-title">Top holdings</h2><p class="panel-subtitle">Your highest-value cards by total quantity</p></div><button class="ghost-button" data-action="navigate" data-page="cards">VIEW ALL</button></div>
      <div class="holdings-list">
        ${cards
          .map(
            (card) => `
            <div class="holding-row" data-action="details" data-id="${html(card.id)}" tabindex="0" role="button">
              <div class="holding-card"><div class="holding-thumb">${renderArt(card)}</div><div class="holding-name"><strong>${html(card.title)}</strong><small>${html(card.series)} · ${html(card.code)}</small></div></div>
              <div class="holding-stat"><span>Unit price</span><strong>${money(unitPhp(card))}</strong><small class="holding-native">${nativeMoney(card.nativePrice, card.currency)}</small></div>
              <div class="holding-stat"><span>Quantity</span><strong>${card.quantity}</strong></div>
              <div class="holding-stat"><span>24h</span><strong class="${card.change >= 0 ? "positive" : "negative"}">${card.change >= 0 ? "+" : ""}${card.change.toFixed(1)}%</strong></div>
              <strong>${money(phpValue(card))}</strong>
            </div>`,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderCards() {
  const filters = ["ALL", ...new Set(state.cards.map((card) => card.series))];
  const filtered = state.filter === "ALL" ? state.cards : state.cards.filter((card) => card.series === state.filter);
  const units = state.cards.reduce((sum, card) => sum + card.quantity, 0);
  return `
    <section class="page">
      <div class="page-head">
        <div><p class="eyebrow">Your collection</p><h1>My cards</h1><p class="page-subtitle">${state.cards.length} unique cards · ${units} total units</p></div>
      </div>
      <div class="toolbar">
        <div class="filters" aria-label="Filter by card series">
          ${filters.map((filter) => `<button class="filter-button ${state.filter === filter ? "active" : ""}" data-action="filter" data-filter="${html(filter)}">${html(filter)}</button>`).join("")}
        </div>
        <button class="primary-button dark" data-action="add"><img src="images/icons/icon-add.svg" alt=""/><span>ADD CARD</span></button>
      </div>
      <div class="cards-grid">
        ${
          filtered.length
            ? filtered.map(renderCardTile).join("")
            : `<div class="empty-state"><div class="empty-icon">${icon("cards")}</div><h3>No cards in this series</h3><p>Add a card or choose a different filter.</p><button class="primary-button" data-action="add">ADD A CARD</button></div>`
        }
      </div>
    </section>
  `;
}

function renderCardTile(card) {
  const series = SERIES[card.series] || { color: "#c8ff34" };
  return `
    <article class="card-tile" data-action="details" data-id="${html(card.id)}" tabindex="0" role="button" aria-label="View ${html(card.title)} card details">
      <div class="card-art">${renderArt(card)}<span class="quantity-pill">× ${card.quantity}</span></div>
      <div class="card-body">
        <div class="card-meta"><span class="series-name" style="color:${series.color}">${html(card.series)}</span><span class="card-code">${html(card.code)}</span></div>
        <div class="card-price-row"><div class="card-price-stack"><strong class="card-price">${money(unitPhp(card))}</strong><small>${nativeMoney(card.nativePrice, card.currency)}</small></div><span class="price-change ${card.change >= 0 ? "positive" : "negative"}">${card.change >= 0 ? "↗ +" : "↘ "}${card.change.toFixed(1)}%</span></div>
      </div>
    </article>
  `;
}

function renderArt(card) {
  if (card.image) return `<img src="${html(card.image)}" alt="${html(card.title)} card" />`;
  const design = SERIES[card.series] || { bg: "#34434a", shape: "#688b92", mark: "CB" };
  return `<div class="generated-art" style="--art-bg:${design.bg};--art-shape:${design.shape}"><div class="art-rings"></div><span class="art-code">${html(card.code)}</span><span class="art-mark">${html(design.mark)}</span></div>`;
}

function renderMobileNav() {
  return `<nav class="mobile-nav" aria-label="Mobile navigation"><button class="${state.page === "dashboard" ? "active" : ""}" data-action="navigate" data-page="dashboard">DASHBOARD</button><button class="${state.page === "cards" ? "active" : ""}" data-action="navigate" data-page="cards">MY CARDS</button></nav>`;
}

function renderModal() {
  if (!state.modal) return "";
  if (state.modal === "login") return renderLoginModal();
  if (state.modal === "notifications") return renderNotificationsModal();
  if (state.modal === "rates") return renderRatesModal();
  if (state.modal === "account") return renderAccountModal();
  if (state.modal === "add") return renderCardForm();
  if (state.modal === "edit") return renderCardForm(state.cards.find((card) => card.id === state.activeCardId));
  if (state.modal === "details") return renderDetailsModal();
  return "";
}

function modalShell(content, options = {}) {
  return `<div class="modal-backdrop" data-action="backdrop"><section class="modal ${options.className || ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-top"><h2 id="modal-title" class="modal-title">${html(options.title || "")}</h2><button class="modal-close" data-action="close" aria-label="Close dialog"><img src="images/icons/icon-close.svg" alt=""/></button></div>${content}</section></div>`;
}

function renderLoginModal() {
  if (backend.isConfigured) {
    return modalShell(
      `<div class="login-content"><div class="login-mark"><span>♟</span></div><h3>Your collection, everywhere.</h3><p>Continue with Google to securely sync your cards, price history, rates, images, and notifications across devices.</p><button class="google-button" data-action="google"><img src="images/icons/icon-google-login.svg" alt=""/>CONTINUE WITH GOOGLE</button></div>`,
      { title: "Login", className: "login-modal" },
    );
  }
  return modalShell(
    `<div class="login-content"><span class="demo-pill">DEMO MODE</span><div class="login-mark"><span>♟</span></div><h3>Google sign-in preview</h3><p>Google OAuth is not connected yet because it requires your production project URL and credentials. This button only previews the signed-in experience in this browser.</p><button class="google-button" data-action="google"><img src="images/icons/icon-google-login.svg" alt=""/>CONTINUE WITH DEMO ACCOUNT</button></div>`,
    { title: "Login · Demo", className: "login-modal" },
  );
}

function renderNotificationsModal() {
  const items = state.notifications;
  return modalShell(
    `<div class="notification-modal-body">
      <div class="notification-summary"><p>Price movement alerts from manual and scheduled checks.</p><span>Daily check: ${DAILY_CHECK_LABEL}</span></div>
      <div class="notification-list">
        ${
          items.length
            ? items.map((item) => `<button class="notification-row" data-action="notification-card" data-id="${html(item.cardId)}"><span class="notification-tone ${item.change >= 0 ? "up" : "down"}">${item.change >= 0 ? "↗" : "↘"}</span><span class="notification-copy"><strong>${html(item.title)}</strong><small>${html(item.message)}</small><time>${notificationTime(item.createdAt)}</time></span></button>`).join("")
            : `<div class="notification-empty"><span>${icon("bell")}</span><strong>No price alerts yet</strong><small>Movements will appear after a manual or daily check.</small></div>`
        }
      </div>
      ${items.length ? '<div class="notification-actions"><button class="secondary-button" data-action="clear-notifications">CLEAR ALL</button></div>' : ""}
    </div>`,
    { title: "Notifications", className: "notifications-modal" },
  );
}

function renderAccountModal() {
  return modalShell(
    `<div class="login-content"><div class="avatar" style="margin:0 auto 14px;width:52px;height:52px;color:#576900;border-color:#a5bd31;background:#e8f4bf">${html(state.user?.initials || "CB")}</div><h3>${html(state.user?.name || "CardBoy Collector")}</h3><p>${html(state.user?.email || "collector@gmail.com")}<br/>Your local demo collection is active on this browser.</p><button class="google-button" data-action="logout">LOG OUT</button></div>`,
    { title: "Account", className: "login-modal" },
  );
}

function renderRatesModal() {
  return modalShell(
    `<form class="modal-body" id="rates-form"><p class="rate-modal-copy">All card prices are converted to Philippine peso. Set a custom rate for budgeting, or return to the latest reference rate anytime.</p><div class="rate-fields"><div class="field"><label for="jpy-rate">JPY → PHP</label><input id="jpy-rate" name="JPY" type="number" min="0.01" step="0.01" value="${state.rates.JPY}" required/><small>Current reference: ₱${state.liveRates.JPY.toFixed(2)}</small></div><div class="field"><label for="usd-rate">USD → PHP</label><input id="usd-rate" name="USD" type="number" min="0.01" step="0.01" value="${state.rates.USD}" required/><small>Current reference: ₱${state.liveRates.USD.toFixed(2)}</small></div></div><div class="current-rate-note">Custom rates affect every portfolio value and price chart immediately. Source prices remain in their original currency.</div><div class="modal-actions"><button type="button" class="secondary-button" data-action="reset-rates">BACK TO CURRENT RATE</button><button type="submit" class="primary-button">SAVE RATES</button></div></form>`,
    { title: "Exchange rates" },
  );
}

function renderCardForm(card = null) {
  const isEdit = Boolean(card);
  const value = card || {
    sourceUrl: "",
    series: "ONE PIECE",
    code: "",
    title: "",
    quantity: 1,
    currency: "JPY",
    nativePrice: "",
    image: "",
  };
  return modalShell(
    `<form class="modal-body" id="card-form" data-editing="${isEdit ? html(card.id) : ""}">
      <div class="form-grid">
        <div class="form-fields">
          <div class="field"><label for="source-url">Card page URL</label><div class="input-wrap"><input id="source-url" name="sourceUrl" type="url" placeholder="https://store.com/card/..." value="${html(value.sourceUrl)}" required/><button type="button" class="fetch-button" data-action="fetch">FETCH</button></div><small id="fetch-status">Fetches the card name, code, source price, and product image when available.</small></div>
          <div class="field"><label for="card-series">Card series</label><select id="card-series" name="series">${Object.keys(SERIES).map((series) => `<option ${series === value.series ? "selected" : ""}>${html(series)}</option>`).join("")}</select></div>
          <div class="two-fields"><div class="field"><label for="card-code">Card code</label><input id="card-code" name="code" value="${html(value.code)}" placeholder="OP08-106" required/></div><div class="field"><label for="card-title">Card name</label><input id="card-title" name="title" value="${html(value.title)}" placeholder="Nami" required/></div></div>
          <div class="two-fields"><div class="field"><label for="card-quantity">Quantity</label><input id="card-quantity" name="quantity" type="number" min="1" step="1" value="${value.quantity}" required/></div><div class="field"><label for="card-currency">Currency</label><select id="card-currency" name="currency"><option ${value.currency === "JPY" ? "selected" : ""}>JPY</option><option ${value.currency === "USD" ? "selected" : ""}>USD</option></select></div></div>
          <div class="field"><label for="native-price">Current source price</label><input id="native-price" name="nativePrice" type="number" min="0" step="0.01" value="${value.nativePrice}" placeholder="3200" required/></div>
        </div>
        <div class="image-upload"><div class="preview-card" id="image-preview">${value.image ? `<img src="${html(value.image)}" alt="Card preview"/>` : `<div class="preview-placeholder">${icon("image")}<span>IMAGE PREVIEW</span></div>`}</div><label class="upload-button">UPLOAD YOUR OWN<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp"/></label><input type="hidden" name="image" value="${html(value.image)}"/></div>
      </div>
      <div class="modal-actions">${isEdit ? '<button type="button" class="danger-button" data-action="delete">DELETE CARD</button>' : ""}<button type="button" class="secondary-button" data-action="close">CANCEL</button><button type="submit" class="primary-button">${isEdit ? "SAVE CHANGES" : "ADD CARD"}</button></div>
    </form>`,
    { title: isEdit ? "Edit card" : "New card entry" },
  );
}

function renderDetailsModal() {
  const card = state.cards.find((item) => item.id === state.activeCardId);
  if (!card) return "";
  const series = SERIES[card.series] || { color: "#6f7900" };
  const labels = ["SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG"];
  return modalShell(
    `<div class="modal-body"><div class="details-layout"><div class="detail-art">${renderArt(card)}</div><div class="details-copy"><div class="details-title-row"><div><div class="details-series" style="color:${series.color}">${html(card.series)}</div><div class="details-code">${html(card.code)} · ${html(card.title)}</div></div><button class="edit-detail-button" data-action="edit" data-id="${html(card.id)}">EDIT</button></div><div class="detail-price">${money(unitPhp(card))}</div><div class="detail-native">${nativeMoney(card.nativePrice, card.currency)} per card · ${card.quantity} ${card.quantity === 1 ? "copy" : "copies"}</div><div class="detail-stats"><div class="detail-stat"><span>Total value</span><strong>${money(phpValue(card))}</strong></div><div class="detail-stat"><span>24h move</span><strong class="${card.change >= 0 ? "positive" : "negative"}">${card.change >= 0 ? "+" : ""}${card.change.toFixed(1)}%</strong></div><div class="detail-stat"><span>Last checked</span><strong>${formatDate(card.lastChecked)}</strong></div></div><div class="detail-source">Price source: <a href="${html(safeUrl(card.sourceUrl))}" target="_blank" rel="noreferrer">${html(card.sourceUrl)}</a></div><div class="modal-chart-tabs">${["MAX", "1M", "3M", "6M", "1Y"].map((range) => `<button class="range-button ${range === "1Y" ? "active" : ""}">${range}</button>`).join("")}</div>${chartSvg(card.history.map((price) => price * state.rates[card.currency]), labels, series.color, `detail-${html(card.id)}`, "detail-chart")}</div></div></div>`,
    { title: "Card details", className: "wide" },
  );
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" }).format(new Date(value));
}

function notificationTime(value) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
    timeZoneName: "short",
  }).format(new Date(value));
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", handleAction);
    if (element.matches('[role="button"], .card-tile')) {
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          element.click();
        }
      });
    }
  });

  document.querySelector("#rates-form")?.addEventListener("submit", saveRates);
  document.querySelector("#card-form")?.addEventListener("submit", saveCard);
  document.querySelector("#image-file")?.addEventListener("change", handleImageUpload);
}

async function handleAction(event) {
  const target = event.currentTarget;
  const action = target.dataset.action;
  if (action === "navigate") {
    state.page = target.dataset.page;
    state.filter = "ALL";
    history.replaceState(null, "", state.page === "cards" ? "#cards" : "#dashboard");
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
  } else if (action === "login") {
    openModal("login");
  } else if (action === "google") {
    if (backend.isConfigured) {
      try {
        await backend.signInWithGoogle();
      } catch (error) {
        toast(`Google login failed: ${error.message}`);
      }
      return;
    }
    state.user = { name: "CardBoy Collector", email: "collector@gmail.com", initials: "CC" };
    state.modal = null;
    saveState();
    render();
    toast("Demo account enabled. Google OAuth is not connected yet.");
  } else if (action === "logout") {
    if (backend.isReady) {
      try {
        await backend.signOut();
      } catch (error) {
        toast(`Logout failed: ${error.message}`);
      }
      return;
    }
    state.user = null;
    state.modal = null;
    saveState();
    render();
    toast("You’re logged out.");
  } else if (action === "account") {
    openModal("account");
  } else if (action === "notifications") {
    state.notifications = state.notifications.map((item) => ({ ...item, read: true }));
    saveState();
    backend.markNotificationsRead().catch((error) => toast(`Could not update alerts: ${error.message}`));
    openModal("notifications");
  } else if (action === "notification-card") {
    const exists = state.cards.some((card) => card.id === target.dataset.id);
    if (exists) {
      state.activeCardId = target.dataset.id;
      openModal("details");
    }
  } else if (action === "clear-notifications") {
    state.notifications = [];
    saveState();
    backend.clearNotifications().catch((error) => toast(`Could not clear cloud alerts: ${error.message}`));
    render();
  } else if (action === "rates") {
    openModal("rates");
  } else if (action === "add") {
    if (backend.isConfigured && !state.user) {
      openModal("login");
      toast("Sign in with Google to add cards to your cloud collection.");
      return;
    }
    pendingImageFile = null;
    state.activeCardId = null;
    openModal("add");
  } else if (action === "details") {
    state.activeCardId = target.dataset.id;
    openModal("details");
  } else if (action === "edit") {
    pendingImageFile = null;
    state.activeCardId = target.dataset.id;
    openModal("edit");
  } else if (action === "close") {
    closeModal();
  } else if (action === "backdrop" && event.target === target) {
    closeModal();
  } else if (action === "filter") {
    state.filter = target.dataset.filter;
    render();
  } else if (action === "fetch") {
    fetchPreview();
  } else if (action === "refresh") {
    refreshPrices(false);
  } else if (action === "reset-rates") {
    state.rates = { ...state.liveRates };
    state.ratesCustomized = false;
    saveState();
    backend.saveRates(state.rates, false).catch((error) => toast(`Could not save cloud rates: ${error.message}`));
    state.modal = null;
    render();
    toast("Conversion rates returned to current reference values.");
  } else if (action === "delete") {
    deleteActiveCard();
  }
}

function openModal(name) {
  state.modal = name;
  render();
  requestAnimationFrame(() => document.querySelector(".modal button, .modal input")?.focus());
}

function closeModal() {
  state.modal = null;
  render();
}

async function saveRates(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.rates = { JPY: Number(data.get("JPY")), USD: Number(data.get("USD")) };
  state.ratesCustomized = Math.abs(state.rates.JPY - state.liveRates.JPY) > 0.0001 || Math.abs(state.rates.USD - state.liveRates.USD) > 0.0001;
  try {
    await backend.saveRates(state.rates, state.ratesCustomized);
  } catch (error) {
    toast(`Cloud rate save failed: ${error.message}`);
  }
  state.modal = null;
  saveState();
  render();
  toast("Custom conversion rates saved.");
}

async function saveCard(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const editingId = form.dataset.editing;
  const nativePrice = Number(data.get("nativePrice"));
  const cardId = editingId || `${String(data.get("code")).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
  let image = String(data.get("image") || "");
  if (pendingImageFile && backend.isReady && backend.user) {
    try {
      image = await backend.uploadImage(pendingImageFile, cardId);
    } catch (error) {
      toast(`Image upload failed: ${error.message}`);
      return;
    }
  }
  const payload = {
    sourceUrl: String(data.get("sourceUrl")).trim(),
    series: String(data.get("series")),
    code: String(data.get("code")).trim().toUpperCase(),
    title: String(data.get("title")).trim(),
    quantity: Math.max(1, Number.parseInt(data.get("quantity"), 10) || 1),
    currency: String(data.get("currency")),
    nativePrice,
    image,
    lastChecked: new Date().toISOString(),
  };
  if (editingId) {
    const index = state.cards.findIndex((card) => card.id === editingId);
    const existing = state.cards[index];
    state.cards[index] = {
      ...existing,
      ...payload,
      history: nativePrice === existing.nativePrice ? existing.history : [...existing.history.slice(-11), nativePrice],
    };
    toast("Card details updated.");
  } else {
    const seed = nativePrice || 1;
    state.cards.unshift({
      ...payload,
      id: cardId,
      change: 0,
      history: Array.from({ length: 12 }, (_, index) => Number((seed * (0.82 + index * 0.016)).toFixed(2))),
    });
    toast("Card added to your collection.");
  }
  const savedCard = editingId ? state.cards.find((card) => card.id === editingId) : state.cards.find((card) => card.id === cardId);
  try {
    await backend.saveCard(savedCard, unitPhp(savedCard));
  } catch (error) {
    toast(`Cloud card save failed: ${error.message}`);
  }
  pendingImageFile = null;
  state.modal = null;
  state.filter = "ALL";
  state.page = "cards";
  history.replaceState(null, "", "#cards");
  saveState();
  render();
}

async function fetchPreview() {
  const urlInput = document.querySelector("#source-url");
  if (!urlInput?.checkValidity()) {
    urlInput?.reportValidity();
    return;
  }
  const form = document.querySelector("#card-form");
  const button = form.querySelector('[data-action="fetch"]');
  const status = document.querySelector("#fetch-status");
  button.disabled = true;
  button.textContent = "READING";
  status.textContent = "Reading product data and image from the source page…";
  try {
    let card;
    if (backend.isReady && backend.user) {
      card = await backend.extractCard(urlInput.value.trim());
    } else {
      const response = await fetch(`/api/extract?url=${encodeURIComponent(urlInput.value.trim())}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The card page could not be read.");
      card = payload.card;
    }
    if (card.series && [...form.elements.series.options].some((option) => option.value === card.series)) form.elements.series.value = card.series;
    if (card.code) form.elements.code.value = card.code;
    if (card.title) form.elements.title.value = card.title;
    if (card.currency) form.elements.currency.value = card.currency;
    if (card.nativePrice) form.elements.nativePrice.value = card.nativePrice;
    if (card.image) {
      form.elements.image.value = card.image;
      document.querySelector("#image-preview").innerHTML = `<img src="${html(card.image)}" alt="Fetched card preview"/>`;
    }
    const fields = [card.title, card.code, card.nativePrice, card.image].filter(Boolean).length;
    status.textContent = card.image ? "Details and product image fetched from the source." : "Details fetched; this page did not expose a product image.";
    toast(`${fields} card details fetched from the source.`);
  } catch (error) {
    status.textContent = error.message;
    toast(`Could not fetch this source: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "FETCH";
  }
}

async function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    toast("Choose an image smaller than 8 MB.");
    event.target.value = "";
    return;
  }
  try {
    pendingImageFile = file;
    const dataUrl = await resizeImage(file, 1200, 0.86);
    document.querySelector('#card-form input[name="image"]').value = dataUrl;
    document.querySelector("#image-preview").innerHTML = `<img src="${dataUrl}" alt="Uploaded card preview"/>`;
    toast("Card photo ready to save.");
  } catch {
    toast("That image could not be processed.");
  }
}

function resizeImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

let priceCheckInProgress = false;
let dailyCheckTimer = null;

async function refreshPrices(automatic) {
  if (priceCheckInProgress) return;
  priceCheckInProgress = true;
  if (!automatic) toast("Checking live card sources…");
  if (backend.isReady && backend.user) {
    try {
      const result = await backend.checkPrices();
      priceCheckInProgress = false;
      await loadCloudPortfolio();
      if (!automatic) toast(result.movements ? `${result.movements} price movement${result.movements === 1 ? "" : "s"} found.` : "Price check complete. No movements found.");
    } catch (error) {
      priceCheckInProgress = false;
      toast(`Price check failed: ${error.message}`);
    }
    return;
  }
  const checkedAt = new Date().toISOString();
  const movements = [];
  const updated = await Promise.all(
    state.cards.map(async (card) => {
      const source = safeUrl(card.sourceUrl);
      if (source === "#" || new URL(source).hostname === "example.com") return { ...card, lastChecked: checkedAt };
      try {
        const response = await fetch(`/api/extract?url=${encodeURIComponent(card.sourceUrl)}`);
        const payload = await response.json();
        if (!response.ok || !payload.card?.nativePrice) return { ...card, lastChecked: checkedAt };
        const nextPrice = Number(payload.card.nativePrice);
        const currency = payload.card.currency || card.currency;
        const change = card.nativePrice ? Number((((nextPrice - card.nativePrice) / card.nativePrice) * 100).toFixed(1)) : 0;
        if (nextPrice !== card.nativePrice) movements.push({ card, nextPrice, change, currency });
        return {
          ...card,
          nativePrice: nextPrice,
          currency,
          image: payload.card.image || card.image,
          change,
          lastChecked: checkedAt,
          history: nextPrice === card.nativePrice ? card.history : [...card.history.slice(-11), nextPrice],
        };
      } catch {
        return { ...card, lastChecked: checkedAt };
      }
    }),
  );
  state.cards = updated;
  movements.forEach(({ card, nextPrice, change, currency }) => {
    const converted = nextPrice * state.rates[currency];
    state.notifications.unshift({
      id: `${card.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cardId: card.id,
      title: `${card.title} ${change >= 0 ? "increased" : "decreased"} ${Math.abs(change).toFixed(1)}%`,
      message: `Now ${nativeMoney(nextPrice, currency)} (${money(converted)}) per card.`,
      change,
      createdAt: checkedAt,
      read: false,
      automatic,
    });
  });
  state.notifications = state.notifications.slice(0, 30);
  state.lastPortfolioCheck = checkedAt;
  priceCheckInProgress = false;
  saveState();
  render();
  if (!automatic) toast(movements.length ? `${movements.length} price movement${movements.length === 1 ? "" : "s"} found.` : "Price check complete. No movements found.");
}

function philippineCheckWindow(now = new Date()) {
  const phNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayCheck = new Date(Date.UTC(phNow.getUTCFullYear(), phNow.getUTCMonth(), phNow.getUTCDate(), DAILY_CHECK_HOUR - 8));
  return { todayCheck, nextCheck: new Date(todayCheck.getTime() + (now >= todayCheck ? 24 * 60 * 60 * 1000 : 0)) };
}

function scheduleDailyCheck() {
  if (dailyCheckTimer) clearTimeout(dailyCheckTimer);
  const { nextCheck } = philippineCheckWindow();
  dailyCheckTimer = setTimeout(async () => {
    await refreshPrices(true);
    scheduleDailyCheck();
  }, Math.max(1000, nextCheck.getTime() - Date.now()));
}

function runDailyCheck() {
  if (backend.isConfigured) return;
  const now = new Date();
  const { todayCheck } = philippineCheckWindow(now);
  const lastCheck = new Date(state.lastPortfolioCheck);
  if (now >= todayCheck && lastCheck < todayCheck) refreshPrices(true);
  scheduleDailyCheck();
}

async function deleteActiveCard() {
  const card = state.cards.find((item) => item.id === state.activeCardId);
  if (!card || !window.confirm(`Remove ${card.title} (${card.code}) from your collection?`)) return;
  state.cards = state.cards.filter((item) => item.id !== state.activeCardId);
  try {
    await backend.deleteCard(card.id);
  } catch (error) {
    toast(`Cloud delete failed: ${error.message}`);
  }
  state.activeCardId = null;
  state.modal = null;
  state.filter = "ALL";
  saveState();
  render();
  toast("Card removed from your collection.");
}

function toast(message) {
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  toastRegion.appendChild(element);
  setTimeout(() => element.remove(), 3200);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.modal) closeModal();
});

window.addEventListener("hashchange", () => {
  state.page = location.hash === "#cards" ? "cards" : "dashboard";
  render();
});

render();
runDailyCheck();
initializeProductionBackend();
