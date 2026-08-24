import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  calculatePriceMovement,
  canonicalExternalUrl,
  createCardValueScraper,
  isCardValueCardUrl,
  isYuyuteiOnePieceSellingUrl,
  resolveSavedCardValueListings,
} from "../_shared/card-value.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cardboy-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function isAutomaticRequest(request: Request) {
  const provided = request.headers.get("x-cardboy-cron-secret")
    || request.headers.get("apikey")
    || bearerToken(request);
  const accepted = [
    Deno.env.get("DAILY_CHECK_SECRET"),
    Deno.env.get("SUPABASE_SECRET_KEY"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  ].filter(Boolean);
  return Boolean(provided && accepted.includes(provided));
}

async function userClient(request: Request) {
  const authorization = request.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization?.startsWith("Bearer ") || !url || !anonKey) return null;
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : client;
}

async function updateFxRates(service: any) {
  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=PHP&to=JPY,USD", { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const data = await response.json();
    const rows = ["JPY", "USD"].map((currency) => ({ currency, php_rate: 1 / Number(data.rates[currency]), fetched_at: new Date().toISOString() }));
    await service.from("fx_rates").upsert(rows);
  } catch {
    // Preserve the last valid FX rates when the provider is unavailable.
  }
}

function philippineObservationDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

async function storeDailyObservation(service: any, card: any, listing: any, observedAt: string) {
  const observationDay = philippineObservationDay(new Date(observedAt));
  const existingQuery = await service.from("daily_price_observations")
    .select("id,price_change,percentage_change")
    .eq("user_id", card.user_id)
    .eq("card_id", card.id)
    .eq("source", "yuyutei")
    .eq("source_via", "card-value.jp")
    .eq("observation_day", observationDay)
    .maybeSingle();
  if (existingQuery.error) throw existingQuery.error;
  if (existingQuery.data) {
    return {
      stored: false,
      priceChange: Number(existingQuery.data.price_change ?? 0),
      percentageChange: Number(existingQuery.data.percentage_change ?? 0),
    };
  }

  const previousQuery = await service.from("daily_price_observations")
    .select("price")
    .eq("user_id", card.user_id)
    .eq("card_id", card.id)
    .eq("source", "yuyutei")
    .eq("source_via", "card-value.jp")
    .lt("observation_day", observationDay)
    .order("observation_day", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousQuery.error) throw previousQuery.error;
  const previousPrice = previousQuery.data ? Number(previousQuery.data.price) : null;
  const currentPrice = Number(listing.yuyuteiPrice);
  const { priceChange, percentageChange } = calculatePriceMovement(currentPrice, previousPrice);
  const inserted = await service.from("daily_price_observations").upsert({
    user_id: card.user_id,
    card_id: card.id,
    card_number: listing.cardNumber || card.code || "UNKNOWN",
    variant: listing.variant,
    card_value_url: listing.cardValueUrl,
    yuyutei_url: listing.yuyuteiUrl,
    price: currentPrice,
    currency: "JPY",
    source: "yuyutei",
    source_via: "card-value.jp",
    price_change: priceChange,
    percentage_change: percentageChange,
    observed_at: observedAt,
    observation_day: observationDay,
  }, {
    onConflict: "user_id,card_id,source,source_via,observation_day",
    ignoreDuplicates: true,
  }).select("id");
  if (inserted.error) throw inserted.error;
  return { stored: Boolean(inserted.data?.length), previousPrice, priceChange, percentageChange };
}

