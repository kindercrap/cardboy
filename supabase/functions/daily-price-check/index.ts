import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { extractCard } from "../_shared/extract.ts";

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

async function handler(request: Request, ctx: any) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  try {
    const automatic = ctx.authMode === "secret";
    const service = ctx.supabaseAdmin;
    const cardsClient = automatic ? service : ctx.supabase;
    await updateFxRates(service);
    const { data: cards, error } = await cardsClient.from("cards").select("*").not("source_url", "is", null).limit(500);
    if (error) throw error;

    const grouped = new Map<string, any[]>();
    for (const card of cards || []) {
      const list = grouped.get(card.source_url) || [];
      list.push(card);
      grouped.set(card.source_url, list);
    }
    let checked = 0;
    let movements = 0;
    const maxSources = Number(Deno.env.get("MAX_SOURCES_PER_RUN") || 100);
    for (const [sourceUrl, linkedCards] of [...grouped.entries()].slice(0, maxSources)) {
      try {
        const extracted = await extractCard(sourceUrl);
        checked += 1;
        if (!extracted.nativePrice) continue;
        for (const card of linkedCards) {
          const oldPrice = Number(card.source_price);
          const nextPrice = Number(extracted.nativePrice);
          const change = oldPrice ? Number((((nextPrice - oldPrice) / oldPrice) * 100).toFixed(1)) : 0;
          const checkedAt = new Date().toISOString();
          await service.from("cards").update({
            source_price: nextPrice,
            source_currency: extracted.currency,
            image_url: extracted.image || card.image_url,
            change_percent: change,
            last_checked: checkedAt,
            updated_at: checkedAt,
          }).eq("user_id", card.user_id).eq("id", card.id);
          if (nextPrice !== oldPrice) {
            movements += 1;
            const { data: fx } = await service.from("fx_rates").select("php_rate").eq("currency", extracted.currency).maybeSingle();
            const phpPrice = Math.round(nextPrice * Number(fx?.php_rate || 1));
            await Promise.all([
              service.from("price_snapshots").insert({ user_id: card.user_id, card_id: card.id, source_price: nextPrice, source_currency: extracted.currency, php_price: phpPrice, checked_at: checkedAt }),
              service.from("notifications").insert({ user_id: card.user_id, card_id: card.id, title: `${card.title} ${change >= 0 ? "increased" : "decreased"} ${Math.abs(change).toFixed(1)}%`, message: `Now ${extracted.currency} ${nextPrice.toLocaleString()} (PHP ${phpPrice.toLocaleString()}) per card.`, change_percent: change, automatic }),
            ]);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (error) {
        console.warn(`Source check failed for ${sourceUrl}:`, error instanceof Error ? error.message : error);
      }
    }
    return Response.json({ checked, movements, automatic });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Price check failed." },
      { status: 500 },
    );
  }
}

export default { fetch: withSupabase({ auth: ["user", "secret"] }, handler) };
