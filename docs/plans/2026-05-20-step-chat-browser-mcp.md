# Phase 5 — Step-Chat off the Server-Side ACP Stack

> **Status (2026-05-20):** strategy doc, not yet a build plan. Picks up where
> `2026-05-18-browser-mcp-spec-agent.md` Phase 4 stalled.
>
> **Owner:** tbd. **Effort:** depends on chosen path (see below).

## What's blocked and why

`docs/plans/2026-05-18-browser-mcp-spec-agent.md` Phase 4 ("remove ACP")
cannot land while the step-chat UI still depends on the ACP stack:

| UI | Endpoint | Backing |
|---|---|---|
| `app/pages/specs/[orgSlug]/[projSlug]/steps/[stepId].vue` | `POST .../steps/[stepId]/sessions/[sid]/turn` | `server/projects/api/.../turn.post.ts` → `createSpeckitRunnerFactory()` → `AcpRunner` |
| `app/pages/specs/[orgSlug]/[projSlug]/run.vue` | `POST .../run/start` | `server/projects/api/.../run/start.post.ts` → `RunScheduler` (fallbackChain `["hermes", "acp:codex"]`) |

The Speckit-Chat UI (`chat.vue`) was migrated to the browser side in PR #86
and is independent of ACP. Step-chat and run-scheduler are not. So the ACP
binaries, `src/runners/acp.js`, `server/shared/utils/speckit-agent-runner.ts`,
the `acp:*` validator branches, and the Dockerfile installs must all stay
until step-chat moves off the ACP runner.

## Why this isn't just "do Phase 2 again"

The browser-MCP architecture for Speckit (PR #86) deliberately restricted
the tool surface:

> Bewusst NICHT in der Surface: kein `write_arbitrary_file`, kein
> `execute_command`, kein `git_*`, kein `npm_install`, kein `read_git_log`.
> Was ein autonomer Hermes-Agent später braucht, ist eine eigene, getrennte
> Surface auf separater Infra.
> — `2026-05-18-browser-mcp-spec-agent.md`, "Tool-Surface"

Step-chat needs exactly that broader surface — it writes source files,
runs commands, walks the repo. Repeating the Speckit pattern verbatim
would either:

- **Widen the browser-MCP surface to include code-modifying tools.** Brings
  the original threat model back (LLM-output decides what to write/run on
  the server; path-traversal and command-injection guards become the only
  safety net).
- **Push step-chat to Hermes-on-remote.** Keeps the isolation story intact
  but requires the Hermes-remote infrastructure to exist first. The user's
  position (2026-05-20) is that Hermes should later run on arbitrary
  remote hosts, not on the Specifyr server — so Hermes-on-remote is
  desired anyway.

## Two viable paths

### Path A — Step-chat on Hermes-on-remote (preferred)

Architecturally consistent with the existing decisions: Hermes runtime
already runs in isolated Docker containers for company-agents; step-chat
fits the same execution shape (autonomous file edits, command execution,
long-running).

Prerequisite work that this depends on:

1. Hermes-remote control plane: protocol for the Specifyr server to spawn
   sessions on a remote Hermes host, hand it a credential blob (org-scoped
   keys per the user's "centrally managed keys" decision), stream events
   back to the Specifyr browser.
2. Per-session credential delivery: short-lived signed tokens that let
   the remote Hermes pull or receive org-scoped LLM keys, without those
   keys persisting on the remote host beyond the session.
3. Step-chat client refactor: replace the ACP-over-`turn.post.ts` plumbing
   with the new Hermes-remote session protocol. UI components (`ChatStream`,
   `ChatMessage`) likely stay; the transport beneath them changes.
4. Phase 4 cleanup of the old plan becomes executable: drop
   `speckit-agent-runner.ts`, `src/runners/acp.js`, `src/runners/claude-code.js`,
   `src/runners/claude-stream-to-acp.js`, the `acp:*` validator branches,
   the Dockerfile ACP installs, and `tests/acp/*` + `tests/runners/acp-*`.

**Effort estimate:** 4–6 weeks. The Hermes-remote control plane is the
big rock; step-chat porting on top of it is comparatively small.

### Path B — Step-chat on browser-MCP with a wider tool surface

If the architectural budget for Hermes-remote isn't available soon, the
alternative is to do for step-chat what Phase 2 did for Speckit — port the
UI to a browser-side composable with Vercel AI SDK, and add the
code-modifying tools to the REST surface.

Required tool surface additions on top of the Speckit set:

| Tool | Surface | Threat |
|---|---|---|
| `write_file(path, content)` | `PUT /api/orgs/.../projects/.../files/<path>` | Path traversal, arbitrary content. Mitigation: same `O_NOFOLLOW + realpath` pattern Phase 1 used for reads, plus a deny-list for `.git/`, `node_modules/`, `.specifyr/`. |
| `delete_file(path)` | `DELETE /api/orgs/.../projects/.../files/<path>` | Same path-traversal concerns. Confirm-on-LLM-call UX in the chat to avoid silent destruction. |
| `run_command(cmd, args, cwd?)` | `POST /api/orgs/.../projects/.../run-command` | Code execution on the Specifyr host. **This is the core of the threat model the pivot was supposed to remove.** Mitigation requires a sandboxed worker process per project, which is non-trivial. |
| `git_*` (status, diff, log, add, commit) | `POST /api/orgs/.../projects/.../git/<op>` | Lower risk than arbitrary `run_command`. Possibly safer to expose these specifically and *not* `run_command` at all. |

The honest read on Path B: the security gain of the original browser-MCP
pivot (server has no LLM-decided execution path) is largely sacrificed for
step-chat. Speckit stays safe because Speckit's tools remain read-only +
draft-write; but the *server as a whole* now hosts a tool surface that an
LLM can drive into arbitrary file writes and command execution. Path
traversal and a deny-list aren't a replacement for process-level isolation.

**Effort estimate:** 2–3 weeks for the port + new endpoints, plus an
indefinite amount for hardening the command-execution path that Path A
sidesteps entirely.

## Recommendation

**Path A** is consistent with the security goals of the browser-MCP pivot
and with the user's stated direction for Hermes (remote hosts, centrally
managed keys). Path B is feasible if shipping is urgent, but it spends
the security budget the pivot was supposed to bank.

The next concrete step is a separate spec for the Hermes-remote control
plane — its scope, the protocol shape, the per-session credential model,
and how the Specifyr server proxies events. That spec is the prerequisite
for an executable Phase-5 build plan.

## Open questions for the spec round

- Hermes-remote: pull or push credential delivery? Short-lived signed
  tokens vs. mTLS-only? (Affects what the Specifyr server has to know
  about each Hermes host.)
- Step-chat semantics on a remote: is the session bound to one Hermes
  host for its lifetime, or can it migrate? (Affects state location.)
- File-system surface: does the Hermes host see the project as a Git
  repo (clone + push back) or as a live bind mount (which the
  multi-tenant-isolation plan flagged as dangerous)?
- Does the `/run` scheduler also move to Hermes-remote, or does it stay
  a Specifyr-server orchestrator that fans out to per-task Hermes
  sessions?

## Related documents

- `docs/plans/2026-05-18-browser-mcp-spec-agent.md` — Phase 1–4 (parent)
- `docs/adrs/2026-05-18-browser-mcp-architecture.md` — original ADR
- `docs/plans/2026-05-18-untrusted-multi-tenant-isolation.md` — superseded;
  contains the threat-model material that informs Path A vs. Path B
