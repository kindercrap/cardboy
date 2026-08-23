const config = window.CARDBOY_CONFIG || {};
let client = null;
let currentUser = null;

async function functionError(error, fallback) {
  let message = error?.message || fallback;
  try {
    const response = error?.context;
    if (response && typeof response.clone === "function") {
      const payload = await response.clone().json();
      if (payload?.error) message = payload.error;
    }
  } catch {
    // Keep the SDK message when the response is not JSON.
  }
  return new Error(message);
}

export const backend = {
  get isConfigured() {
    return Boolean(config.supabaseUrl && config.supabasePublishableKey);
  },

  get isReady() {
    return Boolean(client);
  },

  get user() {
    return currentUser;
  },

  async initialize(onAuthChange) {
    if (!this.isConfigured) return null;
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2?bundle");
    client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    currentUser = data.session?.user || null;
    client.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      onAuthChange?.(currentUser);
    });
    return currentUser;
  },

  async signInWithGoogle() {
    if (!client) throw new Error("Supabase is not configured.");
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) throw error;
  },

  async signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
    currentUser = null;
  },

  async loadPortfolio() {
    if (!client || !currentUser) return null;
    const [cardsResult, snapshotsResult, ratesResult, fxResult, notificationsResult] = await Promise.all([
      client.from("cards").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
      client.from("price_snapshots").select("card_id,source_price,checked_at").order("checked_at", { ascending: true }),
      client.from("user_rates").select("*").maybeSingle(),
      client.from("fx_rates").select("currency,php_rate,fetched_at"),
      client.from("notifications").select("*").order("created_at", { ascending: false }).limit(30),
    ]);
    for (const result of [cardsResult, snapshotsResult, ratesResult, fxResult, notificationsResult]) {
      if (result.error) throw result.error;
    }
    return {
      cards: cardsResult.data || [],
      snapshots: snapshotsResult.data || [],
      rates: ratesResult.data,
      fxRates: fxResult.data || [],
      notifications: notificationsResult.data || [],
    };
  },

  async saveCard(card, phpPrice) {
    if (!client || !currentUser) return;
    const row = {
      id: card.id,
      user_id: currentUser.id,
      series: card.series,
      code: card.code,
      title: card.title,
      quantity: card.quantity,
      source_url: card.sourceUrl,
      source_currency: card.currency,
      source_price: card.nativePrice,
      image_url: card.image,
      is_owned: card.owned !== false,
      sort_order: Number.isFinite(Number(card.sortOrder)) ? Number(card.sortOrder) : 0,
      change_percent: card.change || 0,
      last_checked: card.lastChecked,
      monitor_status: card.monitorStatus || "pending",
      monitor_message: card.monitorMessage || "Waiting for the next scheduled catalog check.",
      monitor_checked_at: card.monitorCheckedAt || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await client.from("cards").upsert(row, { onConflict: "user_id,id" });
    if (error) throw error;
    const { error: snapshotError } = await client.from("price_snapshots").insert({
      user_id: currentUser.id,
      card_id: card.id,
      source_price: card.nativePrice,
      source_currency: card.currency,
      php_price: phpPrice,
      checked_at: card.lastChecked || new Date().toISOString(),
    });
    if (snapshotError) throw snapshotError;
  },

  async deleteCard(id) {
    if (!client || !currentUser) return;
    const { error } = await client.from("cards").delete().eq("id", id);
    if (error) throw error;
  },

  async reorderCards(cards) {
    if (!client || !currentUser || !cards?.length) return;
    const updatedAt = new Date().toISOString();
    const results = await Promise.all(cards.map((card, index) => client
      .from("cards")
      .update({ sort_order: index, updated_at: updatedAt })
      .eq("user_id", currentUser.id)
      .eq("id", card.id)));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
  },

  async saveRates(rates, customized) {
    if (!client || !currentUser) return;
    const { error } = await client.from("user_rates").upsert({
      user_id: currentUser.id,
      jpy_rate: rates.JPY,
      usd_rate: rates.USD,
      use_live_rate: !customized,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },

  async markNotificationsRead() {
    if (!client || !currentUser) return;
    const { error } = await client.from("notifications").update({ read: true }).eq("read", false);
    if (error) throw error;
  },

  async clearNotifications() {
    if (!client || !currentUser) return;
    const { error } = await client.from("notifications").delete().eq("user_id", currentUser.id);
    if (error) throw error;
  },

  async saveNotification(notification) {
    if (!client || !currentUser) return null;
    const { data, error } = await client.from("notifications").insert({
      user_id: currentUser.id,
      card_id: notification.cardId,
      title: notification.title,
      message: notification.message,
      change_percent: notification.change || 0,
      automatic: notification.automatic !== false,
      read: notification.read === true,
      created_at: notification.createdAt || new Date().toISOString(),
    }).select("id").single();
    if (error) throw error;
    return data;
  },

  async extractCard(url) {
    if (!client || !currentUser) throw new Error("Sign in before fetching a card source.");
    const { data, error } = await client.functions.invoke("extract-card", { body: { url } });
    if (error) throw await functionError(error, "The card source could not be fetched.");
    return data.card;
  },

  async checkPrices() {
    if (!client || !currentUser) throw new Error("Sign in before checking prices.");
    const { data, error } = await client.functions.invoke("daily-price-check", { body: { manual: true } });
    if (error) throw await functionError(error, "The price check could not be started.");
    return data;
  },

  async uploadImage(file, cardId) {
    if (!client || !currentUser || !file) return "";
    const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${currentUser.id}/${cardId}-${Date.now()}.${extension}`;
    const { error } = await client.storage.from("card-images").upload(path, file, { upsert: false, cacheControl: "31536000" });
    if (error) throw error;
    return client.storage.from("card-images").getPublicUrl(path).data.publicUrl;
  },
};
