# CardBoy

CardBoy is a responsive card-price monitoring and collection portfolio interface. It runs as a zero-dependency local preview without credentials and automatically switches to the free Supabase backend when `config.js` is configured.

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm start
```

Open `http://127.0.0.1:4173`.

## Included in the prototype

- Quantity-aware portfolio dashboard and collection totals
- Portfolio history and series-allocation graphs
- Filterable card gallery with unique series colors
- Card details, price history, source URL, and edit/delete flows
- Server-side URL extraction for card details, source price, and product image when exposed by the source page
- Manual photo upload with in-browser resizing
- JPY and USD to PHP conversion with custom rates and reset-to-current behavior
- In-app notifications for price movements
- Manual live source checks and a browser-side daily check scheduled for 9:00 AM Philippine time
- Responsive desktop/mobile layouts
- Clearly labeled local Google sign-in preview state
- Browser storage persistence

The local server and production Edge Function read common Product JSON-LD and Open Graph metadata, including Yuyu-tei product records. A source can still block automated requests or omit price/image metadata; CardBoy keeps the last valid data and shows a clear fetch error in that case. Only explicitly enabled source hosts that permit server access can be monitored.

In local preview mode, the 9:00 AM PHT schedule runs while the local app server and browser page are open. In production, Supabase Cron invokes the Edge Function unattended at 01:00 UTC / 09:00 PHT. Google login remains a clearly labeled demo until Supabase and Google OAuth credentials are configured.

## Free production deployment

The production files are already included:

- `supabase/migrations/20260823000000_cardboy.sql`: tables, indexes, Row Level Security, and the image bucket
- `supabase/functions/extract-card`: authenticated on-demand source extraction
- `supabase/functions/daily-price-check`: user-triggered or unattended batch checking, FX refresh, history, and notifications
- `supabase/setup-cron.sql`: the daily 09:00 PHT schedule
- `.github/workflows/pages.yml`: free GitHub Pages deployment
- `backend.js`: automatic cloud/local adapter

### 1. Create and configure Supabase

1. Create a free Supabase project.
2. Run `supabase/migrations/20260823000000_cardboy.sql` in the Supabase SQL Editor.
3. Deploy both functions with the Supabase CLI or Dashboard.
4. Set `ALLOWED_ORIGIN` to the live CardBoy URL and `ALLOWED_SOURCE_HOSTS` to a comma-separated source allowlist such as `yuyu-tei.jp,www.yuyu-tei.jp`.
5. Copy `config.example.js` to `config.js`, then insert the project URL and **publishable** key. Never put the service-role key in a browser file.
6. Replace the placeholders in `supabase/setup-cron.sql` and run it in the SQL Editor. The service-role value is encrypted by Supabase Vault.

CLI equivalent after installing or invoking the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy extract-card
npx supabase functions deploy daily-price-check
npx supabase secrets set ALLOWED_ORIGIN=https://kindercrap.github.io/cardboy ALLOWED_SOURCE_HOSTS=yuyu-tei.jp,www.yuyu-tei.jp
```

### 2. Enable Google login

1. In Google Auth Platform, create a Web OAuth client.
2. Add the GitHub Pages URL as an authorized JavaScript origin.
3. Add the callback URL shown by Supabase Auth → Providers → Google.
4. Save the Google client ID and secret in the Supabase provider screen, not in this repository.
5. Add the live site URL to Supabase Auth redirect URLs.

Once `config.js` contains the Supabase public values, CardBoy replaces the demo login with real Google OAuth and loads each user’s cloud collection under Row Level Security.

### 3. GitHub Pages

Push `main` to GitHub. The included workflow prepares only the static frontend files and deploys them to GitHub Pages. Supabase hosts the extraction and scheduled backend separately on its free tier.

## Recommended production stack

The selected low-maintenance stack is:

- Frontend: this static app on GitHub Pages
- Authentication: Supabase Auth with Google OAuth
- Database: Supabase Postgres with Row Level Security
- Card images: Supabase Storage
- Scheduled checks: Supabase Cron calling an Edge Function once daily
- Source extraction: an Edge Function with one parser adapter per supported card store
- Exchange rates: a server-side daily call to a reliable FX provider, cached in the database
- Backend hosting: Supabase Edge Functions and Cron; GitHub Pages only hosts the frontend and does not run `server.mjs`.

Suggested tables:

- `profiles`: `id`, `email`, `display_name`, timestamps
- `cards`: `id`, `user_id`, `series`, `code`, `title`, `quantity`, `source_url`, `source_currency`, `image_path`, timestamps
- `price_snapshots`: `id`, `card_id`, `source_price`, `php_price`, `fx_rate`, `checked_at`, `status`
- `user_rates`: `user_id`, `currency`, `custom_rate`, `use_live_rate`, `updated_at`
- `fx_rates`: `currency`, `php_rate`, `fetched_at`

Do not scrape card pages in the browser: CORS, store markup changes, and exposed implementation details make that unreliable. Parse supported sources server-side, respect each source's terms and robots policy, rate-limit requests, and keep the last valid price when extraction fails.

## Before production

1. Create the Supabase project and Google OAuth credentials.
2. Replace the storage helpers in `app.js` with authenticated database calls.
3. Implement and test source-specific parser adapters in a server environment.
4. Move image uploads to private per-user storage paths.
5. Add scheduled price checks, failure reporting, and real FX-rate retrieval.
6. Add tests for currency conversion, ownership rules, scraper fixtures, and quantity totals.
7. Add a privacy policy before enabling public Google sign-in.

## GitHub

The project is ready to initialize and publish when desired:

```bash
git init
git add .
git commit -m "Build CardBoy portfolio prototype"
git branch -M main
git remote add origin https://github.com/kindercrap/cardboy.git
git push -u origin main
```

Review the target repository first if it already contains work; do not force-push over existing history.
