# sigtil

**Din hjemmeside. Sig til, så ændrer vi den.**

An AI-first website editor for non-technical people. Editors chat in plain Danish, watch a live preview update, and press one button — **Udgiv** — to go live. No code, no git, no jargon anywhere in the editor UI.

## How it works

```
editor prompt ──▶ /api/chat (AI agent with file tools)
                     │  reads/edits files via GitHub Contents API
                     ▼
              work branch (sigtil-edits)  ──▶ Vercel branch preview (iframe)
                     │
                “Udgiv” ──▶ merge into main ──▶ wait until production
                     │        deployment is READY (verified live)
                     ▼
                work branch reset onto main
```

- **No sandbox, no containers.** Content edits are file edits through the GitHub API — instant. Vercel builds the branch preview (~1 min for a small site).
- **Safety model:** the agent can only touch content paths (configurable per site; `package.json`, configs, CI, lockfiles are always blocked). Nothing reaches production until the human presses Udgiv, and the production build must succeed before sigtil reports "live". Keep branch protection + the Vercel check on `main` as a backstop.
- **Uploads:** images are optimized (sharp → WebP, max 2000px) and committed into `public/uploads/`; videos go to Vercel Blob and are referenced by URL.
- **Undo:** last change (drops the newest unpublished commit) or everything (resets the work branch onto main).

## Stack

Next.js (App Router) · Tailwind 4 · AI SDK v6 via Vercel AI Gateway · Drizzle + Postgres · GitHub REST API · Vercel REST API · Vercel Blob · sharp

## Setup

1. `npm install`
2. Create a Postgres database (e.g. Neon via the Vercel Marketplace) and set `DATABASE_URL` in `.env.local` (copy `.env.example`).
3. Fill the rest of `.env.local`:
   - `AUTH_SECRET` — any long random string
   - `AI_GATEWAY_API_KEY` — from Vercel AI Gateway (one key, any model; switch models via `SIGTIL_MODEL`)
   - `VERCEL_TOKEN` — account token, used to read deployment status
   - `BLOB_READ_WRITE_TOKEN` — from a Vercel Blob store (only needed for video uploads)
   - `SIGTIL_BOOTSTRAP_CODE` — a one-time code; the first login with it creates the admin account
4. `npm run db:push` to create the tables.
5. `npm run dev`, open `/login`, enter the bootstrap code → you land in `/admin`.

## Connecting a site (per site)

1. Create a **fine-grained GitHub PAT** scoped to that one repo, permission *Contents: read & write*.
2. Find the **Vercel project ID** (project settings) and team ID if applicable.
3. In `/admin` → *Connect a site*: name, repo, token, project ID, production URL, and **site notes** — tell the AI where content lives ("menu data is in `lib/menu.ts`; the site has Danish and English text side by side"). Good notes make edits fast and precise.
4. Create the editor user with a personal login code and give them access to the site.
5. On the site's repo: protect `main` and require the Vercel build check (recommended backstop).

The work branch (`sigtil-edits`) is created automatically on first edit; Vercel deploys it as a branch preview automatically since the repo is already connected to Vercel.

## Known v1 limitations / roadmap

- GitHub tokens are stored in plaintext in the DB — encrypt at rest (KMS or a `pgcrypto` column) before real multi-tenant use; replace PATs with a GitHub App.
- Chat history is not persisted (each visit starts fresh).
- One shared work branch per site — two editors on the same site share pending changes.
- Login codes are single-factor; fine for invited family/staff, replace with magic-link email for a public product.
- Preview iframe requires the target site not to send `X-Frame-Options: DENY` (Next.js default is fine).
