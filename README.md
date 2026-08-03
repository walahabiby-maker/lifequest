# LifeQuest — Explorer's Log

A personal life-achievement and adventure tracker: 318 experiences, 196 countries,
26 achievements, and a 50-level Explorer rank system.

## Running it

This is a static site — no build step, no server required. Just open `index.html`
in a browser, or deploy the folder as-is to Netlify / GitHub Pages.

## Your data

All progress (completed experiences, visited countries, journal entries, profile)
is saved in your browser's local storage. It stays on your device — nothing is
sent anywhere. Clearing your browser data will erase it, so avoid using "Clear
site data" for this site if you want to keep your progress.

## Files

- `index.html` — page structure
- `style.css` — visual design
- `data.js` — the experience/country/achievement/level database
- `app.js` — application logic
- `config.js` — your Supabase project keys (edit this)
- `schema.sql` — database setup script (run once in Supabase, safe to re-run anytime)
- `manifest.json`, `service-worker.js`, `icon-192.png`, `icon-512.png` — installable app support

## Phase 2 setup: accounts + groups

1. Create a free project at **supabase.com**
2. In your Supabase project, go to **SQL Editor → New query**, paste in the entire contents
   of `schema.sql`, and click **Run**
3. Go to **Project Settings → API**. Copy the **Project URL** and the **publishable** key
4. Open `config.js` and paste those two values in place of the placeholders
5. In Supabase, go to **Authentication → Providers**, make sure **Email** is enabled
6. Commit the updated `config.js` on GitHub — Netlify will redeploy automatically

Until `config.js` has real values, the app runs in local-only mode (same as Phase 1) —
no login screen, progress stays in that browser only. Once configured, a login
screen appears and progress syncs to your account.

If magic-link emails don't arrive, Supabase's default email sender is rate-limited
(a couple per hour) and not meant for real production use — set up a free SMTP
provider (e.g. Resend) under **Authentication → Email** for reliable delivery.

## Newer features

- **Global Leaderboard** — opt-in only (toggle it in your Profile tab). Nobody's
  stats show up publicly unless they turn this on themselves.
- **World Map** — visited countries fill in on a world map. Needs an internet
  connection to load (uses a public map-data CDN); a few very small nations
  (Vatican City, Monaco, etc.) are too small to render as distinct shapes at
  this map's resolution, but they still count correctly in your stats.
- **Suggest Experience** — anyone logged in can propose a new experience to add.
  Review submissions anytime in Supabase → **Table Editor** →
  `experience_suggestions` — no separate admin screen needed.
- **Install as an app** — on a phone, open the site in the browser, then use
  the browser's "Add to Home Screen" (iOS Safari, via the Share button) or
  "Install app" (Android Chrome, usually a prompt or a menu option). It'll
  then open full-screen with its own icon, and works offline for anything
  already loaded.
