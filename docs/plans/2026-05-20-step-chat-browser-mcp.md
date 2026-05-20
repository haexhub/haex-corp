# Phase 5 — Step-Chat off the ACP Stack, onto Browser-MCP

> **Status (2026-05-20, revised):** strategy doc, not yet a build plan.
> Picks up where `2026-05-18-browser-mcp-spec-agent.md` Phase 4 stalled.
>
> **Owner:** tbd. **Effort:** ~2 weeks for 5a (step-chat migration) +
> ~3 days for 5b (ACP cleanup) once 5a is in. A separate Phase 6 plan
> handles the git-push surface.

## The product flow this plan locks in

1. User picks their own LLM provider in the browser
   (`/settings/speckit-agent`, localStorage). Keys never reach Specifyr.
2. User produces spec artifacts (`specs/spec.md`, `planning.md`,
   `tasks.md`, etc.) entirely browser-side, using Speckit skills as
   LLM instructions.
3. User pushes finished artifacts to a git repo via Specifyr (Phase 6).
4. Hermes (lives in this repo under `src/runners/hermes-*`, runs on
   remote hosts, fed by org-managed credentials) reads the git repo and
   executes whatever the spec asks for. Hermes is *not* something
   Specifyr starts in-process; Specifyr only delivers the artifacts.

Specifyr's job is the spec-authoring surface (steps 1–2) plus the
"publish to git" handoff (step 3). Task execution from a spec is not
Specifyr's job anymore.

## What's blocked today and why

`docs/plans/2026-05-18-browser-mcp-spec-agent.md` Phase 4 wants to
delete the server-side ACP stack — `src/runners/acp.js`,
`server/shared/utils/speckit-agent-runner.ts`, the Dockerfile installs,
`tests/acp/*`. Two live UIs still call into it:

| UI | Endpoint | Backing | What it is |
|---|---|---|---|
| `app/pages/specs/[orgSlug]/[projSlug]/steps/[stepId].vue` | `POST .../steps/[stepId]/sessions/[sid]/turn` | `turn.post.ts` → `createSpeckitRunnerFactory()` → `AcpRunner` | The structured Spec-Kit workflow UI (Spec → Plan → Tasks → …). Each step is its own chat. The unmigrated half of Speckit. |
| `app/pages/specs/[orgSlug]/[projSlug]/run.vue` | `POST .../run/start` | `run/start.post.ts` → `RunScheduler` | Old in-app task-graph runner — picks up tasks.md and executes each task locally inside the Specifyr container. From the pre-pivot architecture. |

PR #86 shipped a parallel browser-MCP chat at `chat.vue` for free-form
draft work. `steps/[stepId].vue` is the *other* half — the structured
workflow — and was left for later.

## The migration

### Phase 5a — Step-Chat on Browser-MCP

Give `steps/[stepId].vue` the same shape as `chat.vue`. Same browser
composable pattern (`useSpeckitAgent`), same Vercel AI SDK, same REST
tool surface (`list_files`, `read_file`, `search_code`,
`read_existing_spec`, `list_my_drafts`, `load_draft`,
`update_draft_files`). No new tools, no Hermes calls. The step ID
becomes part of the session/draft identity so different workflow steps
get their own chat history but share the same draft bundle.

Key decisions:
- Keep `steps/[stepId].vue` separate from `chat.vue` rather than
  collapsing them — the step-by-step affordance *is* the value of the
  Spec-Kit workflow; `chat.vue` is the free-form alternative.
- Replace `ChatStream.vue`'s `POST /turn` pipeline with a
  composable-driven stream identical to `SpeckitChatHost`.
- Per-step session list (`SessionList.vue`) needs to either be reused
  with a new in-browser data source or simplified — sessions in the
  current model are server rows; in the browser-MCP model they could be
  collapsed into the draft's conversation array.

Outcome: nothing in the app calls into ACP from interactive code paths
anymore.

### Phase 5b — Delete the ACP stack

With 5a in, the server has no live consumers of:

**Delete:**
- `app/pages/specs/[orgSlug]/[projSlug]/run.vue` and
  `app/components/ui/RunTaskList.vue`, `RunTaskDetail.vue` —
  task execution is no longer Specifyr's job
- `server/projects/api/orgs/[slug]/projects/[projSlug]/run/start.post.ts`
  and the run/status endpoints, plus their tests
