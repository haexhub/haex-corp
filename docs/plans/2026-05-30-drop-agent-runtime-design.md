# Specifyr: drop agent runtime — design

**Status:** approved — ready to execute
**Branch:** `feat/drop-agent-runtime`
**Date:** 2026-05-30

## Context

Two parallel decisions shape this work:

1. The Anthropic-proxy code (formerly `claude-proxy` inside this repo) has been
   extracted into a standalone, project-agnostic service `haex-claude-proxy`.
2. Specifyr is being narrowed in scope: it is now **the UI for speckit-based
   spec authoring**. The autonomous agent runtime (ACP runners, Hermes
   orchestration, multi-agent "company" runtime, capability gates, approvals)
   moves out of specifyr entirely. Speckit and the runtime are different
   products served by different infrastructure — they should live in different
   repos.

The browser-side speckit pivot (PR #79 / #86 / #91) already validated this
direction: the speckit chat and step-chat both run in the browser via Vercel
AI SDK against a REST tool surface; no server-side LLM execution remains in
the happy path. Today the legacy ACP step-chat endpoint is the only blocker
to a clean cut.

## Target shape after the cut

**Specifyr keeps:**

- Org / project / membership / invite management
- Spec drafting & publishing (REST tools, browser-side speckit agent)
- Browser model identity management (localStorage-backed)
- Repository sync (git remote per project)
- Platform admin surfaces
- Authentik / OIDC auth flow

**Specifyr drops:**

- All server-side agent execution (ACP, Hermes, claude-code runners)
- The "company runtime" multi-agent orchestrator
- DB-backed LLM credentials, agent profiles, runner sessions, secrets
- The capability-grant / approvals flow
- The `claude-proxy` sibling container, the shared `haex_claude_proxy`
  Postgres role, and the `SPECIFYR_SECRET_KEY` envelope encryption that only
  existed to feed the proxy
- The `hermes-agent` Dockerfile and `bin/specifyr-acp.js` ACP entrypoint

## Inventory

### Code & directories to delete

**Top-level:**

- `src/` (entire tree — acp, agents, cli, core, providers, runners, server,
  transports, index.js, utils)
- `bin/specifyr-acp.js`
- `Dockerfile.hermes-agent`

**Server endpoints:**

- `server/api/approvals/`
- `server/projects/api/orgs/[slug]/projects/[projSlug]/run/`
- `server/projects/api/orgs/[slug]/projects/[projSlug]/company/`
- `server/projects/api/orgs/[slug]/projects/[projSlug]/steps/[stepId]/sessions/`
- `server/projects/api/orgs/[slug]/projects/[projSlug]/secrets/`

**Server utils (`server/shared/utils/`):**

- `speckit-agent-runner.ts`
- `company-manager.ts`
- `claude-oauth-driver.ts`
- `llm-credentials-store.ts`
- `llm-agent-profiles-store.ts`
- `runner-sessions-store.ts`
- `run-manager.ts`
- `secrets-store.ts`
- `orchestrator.ts`
- `bridge-subnet-allocator.ts`
- `mcp-auth.ts`
- `provider-models.ts`

`shared/utils/mcp-auth.ts` (mirror file) — check and remove if it's a re-export.

**UI:**

- `app/pages/approvals/`
- `app/pages/specs/[orgSlug]/[projSlug]/runtime.vue`
- `app/pages/specs/[orgSlug]/[projSlug]/run.vue`
- `app/pages/specs/[orgSlug]/[projSlug]/history.vue`
- `app/pages/specs/[orgSlug]/[projSlug]/secrets.vue`
- `app/pages/settings/me/llm.vue`
- `app/pages/settings/orgs/[slug]/llm.vue`
- `app/pages/settings/orgs/[slug]/secrets.vue`
- `app/components/agents/` (all three)
- `app/components/auth/AnthropicOAuthCard.vue`
- `app/components/settings/LlmCredentialCard.vue`
- `app/components/settings/ModelSelect.vue`
- Tab definitions for **Runtime** and **Secrets** in
  `app/components/projects/ProjectViewTabs.vue`
- Step sidebar pieces (`app/components/projects/ProjectStepSidebar.vue`) —
  audit and prune dead bits

### Schema tables to drop

- `llm_credentials`
- `llm_agent_profiles`
- `runner_sessions`

Generated via `pnpm drizzle-kit generate` after editing
`server/shared/database/schema.ts` — never hand-edit migrations.

### Compose / env / config to strip

- `docker-compose.yml`: `claude-proxy` service block; `COMPANY_CLAUDE_PROXY_URL`,
  `HERMES_AGENT_IMAGE`, `ANTHROPIC_API_KEY` env vars for the specifyr container
- `docker-compose.prod.yml`: equivalent entries
- `.env.example`: `ANTHROPIC_API_KEY`, `HERMES_AGENT_IMAGE`,
  `SPECIFYR_SECRET_KEY`, proxy-related blocks
- `nuxt.config.ts`: `companyClaudeProxyUrl`, `companyOpsUrlBase` runtimeConfig
  entries
- `docker/postgres-init/`: any seed that creates the `haex_claude_proxy` role

### Docs

- README rewrite: scope down to "speckit UI" framing; remove company-runtime
  and hermes-agent sections
- Plan documents older than 2026-05-18 stay in `docs/plans/` for git history
  but are no longer canonical; add a note at the top of this design pointing
  at the new boundary

## Execution order

1. **Schema first** — edit `schema.ts`, drop three tables; run
   `pnpm drizzle-kit generate` so the migration is captured cleanly.
2. **Server endpoints** — delete entire endpoint trees and the server utils
   they import.
3. **`src/` and standalone scripts** — delete `src/`, `bin/specifyr-acp.js`,
   `Dockerfile.hermes-agent`.
4. **UI** — delete agent pages, components, auth/llm settings. Trim
   `ProjectViewTabs.vue` to Speckit / Chat / Repository.
5. **Config** — strip compose, env, nuxt.config, postgres-init.
6. **Tests** — delete tests that target removed modules; do not weaken
   tests that target retained code.
7. **Docs** — README + this design doc as the new top-level pointer.

Each step compiles independently as long as the order is respected
(schema → endpoints → utils → src → ui → config). Doing it in a single PR
keeps the diff coherent: a multi-PR split would leave intermediate states
with broken imports.

## Verification

Before opening the PR:

- `pnpm typecheck` clean
- `pnpm build` clean
- `pnpm test` clean (excluding deleted runtime tests)
- `docker compose up` boots without the proxy service and migrations apply
- Manual smoke: log in → create org → create project → open speckit chat →
  ask the speckit agent for a draft → publish

If smoke fails or typecheck surfaces dead imports we missed, fix in the
worktree before committing.

## Risks

- **Hidden runtime imports in retained files**: server utils referenced by
  endpoints we keep. Mitigation: run typecheck early and iteratively.
- **DB migration on existing dev volumes**: dropping tables loses data. The
  user confirmed dev DBs are disposable; prod has no rows yet.
- **Settings-page regressions**: the working tree on `main` already had WIP
  edits to `settings/orgs/[slug]/llm.vue` — those are dropped by this PR (the
  whole file goes). Confirm with the user the WIP wasn't meant for something
  unrelated.
