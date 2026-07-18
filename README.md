# Circle — Eritrean Youth Community

A real-time chat and calling space for Eritrean girls and boys. Presence, chat, and
1‑to‑1 audio calling are all backed by [Supabase](https://supabase.com) — no fake
users, no bots, only people who've actually joined.

- **Presence** — Supabase Realtime Presence shows who's genuinely online right now.
- **Chat** — messages are stored in Postgres and pushed live via Supabase Realtime.
- **Calling** — real WebRTC audio calls, using Supabase Realtime Broadcast as the
  signaling channel (no separate signaling server needed).
- Plain HTML/CSS/JS — no build step, deploys anywhere static files work (GitHub Pages,
  Netlify, Vercel, etc).

## A note on the "Enter" button

`js/app.js` loads Supabase dynamically and wraps it in a try/catch, so the
whole page — including the Enter button — works even before you've set up
Supabase or if it's opened straight from disk. Only chat, presence, and
calling need Supabase; navigation never does. If you still see a blank
console error, run it through a local server (step 3) rather than
double-clicking `index.html` — the Supabase import over HTTPS behaves more
reliably from `http://` than from `file://`.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Once it's ready, open **SQL Editor** → New query, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates the
   `messages` table, its security policies, and turns realtime on for it.
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key

## 2. Add your keys

Open `js/config.js` and fill in the two values:

```js
export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

`config.js` is loaded in the browser, so the anon key is meant to be public —
that's normal for Supabase, since access is actually controlled by the Row
Level Security (RLS) policies in `schema.sql`, not by hiding the key.

## 3. Run it locally

Because this uses ES modules, open it through a local server rather than
double-clicking the file (browsers block `file://` module imports):

```bash
# any static server works, e.g.:
npx serve .
# or
python3 -m http.server 8080
```

Then visit `http://localhost:8080` (or whatever port it prints).

## 4. Push to GitHub

```bash
git init
git add .
git commit -m "Circle — initial version"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 5. Deploy for free (GitHub Pages)

1. In your GitHub repo: **Settings → Pages**.
2. Under "Build and deployment", set **Source: Deploy from a branch**, branch
   `main`, folder `/ (root)`.
3. Save — GitHub gives you a URL like `https://<username>.github.io/<repo>/`
   within a minute or two.

(Netlify or Vercel also work great and deploy automatically on every push —
just point them at the repo, no build command needed.)

## Project structure

```
index.html          — the app shell (welcome, choose group, name, room)
css/style.css        — all styling, including the 3D hero and call UI
js/config.js         — your Supabase URL + anon key (fill this in)
js/app.js            — all app logic: presence, chat, WebRTC calling
supabase/schema.sql  — run once in the Supabase SQL editor
```

## Before a real launch — please read

This is built for young people, so a few things are worth doing before you
share it widely:

- **Moderation.** The current RLS policies let anyone with the anon key read
  and post messages — fine for a small trusted group, not safe at scale.
  Before wider release, add a lightweight report/block feature, and consider
  a profanity/abuse filter on inserts (a Postgres trigger or an edge function
  is a good place for this).
- **Accounts.** Right now anyone can type any name — there's no verification.
  If this grows, look at Supabase Auth (email, phone, or magic link) so
  identities are real and you can ban abusive accounts.
- **Data collected.** Only a display name is stored — no email, phone, or
  location. Keep it that way unless you have a clear reason and a privacy
  policy to match.
- **Calling.** Uses public STUN servers only, so most calls connect, but very
  restrictive networks can occasionally block the peer-to-peer connection.
  A TURN server (e.g. via [Twilio](https://www.twilio.com/docs/stun-turn) or
  [metered.ca](https://www.metered.ca/tools/openrelay/)) fixes that if it
  becomes a common complaint.
- **Rate limiting.** Consider adding basic rate limits (e.g. via a Supabase
  edge function) so one person can't flood the chat.
