# specifyr

specifyr is a browser-side UI for authoring software specifications using the
[spec-kit](https://github.com/github/spec-kit) workflow. Specs evolve through
explicit steps (constitution → specify → plan → tasks → implement) and live as
markdown artifacts under `.specifyr/<orgId>/<slug>/`, ready to be consumed by an
external agent runtime when it is time to execute the work.

specifyr is **not** an agent runtime. The browser-side speckit agent runs in
the user's browser (Vercel AI SDK + a REST tool surface against the Nitro
server); model calls go directly from the browser to the user's chosen
provider using a localStorage-backed identity. The Nitro server's job is to
serve the UI, persist drafts, sync project directories to a git remote, and
manage orgs / projects / memberships.

For autonomous, server-side multi-agent execution see the standalone
hermes-agent project — it consumes finished specs from a git remote and
executes them on its own infrastructure.

## What is included

- Spec drafting with auto-saved conversation history (one row per
  `(project, owner, step)` in `spec_drafts`)
- Per-project workflow step state stored on disk under `.specifyr/<orgId>/<slug>/steps/`
- Org / project / membership / invite management backed by Postgres
- Per-project git remote sync (HTTPS + PAT, AES-256-GCM encrypted at rest)
- Org-installed spec-kit extensions (alternate workflows beyond the default)
- Authentik forward-auth + a dev-mode email shortcut for local iteration
- A Nuxt 4 UI built with Vue, Tailwind, and shadcn-style components

## Local development

```bash
pnpm install
pnpm dev   # http://localhost:3000
```

With Postgres (recommended — the full multi-tenant flow requires it):

```bash
docker compose up --build
# specifyr direct  → http://localhost:10000 (uses SPECIFYR_DEV_USER_EMAIL)
# multi-user flow  → http://specifyr.localhost (Traefik + Authentik)
```

Copy `.env.example` to `.env` and at minimum set:

- `DATABASE_URL` — points the server at Postgres
- `SPECIFYR_SECRET_KEY` — 32 random bytes hex, encrypts the per-project git PAT

See `.env.example` for the full env-var reference (Authentik bootstrap, host
port scheme, etc.).

## Schema migrations

Drizzle generates and applies migrations from
`server/shared/database/schema.ts`:

```bash
pnpm drizzle-kit generate --name <slug>
```

Migrations apply automatically at Nitro startup via
`server/plugins/db.ts`. Never hand-edit the SQL, snapshot, or journal files
under `server/shared/database/migrations/` — always regenerate from a schema
change.

## Tests

```bash
pnpm test          # unit + node tests
pnpm test:unit     # browser-side speckit tests (vitest)
pnpm test:node     # server-side + DB tests (node:test)
```

DB-backed tests are skipped automatically when `DATABASE_URL` is unset.

## Project layout

```
app/             Nuxt frontend (pages, components, stores, composables)
server/          Nitro server (REST API, auth, DB migrations)
shared/          types shared by frontend and backend
i18n/            translations (de, en)
docs/plans/      design docs
tests/           node:test (server, DB) + vitest (browser units)
```
