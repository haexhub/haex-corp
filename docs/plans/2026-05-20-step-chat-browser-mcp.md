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
2. User walks through the workflow steps (Spec → Plan → Tasks → … → Run)
   entirely browser-side, using Speckit skills as LLM instructions.
   Each step produces an artifact (`spec.md`, `planning.md`, `tasks.md`,
   …).
3. After each step's artifact is finished, Specifyr pushes that artifact
   to the user's configured git remote (Phase 6 wires this up).
4. The final "Run" step is the trigger for task execution — but the
   execution itself runs on **Hermes on a remote host**, fed from the
   git repo. Specifyr's Run UI talks to that remote Hermes (start,
   status, results) rather than spawning a local runner. Hermes
   implementation lives in this repo under `src/runners/hermes-*`; what
   changes is the *deployment location* and the *transport between
   Specifyr and Hermes*.

Specifyr's job becomes: spec-authoring surface (steps 1–2), per-step
git-push (step 3), and a thin Run UI that drives a remote Hermes
(step 4). All in-process LLM execution (ACP runner, local
RunScheduler) is removed.

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
becomes part of the draft identity so different workflow steps get
their own draft (and therefore their own conversation) but share the
same underlying schema.

**Resolved decisions (2026-05-21 conversation):**

- **Keep `steps/[stepId].vue` separate from `chat.vue`.** The
  step-by-step affordance is the value of the Spec-Kit workflow;
  `chat.vue` is the free-form alternative. Both stay.
- **Drop the multi-session-per-step model.** Today the user can stack
  multiple parallel chat sessions on one step; that model goes away in
  favor of the `chat.vue` shape where the conversation is part of the
  draft. Starting fresh means "new draft." The `step_sessions` /
  `SessionList.vue` UI gets removed in 5b.
- **Replace `ChatStream.vue` with a new `SpeckitStepChatHost.vue`
  component** modeled on `SpeckitChatHost.vue`, but carrying over the
  external API the surrounding page already calls — props for
  `stepId`/`draftId`, the `insertIntoDraft(text: string)` exposed
  method that `PowerPrompts` and `HookGateBanner` invoke. This is more
  honest than "in-place refactor" since the internal data pipeline is
  effectively rewritten; the diff is bigger but easier to review, and
  we don't end up maintaining two near-identical chat components long
  term.

Outcome: nothing in the app calls into ACP from interactive code paths
anymore.

### Phase 5b — Delete the ACP stack, rework `run.vue` for remote Hermes

With 5a in, the server has no live consumers of the ACP runner for
interactive chat. The Run step still exists as a UI, but its backing
moves from `RunScheduler` (in-process, ACP) to a remote-Hermes client.

**Delete:**
- `server/projects/api/orgs/[slug]/projects/[projSlug]/steps/[stepId]/sessions/[sid]/turn.post.ts`
  and the related session create/delete endpoints
- `server/shared/utils/speckit-agent-runner.ts`
- `src/runners/acp.js`, `src/runners/claude-code.js`,
  `src/runners/claude-stream-to-acp.js`
- `src/core/run-scheduler.js` (in-process scheduler — Hermes-on-remote
  takes over) and `tests/runners/acp-runner-scheduler.test.js`
- `server/projects/api/orgs/[slug]/projects/[projSlug]/run/start.post.ts`
  in its current form — it called `createSpeckitRunnerFactory()`. A
  replacement endpoint of similar shape will exist but talks to the
  remote Hermes instead (see "Rework," below).
- `bin/specifyr-acp.js` (CLI entry for the ACP runner — likely orphaned)
- `tests/acp/*` (8 files), `tests/runners/acp-*` (4 files),
  `tests/core/turn-broker-acp.test.js`,
  `tests/integration/acp-gemini.test.js`
