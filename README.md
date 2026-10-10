# sigtil

**Din hjemmeside. Sig til, så ændrer vi den.**

An AI-first website editor for non-technical people. Editors chat in plain Danish, watch a live preview update, and press one button — **Udgiv** — to go live. No code, no git, no jargon anywhere in the editor UI.

## How it works

```
editor prompt ──▶ /api/chat (AI agent with file tools)
                     │  reads/edits files via GitHub Contents API
                     ▼
     work branch per editor (sigtil-edits-<user>) ──▶ Vercel branch preview (iframe)
                     │
                “Udgiv” ──▶ merge into main ──▶ wait until production
                     │        deployment is READY (verified live)
                     ▼
                work branch catches up with main
```

- **No sandbox, no containers.** Content edits are file edits through the GitHub API — instant. Vercel builds the branch preview (~1 min for a small site).
- **Safety model:** the agent can only touch content paths (configurable per site; `package.json`, configs, CI, lockfiles are always blocked). Nothing reaches production until the human presses Udgiv, and the production build must succeed before sigtil reports "live". Keep branch protection + the Vercel check on `main` as a backstop.
- **Uploads:** images are optimized (sharp → WebP, max 2000px) and committed into `public/uploads/`; videos go to Vercel Blob and are referenced by URL.
- **Undo:** last change (drops the newest unpublished commit) or everything (resets the work branch onto main). Each editor has their own work branch, so undo only ever touches your own changes.
- **A change that breaks the build:** every commit a chat turn makes carries a `Sigtil-Turn: <id>` line. When the newest change's branch build is `ERROR`, the status route reports it, and the editor sends the AI one repair turn with the end of the build log (`buildLog` in `lib/vercel.ts`). The repair reuses the turn id, marked `Sigtil-Repair: yes`. If its build fails too, or it changed nothing, `dropTurn` takes the whole turn out (keeping changes before and after it) and the editor is told in plain Danish.
- **Several editors, and developers, at once:** nobody is ever asked to resolve anything.
  - Every editor gets their own work branch (`<workBranch>-<first 8 of user id>`), with its own preview and publish.
  - `main` can move under you (someone else publishes, a developer pushes). On every status poll, chat turn and publish, `syncWorkBranch` replays your unpublished commits on top of `main`. Files changed on both sides are merged line by line (`lib/merge.ts`); where both changed the same lines, the editor's version wins. Binary files: the editor's version wins. A move keeps a developer's edit to the moved file.
  - Every write to a work branch runs under a Postgres advisory lock for that branch, and `updateFile` reads and writes in one go, so a chat edit, an inline text edit and a sync never overwrite each other.
  - Publishing merges exactly the synced commit, retries after a re-sync if `main` moved, and afterwards only catches the branch up (no reset), so edits made while a publish was waiting are kept.
  - The old shared branch (`sigtil-edits`) is taken over by the first editor who opens the site after the upgrade, then deleted.

## Stack

Next.js (App Router) · Tailwind 4 · AI SDK via OpenRouter · Drizzle + Postgres · GitHub REST API · Vercel REST API · Vercel Blob · sharp

## Setup

1. `npm install`
2. Create a Postgres database (e.g. Neon via the Vercel Marketplace) and set `DATABASE_URL` in `.env.local` (copy `.env.example`).
3. Fill the rest of `.env.local`:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — from https://dashboard.clerk.com (API keys)
   - `SIGTIL_ADMIN_EMAIL` — while no users exist, the first Clerk sign-in with this email becomes admin
   - `OPENROUTER_API_KEY` — from https://openrouter.ai/keys (one key, any model; switch models via `SIGTIL_MODEL`)
   - `VERCEL_TOKEN` — account token, used to read deployment status
   - `BLOB_READ_WRITE_TOKEN` — from a Vercel Blob store (only needed for video uploads)
4. `npm run db:push` to create the tables.
5. `npm run dev`, open `/sign-in`, sign in with the admin email → you land in `/admin`.

Auth is Clerk (identity) + invite-only authorization in the DB: admins invite users by email in `/admin`, and the first Clerk sign-in with that email links the account. A Clerk account that isn't invited sees a "no access" page.

## Tests

`npm test` runs Vitest. `test/merge.test.ts` covers the line merge; `test/github.test.ts` runs sync, publish, undo and file writes against `test/fake-github.ts`, an in-memory GitHub repo, with the Postgres branch lock faked in `test/fake-db.ts`. No network or database needed.

## Connecting a site (per site)

1. Create a **fine-grained GitHub PAT** scoped to that one repo, permission *Contents: read & write*.
2. Find the **Vercel project ID** (project settings) and team ID if applicable.
3. In `/admin` → *Connect a site*: name, repo, token, project ID, production URL, and **site notes** — tell the AI where content lives ("menu data is in `lib/menu.ts`; the site has Danish and English text side by side"). Good notes make edits fast and precise.
4. Invite the editor by email and give them access to the site.
5. On the site's repo: protect `main` and require the Vercel build check (recommended backstop).

The work branch (`sigtil-edits`) is created automatically on first edit; Vercel deploys it as a branch preview automatically since the repo is already connected to Vercel.

## Known v1 limitations / roadmap

- GitHub tokens are stored in plaintext in the DB — encrypt at rest (KMS or a `pgcrypto` column) before real multi-tenant use; replace PATs with a GitHub App.
- Chat history is not persisted (each visit starts fresh).
- Two editors don't see each other's unpublished changes in their previews. Whoever publishes last wins on lines both changed.
- Login codes are single-factor; fine for invited family/staff, replace with magic-link email for a public product.
- Preview iframe requires the target site not to send `X-Frame-Options: DENY` (Next.js default is fine).
