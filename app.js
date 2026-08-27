import { backend } from "./backend.js";
import { normalizeCardOrder, toggleCardPinned } from "./card-order.js";
import {
  createManualUpdateQueue,
  manualUpdateBatch,
  manualUpdateCandidates,
  manualUpdateQueueView,
  markManualUpdateComplete,
  markManualUpdateOpened,
  normalizeManualUpdateQueue,
} from "./manual-update-queue.js";
import {
  createInitialMonitorRun,
  MONITOR_STATUS_ACTIVE_POLL_MS,
  MONITOR_STATUS_IDLE_POLL_MS,
  MONITOR_RECENT_RESULT_MS,
  monitorRunSignature,
  monitorStatusView,
  normalizeMonitorRun,
} from "./monitor-status.js";

const STORAGE_KEY = "cardboy-demo-v1";
const CARD_IMPORT_KEY = "cardboy-pending-import-v1";
const UPDATE_QUEUE_KEY = "cardboy-manual-update-queue-v1";
const APP_SCHEMA_VERSION = 5;
const DAILY_CHECK_HOUR = 9;
const DAILY_CHECK_MINUTE = 15;
const DAILY_CHECK_LABEL = "9:15 AM PHT";

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
    owned: true,
    pinned: false,
    sortOrder: 0,
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
    owned: true,
    pinned: false,
    sortOrder: 1,
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
    owned: true,
    pinned: false,
    sortOrder: 2,
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
  monitorRun: createInitialMonitorRun(),
  notifications: [],
  cards: defaultCards,
};

let state = loadState();
let pendingImportAutoSave = new URL(location.href).searchParams.get("autoSave") === "1";
let pendingCardImport = loadPendingCardImport();
let manualUpdateQueue = loadManualUpdateQueue();
let pendingImageFile = null;
let backendSyncInProgress = false;
let monitorStatusSyncInProgress = false;
let monitorStatusTimer = null;
let manualMonitorOverrideUntil = 0;
let nativeCardDrag = null;
let pointerCardDrag = null;
let suppressCardOpenUntil = 0;
let autoImportStarted = false;
let autoImportCompletionResolve = null;
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
    migratedCards = normalizeCardOrder(migratedCards.map((card) => ({
      ...card,
      owned: card.owned !== false,
      pinned: card.pinned === true,
    })));
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
  const { modal, activeCardId, page, monitorRun, ...persisted } = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    toast("That image is too large for browser storage. Try a smaller file.");
  }
}

function normalizeCardImport(value) {
  if (!value || typeof value !== "object") return null;
  const sourceUrl = safeUrl(value.sourceUrl);
  if (sourceUrl === "#") return null;
  const imageUrl = safeUrl(value.image);
  const nativePrice = Number(value.nativePrice);
  return {
    sourceUrl,
    series: Object.hasOwn(SERIES, value.series) ? value.series : "ONE PIECE",
    code: String(value.code || "").trim().slice(0, 80),
    title: String(value.title || "").trim().slice(0, 220),
    quantity: Math.max(1, Number.parseInt(value.quantity, 10) || 1),
    currency: ["JPY", "USD"].includes(value.currency) ? value.currency : "JPY",
    nativePrice: Number.isFinite(nativePrice) && nativePrice >= 0 ? nativePrice : "",
    image: imageUrl === "#" ? "" : imageUrl,
    owned: value.owned !== false,
    availability: String(value.availability || "").replace(/[^a-z]/gi, "").slice(0, 40),
  };
}

