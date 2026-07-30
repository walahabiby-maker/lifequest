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
- `schema.sql` — database setup script (run once in Supabase)

## Phase 2 setup: accounts + groups

1. Create a free project at **supabase.com**
2. In your Supabase project, go to **SQL Editor → New query**, paste in the entire contents
   of `schema.sql`, and click **Run**
3. Go to **Project Settings → API**. Copy the **Project URL** and the **anon public** key
4. Open `config.js` and paste those two values in place of the placeholders
5. In Supabase, go to **Authentication → Sign In / Providers**, make sure **Email** is enabled,
   and under **Email → Magic Link** make sure it's turned on (it is by default)
6. Commit the updated `config.js` on GitHub — Netlify will redeploy automatically

Until `config.js` has real values, the app runs in local-only mode (same as Phase 1) —
no login screen, progress stays in that browser only. Once configured, a login
screen appears and progress syncs to your account.
