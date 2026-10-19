# Blind Score

*Play the hole. Forget the score.*

A minimalist, offline-first golf score tracker (PWA, built for iPhone). Scores for completed holes are never shown during a round — not the running total, not score to par, not the previous hole. Everything is revealed when you tap **Finish Round**.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # scoring + local-store tests
npm run build      # outputs dist/ (static site; service worker precache is stamped at build)
```

Pushing to the default branch deploys `dist/` to GitHub Pages via `.github/workflows/deploy.yml` (one-time: repo Settings → Pages → Source: GitHub Actions). To install on iPhone, host `dist/` anywhere that serves HTTPS (GitHub Pages, Netlify, Cloudflare Pages, …), open it in Safari → Share → **Add to Home Screen**. The build uses relative paths, so it works from a sub-path.

## How the blind rule is enforced

- While a round is active, the only data read by the UI is *which hole numbers are done* (`completedHoleNumbers`) — hole records are never loaded into the active-round screens.
- History, Stats and Results routes are blocked while a round is active (App.tsx).
- **Edit Previous Hole** lists hole numbers only and opens a blank form labelled *Replace Hole Entry*, with a confirmation before the saved record is overwritten.
- The hole currently on screen has its draft autosaved to IndexedDB, so an app kill resumes the same hole with the same inputs.

## Google Sheets sync

Data lives on the device (IndexedDB) first; every saved hole is queued and pushed in the background, with retry on failure/reconnect. Hole IDs are `${round_id}_${hole_number}`, so re-sending or editing a hole upserts, never duplicates.

1. Create a Google Sheet. **Extensions → Apps Script**, paste `apps-script/Code.gs`.
2. **Project Settings → Script properties** → add `BLIND_SCORE_TOKEN` = a long random string.
3. **Deploy → New deployment → Web app**: *Execute as: Me*, *Who has access: Anyone*. Copy the `/exec` URL.
4. In the app: **Home → Sync settings**, paste the URL and token, **Save & Sync**.

The token is stored only on your device and checked by the script on every request; no Google credentials ever ship in the frontend. The `Rounds` and `Holes` worksheets are created automatically.

## Notes / decisions

- Starting a new round while one is unfinished asks for confirmation; the old round is kept with status `abandoned` (hidden from history and stats) rather than deleted.
- Rounds carry an extra `updated_at` column (used for sync merging); penalties are a classification only and never change strokes.
- Each hole has an optional free-text note. It is blind like everything else (never shown after the hole is saved) and appears under "Hole notes" on the results screen. A blind replacement with a blank note keeps the existing note. Existing Sheets get a `note` column added automatically on the next sync (redeploy `Code.gs`).
- Stats and charts keep 9- and 18-hole rounds separate and use completed rounds only.