async function updateMonitorStatus(service: any, fields: Record<string, unknown>) {
  const { error } = await service.from("price_monitor_status").update({
    ...fields,
    updated_at: new Date().toISOString(),
  }).eq("id", "daily");
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method === "GET") {
    try {
      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !serviceKey) throw new Error("Supabase service credentials are not configured.");
      const statusClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await statusClient.from("price_monitor_status").select("*").eq("id", "daily").maybeSingle();
      if (error) throw error;
      return json({ status: data });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Monitor status is unavailable." }, 500);
    }
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let service: any = null;
  let checked = 0;
  let movements = 0;
  let observations = 0;
  let unsupported = 0;
  let processed = 0;
  let totalSources = 0;

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Supabase service credentials are not configured.");
    service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const automatic = isAutomaticRequest(request);
    const authenticatedUserClient = automatic ? null : await userClient(request);
    if (!automatic && !authenticatedUserClient) {
      return json({ error: "Sign in with Google before checking prices." }, 401);
    }
    const cardsClient = automatic ? service : authenticatedUserClient!;
    const startedAt = new Date().toISOString();
    await updateMonitorStatus(service, {
      status: "running",
      trigger: automatic ? "scheduled" : "manual",
      started_at: startedAt,
      completed_at: null,
      processed_sources: 0,
      total_sources: 0,
      checked_sources: 0,
      observations: 0,
      movements: 0,
      unsupported_sources: 0,
      message: "Checking the latest Yuyutei selling prices via Card-Value.",
    });
    await updateFxRates(service);
    const { data: cards, error } = await cardsClient.from("cards").select("*").not("source_url", "is", null).limit(500);
    if (error) throw error;

    const grouped = new Map<string, any[]>();
    for (const card of cards || []) {
      try {
        const sourceKey = canonicalExternalUrl(card.source_url);
        const list = grouped.get(sourceKey) || [];
        list.push(card);
        grouped.set(sourceKey, list);
      } catch {
        // Invalid saved URLs cannot be checked.
      }
    }
    const maxSources = Number(Deno.env.get("MAX_SOURCES_PER_RUN") || 100);
    const selectedEntries = [...grouped.entries()].slice(0, maxSources);
    totalSources = selectedEntries.length;
    const selectedCards = selectedEntries.flatMap((entry) => entry[1]);
    await updateMonitorStatus(service, {
      status: "running",
      total_sources: totalSources,
      message: totalSources ? `Checking source 1 of ${totalSources}.` : "No saved card sources to check.",
    });
    const scraper = createCardValueScraper({
      concurrency: 2,
      minimumDelayMs: 700,
      maximumDelayMs: 1300,
      retries: 3,
    });
    const listings = await resolveSavedCardValueListings(selectedCards, { scraper });
    const { data: fx } = await service.from("fx_rates").select("php_rate").eq("currency", "JPY").maybeSingle();
    const jpyPhpRate = Number(fx?.php_rate || 1);

    for (const [sourceKey, linkedCards] of selectedEntries) {
      const sourceUrl = linkedCards[0]?.source_url || sourceKey;
      const listing = listings.get(sourceKey);
      if (!listing || !Number.isFinite(listing.yuyuteiPrice) || listing.yuyuteiPrice <= 0) {
        unsupported += 1;
        const message = isCardValueCardUrl(sourceUrl) || isYuyuteiOnePieceSellingUrl(sourceUrl)
          ? "Card-Value does not currently list a Yuyutei selling price for this exact variant. Use the bookmark importer for updates."
          : "Automatic monitoring currently supports One Piece variants that Card-Value maps to a Yuyutei selling listing.";
        for (const card of linkedCards) {
          await service.from("cards").update({
            monitor_status: "unsupported",
            monitor_message: message,
            monitor_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("user_id", card.user_id).eq("id", card.id);
        }
        processed += 1;
        await updateMonitorStatus(service, {
          status: "running",
          processed_sources: processed,
          total_sources: totalSources,
          checked_sources: checked,
          observations,
          movements,
          unsupported_sources: unsupported,
          message: `Checked ${processed} of ${totalSources} sources.`,
        });
        continue;
      }

      checked += 1;
      const checkedAt = listing.checkedAt || new Date().toISOString();
      for (const card of linkedCards) {
        const nextPrice = Number(listing.yuyuteiPrice);
        const observation = await storeDailyObservation(service, card, listing, checkedAt);
        if (observation.stored) observations += 1;
        await service.from("cards").update({
          source_price: nextPrice,
          source_currency: "JPY",
          card_value_url: listing.cardValueUrl,
          ...(observation.stored && observation.percentageChange !== null ? { change_percent: observation.percentageChange } : {}),
          last_checked: checkedAt,
          monitor_status: "active",
          monitor_message: "Automatic daily monitoring reads this exact variant's Yuyutei selling price via Card-Value.",
          monitor_checked_at: checkedAt,
          updated_at: checkedAt,
        }).eq("user_id", card.user_id).eq("id", card.id);

        if (!observation.stored || observation.priceChange === null || observation.priceChange === 0) continue;
        movements += 1;
        const phpPrice = Math.round(nextPrice * jpyPhpRate);
        const change = Number(observation.percentageChange);
        await Promise.all([
          service.from("price_snapshots").insert({
            user_id: card.user_id,
            card_id: card.id,
            source_price: nextPrice,
            source_currency: "JPY",
            php_price: phpPrice,
            checked_at: checkedAt,
          }),
          service.from("notifications").insert({
            user_id: card.user_id,
            card_id: card.id,
            title: `${card.title} ${change >= 0 ? "increased" : "decreased"} ${Math.abs(change).toFixed(2)}%`,
            message: `Yuyutei selling price is now JPY ${nextPrice.toLocaleString()} (PHP ${phpPrice.toLocaleString()}) per card via Card-Value.`,
            change_percent: change,
            automatic,
          }),
        ]);
      }
      processed += 1;
      await updateMonitorStatus(service, {
        status: "running",
        processed_sources: processed,
        total_sources: totalSources,
        checked_sources: checked,
        observations,
        movements,
        unsupported_sources: unsupported,
        message: `Checked ${processed} of ${totalSources} sources.`,
      });
    }
    const completedAt = new Date().toISOString();
    await updateMonitorStatus(service, {
      status: "success",
      completed_at: completedAt,
      last_success_at: completedAt,
      processed_sources: processed,
      total_sources: totalSources,
      checked_sources: checked,
      observations,
      movements,
      unsupported_sources: unsupported,
      message: `${checked} sources checked. ${movements} price movements found.`,
    });
    return json({ checked, observations, movements, unsupported, automatic, sourceVia: "card-value.jp" });
  } catch (error) {
    if (service) {
      try {
        await updateMonitorStatus(service, {
          status: "error",
          completed_at: new Date().toISOString(),
          processed_sources: processed,
          total_sources: totalSources,
          checked_sources: checked,
          observations,
          movements,
          unsupported_sources: unsupported,
          message: error instanceof Error ? error.message.slice(0, 300) : "The price check failed.",
        });
      } catch {
        // Preserve the original price-check error response.
      }
    }
    return json(
      { error: error instanceof Error ? error.message : "Price check failed." },
      500,
    );
  }
});