- `app/components/ui/SessionList.vue` and the related step-session UI
  primitives (sessions concept goes away with 5a's draft-as-conversation)

**Rework (don't delete):**
- `app/pages/specs/[orgSlug]/[projSlug]/run.vue` — UI stays. Replace
  the SSE pipeline that streamed from the in-process scheduler with a
  transport that drives the remote Hermes (start, status poll or
  webhook-driven progress, final results). UI shape (task list, task
  detail, progress) is unchanged.
- `app/components/ui/RunTaskList.vue`, `RunTaskDetail.vue` — keep,
  same data shape, different source.
- A new `server/projects/api/.../run/start.post.ts` (or renamed) that
  takes the current spec state, validates that Hermes-remote
  connectivity is configured for the org, and triggers a remote run.
  The exact transport is a Phase-7 design question, not Phase-5b.

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
the Hermes path, and that path is *remote*. The browser is the only
place Speckit talks to a language model.

### Phase 6 (deferred to its own plan) — Per-step git-push

After 5b lands, Specifyr can produce spec artifacts but has no way to
get them into the git repo Hermes will read. Phase 6 builds that
bridge with a **push-after-every-step** trigger, not a single
end-of-workflow upload:

- Store user-supplied git remote URL + credential (PAT or SSH key,
  AES-GCM encrypted, same pattern as `llm_credentials`)
- When a workflow step's artifact is finalized (draft published,
  per-step), Specifyr commits + pushes that file to the configured
  remote. Each step's artifact lands as its own commit on the working
  branch.
- The final Run step uses the same repo as the trigger for
  Hermes-remote — the git state at Run time is exactly the spec the
  user finalized.
- Branch strategy and PR vs. direct-commit configurability
- Empty-repo bootstrap (initialize `.specify/` scaffolding on first
  push)

### Phase 7 (deferred to its own plan) — Specifyr ↔ Hermes-remote transport

The Run UI in `run.vue` needs to talk to a Hermes instance running on
some other host. That's its own design problem and lives outside this
plan:

- Authentication of Specifyr → Hermes-remote (mTLS? signed
  session-token? both?)
- Org credential delivery: Hermes-remote needs the org's LLM keys for
  its agents; how Specifyr ships them in a way that lets Hermes use
  them without persisting them
- Progress reporting back to Specifyr (long-polling, SSE, webhooks)
- Run lifecycle: how Specifyr knows when Hermes is done, how to cancel,
  how to resume after a Hermes-host restart
- Per-org or per-project Hermes-host assignment

Phase 7 is the bigger architectural piece. Phase 5 doesn't depend on
it landing first — the existing `run.vue` UI can stay broken (or
hidden behind a "not yet" notice) for a window between 5b and 7.

Phase 6 and Phase 7 are out of scope for the current branch.

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

All three earlier open questions resolved 2026-05-21:

- ✅ Session model: collapse into draft conversation (chat.vue shape).
  `step_sessions` rows + `SessionList.vue` go away in 5b.
- ✅ `ChatStream.vue`: replace with a new `SpeckitStepChatHost.vue`
  modeled on `SpeckitChatHost`, carrying the existing external API
  (`insertIntoDraft` etc.).
- ✅ Run step: stays as a UI, backed by Hermes-on-remote (transport
  designed in Phase 7).

Remaining for the 5a build plan:
- Draft identity per step — one draft per (project, user, stepId)? Or
  one draft per workflow run that all steps share?
- Migrating any in-flight step-chat sessions when 5a ships: keep them
  read-only? Auto-convert to drafts? Throw away?
- `tasks.md` is the input to Run — does the structured Tasks step
  produce a typed task graph (the way `RunScheduler` consumed it
  today), or just markdown? The current scheduler parsed structured
  JSON-y task definitions; if Hermes-remote needs that same shape,
  Tasks step still has structured output. If Hermes-remote can parse
  plain markdown, Tasks step can simplify.

## Related documents

- [`2026-05-21-step-chat-browser-mcp-build.md`](2026-05-21-step-chat-browser-mcp-build.md)
  — task-by-task **build plan** for Phase 5a (executable via
  `superpowers:executing-plans`)
- `docs/plans/2026-05-18-browser-mcp-spec-agent.md` — Phase 1–4 (parent)
- `docs/adrs/2026-05-18-browser-mcp-architecture.md` — original ADR
- `docs/plans/2026-05-18-untrusted-multi-tenant-isolation.md` —
  superseded; contains the threat-model material that informed the
  decision to keep Speckit's tool surface read-only
