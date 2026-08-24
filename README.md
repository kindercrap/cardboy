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
- Pin priority cards to a persistent top group while keeping each group reorderable
- “Card I own” tags, with dashboard values and graphs limited to owned cards
- Card details, price history, source URL, and edit/delete flows
- Server-side URL extraction for card details, source price, and product image when exposed by the source page
- Manual photo upload with in-browser resizing
- JPY and USD to PHP conversion with custom rates and reset-to-current behavior
- In-app notifications for price movements
- A free GitHub Actions monitor that reads only Yuyutei selling prices through Card-Value at 9:15 AM Philippine time
- A live header indicator that shows when the monitor is checking prices, its source progress, and the recent completion result
- Responsive desktop/mobile layouts
- Clearly labeled local Google sign-in preview state
- Browser storage persistence

The unattended One Piece scraper never requests Yuyutei card pages. It fetches Card-Value card pages, isolates the `店舗別販売価格` section, and reads only the `遊々亭` row's `販売価格`. Average prices, buylist tables, and other stores are never used as fallbacks.

The reusable functions live in `supabase/functions/_shared/card-value.js`:

```js
import { getYuyuteiSellingPrice, scrapeSetYuyuteiPrices } from "./supabase/functions/_shared/card-value.js";

const shanks = await getYuyuteiSellingPrice("https://card-value.jp/onepiece/cards/op17-022-3/");
const valuableOp17 = await scrapeSetYuyuteiPrices("OP17", { minimumPrice: 10000 });
```

Set scraping uses three workers at most, spaces request starts by 650–1250ms, retries temporary failures, and caches each fetched page for the duration of the run. `minimumPrice` is strict, so `10000` returns only variants above ¥10,000.

## One-click Yuyu-tei import

Yuyu-tei currently blocks CardBoy's Supabase server from reading its product pages. The Add Card window therefore includes a free browser bookmark importer for user-initiated imports:

1. Open CardBoy and choose **Add Card**.
2. Drag **Drag to Bookmarks** to the browser bookmarks bar once.
3. Open a Yuyu-tei card page and click the saved bookmark.
4. CardBoy opens in a new tab with the source URL, card code, name, currency, listed price, image, and availability already read from the page's Product JSON-LD.
5. If the source URL is new, review the quantity and click **Add Card**. If that URL is already saved, CardBoy opens the existing card with the latest page price ready to review.
6. Saving a changed imported price adds a price-history point and a CardBoy notification. Saving an unchanged price records the check without creating a false alert.

The importer only prefills the form and never saves a card without confirmation. It runs on the Yuyu-tei page at the user's request, so no F12/Console workflow or paid proxy is required.

In local preview mode, the 9:15 AM PHT fallback schedule runs while the local app server and browser page are open. In production, `.github/workflows/price-monitor.yml` runs unattended at 01:15 UTC / 09:15 PHT. It discovers exact Card-Value variants from the relevant set page, matches each variant through its Yuyutei `/sell/` link, stores one deduplicated observation per Philippine calendar day, and creates an in-app notification when that observed selling price moves. GitHub may start scheduled workflows a few minutes late during busy periods.

## Free production deployment

The production files are already included:

- `supabase/migrations/20260823000000_cardboy.sql`: tables, indexes, Row Level Security, and the image bucket
- `supabase/migrations/20260823123000_owned_cards_and_sort_order.sql`: owned-card portfolio filtering and persistent custom ordering
- `supabase/migrations/20260823224500_card_value_daily_observations.sql`: Card-Value variant mappings and deduplicated daily Yuyutei selling-price observations
- `supabase/migrations/20260824091500_price_monitor_status.sql`: service-managed live monitor status and progress
- `supabase/migrations/20260824100000_pinned_cards.sql`: persistent per-user pinned-card priority
- `supabase/functions/extract-card`: authenticated on-demand source extraction
- `supabase/functions/daily-price-check`: user-triggered or unattended batch checking, FX refresh, history, and notifications
- `supabase/functions/monitor-status`: authenticated read-only status payload backed by the private monitor status row
- `supabase/setup-cron.sql`: the daily 09:00 PHT schedule
- `.github/workflows/pages.yml`: free GitHub Pages deployment
- `.github/workflows/price-monitor.yml`: free 09:15 PHT Yuyu-tei monitoring from a GitHub-hosted runner
- `supabase/functions/_shared/card-value.js`: reusable Card-Value parser, set discovery, retries, throttling, and per-run page cache
- `scripts/monitor-prices.mjs`: exact-variant Card-Value/Yuyutei matcher and Supabase updater
- `backend.js`: automatic cloud/local adapter

