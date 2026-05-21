# Phase 5a Build Plan — Step-Chat on Browser-MCP

> **Companion to:** [`2026-05-20-step-chat-browser-mcp.md`](2026-05-20-step-chat-browser-mcp.md)
> (the strategy doc — read first for the "why").
>
> **Scope:** Phase 5a only. Phase 5b (delete ACP stack), Phase 6
> (per-step git-push) and Phase 7 (Specifyr ↔ Hermes-remote transport)
> are out of scope here and each get their own plan.
>
> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`
> to implement this plan task-by-task. Default batch size: 2 tasks
> (smaller than Phase 1 because each task touches both DB and UI).
>
> **Estimated effort:** ~8–10 working days. Single contributor.
> **Owner:** tbd.

## Goal

`app/pages/specs/[orgSlug]/[projSlug]/steps/[stepId].vue` stops calling
`POST .../turn` (server-side ACP) and instead runs the same browser-MCP
shape as `chat.vue`: Vercel AI SDK in the browser, user-provided LLM
provider identity from localStorage, REST tool surface for file ops,
conversation persisted in `spec_drafts` rows.

When this phase ships, every interactive path that touches a language
model lives in the user's browser. Server-side ACP code still exists
(turn endpoint, AcpRunner, Dockerfile binaries) — that's Phase 5b
cleanup once we've watched 5a in production for ~1 week.

## Architecture sketch

```text
                ┌─────────────────────────────────────────┐
                │ steps/[stepId].vue                       │
                │                                          │
                │   <ProjectStepSidebar />                 │
                │   <SpeckitStepChatHost                   │ ◄── new
                │      :stepId="…" :draftId="…"            │
                │      ref="chatHost" />                   │
                │   <ArtifactViewer />                     │  unchanged
                │   <HookGateBanner                        │  unchanged
                │      @use-command="cmd =>                │
                │        chatHost.insertIntoDraft(cmd)" /> │
                └─────────────────────────────────────────┘
                                │
                                │ uses
                                ▼
                ┌─────────────────────────────────────────┐
                │ useSpeckitStepAgent({ orgSlug, projSlug, │ ◄── new (step
                │   stepId })                              │     composable —
                │                                          │     not a wrapper
                │   - resolveDraft() via by-step endpoint  │     of useSpeckit-
                │   - sendMessage(text) (own turn loop)    │     Agent; reuses
                │   - insertDraftText(text)                │     store + libs)
                └─────────────────────────────────────────┘
                                │
                                │ reuses
                                ▼
                ┌─────────────────────────────────────────┐
                │ useActiveSessionStore (openDraft,        │
                │ appendTurn, commitTurn)                  │
                │ buildSpeckitTools / buildLanguageModel   │
                │ SPECKIT_SYSTEM_PROMPT                    │
                └─────────────────────────────────────────┘
                                │
                                │ persists via
                                ▼
                ┌─────────────────────────────────────────┐
                │ spec_drafts row (gets new stepId column) │
                │   + conversation: Message[]              │
                │   + files: Record<string, string>        │
                └─────────────────────────────────────────┘
```

## Resolved decisions (from the 2026-05-21 strategy conversation)

- One draft per `(projectId, ownerUserId, stepId)`. No multi-session
  per step; the conversation lives in the draft.
- ChatStream.vue is **replaced** by a new `SpeckitStepChatHost.vue`,
  not refactored in place.
- `SessionList.vue` and the `/steps/.../sessions` endpoints stay
  callable until Phase 5b, but `steps/[stepId].vue` stops linking to
  them in 5a.
- `useSpeckitStepAgent` does **not** literally wrap `useSpeckitAgent`
  (the latter's `onMounted` auto-loads from a fixed `draftId` arg,
  which can't reactively swap on `stepId` change). It reuses the same
  store layer (`useActiveSessionStore`) and the same libs
  (`buildSpeckitTools`, `buildLanguageModel`, `SPECKIT_SYSTEM_PROMPT`)
  and mirrors the turn loop, so the implementations stay in sync.

## Tasks

### Task 5a.1: Add `step_id` to `spec_drafts`

**Files:**
- Modify: `server/shared/database/schema.ts` (extend `specDrafts` table)
- Generated (NEVER hand-edit): `server/shared/database/migrations/NNNN_*.sql` + journal/snapshot via `pnpm drizzle-kit generate`

**Schema change:**
```ts
// In specDrafts:
stepId: text("step_id"),  // nullable — chat.vue drafts have no step

