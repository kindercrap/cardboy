import { corsHeaders, json } from "../_shared/cors.ts";
import { extractCard } from "../_shared/extract.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const { url } = await request.json();
    if (!url) return json({ error: "A card page URL is required." }, 400);
    return json({ card: await extractCard(url) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The source page could not be read." }, 422);
  }
});
