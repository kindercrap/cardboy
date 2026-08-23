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
- Drag-to-reorder collection cards with cloud-synced custom ordering
- “Card I own” tags, with dashboard values and graphs limited to owned cards
- Card details, price history, source URL, and edit/delete flows
- Server-side URL extraction for card details, source price, and product image when exposed by the source page
- Manual photo upload with in-browser resizing
- JPY and USD to PHP conversion with custom rates and reset-to-current behavior
- In-app notifications for price movements
- A free GitHub Actions Yuyu-tei monitor scheduled for 9:15 AM Philippine time
- Responsive desktop/mobile layouts
- Clearly labeled local Google sign-in preview state
- Browser storage persistence

The local server and production Edge Function read common Product JSON-LD and Open Graph metadata, including Yuyu-tei product records. A source can still block automated requests or omit price/image metadata; CardBoy keeps the last valid data and shows a clear fetch error in that case. Only explicitly enabled source hosts that permit server access can be monitored.

## One-click Yuyu-tei import

Yuyu-tei currently blocks CardBoy's Supabase server from reading its product pages. The Add Card window therefore includes a free browser bookmark importer for user-initiated imports:

1. Open CardBoy and choose **Add Card**.
2. Drag **Drag to Bookmarks** to the browser bookmarks bar once.
3. Open a Yuyu-tei card page and click the saved bookmark.
4. CardBoy opens in a new tab with the source URL, card code, name, currency, listed price, image, and availability already read from the page's Product JSON-LD.
5. If the source URL is new, review the quantity and click **Add Card**. If that URL is already saved, CardBoy opens the existing card with the latest page price ready to review.
6. Saving a changed imported price adds a price-history point and a CardBoy notification. Saving an unchanged price records the check without creating a false alert.

The importer only prefills the form and never saves a card without confirmation. It runs on the Yuyu-tei page at the user's request, so no F12/Console workflow or paid proxy is required.

In local preview mode, the 9:15 AM PHT fallback schedule runs while the local app server and browser page are open. In production, `.github/workflows/price-monitor.yml` runs unattended at 01:15 UTC / 09:15 PHT. Yuyu-tei blocks both Supabase and GitHub datacenter requests, so the workflow matches each exact saved Yuyu-tei source URL against OP Collector's public daily catalog. It updates matching cards, stores history only when a price moves, and creates in-app notifications. GitHub may start scheduled workflows a few minutes late during busy periods.

## Free production deployment

The production files are already included:

- `supabase/migrations/20260823000000_cardboy.sql`: tables, indexes, Row Level Security, and the image bucket
- `supabase/migrations/20260823123000_owned_cards_and_sort_order.sql`: owned-card portfolio filtering and persistent custom ordering
- `supabase/functions/extract-card`: authenticated on-demand source extraction
- `supabase/functions/daily-price-check`: user-triggered or unattended batch checking, FX refresh, history, and notifications
- `supabase/setup-cron.sql`: the daily 09:00 PHT schedule
- `.github/workflows/pages.yml`: free GitHub Pages deployment
- `.github/workflows/price-monitor.yml`: free 09:15 PHT Yuyu-tei monitoring from a GitHub-hosted runner
- `scripts/monitor-prices.mjs`: exact-variant OP Collector catalog matcher and Supabase updater
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

### 4. Enable the unattended Yuyu-tei monitor

Create these encrypted repository secrets under **GitHub → cardboy → Settings → Secrets and variables → Actions**:

- `CARDBOY_SUPABASE_URL`: the Supabase project URL
- `CARDBOY_SUPABASE_SECRET_KEY`: a server-only `sb_secret_...` key from Supabase Settings → API Keys

Never place the secret key in `config.js`, source code, a browser, or a workflow log. The monitor uses it only inside the GitHub Actions runner to read saved source URLs and write card prices, snapshots, FX rates, and notifications. The public browser app continues to use the low-privilege publishable key plus Row Level Security.

After adding both secrets, open **Actions → Monitor Yuyu-tei prices → Run workflow** for the first full check. Scheduled checks then begin daily at 09:15 PHT. A manual `probe_only` run verifies the example Yuyu-tei source URL against the public catalog without accessing CardBoy account data.

## Recommended production stack

The selected low-maintenance stack is:

- Frontend: this static app on GitHub Pages
- Authentication: Supabase Auth with Google OAuth
- Database: Supabase Postgres with Row Level Security
- Card images: Supabase Storage
- Scheduled Yuyu-tei checks: GitHub Actions at 09:15 PHT, using encrypted repository secrets
- Scheduled price source: OP Collector's public daily catalog, matched by the exact Yuyu-tei source URL
- Exchange rates: a server-side daily call to a reliable FX provider, cached in the database
- Backend hosting: Supabase Edge Functions/Database plus GitHub Actions; GitHub Pages only hosts the frontend and does not run `server.mjs`.

Suggested tables:

- `profiles`: `id`, `email`, `display_name`, timestamps
- `cards`: `id`, `user_id`, `series`, `code`, `title`, `quantity`, `source_url`, `source_currency`, `image_path`, timestamps
- `price_snapshots`: `id`, `card_id`, `source_price`, `php_price`, `fx_rate`, `checked_at`, `status`
- `user_rates`: `user_id`, `currency`, `custom_rate`, `use_live_rate`, `updated_at`
- `fx_rates`: `currency`, `php_rate`, `fetched_at`

Use server-side extraction for unattended monitoring wherever the source permits it. OP Collector is an independent third-party dependency and not an official Yuyu-tei API, so CardBoy keeps the last valid price if its catalog is unavailable or an exact variant is missing. The Yuyu-tei bookmark importer remains the exact browser-side fallback and reads only the page's public Product JSON-LD at the user's request.

## Current production status

- Live frontend: `https://kindercrap.github.io/cardboy/`
- Free Supabase project in Singapore with Postgres, Storage, Auth, and Row Level Security
- Google OAuth published for external Google accounts
- Authenticated `extract-card` and `daily-price-check` Edge Functions
- Active GitHub Actions daily Yuyu-tei monitor at `15 1 * * *` (09:15 Asia/Manila)
- The repository contains only the browser-safe Supabase publishable key; server and OAuth secrets stay in their respective cloud dashboards

## GitHub

Repository: `https://github.com/kindercrap/cardboy`

Pushes to `main` automatically deploy the static frontend through `.github/workflows/pages.yml`.