// New index:
byProjectOwnerStep: uniqueIndex().on(
  table.projectId,
  table.ownerUserId,
  table.stepId,
).where(sql`step_id IS NOT NULL AND status = 'draft'`),
```

Rationale: the unique index enforces "one open draft per
(project, user, step)" at the DB level. Filtered on
`status='draft'` so historical published drafts don't block new ones.

**Steps:**
1. Edit schema. Run `pnpm drizzle-kit generate` — Drizzle produces the
   migration. Do not edit the generated SQL.
2. Confirm migration runs cleanly against a fresh dev DB
   (`pnpm dev:docker`).
3. Existing rows: `step_id` is NULL — that's correct, they're free-form
   chat.vue drafts.

**Verification:**
- `pnpm test` passes.
- Manual: in dev psql, `INSERT` two rows with the same
  `(projectId, ownerUserId, stepId)` and `status='draft'` — second
  insert fails with the unique constraint.

**Commit:** `feat(db): add step_id to spec_drafts for step-scoped drafts`

---

### Task 5a.2: `GET /spec-drafts/by-step/:stepId` — find-or-create

**Files:**
- Create: `server/projects/api/orgs/[slug]/projects/[projSlug]/spec-drafts/by-step/[stepId].get.ts`
- Modify: `server/shared/utils/spec-draft-store.ts` (new
  `findOrCreateStepDraft({ projectId, userId, stepId, baseVersion })`)
- Test: `tests/api/projects/spec-drafts-by-step.test.ts`

**Endpoint semantics:**
- Returns the caller's open draft (`status='draft'`) for the given
  `(project, user, stepId)` if one exists.
- If none exists: creates one with empty `conversation`, empty `files`,
  `baseVersion = project.spec_public_version`, status `draft`, title
  derived from the step (e.g. `"Step: spec"` — final title is a UX
  decision in 5a.4).
- Owner-only. Other users with project access calling this never see
  another user's draft; they get their own.

**TDD order:**
1. Test: GET when no draft exists → 200, creates new draft, returns
   draft body.
2. Test: GET when a draft exists → 200, returns the same draft (not a
   new one).
3. Test: GET as user B when user A has a draft for the same step →
   user B gets *their own* new draft, not A's.
4. Test: GET for an invalid stepId (path-param shape only — actual
   step existence is a UI-side concern) → still works; the server
   doesn't enforce a step taxonomy.
5. Implement endpoint + store function until tests pass.

**Commit:** `feat(api): find-or-create spec draft by step`

---

### Task 5a.3: `useSpeckitStepAgent` composable

**Files:**
- Create: `app/composables/useSpeckitStepAgent.ts`
- Test: `tests/unit/use-speckit-step-agent.test.ts`

**API:**
```ts
const {
  session,           // Ref<ActiveSession | null>
  saveState,         // Ref<SaveState>
  isStreaming,       // Ref<boolean>
  sendMessage,       // (text: string) => Promise<void>
  cancel,            // () => void
  insertDraftText,   // (text: string) => void — injects into next user message
  retrySave,         // () => Promise<void>
} = useSpeckitStepAgent({
  projectId: Ref<string>,
  stepId:    Ref<string>,
})
```

**Internals:**
1. On mount: call `GET /spec-drafts/by-step/:stepId` to resolve the
   draft, then `useActiveSessionStore.openDraft({ orgSlug, projSlug,
   draftId })` to make it the active session.
2. Re-implement the `streamText` turn loop locally (mirroring
   `useSpeckitAgent.sendMessage`) so a `stepId` change can swap the
   open draft without remounting — `useSpeckitAgent`'s `onMounted`
   binds to a fixed `draftId` and can't reactively swap.
3. Add `insertDraftText(text)` that appends to a buffered "next message"
   value (consumed by `sendMessage` or the chat input box —
   implementation choice in 5a.4).
4. When `stepId` (or `orgSlug`/`projSlug`) changes, re-run the GET and
   swap drafts. Guard with a per-call sequence token so a slow earlier
   response can't clobber a newer one.

**Tests** (vitest, mocked `$fetch`, `MockLanguageModelV1`):
- Mount → GET fired → draft resolved → composable returns active
  session.
- `sendMessage("hi")` → underlying `useSpeckitAgent.sendMessage`
  called.
- `insertDraftText("foo")` then `sendMessage("bar")` → underlying
  `sendMessage` receives `"foo bar"` (or the chosen concat shape).
- `stepId` ref change → second GET fires, session swaps.

**Commit:** `feat(speckit): step-aware browser composable`

---

### Task 5a.4: `SpeckitStepChatHost.vue` component

**Files:**
- Create: `app/components/speckit/SpeckitStepChatHost.vue`
- Test: `tests/unit/speckit-step-chat-host.test.ts` (vitest + Vue Test
  Utils + Pinia testing)

**Component shape:**
```vue
<script setup lang="ts">
import { useSpeckitStepAgent } from "~/composables/useSpeckitStepAgent";

const props = defineProps<{
  projectId: string;
  stepId: string;
}>();

const {
  session, saveState, isStreaming,
  sendMessage, cancel, insertDraftText, retrySave,
} = useSpeckitStepAgent({
  projectId: toRef(props, "projectId"),
  stepId:    toRef(props, "stepId"),
});

defineExpose({ insertIntoDraft: insertDraftText });
</script>

