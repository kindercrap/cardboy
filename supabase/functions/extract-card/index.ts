import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { extractCard } from "../_shared/extract.ts";

async function handler(request: Request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  try {
    const { url } = await request.json();
    if (!url) {
      return Response.json({ error: "A card page URL is required." }, { status: 400 });
    }
    return Response.json({ card: await extractCard(url) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The source page could not be read." },
      { status: 422 },
    );
  }
}

export default { fetch: withSupabase({ auth: "user" }, handler) };