function loadPendingCardImport() {
  const currentUrl = new URL(location.href);
  const incoming = currentUrl.searchParams.get("cardImport");
  let value = null;
  try {
    value = incoming ? JSON.parse(incoming) : JSON.parse(sessionStorage.getItem(CARD_IMPORT_KEY));
  } catch {
    value = null;
  }
  const normalized = normalizeCardImport(value);
  if (normalized) sessionStorage.setItem(CARD_IMPORT_KEY, JSON.stringify(normalized));
  else sessionStorage.removeItem(CARD_IMPORT_KEY);
  if (incoming !== null) {
    currentUrl.searchParams.delete("cardImport");
    currentUrl.searchParams.delete("autoSave");
    history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash || "#cards"}`);
  }
  return normalized;
}

function clearPendingCardImport() {
  pendingCardImport = null;
  pendingImportAutoSave = false;
  sessionStorage.removeItem(CARD_IMPORT_KEY);
}

function loadManualUpdateQueue() {
  try {
    return normalizeManualUpdateQueue(JSON.parse(localStorage.getItem(UPDATE_QUEUE_KEY)), state.cards);
  } catch {
    return null;
  }
}

function saveManualUpdateQueue() {
  manualUpdateQueue = normalizeManualUpdateQueue(manualUpdateQueue, state.cards);
  if (manualUpdateQueue) localStorage.setItem(UPDATE_QUEUE_KEY, JSON.stringify(manualUpdateQueue));
  else localStorage.removeItem(UPDATE_QUEUE_KEY);
}

function resetManualUpdateQueue() {
  manualUpdateQueue = createManualUpdateQueue(state.cards);
  saveManualUpdateQueue();
  return manualUpdateQueueView(manualUpdateQueue, state.cards);
}

function openQuickUpdateTab(card) {
  try {
    const url = new URL(card.sourceUrl);
    url.hash = "cardboy-quick";
    return window.open(url.href, "_blank");
  } catch {
    return null;
  }
}

function openQuickUpdateBatch() {
  const cards = manualUpdateBatch(manualUpdateQueue, state.cards, 10);
  let opened = 0;
  cards.forEach((card) => {
    if (openQuickUpdateTab(card)) opened += 1;
  });
  if (cards[0]) {
    manualUpdateQueue = markManualUpdateOpened(manualUpdateQueue, cards[0].id, state.cards);
    saveManualUpdateQueue();
  }
  render();
  if (!opened) toast("Your browser blocked the tabs. Allow pop-ups for CardBoy, then try again.");
  else if (opened < cards.length) toast(`Opened ${opened} of ${cards.length} tabs. Allow pop-ups to open the rest.`);
  else toast(`${opened} Yuyu-tei tabs opened. Click your CardBoy bookmark once in each tab.`);
}

function canonicalSourceUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.href.replace(/\/$/, "").toLowerCase();
  } catch {
    return String(value || "").trim().replace(/\/$/, "").toLowerCase();
  }
}

function isYuyuteiSourceUrl(value) {
  try {
    return /(^|\.)yuyu-tei\.jp$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

function fetchButtonLabel(value) {
  return isYuyuteiSourceUrl(value) ? "FETCH IMAGE" : "FETCH DETAILS";
}

function importedCardMatch() {
  if (!pendingCardImport) return null;
  const importedSource = canonicalSourceUrl(pendingCardImport.sourceUrl);
  return state.cards.find((card) => canonicalSourceUrl(card.sourceUrl) === importedSource) || null;
}

function refreshPortfolioFromStorage() {
  const saved = loadState();
  state.cards = saved.cards;
  state.notifications = saved.notifications;
  state.lastPortfolioCheck = saved.lastPortfolioCheck;
  manualUpdateQueue = loadManualUpdateQueue();
}

function startAutomaticCardImport() {
  if (autoImportStarted) return;
  autoImportStarted = true;
  const submitWhenReady = () => new Promise((resolve) => {
    autoImportCompletionResolve = resolve;
    setTimeout(() => {
      refreshPortfolioFromStorage();
      const existing = importedCardMatch();
      if (!existing) {
        pendingImportAutoSave = false;
        autoImportStarted = false;
        autoImportCompletionResolve = null;
        state.activeCardId = null;
        state.modal = "add";
        render();
        resolve();
        toast("This source is not in your collection yet. Review it before adding the new card.");
        return;
      }
      state.activeCardId = existing.id;
      state.modal = "edit";
      render();
      const form = document.querySelector("#card-form");
      const importedPrice = Number(pendingCardImport?.nativePrice);
      if (!form || !form.checkValidity() || !Number.isFinite(importedPrice) || importedPrice <= 0) {
        pendingImportAutoSave = false;
        autoImportStarted = false;
        autoImportCompletionResolve = null;
        resolve();
        toast("Automatic save needs a quick review. No valid positive selling price was found.");
        form?.reportValidity();
        return;
      }
      const submit = form.querySelector('button[type="submit"]');
      if (submit) {
        submit.disabled = true;
        submit.textContent = "SAVING…";
      }
      toast("Latest Yuyu-tei price found. Saving automatically…");
      form.requestSubmit();
    }, 0);
  });
  const task = navigator.locks?.request
    ? navigator.locks.request("cardboy-quick-price-import", submitWhenReady)
    : submitWhenReady();
  task.catch((error) => {
    autoImportStarted = false;
    autoImportCompletionResolve = null;
    pendingImportAutoSave = false;
    toast(`Automatic update paused: ${error.message}`);
  });
}

function activatePendingCardImport() {
  if (!pendingCardImport) return;
  const existing = importedCardMatch();
  const targetModal = backend.isConfigured && !backend.user ? "login" : existing ? "edit" : "add";
  if (state.page === "cards" && state.modal === targetModal && state.activeCardId === (existing?.id || null)) {
    if (pendingImportAutoSave && existing && targetModal === "edit") startAutomaticCardImport();
    return;
  }
  state.page = "cards";
  state.filter = "ALL";
  state.activeCardId = existing?.id || null;
  state.modal = targetModal;
  history.replaceState(null, "", "#cards");
  render();
  if (pendingImportAutoSave && existing && state.modal === "edit") {
    startAutomaticCardImport();
  } else if (state.modal === "add") {
    requestAnimationFrame(() => document.querySelector("#card-quantity")?.select());
    toast("Yuyu-tei card details imported. Review the quantity, then add the card.");
  } else if (state.modal === "edit") {
    requestAnimationFrame(() => document.querySelector("#native-price")?.select());
    toast("Existing card found. Review the latest Yuyu-tei price, then save the update.");
  }
}

function yuyuImporterBookmarklet() {
  const appUrl = `${location.origin}${location.pathname}`;
  return `javascript:(()=>{try{const a=[...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(s=>{try{const j=JSON.parse(s.textContent);return Array.isArray(j)?j:[j]}catch{return[]}}).flatMap(j=>j['@graph']||[j]),p=a.find(x=>x&&x['@type']==='Product');if(!p)throw Error('Product data was not found on this page.');const o=Array.isArray(p.offers)?p.offers[0]:p.offers,s=new URL(location.href),q=s.hash==='#cardboy-quick'&&window.opener&&!window.opener.closed;s.hash='';const d={sourceUrl:s.href,series:s.pathname.includes('/opc/')?'ONE PIECE':'ONE PIECE',code:p.description||'',title:p.name||'',quantity:1,currency:o?.priceCurrency||'JPY',nativePrice:Number(o?.price||0),image:Array.isArray(p.image)?p.image[0]:p.image||'',availability:String(o?.availability||'').split('/').pop()},u=${JSON.stringify(appUrl)}+'?cardImport='+encodeURIComponent(JSON.stringify(d));if(q)location.replace(u+'&autoSave=1#cards');else{const w=open(u+'#cards','_blank');if(w)w.opener=null;else location.href=u+'#cards'}}catch(e){alert('CardBoy importer: '+e.message)}})()`;
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
    state.cards = normalizeCardOrder(remote.cards.map((card, index) => ({
      id: card.id,
      series: card.series,
      code: card.code,
      title: card.title,
      quantity: card.quantity,
      sourceUrl: card.source_url,
      cardValueUrl: card.card_value_url || null,
      currency: card.source_currency,
      nativePrice: Number(card.source_price),
      image: card.image_url || "",
      owned: card.is_owned !== false,
      pinned: card.is_pinned === true,
      sortOrder: Number.isFinite(Number(card.sort_order)) ? Number(card.sort_order) : index,
      change: Number(card.change_percent || 0),
      lastChecked: card.last_checked || card.updated_at,
      monitorStatus: card.monitor_status || "pending",
      monitorMessage: card.monitor_message || "Waiting for the next scheduled Card-Value check.",
      monitorCheckedAt: card.monitor_checked_at || null,
      history: padHistory(snapshots.get(card.id) || [], card.source_price),
    })));
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

function scheduleMonitorStatusSync() {
  if (monitorStatusTimer) clearTimeout(monitorStatusTimer);
  if (!backend.isReady) return;
  const delay = state.monitorRun?.status === "running" ? MONITOR_STATUS_ACTIVE_POLL_MS : MONITOR_STATUS_IDLE_POLL_MS;
  monitorStatusTimer = setTimeout(refreshMonitorStatus, delay);
}

async function refreshMonitorStatus() {
  if (!backend.isReady || monitorStatusSyncInProgress) return;
  if (Date.now() < manualMonitorOverrideUntil) {
    scheduleMonitorStatusSync();
    return;
  }
  monitorStatusSyncInProgress = true;
  try {
    const remote = await backend.getMonitorStatus();
    const next = normalizeMonitorRun(remote);
    if (monitorRunSignature(next) !== monitorRunSignature(state.monitorRun)) {
      state.monitorRun = next;
      render();
    }
  } catch (error) {
    console.warn(`Monitor status sync failed: ${error.message}`);
  } finally {
    monitorStatusSyncInProgress = false;
    scheduleMonitorStatusSync();
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
  activatePendingCardImport();
}

async function initializeProductionBackend() {
  if (!backend.isConfigured) {
    activatePendingCardImport();
    return;
  }
  try {
    state.user = null;
    render();
    const user = await backend.initialize((nextUser) => applyBackendUser(nextUser));
    await applyBackendUser(user);
    await refreshMonitorStatus();
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

function monitoringInfo(card) {
  if (card.monitorStatus === "active") {
    return {
      className: "active",
      label: "PRICE MONITORED",
      detail: "Automatic daily monitoring reads this exact variant's Yuyutei selling price via Card-Value.",
    };
  }
  if (card.monitorStatus === "unsupported") {
    return {
      className: "manual",
      label: "MANUAL UPDATE",
      detail: card.monitorMessage || "Card-Value does not currently list a Yuyutei selling price for this exact variant. Use the bookmark importer for updates.",
    };
  }
  return {
    className: "pending",
    label: "CHECK PENDING",
    detail: "Monitoring support will be confirmed during the next scheduled price check.",
  };
}

function ownedCards() {
  return state.cards.filter((card) => card.owned !== false);
}

function totalPortfolio() {
  return ownedCards().reduce((sum, card) => sum + phpValue(card), 0);
}

function previousPortfolio() {
  return ownedCards().reduce((sum, card) => {
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
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M9 3h6v4l3 4v2H6v-2l3-4V3Z"/><path d="M12 13v8M5 21h14"/></svg>',
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
  const monitor = monitorStatusView(state.monitorRun, { dailyCheckLabel: DAILY_CHECK_LABEL });
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
    <div class="rate-strip ${monitor.running ? "monitor-running" : ""}">
      <div class="rate-summary">
        <span class="rate-dot"></span>
        <span>¥1 = ₱${state.rates.JPY.toFixed(2)}</span>
        <span>·</span>
        <span>$1 = ₱${state.rates.USD.toFixed(2)}</span>
        <button class="rate-edit" data-action="rates">${state.ratesCustomized ? "CUSTOM" : "EDIT RATES"}</button>
      </div>
      <div class="sync-status ${monitor.className}" role="status" aria-live="polite" title="${html(monitor.title)}"><span class="sync-dot" aria-hidden="true"></span><span>${html(monitor.label)}</span></div>
    </div>
  `;
}

function renderDashboard() {
  const portfolioCards = ownedCards();
  const total = totalPortfolio();
  const previous = previousPortfolio();
  const changeAmount = total - previous;
  const changePercent = previous ? (changeAmount / previous) * 100 : 0;
  const units = portfolioCards.reduce((sum, card) => sum + card.quantity, 0);
  const seriesCount = new Set(portfolioCards.map((card) => card.series)).size;
  const metrics = [
    { label: "Portfolio value", value: money(total), meta: "Live in Philippine peso", icon: "wallet" },
    { label: "Today's movement", value: `${changeAmount >= 0 ? "+" : ""}${money(changeAmount)}`, meta: `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(1)}% across your cards`, icon: "trend", tone: changeAmount >= 0 ? "positive" : "negative" },
    { label: "Total cards", value: units.toLocaleString(), meta: `${portfolioCards.length} unique owned cards`, icon: "cards" },
    { label: "Card series", value: seriesCount, meta: `${seriesCount} collections tracked`, icon: "layers" },
  ];
  return `
    <section class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">Portfolio overview</p>
          <h1>Good ${greeting()}, collector.</h1>
           <p class="page-subtitle">Only cards tagged “Card I own” are included. Daily check begins at ${DAILY_CHECK_LABEL}.</p>
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
             <div><h2 class="panel-title">Portfolio performance</h2><p class="panel-subtitle">Combined value of owned card quantities</p></div>
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
  const portfolioCards = ownedCards();
  const series = Array.from({ length: 12 }, (_, index) =>
    portfolioCards.reduce((sum, card) => {
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
  ownedCards().forEach((card) => {
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
        <div class="donut" style="background:${stops.length ? `conic-gradient(${stops.join(",")})` : "#292c32"}"></div>
        <div class="donut-copy"><strong>${data.length}</strong><small>series</small></div>
      </div>
      <div class="legend">
        ${data.length
          ? data.slice(0, 5).map((item) => `<div class="legend-row"><span class="legend-dot" style="background:${item.color}"></span><span>${html(item.series)}</span><strong>${((item.value / total) * 100).toFixed(0)}%</strong></div>`).join("")
          : '<div class="dashboard-empty">Tag a card as “Card I own” to include it here.</div>'}
      </div>
    </article>
  `;
}

function renderHoldings() {
  const cards = [...ownedCards()].sort((a, b) => phpValue(b) - phpValue(a)).slice(0, 4);
  return `
    <article class="panel holdings-panel">
      <div class="holdings-head panel-head"><div><h2 class="panel-title">Top holdings</h2><p class="panel-subtitle">Your highest-value cards by total quantity</p></div><button class="ghost-button" data-action="navigate" data-page="cards">VIEW ALL</button></div>
      <div class="holdings-list">
        ${cards.length ? cards
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
          .join("") : '<div class="dashboard-empty holdings-empty">No owned cards yet. Tag one from its Edit card window.</div>'}
      </div>
    </article>
  `;
}

function renderCards() {
  const filters = ["ALL", ...new Set(state.cards.map((card) => card.series))];
  const filtered = state.filter === "ALL" ? state.cards : state.cards.filter((card) => card.series === state.filter);
  const portfolioCards = ownedCards();
  const ownedUnits = portfolioCards.reduce((sum, card) => sum + card.quantity, 0);
  const monitoredCards = state.cards.filter((card) => card.monitorStatus === "active").length;
  const pinnedCards = state.cards.filter((card) => card.pinned === true).length;
  const manualCards = manualUpdateCandidates(state.cards).length;
  return `
    <section class="page">
      <div class="page-head">
        <div><p class="eyebrow">Your collection</p><h1>My cards</h1><p class="page-subtitle">${state.cards.length} tracked · ${pinnedCards} pinned · ${portfolioCards.length} owned · ${ownedUnits} owned units · ${monitoredCards} price monitored</p></div>
      </div>
      <div class="toolbar">
        <div class="filters" aria-label="Filter by card series">
          ${filters.map((filter) => `<button class="filter-button ${state.filter === filter ? "active" : ""}" data-action="filter" data-filter="${html(filter)}">${html(filter)}</button>`).join("")}
        </div>
        <div class="toolbar-actions"><button class="queue-toolbar-button" data-action="update-queue"><span>UPDATE QUEUE</span><b>${manualCards}</b></button><button class="primary-button dark" data-action="add"><img src="images/icons/icon-add.svg" alt=""/><span>ADD CARD</span></button></div>
      </div>
      <div class="cards-grid" data-card-grid>
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
  const monitor = monitoringInfo(card);
  return `
    <article class="card-tile ${card.pinned ? "is-pinned" : ""}" data-id="${html(card.id)}" data-pinned="${card.pinned ? "true" : "false"}" draggable="true">
      <button class="card-open" data-action="details" data-id="${html(card.id)}" aria-label="View ${html(card.title)} card details">
        <div class="card-art">${renderArt(card)}<span class="quantity-pill">× ${card.quantity}</span><span class="ownership-pill ${card.owned !== false ? "owned" : "watching"}">${card.owned !== false ? "✓ OWNED" : "WATCHING"}</span><span class="monitoring-pill ${monitor.className}" title="${html(monitor.detail)}">${monitor.label}</span></div>
        <div class="card-body">
          <div class="card-meta"><span class="series-name" style="color:${series.color}">${html(card.series)}</span><span class="card-code">${html(card.code)}</span></div>
          <div class="card-price-row"><div class="card-price-stack"><strong class="card-price">${money(unitPhp(card))}</strong><small>${nativeMoney(card.nativePrice, card.currency)}</small></div><span class="price-change ${card.change >= 0 ? "positive" : "negative"}">${card.change >= 0 ? "↗ +" : "↘ "}${card.change.toFixed(1)}%</span></div>
        </div>
      </button>
      <button class="drag-handle" type="button" data-drag-handle aria-label="Drag ${html(card.title)} to reorder, or use arrow keys" title="Drag to reorder"><span></span><span></span><span></span><span></span><span></span><span></span></button>
      <button class="pin-button ${card.pinned ? "active" : ""}" type="button" data-action="pin" data-id="${html(card.id)}" aria-label="${card.pinned ? "Unpin" : "Pin"} ${html(card.title)}" aria-pressed="${card.pinned ? "true" : "false"}" title="${card.pinned ? "Unpin card" : "Pin card to top"}">${icon("pin")}</button>
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
  if (state.modal === "update-queue") return renderManualUpdateQueueModal();
  return "";
}

function renderManualUpdateQueueModal() {
  const view = manualUpdateQueueView(manualUpdateQueue, state.cards);
  const progress = view.total ? Math.round((view.completed / view.total) * 100) : 0;
  const batchSize = Math.min(view.remaining, 10);
  const currentCard = view.current?.card;
  const current = currentCard
    ? `<article class="queue-current"><div class="queue-current-art">${renderArt(currentCard)}</div><div class="queue-current-copy"><span>NEXT CARD · ${view.completed + 1} OF ${view.total}</span><strong>${html(currentCard.title)}</strong><small>${html(currentCard.code)} · ${nativeMoney(currentCard.nativePrice, currentCard.currency)}</small><a href="${html(safeUrl(currentCard.sourceUrl))}" data-action="queue-open" data-id="${html(currentCard.id)}">${view.current.active ? "OPEN AGAIN" : "OPEN ONE TAB"} ↗</a></div></article>`
    : `<div class="queue-complete"><strong>${view.total ? "QUEUE COMPLETE" : "NO YUYUTEI CARDS"}</strong><p>${view.total ? `All ${view.total} cards were updated in this round.` : "Add a Yuyutei card-page URL to use the manual update queue."}</p></div>`;
  const rows = view.entries.map(({ card, completed, active }) => `
    <div class="queue-row ${completed ? "complete" : active ? "active" : ""}">
      <div class="queue-thumb">${renderArt(card)}</div>
      <div class="queue-row-copy"><strong>${html(card.title)}</strong><small>${html(card.code)} · ${nativeMoney(card.nativePrice, card.currency)}</small></div>
      <span>${completed ? "UPDATED" : active ? "OPENED" : "WAITING"}</span>
    </div>`).join("");
  return modalShell(
    `<div class="modal-body update-queue-body"><div class="queue-instructions"><div><strong>ONE-TIME BOOKMARK UPGRADE</strong><span>Replace your old CardBoy bookmark with this version. It auto-saves queue updates and closes finished tabs.</span></div><a class="queue-bookmark" href="${html(yuyuImporterBookmarklet())}" title="Drag this over your existing CardBoy bookmark">DRAG NEW BOOKMARK</a></div>${batchSize ? `<div class="queue-batch"><div><strong>QUICK BATCH</strong><span>Open the tabs, then click your CardBoy bookmark once in each. No Save step.</span></div><button type="button" data-action="queue-open-batch">OPEN NEXT ${batchSize} ${batchSize === 1 ? "TAB" : "TABS"}</button></div>` : ""}<div class="queue-progress-copy"><span>${view.completed} updated</span><span>${view.remaining} remaining</span></div><div class="queue-progress"><span style="width:${progress}%"></span></div>${current}${rows ? `<div class="queue-list"><div class="queue-list-title">THIS ROUND</div>${rows}</div>` : ""}<div class="modal-actions"><button type="button" class="secondary-button" data-action="queue-reset">${view.total && !view.remaining ? "START NEW ROUND" : "RESET QUEUE"}</button><button type="button" class="primary-button" data-action="close">DONE</button></div></div>`,
    { title: "Manual update queue", className: "update-queue-modal" },
  );
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
      <div class="notification-summary"><p>Price movement alerts from manual checks and Card-Value's Yuyutei selling table.</p><span>Daily check: ${DAILY_CHECK_LABEL}</span></div>
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
  const importedUpdate = isEdit && pendingCardImport
    && canonicalSourceUrl(card.sourceUrl) === canonicalSourceUrl(pendingCardImport.sourceUrl);
  const value = importedUpdate
    ? {
        ...card,
        ...pendingCardImport,
        quantity: card.quantity,
        owned: card.owned,
        image: pendingCardImport.image || card.image,
      }
    : card || pendingCardImport || {
    sourceUrl: "",
    series: "ONE PIECE",
    code: "",
    title: "",
    quantity: 1,
    currency: "JPY",
    nativePrice: "",
    image: "",
    owned: true,
  };
  const importStatus = importedUpdate
    ? `Existing card matched by its source URL. Stored price: ${nativeMoney(card.nativePrice, card.currency)} · Latest page price: ${nativeMoney(Number(value.nativePrice), value.currency)}.${pendingCardImport.availability === "OutOfStock" ? " This listing is currently out of stock." : ""}`
    : !isEdit && pendingCardImport
      ? `Imported directly from Yuyu-tei.${pendingCardImport.availability === "OutOfStock" ? " This listing is currently out of stock." : ""}`
    : isYuyuteiSourceUrl(value.sourceUrl)
      ? "Fetches the card image from Yuyutei. The stored price will not be changed."
      : "Fetches the card name, code, source price, and product image when available.";
  return modalShell(
    `<form class="modal-body" id="card-form" data-editing="${isEdit ? html(card.id) : ""}">
      ${!isEdit ? `<div class="import-helper"><div><strong>ONE-CLICK YUYU-TEI IMPORT</strong><small>Drag this button to your browser bookmarks bar once. Queue-opened cards save automatically; other Yuyu-tei pages still open a review form.</small></div><a class="import-bookmark" href="${html(yuyuImporterBookmarklet())}" title="Drag this button to your bookmarks bar">DRAG TO BOOKMARKS</a></div>` : ""}
      <div class="form-grid">
        <div class="form-fields">
          <div class="field"><label for="source-url">Card page URL</label><div class="input-wrap"><input id="source-url" name="sourceUrl" type="url" placeholder="https://store.com/card/..." value="${html(value.sourceUrl)}" required/><button type="button" class="fetch-button" data-action="fetch">${fetchButtonLabel(value.sourceUrl)}</button></div><small id="fetch-status"${pendingCardImport && (!isEdit || importedUpdate) ? ' class="import-success"' : ""}>${html(importStatus)}</small></div>
          <div class="field"><label for="card-series">Card series</label><select id="card-series" name="series">${Object.keys(SERIES).map((series) => `<option ${series === value.series ? "selected" : ""}>${html(series)}</option>`).join("")}</select></div>
          <div class="two-fields"><div class="field"><label for="card-code">Card code</label><input id="card-code" name="code" value="${html(value.code)}" placeholder="OP08-106" required/></div><div class="field"><label for="card-title">Card name</label><input id="card-title" name="title" value="${html(value.title)}" placeholder="Nami" required/></div></div>
          <div class="two-fields"><div class="field"><label for="card-quantity">Quantity</label><input id="card-quantity" name="quantity" type="number" min="1" step="1" value="${value.quantity}" required/></div><div class="field"><label for="card-currency">Currency</label><select id="card-currency" name="currency"><option ${value.currency === "JPY" ? "selected" : ""}>JPY</option><option ${value.currency === "USD" ? "selected" : ""}>USD</option></select></div></div>
          <label class="ownership-control"><input name="owned" type="checkbox" ${value.owned !== false ? "checked" : ""}/><span class="ownership-checkbox">✓</span><span class="ownership-copy"><strong>CARD I OWN</strong><small>Only owned cards and their quantities are included in the dashboard.</small></span></label>
          <div class="field"><label for="native-price">Current source price</label><input id="native-price" name="nativePrice" type="number" min="0" step="0.01" value="${value.nativePrice}" placeholder="3200" required/></div>
        </div>
        <div class="image-upload"><div class="preview-card" id="image-preview">${value.image ? `<img src="${html(value.image)}" alt="Card preview"/>` : `<div class="preview-placeholder">${icon("image")}<span>IMAGE PREVIEW</span></div>`}</div><label class="upload-button">UPLOAD YOUR OWN<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp"/></label><input type="hidden" name="image" value="${html(value.image)}"/></div>
      </div>
      <div class="modal-actions">${isEdit ? '<button type="button" class="danger-button" data-action="delete">DELETE CARD</button>' : ""}<button type="button" class="secondary-button" data-action="close">CANCEL</button><button type="submit" class="primary-button">${isEdit ? "SAVE CHANGES" : "ADD CARD"}</button></div>
    </form>`,
    { title: importedUpdate ? "Update card price" : isEdit ? "Edit card" : "New card entry" },
  );
}

function renderDetailsModal() {
  const card = state.cards.find((item) => item.id === state.activeCardId);
  if (!card) return "";
  const series = SERIES[card.series] || { color: "#6f7900" };
  const monitor = monitoringInfo(card);
  const labels = ["SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG"];
  const directUpdate = isYuyuteiSourceUrl(card.sourceUrl)
    ? `<div class="detail-source-update"><div><strong>DIRECT YUYUTEI UPDATE</strong><small>For automatic saving, use Update Queue. This direct link keeps the review-first workflow.</small></div><a href="${html(safeUrl(card.sourceUrl))}" target="_blank" rel="noopener noreferrer">OPEN YUYUTEI ↗</a></div>`
    : "";
  return modalShell(
    `<div class="modal-body"><div class="details-layout"><div class="detail-art">${renderArt(card)}</div><div class="details-copy"><div class="details-title-row"><div><div class="details-series" style="color:${series.color}">${html(card.series)}</div><div class="details-code">${html(card.code)} · ${html(card.title)}</div></div><button class="edit-detail-button" data-action="edit" data-id="${html(card.id)}">EDIT</button></div><div class="detail-price">${money(unitPhp(card))}</div><div class="detail-native">${nativeMoney(card.nativePrice, card.currency)} per card · ${card.quantity} ${card.quantity === 1 ? "copy" : "copies"}</div><div class="detail-tags"><div class="detail-ownership ${card.owned !== false ? "owned" : "watching"}">${card.owned !== false ? "✓ Card I own · Included in dashboard" : "Watching · Not included in dashboard"}</div><div class="detail-monitor ${monitor.className}" title="${html(monitor.detail)}"><span></span>${monitor.label}</div></div><p class="detail-monitor-copy">${html(monitor.detail)}</p><div class="detail-stats"><div class="detail-stat"><span>Total value</span><strong>${money(phpValue(card))}</strong></div><div class="detail-stat"><span>24h move</span><strong class="${card.change >= 0 ? "positive" : "negative"}">${card.change >= 0 ? "+" : ""}${card.change.toFixed(1)}%</strong></div><div class="detail-stat"><span>Last checked</span><strong>${formatDate(card.lastChecked)}</strong></div></div>${directUpdate}<div class="detail-source">Price source: <a href="${html(safeUrl(card.sourceUrl))}" target="_blank" rel="noopener noreferrer">${html(card.sourceUrl)}</a></div><div class="modal-chart-tabs">${["MAX", "1M", "3M", "6M", "1Y"].map((range) => `<button class="range-button ${range === "1Y" ? "active" : ""}">${range}</button>`).join("")}</div>${chartSvg(card.history.map((price) => price * state.rates[card.currency]), labels, series.color, `detail-${html(card.id)}`, "detail-chart")}</div></div></div>`,
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
  document.querySelector("#source-url")?.addEventListener("input", (event) => {
    const button = document.querySelector('#card-form [data-action="fetch"]');
    if (button && !button.disabled) button.textContent = fetchButtonLabel(event.currentTarget.value);
  });
  const cardGrid = document.querySelector("[data-card-grid]");
  if (cardGrid) {
    cardGrid.addEventListener("dragover", handleCardDragOver);
    cardGrid.addEventListener("drop", finishNativeCardDrag);
    cardGrid.querySelectorAll(".card-tile").forEach((tile) => {
      tile.addEventListener("dragstart", startNativeCardDrag);
      tile.addEventListener("dragend", finishNativeCardDrag);
    });
    cardGrid.querySelectorAll("[data-drag-handle]").forEach((handle) => {
      handle.addEventListener("pointerdown", startPointerCardDrag);
      handle.addEventListener("keydown", reorderCardWithKeyboard);
    });
  }
}

function reorderDraggedTile(draggedTile, targetTile, clientX, clientY) {
  if (!draggedTile || !targetTile || draggedTile === targetTile) return false;
  if (draggedTile.dataset.pinned !== targetTile.dataset.pinned) return false;
  const targetRect = targetTile.getBoundingClientRect();
  const draggedRect = draggedTile.getBoundingClientRect();
  const sameRow = Math.abs(targetRect.top - draggedRect.top) < Math.min(targetRect.height, draggedRect.height) / 2;
  const placeAfter = sameRow ? clientX > targetRect.left + targetRect.width / 2 : clientY > targetRect.top + targetRect.height / 2;
  const reference = placeAfter ? targetTile.nextElementSibling : targetTile;
  if (reference === draggedTile || (!reference && draggedTile === targetTile.parentElement.lastElementChild)) return false;
  targetTile.parentElement.insertBefore(draggedTile, reference);
  return true;
}

function commitCardOrder(grid) {
  const visibleIds = [...grid.querySelectorAll(".card-tile")].map((tile) => tile.dataset.id);
  const visibleSet = new Set(visibleIds);
  const cardsById = new Map(state.cards.map((card) => [card.id, card]));
  let visibleIndex = 0;
  const reordered = state.cards.map((card) => (visibleSet.has(card.id) ? cardsById.get(visibleIds[visibleIndex++]) : card));
  const changed = reordered.some((card, index) => card.id !== state.cards[index]?.id);
  if (!changed) return;
  state.cards = normalizeCardOrder(reordered);
  saveState();
  render();
  backend.reorderCards(state.cards).catch((error) => toast(`Card order sync failed: ${error.message}`));
  toast("Card order saved.");
}

async function togglePinned(cardId) {
  if (backend.isConfigured && !state.user) {
    openModal("login");
    toast("Sign in with Google to save pinned cards across devices.");
    return;
  }
  const result = toggleCardPinned(state.cards, cardId);
  if (!result.card) return;
  state.cards = result.cards;
  saveState();
  render();
  toast(result.card.pinned ? "Card pinned to the top." : "Card moved back to the regular list.");
  try {
    await backend.setCardPinned(result.card.id, result.card.pinned);
    await backend.reorderCards(state.cards);
  } catch (error) {
    toast(`Pinned card sync failed: ${error.message}`);
  }
}

function startNativeCardDrag(event) {
  if (backend.isConfigured && !state.user) {
    event.preventDefault();
    toast("Sign in with Google to save a custom card order.");
    return;
  }
  const tile = event.currentTarget;
  nativeCardDrag = { tile, grid: tile.parentElement, moved: false };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tile.dataset.id);
  }
  requestAnimationFrame(() => tile.classList.add("is-dragging"));
}