<template>
  <!-- shape mirrors SpeckitChatHost.vue: message list, input box,
       streaming indicator, save indicator, retry banner on failure -->
</template>
```

External API: identical to what `ChatStream.vue` exposed in the old
world — `insertIntoDraft(text)` is the method `steps/[stepId].vue`
calls from PowerPrompts / HookGateBanner integrations.

**Tests:**
- Renders draft.conversation messages.
- Streaming indicator shows during `isStreaming`.
- `chatHostRef.insertIntoDraft("rg foo")` calls the underlying
  composable's `insertDraftText`.
- Save banner appears on `saveState.kind === "failed"`; clicking Retry
  invokes `retrySave`.

**Commit:** `feat(speckit): step chat host component`

---

### Task 5a.5: Refactor `steps/[stepId].vue` to use the new component

**Files:**
- Modify: `app/pages/specs/[orgSlug]/[projSlug]/steps/[stepId].vue`
- Test (e2e): `tests/e2e/step-chat-browser-mcp.test.ts`

**Replace:**
- `<ChatStream ref="chatStreamRef" ...>` →
  `<SpeckitStepChatHost ref="chatHostRef" :step-id="..." ...>`
- `chatStreamRef.value?.insertIntoDraft(text)` (existing call sites in
  `handlePowerPrompt` and `handleGateUseCommand`) →
  `chatHostRef.value?.insertIntoDraft(text)` (same signature, no
  semantic change at call sites).

**Remove:**
- `import SessionList from "~/components/ui/SessionList.vue"`
- The session-fetching, session-creating, session-deleting state and
  handlers (`sessions`, `sessionsLoading`, `creatingSession`,
  `deleteSessionTarget`, `deletingSession`).
- The `<SessionList>` element from the template.
- Anything that reads `route.query.session` for the active session id.

`SessionList.vue` itself **stays in the codebase** for 5a — it might
still be referenced elsewhere. 5b removes it (and the server-side
session endpoints) for good.

**Verification (manual + e2e):**
- Open a project step, type a message, see streaming response.
- Tool calls (e.g. `read_file`) execute against the REST surface and
  return results that the LLM uses.
- Drafted files appear in `<ArtifactViewer>` after the turn.
- Refresh the page: conversation persists (loaded from the draft).
- Switch to another step in the sidebar: chat resets to that step's
  draft.
- HookGate "Use this command" button: pre-fills the chat input via
  `insertIntoDraft`.

**Commit:** `feat(ui): step-chat on browser-MCP`

---

### Task 5a.6: Server-side `/turn` endpoint becomes unreachable from this UI

**Files:** none (no code change). This is a verification step.

**What to check:**
- grep the `app/` tree for any remaining call to `POST .../turn`. The
  step-chat refactor in 5a.5 should be the only consumer; once it's
  gone, `app/` has zero references.
- `server/projects/api/orgs/[slug]/projects/[projSlug]/steps/[stepId]/sessions/[sid]/turn.post.ts`
  still exists; the deletion is Phase 5b.

If the grep finds anything: that's a stray call that needs to move to
the new composable, otherwise the file gets deleted in 5b and that
call breaks. Treat any hit as a 5a blocker.

**Commit:** none (verification only).

---

## Out-of-scope (do not do in 5a)

- Deleting `turn.post.ts`, `speckit-agent-runner.ts`, the AcpRunner,
  the Dockerfile binaries, the test suites — all 5b.
- Rewriting `run.vue` for remote Hermes — 5b + 7.
- Per-step git-push — 6.
- New skills or new tools — same surface as PR #86 stays.
- Migrating any in-flight step sessions to drafts. Existing sessions
  remain readable through the server-side `/turn` path until 5b
  removes it; users with active sessions see them go away when 5b
  ships. If the data turns out to matter, add a one-shot migration in
  5b. Don't pre-build a converter that may not be needed.

## Open questions (none blocking)

- **Per-step system prompt:** today the server-side path injects a
  step-specific system prompt before the user turn. 5a's first cut
  reuses `chat.vue`'s system prompt for all steps. Step-specific
  prompts can land in a follow-up after we've felt the actual quality
  gap (or non-gap).
- **Title of step-drafts:** "Step: spec" is the placeholder; the UX
  call (visible in the draft sidebar elsewhere) is fine to defer.

## Definition of Done

- All six tasks committed, each with passing tests.
- E2E test in `tests/e2e/step-chat-browser-mcp.test.ts` walks the full
  flow described in 5a.5 verification.
- `app/` directory grep for `POST .../turn` has no reachable step-chat
  callsites. The orphaned `ChatStream.vue` reference is acceptable and
  goes away in Phase 5b cleanup.
- `pnpm test` and `pnpm typecheck` both green.
- Manual smoke test against a live dev stack: spec step → plan step →
  tasks step, each in browser-MCP mode, each draft persists across
  reloads.
- 5a sits in production (or staging if there's no prod yet) for ~1
  week before 5b starts.