- `src/core/run-scheduler.js` and `tests/runners/acp-runner-scheduler.test.js`
- `server/projects/api/orgs/[slug]/projects/[projSlug]/steps/[stepId]/sessions/[sid]/turn.post.ts`
  and the related session create/delete endpoints
- `server/shared/utils/speckit-agent-runner.ts`
- `src/runners/acp.js`, `src/runners/claude-code.js`,
  `src/runners/claude-stream-to-acp.js`
- `bin/specifyr-acp.js` (CLI entry for the ACP runner — likely orphaned)
- `tests/acp/*` (8 files), `tests/runners/acp-*` (4 files),
  `tests/core/turn-broker-acp.test.js`,
  `tests/integration/acp-gemini.test.js`

**Update:**
- `server/shared/utils/validation.ts` — drop `ACP_RUNNERS`, either
  remove `speckitAgentProfileSchema` entirely (no DB-backed Speckit
  profile concept after browser-MCP) or narrow it
- `server/shared/utils/llm-agent-profiles-store.ts` — drop the `acp:*`
  validator branch in the Speckit path
- `app/pages/settings/me/llm.vue` — remove
  `<AgentsSpeckitAgentProfileCard>` (the underlying profile concept is
  gone); page becomes Hermes-only as already labeled
- `Dockerfile` — drop the `claude-agent-acp`, `codex-acp`, `gemini-cli`
  npm-install block; the runtime image gets smaller

**Keep:**
- `src/runners/hermes-streaming.js`, `src/runners/hermes-docker.js`,
  and the broader `src/runners/hermes-*` family — Hermes implementation
  is the *output* of this whole effort, runs on remote hosts
- `server/projects/api/orgs/[slug]/projects/[projSlug]/company/start.post.ts`
  and the company-agent runtime endpoints — that's how Hermes spawns
  its agents
- `app/pages/settings/orgs/[slug]/llm.vue` — Hermes org-credentials UI
- The personal-Hermes-credentials page (`/settings/me/llm`) minus the
  Speckit profile card

After 5b, the only LLM-execution path Specifyr's server still has is
the Hermes path. The browser is the only place Speckit talks to a
language model.

### Phase 6 (deferred to its own plan) — Publish to Git

After 5b lands, Specifyr can produce spec artifacts but has no way to
get them into the git repo Hermes will read. Phase 6 builds that
bridge:

- Store user-supplied git remote URL + credential (PAT or SSH key,
  AES-GCM encrypted, same pattern as `llm_credentials`)
- "Publish to git" action on the Speckit page: pulls the latest
  published spec_drafts, materializes them under `specs/` in a working
  checkout, commits + pushes
- Branch strategy and PR vs. direct-commit configurability
- Empty-repo bootstrap (initialize `.specify/` scaffolding on first
  push)

Phase 6 is out of scope for the current branch.

## Why this is smaller than the previous version of this doc said

The earlier version (commit `61a0700`) put a "Path A — Step-chat on
Hermes-on-remote" recommendation at the top. That was wrong: Speckit
never ran on Hermes, was never meant to, and never will. Speckit is a
browser-side spec-authoring tool. Hermes is the *consumer* of what
Speckit produces, fed via git, running elsewhere. The migration of
step-chat is therefore just "do for `steps/[stepId].vue` what PR #86
did for `chat.vue`" — same tools, same composable, same DB schema.
No new threat-model expansion, no waiting on infrastructure that
doesn't exist yet.

## Open questions for the build plan

- Session model in step-chat: keep per-step session rows
  (`step_sessions`) for history, or fold sessions into the draft's
  `conversation` JSON the way `chat.vue` does?
- `ChatStream.vue`: refactor in place or replace with
  `SpeckitChatHost.vue`-equivalent? Component surface affects how much
  of the existing UI (artifact viewer, hook gate banner) carries over.
- Workflow steps that aren't chat-shaped (the "Run" step today) need a
  decision too — turn into a "Publish to git" step instead, since
  in-app task execution goes away?

## Related documents

- `docs/plans/2026-05-18-browser-mcp-spec-agent.md` — Phase 1–4 (parent)
- `docs/adrs/2026-05-18-browser-mcp-architecture.md` — original ADR
- `docs/plans/2026-05-18-untrusted-multi-tenant-isolation.md` —
  superseded; contains the threat-model material that informed the
  decision to keep Speckit's tool surface read-only