function handleCardDragOver(event) {
  if (!nativeCardDrag) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const targetTile = event.target.closest(".card-tile");
  if (reorderDraggedTile(nativeCardDrag.tile, targetTile, event.clientX, event.clientY)) nativeCardDrag.moved = true;
}

function finishNativeCardDrag(event) {
  if (!nativeCardDrag) return;
  event.preventDefault?.();
  const { tile, grid, moved } = nativeCardDrag;
  nativeCardDrag = null;
  tile.classList.remove("is-dragging");
  if (moved) {
    suppressCardOpenUntil = Date.now() + 350;
    commitCardOrder(grid);
  }
}

function startPointerCardDrag(event) {
  if (!event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (backend.isConfigured && !state.user) {
    toast("Sign in with Google to save a custom card order.");
    return;
  }
  const handle = event.currentTarget;
  const tile = handle.closest(".card-tile");
  handle.setPointerCapture(event.pointerId);
  pointerCardDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    handle,
    tile,
    grid: tile.parentElement,
    moved: false,
  };
  window.addEventListener("pointermove", movePointerCardDrag, { passive: false });
  window.addEventListener("pointerup", finishPointerCardDrag);
  window.addEventListener("pointercancel", finishPointerCardDrag);
}

function reorderCardWithKeyboard(event) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (backend.isConfigured && !state.user) {
    toast("Sign in with Google to save a custom card order.");
    return;
  }
  const tile = event.currentTarget.closest(".card-tile");
  const sibling = ["ArrowLeft", "ArrowUp"].includes(event.key) ? tile.previousElementSibling : tile.nextElementSibling;
  if (!sibling?.classList.contains("card-tile")) return;
  if (sibling.dataset.pinned !== tile.dataset.pinned) return;
  if (["ArrowLeft", "ArrowUp"].includes(event.key)) sibling.before(tile);
  else sibling.after(tile);
  const cardId = tile.dataset.id;
  commitCardOrder(tile.parentElement);
  requestAnimationFrame(() => {
    const movedTile = [...document.querySelectorAll(".card-tile")].find((item) => item.dataset.id === cardId);
    movedTile?.querySelector("[data-drag-handle]")?.focus();
  });
}