### 1. Create and configure Supabase

1. Create a free Supabase project.
2. Run `supabase/migrations/20260823000000_cardboy.sql` in the Supabase SQL Editor.
3. Deploy both functions with the Supabase CLI or Dashboard.
4. Set `ALLOWED_ORIGIN` to the live CardBoy URL and `ALLOWED_SOURCE_HOSTS` to `card-value.jp,www.card-value.jp,yuyu-tei.jp,www.yuyu-tei.jp`. Yuyutei stays allowlisted only for the non-scraping image/manual-import fallback.
5. Copy `config.example.js` to `config.js`, then insert the project URL and **publishable** key. Never put the service-role key in a browser file.
6. Replace the placeholders in `supabase/setup-cron.sql` and run it in the SQL Editor. The service-role value is encrypted by Supabase Vault.

CLI equivalent after installing or invoking the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy extract-card
npx supabase functions deploy daily-price-check
npx supabase secrets set ALLOWED_ORIGIN=https://kindercrap.github.io/cardboy ALLOWED_SOURCE_HOSTS=card-value.jp,www.card-value.jp,yuyu-tei.jp,www.yuyu-tei.jp
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

### 4. Enable the unattended Yuyutei selling-price monitor

Create these encrypted repository secrets under **GitHub → cardboy → Settings → Secrets and variables → Actions**:

- `CARDBOY_SUPABASE_URL`: the Supabase project URL
- `CARDBOY_SUPABASE_SECRET_KEY`: a server-only `sb_secret_...` key from Supabase Settings → API Keys

Never place the secret key in `config.js`, source code, a browser, or a workflow log. The monitor uses it only inside the GitHub Actions runner to read saved source URLs and write card prices, snapshots, FX rates, and notifications. The public browser app continues to use the low-privilege publishable key plus Row Level Security.

After adding both secrets, open **Actions → Monitor Yuyutei selling prices via Card-Value → Run workflow** for the first full check. Scheduled checks then begin daily at 09:15 PHT. A manual `probe_only` run verifies that the Shanks Card-Value example returns the Yuyutei selling row without accessing CardBoy account data.

## Recommended production stack

The selected low-maintenance stack is:

- Frontend: this static app on GitHub Pages
- Authentication: Supabase Auth with Google OAuth
- Database: Supabase Postgres with Row Level Security
- Card images: Supabase Storage
- Scheduled Yuyutei checks: GitHub Actions at 09:15 PHT, using encrypted repository secrets
- Scheduled price source: Card-Value's store-by-store selling section, restricted to the exact Yuyutei row and variant URL
- Exchange rates: a server-side daily call to a reliable FX provider, cached in the database
- Backend hosting: Supabase Edge Functions/Database plus GitHub Actions; GitHub Pages only hosts the frontend and does not run `server.mjs`.

Suggested tables:

- `profiles`: `id`, `email`, `display_name`, timestamps
- `cards`: `id`, `user_id`, `series`, `code`, `title`, `quantity`, `source_url`, `source_currency`, `image_path`, timestamps
- `price_snapshots`: `id`, `card_id`, `source_price`, `php_price`, `fx_rate`, `checked_at`, `status`
- `daily_price_observations`: `card_id`, `card_number`, `variant`, `price`, `currency`, `source`, `source_via`, `price_change`, `percentage_change`, `observed_at`, `observation_day`
- `price_monitor_status`: current run state, progress counters, completion time, and last successful check
- `user_rates`: `user_id`, `currency`, `custom_rate`, `use_live_rate`, `updated_at`
- `fx_rates`: `currency`, `php_rate`, `fetched_at`

Card-Value is an independent third-party data source and not an official Yuyutei API. CardBoy keeps the last valid price if Card-Value is unavailable or the exact variant has no Yuyutei selling row; it never substitutes an average, buylist, or another store's price. The Yuyutei bookmark importer remains a user-initiated browser fallback and is not used by the unattended scraper.

## Current production status

- Live frontend: `https://kindercrap.github.io/cardboy/`
- Free Supabase project in Singapore with Postgres, Storage, Auth, and Row Level Security
- Google OAuth published for external Google accounts
- Authenticated `extract-card` and `daily-price-check` Edge Functions
- Active GitHub Actions daily Card-Value/Yuyutei selling-price monitor at `15 1 * * *` (09:15 Asia/Manila)
- The repository contains only the browser-safe Supabase publishable key; server and OAuth secrets stay in their respective cloud dashboards

## GitHub

Repository: `https://github.com/kindercrap/cardboy`

Pushes to `main` automatically deploy the static frontend through `.github/workflows/pages.yml`.
