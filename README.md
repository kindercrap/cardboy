# CardBoy

CardBoy is a responsive card collection and price portfolio. The production site uses Supabase for Google sign-in, per-user cloud data, images, price history, and notifications, while GitHub Pages hosts the static frontend for free.

## Price source

CardBoy uses saved **Yuyutei card pages directly** for new price updates. Card-Value is not used and no unattended daily price job runs.

The direct Yuyutei flow is intentionally user-triggered because Yuyutei blocks server-side page reads:

1. Open **My Cards → Update Queue**.
2. Drag **Drag New Bookmark** to the browser bookmarks bar once.
3. Choose **Start Quick Update**.
4. On each Yuyutei page, click the CardBoy bookmark. CardBoy saves only the current source price and advances the same tab to the next queued card.

The queue preserves the card name, code, series, quantity, ownership, image, URL, currency, pin, and custom order. A changed price adds a history point and notification; an unchanged price records the latest check without a false alert.

The **Fetch Image** action can still derive a card image from a Yuyutei card-page URL. It does not read or alter the price.

## Included features

- Quantity-aware portfolio totals and charts
- Dashboard calculations limited to cards tagged **Card I own**
- Card gallery with series and owned/watching filters, search, and useful sorting
- Drag-to-reorder cards and persistent pin-to-top groups
- Direct Yuyutei Update Queue with price-only imports
- PHP conversion for JPY and USD, editable rates, and reset-to-current behavior
- Card details, editing, photo upload, price history, and movement notifications
- Responsive desktop and mobile layouts
- Google OAuth and cloud sync through Supabase

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm start
```

Open `http://127.0.0.1:4173`.

## Production setup

The production files include:

- `supabase/migrations/20260823000000_cardboy.sql`: tables, indexes, Row Level Security, and image storage
- `supabase/migrations/20260823123000_owned_cards_and_sort_order.sql`: ownership and custom card ordering
- `supabase/migrations/20260824100000_pinned_cards.sql`: persistent pins
- `supabase/migrations/20260828091500_disable_card_value_monitor.sql`: removes the former database cron and updates its stale labels
- `supabase/functions/extract-card`: authenticated Yuyutei image lookup and generic on-demand extraction
- `.github/workflows/pages.yml`: static GitHub Pages deployment

Historical Card-Value observation tables and migrations remain in the database so old price history is not destroyed. They are read-only legacy data; there is no workflow, browser timer, dashboard action, Edge Function, or database cron that creates new Card-Value observations.

### Supabase

1. Create a Supabase project and apply the migrations.
2. Deploy the image/source extraction function.
3. Set the live CardBoy origin and allow only the Yuyutei hosts.
4. Put the Supabase project URL and publishable key in `config.js`. Never put the service-role key in browser code.

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy extract-card
npx supabase secrets set ALLOWED_ORIGIN=https://kindercrap.github.io/cardboy ALLOWED_SOURCE_HOSTS=yuyu-tei.jp,www.yuyu-tei.jp
```

### Google login

1. Create a Web OAuth client in Google Auth Platform.
2. Add the GitHub Pages URL as an authorized JavaScript origin.
3. Add the callback shown in Supabase Auth → Providers → Google.
4. Store the Google client ID and secret in Supabase, not this repository.
5. Add the live site URL to Supabase Auth redirect URLs.

### GitHub Pages

Push `main` to GitHub. The Pages workflow deploys the browser-safe frontend automatically. Supabase provides authentication, database, storage, and the authenticated image lookup.

## Current production status

- Live frontend: `https://kindercrap.github.io/cardboy/`
- Google OAuth and per-user Supabase cloud collections
- Direct Yuyutei bookmark/update queue as the only new saved-card price update path
- Card-Value schedule, dashboard fetch action, browser timer, and daily Edge Function removed
- Existing cards and historical price observations preserved

## GitHub

Repository: `https://github.com/kindercrap/cardboy`