function movePointerCardDrag(event) {
  if (!pointerCardDrag || event.pointerId !== pointerCardDrag.pointerId) return;
  const distance = Math.hypot(event.clientX - pointerCardDrag.startX, event.clientY - pointerCardDrag.startY);
  if (!pointerCardDrag.moved && distance < 7) return;
  event.preventDefault();
  if (!pointerCardDrag.moved) {
    pointerCardDrag.moved = true;
    pointerCardDrag.tile.classList.add("is-dragging");
    document.body.classList.add("is-reordering");
  }
  const targetTile = document.elementFromPoint(event.clientX, event.clientY)?.closest(".card-tile");
  reorderDraggedTile(pointerCardDrag.tile, targetTile, event.clientX, event.clientY);
}

function finishPointerCardDrag(event) {
  if (!pointerCardDrag || event.pointerId !== pointerCardDrag.pointerId) return;
  const { handle, tile, grid, moved, pointerId } = pointerCardDrag;
  pointerCardDrag = null;
  window.removeEventListener("pointermove", movePointerCardDrag);
  window.removeEventListener("pointerup", finishPointerCardDrag);
  window.removeEventListener("pointercancel", finishPointerCardDrag);
  if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  tile.classList.remove("is-dragging");
  document.body.classList.remove("is-reordering");
  if (moved) {
    suppressCardOpenUntil = Date.now() + 350;
    commitCardOrder(grid);
  }
}

async function handleAction(event) {
  const target = event.currentTarget;
  const action = target.dataset.action;
  if (action === "details" && Date.now() < suppressCardOpenUntil) return;
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
    clearPendingCardImport();
    pendingImageFile = null;
    state.activeCardId = null;
    openModal("add");
  } else if (action === "update-queue") {
    const existing = manualUpdateQueueView(manualUpdateQueue, state.cards);
    if (!existing.total) resetManualUpdateQueue();
    openModal("update-queue");
  } else if (action === "queue-reset") {
    resetManualUpdateQueue();
    render();
  } else if (action === "queue-open-batch") {
    openQuickUpdateBatch();
  } else if (action === "queue-open") {
    event.preventDefault();
    const card = state.cards.find((item) => item.id === target.dataset.id);
    if (!card || !openQuickUpdateTab(card)) {
      toast("Your browser blocked the tab. Allow pop-ups for CardBoy, then try again.");
      return;
    }
    manualUpdateQueue = markManualUpdateOpened(manualUpdateQueue, target.dataset.id, state.cards);
    saveManualUpdateQueue();
    setTimeout(render, 0);
  } else if (action === "details") {
    state.activeCardId = target.dataset.id;
    openModal("details");
  } else if (action === "pin") {
    await togglePinned(target.dataset.id);
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
  if (pendingCardImport && ["add", "edit", "login"].includes(state.modal)) clearPendingCardImport();
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
  const existing = editingId ? state.cards.find((card) => card.id === editingId) : null;
  const importedUpdate = Boolean(existing && pendingCardImport
    && canonicalSourceUrl(existing.sourceUrl) === canonicalSourceUrl(pendingCardImport.sourceUrl));
  const closeAfterSave = importedUpdate && pendingImportAutoSave;
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
    cardValueUrl: existing && canonicalSourceUrl(existing.sourceUrl) === canonicalSourceUrl(String(data.get("sourceUrl")))
      ? existing.cardValueUrl || null
      : null,
    series: String(data.get("series")),
    code: String(data.get("code")).trim().toUpperCase(),
    title: String(data.get("title")).trim(),
    quantity: Math.max(1, Number.parseInt(data.get("quantity"), 10) || 1),
    currency: String(data.get("currency")),
    nativePrice,
    image,
    owned: data.get("owned") === "on",
    lastChecked: new Date().toISOString(),
    monitorStatus: existing && canonicalSourceUrl(existing.sourceUrl) === canonicalSourceUrl(String(data.get("sourceUrl")))
      ? existing.monitorStatus || "pending"
      : "pending",
    monitorMessage: existing && canonicalSourceUrl(existing.sourceUrl) === canonicalSourceUrl(String(data.get("sourceUrl")))
      ? existing.monitorMessage || "Waiting for the next scheduled Card-Value check."
      : "Waiting for the next scheduled Card-Value check.",
    monitorCheckedAt: existing && canonicalSourceUrl(existing.sourceUrl) === canonicalSourceUrl(String(data.get("sourceUrl")))
      ? existing.monitorCheckedAt || null
      : null,
  };
  let priceMovement = null;
  if (editingId) {
    const index = state.cards.findIndex((card) => card.id === editingId);
    const previous = state.cards[index];
    const change = previous.nativePrice
      ? Number((((nativePrice - previous.nativePrice) / previous.nativePrice) * 100).toFixed(1))
      : 0;
    state.cards[index] = {
      ...previous,
      ...payload,
      change: nativePrice === previous.nativePrice ? previous.change : change,
      history: nativePrice === previous.nativePrice ? previous.history : [...previous.history.slice(-11), nativePrice],
    };
    if (importedUpdate && nativePrice !== previous.nativePrice) {
      priceMovement = { previousPrice: previous.nativePrice, change };
    }
  } else {
    const seed = nativePrice || 1;
    state.cards.push({
      ...payload,
      id: cardId,
      pinned: false,
      change: 0,
      history: Array.from({ length: 12 }, (_, index) => Number((seed * (0.82 + index * 0.016)).toFixed(2))),
    });
  }
  state.cards = normalizeCardOrder(state.cards);
  const savedCard = editingId ? state.cards.find((card) => card.id === editingId) : state.cards.find((card) => card.id === cardId);
  let alert = null;
  if (priceMovement) {
    const direction = priceMovement.change >= 0 ? "increased" : "decreased";
    alert = {
      id: `${savedCard.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cardId: savedCard.id,
      title: `${savedCard.title} ${direction} ${Math.abs(priceMovement.change).toFixed(1)}%`,
      message: `Updated from ${nativeMoney(priceMovement.previousPrice, savedCard.currency)} to ${nativeMoney(savedCard.nativePrice, savedCard.currency)} (${money(unitPhp(savedCard))}) per card.`,
      change: priceMovement.change,
      createdAt: savedCard.lastChecked,
      read: false,
      automatic: false,
    };
    state.notifications.unshift(alert);
    state.notifications = state.notifications.slice(0, 30);
    state.lastPortfolioCheck = savedCard.lastChecked;
  }
  let queueAdvance = null;
  if (importedUpdate && editingId) {
    const completed = markManualUpdateComplete(manualUpdateQueue, savedCard.id, state.cards);
    if (completed.changed) {
      manualUpdateQueue = completed.queue;
      saveManualUpdateQueue();
      queueAdvance = manualUpdateQueueView(manualUpdateQueue, state.cards);
    }
  }
  saveState();
  try {
    await backend.saveCard(savedCard, unitPhp(savedCard));
    if (alert) {
      const savedAlert = await backend.saveNotification(alert);
      if (savedAlert?.id) alert.id = savedAlert.id;
    }
  } catch (error) {
    toast(`Cloud card save failed: ${error.message}`);
  }
  if (!editingId) backend.reorderCards(state.cards).catch((error) => toast(`Card order sync failed: ${error.message}`));
  pendingImageFile = null;
  clearPendingCardImport();
  state.modal = queueAdvance ? "update-queue" : null;
  state.filter = "ALL";
  state.page = "cards";
  history.replaceState(null, "", "#cards");
  saveState();
  render();
  if (queueAdvance?.remaining) toast(`Update saved. ${queueAdvance.remaining} card${queueAdvance.remaining === 1 ? "" : "s"} remaining.`);
  else if (queueAdvance) toast("Manual update queue complete.");
  else if (!editingId) toast("Card added to your collection.");
  else if (priceMovement) toast(`Price ${priceMovement.change >= 0 ? "increase" : "decrease"} saved. A notification was created.`);
  else if (importedUpdate) toast("Price checked. The Yuyu-tei price has not changed.");
  else toast("Card details updated.");
  autoImportStarted = false;
  const completeAutoImport = autoImportCompletionResolve;
  autoImportCompletionResolve = null;
  completeAutoImport?.();
  if (closeAfterSave) setTimeout(() => window.close(), 350);
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
  const imageOnly = isYuyuteiSourceUrl(urlInput.value.trim());
  button.disabled = true;
  button.textContent = "READING";
  status.textContent = imageOnly
    ? "Locating the card image from Yuyutei…"
    : "Reading product data and image from the source page…";
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
    status.textContent = card.notice || (card.image ? "Details and product image fetched from the source." : "Details fetched; this page did not expose a product image.");
    toast(imageOnly && card.image ? "Card image fetched from Yuyutei." : `${fields} card details fetched from the source.`);
  } catch (error) {
    status.textContent = error.message;
    toast(`Could not fetch this source: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = fetchButtonLabel(urlInput.value);
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
  const startedAt = new Date().toISOString();
  const totalSources = new Set(state.cards.map((card) => safeUrl(card.sourceUrl)).filter((url) => url !== "#")).size;
  state.monitorRun = {
    ...createInitialMonitorRun(),
    status: "running",
    trigger: automatic ? "scheduled" : "manual",
    startedAt,
    totalSources,
    message: "Checking the latest Yuyutei selling prices via Card-Value.",
  };
  render();
  if (!automatic) toast("Checking live card sources…");
  if (backend.isReady && backend.user) {
    try {
      const result = await backend.checkPrices();
      priceCheckInProgress = false;
      await loadCloudPortfolio();
      if (result.fallback) {
        const completedAt = new Date().toISOString();
        manualMonitorOverrideUntil = Date.now() + MONITOR_RECENT_RESULT_MS;
        state.monitorRun = {
          ...state.monitorRun,
          status: "success",
          completedAt,
          lastSuccessAt: completedAt,
          processedSources: result.checked + result.unsupported,
          totalSources: result.checked + result.unsupported,
          checkedSources: result.checked,
          observations: result.observations || 0,
          movements: result.movements,
          unsupportedSources: result.unsupported,
          message: `${result.checked} live sources checked through the recovery path. ${result.movements} price movements found.`,
        };
        render();
      } else {
        await refreshMonitorStatus();
      }
      if (!automatic) {
        if (result.movements) toast(`${result.movements} price movement${result.movements === 1 ? "" : "s"} found.`);
        else if (result.fallback && result.unsupported) toast(`Price check complete. ${result.checked} checked; ${result.unsupported} need a Card-Value variant URL.`);
        else toast("Price check complete. No movements found.");
      }
    } catch (error) {
      priceCheckInProgress = false;
      state.monitorRun = {
        ...state.monitorRun,
        status: "error",
        completedAt: new Date().toISOString(),
        message: error.message,
      };
      render();
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
  state.monitorRun = {
    ...state.monitorRun,
    status: "success",
    completedAt: checkedAt,
    lastSuccessAt: checkedAt,
    processedSources: totalSources,
    totalSources,
    checkedSources: totalSources,
    movements: movements.length,
    message: `${totalSources} sources checked. ${movements.length} price movements found.`,
  };
  priceCheckInProgress = false;
  saveState();
  render();
  if (!automatic) toast(movements.length ? `${movements.length} price movement${movements.length === 1 ? "" : "s"} found.` : "Price check complete. No movements found.");
}

function philippineCheckWindow(now = new Date()) {
  const phNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayCheck = new Date(Date.UTC(phNow.getUTCFullYear(), phNow.getUTCMonth(), phNow.getUTCDate(), DAILY_CHECK_HOUR - 8, DAILY_CHECK_MINUTE));
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

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    refreshPortfolioFromStorage();
    if (state.modal === "update-queue") render();
    return;
  }
  if (event.key === UPDATE_QUEUE_KEY) {
    manualUpdateQueue = loadManualUpdateQueue();
    if (state.modal === "update-queue") render();
  }
});

render();
runDailyCheck();
initializeProductionBackend();
