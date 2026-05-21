# Browser-side Spec Agent + Server REST Tool Surface

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **Status (2026-05-20):** Phases 0–2 complete; Phase 3 effectively skipped;
> Phase 4 cleanup blocked on a separate Step-Chat browser-MCP migration.
> Supersedes `2026-05-18-untrusted-multi-tenant-isolation.md`.
> Architecture decision: [`docs/adrs/2026-05-18-browser-mcp-architecture.md`](../adrs/2026-05-18-browser-mcp-architecture.md).
> Owner: tbd. Estimated effort revised to ~4–5 weeks delivered + a separate
> follow-up plan for the Step-Chat migration (see Phase 5 note below).
>
> - **Phase 1** landed in PRs #79, #80, #81, #82, #84. Notable deviations from
>   the original sketch are captured per task below.
> - **Phase 2** landed in PR #86 (commit `ef1d53b`, "browser-side spec agent
>   (UI + stores + tools)"). The browser composable, Pinia stores, tools,
>   provider-identity settings page, and chat host all shipped in one cut.
> - **Phase 3** was effectively skipped: no `useBrowserAgent` feature flag was
>   introduced because Phase 2 went directly to default. The new chat page
>   (`/specs/[orgSlug]/[projSlug]/chat.vue`) is the only Speckit chat path. No
>   data-migration script was needed (no pre-existing browser-side draft data
>   to import; existing on-disk specs are read via the unchanged
>   `read_existing_spec` tool).
> - **Phase 4** is **blocked**: the server-side `turn.post.ts` endpoint that
>   drives the *step-chat* UI (`/specs/[orgSlug]/[projSlug]/steps/[stepId].vue`)
>   still depends on `createSpeckitRunnerFactory` → `AcpRunner`. Removing the
>   ACP stack would break step-chat. The intended follow-up is to migrate
>   step-chat itself to a browser-MCP shape — tracked separately as Phase 5
>   in `docs/plans/2026-05-20-step-chat-browser-mcp.md`.

**Goal:** Den Speckit-Chat-Agent aus dem Specifyr-Server in den User-Browser verlagern. Der Server stellt nur eine schmale, getypte REST-Tool-Surface bereit und führt selbst keinen LLM- oder Agent-Code mehr aus.

**Architecture:** Browser nutzt Vercel AI SDK gegen einen User-konfigurierten Provider (Anthropic / OpenAI / OpenRouter / Google). Tool-Calls des LLMs landen als REST-Aufrufe gegen ein klar definiertes Specifyr-API-Endpoint-Set oder werden zunächst lokal in den Active-Session-Store des Browsers geschrieben. Quelle der Wahrheit für Drafts + Conversation-Historie ist Postgres; der Browser auto-PATCHt nach jedem fertigen Agent-Turn (mit Auto-Retry + exponential backoff bei Failure). Pro Projekt gibt es **einen aktuellen Public-State** (= canonical spec auf disk) sowie pro User N private Drafts. Publish ist eine optimistic-concurrency-Operation (compare-and-swap auf `spec_public_version`): wenn der Public-State sich seit Draft-Erstellung bewegt hat, muss der User den Konflikt manuell auflösen bevor Publish gelingt.

**Tech Stack:** Vercel AI SDK (`ai` 4.x) + Provider-Packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`), Nuxt 4 / Nitro für REST, Drizzle + Postgres für DB (Source of Truth für Drafts + Conversation), Pinia + `pinia-plugin-persistedstate` (persistiert nach `localStorage` — nur Provider-Identities + ephemerer Session-Cache) im Browser, Zod für Tool-Input-Validation.

---

## Motivation

Aktuell läuft `claude-agent-acp` als Child-Prozess im Specifyr-Container. Das hat drei kumulative Risiken:

1. **Cross-Tenant-Leak.** Bind-Mount `/data/projects` ist über alle Orgs sichtbar; ein Prompt-Injection-Bash-Call sieht jedes Org-Projekt.
2. **Server-Compromise via Agent.** Der Agent hat `/var/run/docker.sock`, Network zu Postgres, Env-Vars mit Credentials — eine Code-Execution-Vulnerability im Agent oder im LLM-Output ist effektiv Root am Host.
3. **Per-User-Race.** Zwei Org-Mitglieder am selben Projekt schreiben über dieselbe Bind-Mount; Arbeit eines Users überschreibt die des anderen ungebremst.

Container-Isolation (siehe superseded Plan) löst (1) und teilweise (2), aber nicht (3) ohne separate Per-User-Worktrees. **Browser-side Execution löst alle drei in einem Schritt**, weil:

- LLM und Tool-Definitions leben im Browser — Server hat keinen Code-Execution-Pfad mehr für LLM-Output.
- Plan-Drafts sind per-User (Server-side persisted, RLS-enforced), kein gemeinsam-schreibbarer Public-State außerhalb des CAS-Publish.
- Server-Operationen passieren nur über getypte REST-Endpoints, deren Implementation wir kontrollieren — keine `Bash`-Tool-Surface mehr für das LLM.

Hermes-Runtime-Agents (autonome, langlaufende Workflows) sind **außerhalb dieser Scope** und werden später auf separater Hardware deployt.

---

## Architektur

### Komponenten

```
┌────────────────────────────────────────────────────┐
│  Browser (User-Device)                              │
│                                                     │
│  ┌────────────────────────────────────────────┐    │
│  │ Speckit-Chat-UI (Vue 3 / Nuxt-Page)        │    │
│  │                                             │    │
│  │  ┌──────────────────────────────────────┐  │    │
│  │  │ Browser Agent (Vercel AI SDK)        │  │    │
│  │  │  - streamText({ model, tools })      │  │    │
│  │  │  - 7 Tools (6 REST + 1 local IDB)    │  │    │
│  │  └──────────────────────────────────────┘  │    │
│  │                                             │    │
│  │  ┌──────────────────────────────────────┐  │    │
│  │  │ Active-Session Pinia Store           │  │    │
│  │  │  - active draftId + fetched state    │  │    │
│  │  │  - in-flight stream buffer           │  │    │
│  │  │  - save-queue (auto-retry on fail)   │  │    │
│  │  │  (localStorage only as ephemeral     │  │    │
│  │  │   tab-reload cache; truth = server)  │  │    │
│  │  └──────────────────────────────────────┘  │    │
│  └────────────────────────────────────────────┘    │
│                                                     │
└─────────┬──────────────────────────────────┬───────┘
          │                                  │
          │ HTTPS (user-API-key)             │ HTTPS (session cookie)
          ▼                                  ▼
┌───────────────────────┐         ┌─────────────────────────────┐
│ Anthropic / OpenAI /  │         │ Specifyr Server              │
│ Google / OpenRouter   │         │  REST Tool Surface:          │
│                       │         │   GET  /files (list)         │
│                       │         │   GET  /files/<path>         │
│                       │         │   POST /search               │
│                       │         │   POST /spec-drafts          │
│                       │         │   PATCH /spec-drafts/<id>    │
│                       │         │                              │
│                       │         │  Kein LLM, kein Agent,       │
│                       │         │  kein Bash, kein Docker      │
│                       │         └─────────────────────────────┘
└───────────────────────┘
```

### Tool-Surface

Zwei Klassen:

**(A) LLM-Tools** — vom Browser-Agent während eines Turns aufgerufen, dem LLM via Vercel-AI-SDK `tools`-Parameter exposed:

| Tool | Backing | Input | Output |
|---|---|---|---|
| `list_files` | REST `GET /api/orgs/{orgSlug}/projects/{projSlug}/files?glob=*` | `{ glob?: string }` | `{ files: [{ path, size, type }] }` |
| `read_file` | REST `GET /api/orgs/{orgSlug}/projects/{projSlug}/files/{*path}` | `{ path: string }` | `{ content, encoding }` |
| `search_code` | REST `POST /api/orgs/{orgSlug}/projects/{projSlug}/search` (ripgrep) | `{ query, glob?, limit? }` | `{ matches: [{ path, line, snippet }] }` |
| `read_existing_spec` | REST `GET /api/orgs/{orgSlug}/projects/{projSlug}/spec-public-state` | `{ name?: string }` (specific file or all) | `{ files: [{ name, content }], version }` |
| `list_my_drafts` | REST `GET /api/orgs/{orgSlug}/projects/{projSlug}/spec-drafts/mine` | none | `{ drafts: [{ id, title, base_version, status, updated_at }] }` |
| `load_draft` | REST `GET /api/orgs/{orgSlug}/projects/{projSlug}/spec-drafts/{draftId}` | `{ draftId }` | `{ title, files, base_version, conversation }` |
| `update_draft_files` | **lokal** — Active-Session-Store-Write; wird nach Turn-Ende automatisch zum Server gePATCHt | `{ files: [{ name, content }] }` | `{ ok: true }` |

**(B) User-Actions** — vom UI ausgelöst, NICHT vom LLM aufrufbar:

| Aktion | Endpoint | Zweck |
|---|---|---|
| Publish | `POST /api/orgs/{orgSlug}/projects/{projSlug}/spec-drafts/{draftId}/publish` | Compare-and-swap `base_version` ↔ `spec_public_version`. Bei Match: Files nach disk schreiben, version inkrementieren, draft.status="published". Bei Mismatch: 409 mit Conflict-Diff. |
| Discard | `DELETE /api/orgs/{orgSlug}/projects/{projSlug}/spec-drafts/{draftId}` | Owner verwirft Draft. Hard-delete für `status="draft"`; `status="published"` → 409 (Audit-Trail immutable). |
| Retry Save | UI-Button (nur sichtbar wenn Auto-Save final fehlgeschlagen, siehe unten) | PATCH manuell erneut auslösen. |

**(C) Auto-Save (implicit, nicht user-triggered)** — Nach jedem fertigen Agent-Turn `PATCH /api/orgs/{orgSlug}/projects/{projSlug}/spec-drafts/{draftId}` mit `{ conversation, files }`. Bei Failure: 3 Auto-Retries mit exponential backoff (2s / 4s / 8s); danach Banner "Save failed — Retry" mit manuellem Button. Während ausstehender Saves hält der Browser den Turn im Active-Session-Store; bei Tab-Reload wird der Save fortgesetzt.

**Bewusst NICHT in der Surface:** kein `write_arbitrary_file`, kein `execute_command`, kein `git_*`, kein `npm_install`, kein `read_git_log`. Was ein autonomer Hermes-Agent später braucht, ist eine eigene, getrennte Surface auf separater Infra.

### Provider-Auswahl im Browser

User-Settings-Seite (`/settings/speckit-agent`) erlaubt Konfiguration **mehrerer Provider-Identities** mit einer aktiven:

```ts
type ProviderIdentity = {
  id: string,                     // local UUID
  label: string,                  // user-chosen, e.g. "My Anthropic Pro"
  provider: "anthropic" | "openai" | "google" | "openrouter",
  model: string,                  // free text, e.g. "claude-opus-4-7"
  apiKey: string,
  baseUrl?: string,
};

type IdentityStoreState = {
  identities: ProviderIdentity[],
  activeIdentityId: string | null,
};
```

**Storage:** Pinia-Store mit `pinia-plugin-persistedstate`. Identity-Payload klein (< 10 KB), persistiert nach `localStorage`. Kein AES-GCM-Encrypt mit Passphrase — die Komplexität wog die UX-Reibung nicht auf (Begründung: Threat-Model "Server-Compromise" ist abgedeckt, "Stolen-Device" ist Sache der OS-Disk-Encryption, "XSS-Exfiltration" durch strikte CSP-Header verhindert).

**Cross-Device:** Kein Sync. Pro Device einmaliges Setup. Server-Side-Storage der Keys ist explizit ausgeschlossen (das war das Kernversprechen des Pivots: Server sieht Provider-Keys nie).

**CSP-Anforderung:** `Content-Security-Policy: default-src 'self'; connect-src 'self' api.anthropic.com api.openai.com generativelanguage.googleapis.com openrouter.ai; ...`. Strikt, damit kein injizierter Script den Key zu einer Drittpartei sendet.

### Spec-Draft-Model

**Pro Projekt: ein aktueller Public-State + N private Drafts (eine pro User pro Initiative).**

```
                    ┌──────────────────────────────────┐
                    │ project.spec_public_version = 5   │
                    │ specs/spec.md, specs/planning.md  │  ← canonical files on disk
                    └──────────────────────────────────┘
                                ▲ Fast-Forward on Publish
                                │
                    ┌───────────┴───────────────────────────┐
                    │ Drafts (private, status="draft")       │
                    │                                         │
                    │ User A: draft #21 base_version=5  ←OK  │
                    │ User A: draft #22 base_version=4  ←needs rebase │
                    │ User B: draft #23 base_version=5  ←OK  │
                    └───────────────────────────────────────┘
```

**Storage:**
- **Server (Source of Truth):** Postgres-Tabellen `spec_drafts` + `spec_draft_files` halten den vollständigen Stand jedes Drafts inkl. `conversation` (JSON-Array, Vercel-AI-SDK-Format). Browser PATCHt nach jedem fertigen Agent-Turn automatisch.
- **Browser (Active-Session-Cache):** Pinia-Store mit `pinia-plugin-persistedstate` nach `localStorage`. Hält nur die **aktive Session** (gewählter Draft + In-Flight-Stream-Buffer + ausstehende Save-Queue) plus die Provider-Identities. Dient als Crash-Safety zwischen Tab-Reloads während ein Save fliegt — *keine* persistente Quelle. Bei Session-Start (User öffnet Speckit-Page oder wechselt Draft) wird der Cache durch ein fresh `GET /spec-drafts/{id}` ersetzt.
- **Cross-Device-Continuity:** kommt natürlich aus dem Server-First-Modell. User logged auf Gerät B ein → `GET /spec-drafts/mine` listet seine Drafts → wählt einen → Gerät B mountet Agent mit komplettem History-Kontext.

**Privacy:**
- `status="draft"` → nur Owner kann lesen (RLS: `owner_user_id = current_user_id`).
- `status="published"` → alle mit project-access sehen, ist Audit-Trail. Ein Draft wird zu `published` durch erfolgreichen Publish; danach bleibt er als History-Eintrag erhalten.

**Publish (Optimistic Concurrency):**
1. User klickt "Publish" auf seinem Draft (status="draft").
2. Server: lock project row, vergleiche `draft.base_version === project.spec_public_version`.
3. **Match:** Files atomisch nach `projects/<org>/<slug>/specs/` schreiben, `project.spec_public_version += 1`, `draft.status = "published"`. 201 Created.
4. **Mismatch:** 409 Conflict mit Body `{ currentPublicVersion, currentPublicFiles }`. UI zeigt Diff zwischen Draft und neuem Public-State. User reconcilet manuell im Draft (kann die neuen Public-Files lesen via `read_existing_spec`-Tool, eigenen Draft via `update_draft_files`-Tool anpassen). Der nächste fertige Agent-Turn auto-PATCHt; der User klickt dann nur noch "Publish" erneut. Beim erneuten Publish wird `base_version` aus dem aktuellen `spec_public_version` neu abgeleitet.

**Mehrere Drafts pro User:**
- Erlaubt. User kann "v1 attempt", "v2 alternative framing", etc. parallel haben.
- Jeder hat eigene `base_version`; alte Drafts werden zu rebase-Kandidaten, wenn Public-State sich bewegt.
- Maximal ein Draft pro User kann "in publish flight" sein (per Lock auf project row).

### Auth-Flow

- Browser ist via existierender Specifyr-Session-Cookie gegenüber dem Server authentifiziert (Authentik-OAuth läuft schon).
- Tool-REST-Calls aus dem Browser tragen den Session-Cookie → Server kennt `userId` + `ownerOrgId` über die übliche `project-access`-Middleware.
- LLM-Calls aus dem Browser gehen direkt an den Provider (Anthropic etc.) mit dem User-API-Key im Header. Specifyr-Server sieht diese Calls nie.

---

## Migration aus dem aktuellen Code

### Was bleibt

- Server: Auth, Org/User/Project-DB-Modell, file-system inside `dataDir/projects/<org>/<slug>/`, ripgrep für Search, Drizzle-Migrations.
- Browser: bestehende Specifyr-Nuxt-App, Component-Library, Auth-Flow.

### Was wird neu gebaut

- 5 REST-Endpoints für die Tool-Surface.
- DB-Tabelle `spec_drafts` (Drizzle-Migration via `pnpm drizzle-kit generate`, NIE Migration-SQL hand-editieren).
- Browser-Bundle für Speckit-Chat: Vercel AI SDK + Tool-Defs + Pinia-Stores (Provider-Identity browser-only via `pinia-plugin-persistedstate`/localStorage + Active-Session als write-through-Cache zum Server) + Streaming-UI mit Auto-Save-Indikator.
- Provider-Settings-Seite, die den Provider-Identity-Pinia-Store rendert.

### Was wird entfernt (Phase 4, nach Stabilisierung)

- `src/runners/acp.js` (AcpRunner) — wenn keine anderen Pfade davon abhängen
- `server/shared/utils/speckit-agent-runner.ts`
- TurnBroker-Plugin (`server/plugins/drain-turn-broker.ts` + Mitspieler)
- Speckit-Chat-Server-Endpoints (alle die `AcpRunner` aufrufen)
- `claude-agent-acp`, `codex-acp`, `gemini-cli` aus dem Specifyr-Dockerfile (kommen nicht mehr zum Einsatz)
- Anthropic-Proxy-Pfad für Speckit (bleibt nur für eventuelle andere Server-Side-Konsumenten — prüfen ob es welche gibt)

---

## Phasen

### Phase 0: Spec + ADR (1–2 Tage) — ✅ done



**Files:**
- Create: [`docs/adrs/2026-05-18-browser-mcp-architecture.md`](../adrs/2026-05-18-browser-mcp-architecture.md)
- Create: [`server/shared/utils/spec-tools-schemas.ts`](../../server/shared/utils/spec-tools-schemas.ts) — Zod sketch
- Create: [`app/lib/speckit-system-prompt.ts`](../../app/lib/speckit-system-prompt.ts) — v1 system prompt
- Modify: `docs/plans/2026-05-18-browser-mcp-spec-agent.md` (dieses Dokument, mit Review-Feedback)

**Aufgaben:**
1. ADR schreiben, das die Entscheidung "Browser statt Container" mit Threat-Model + Trade-offs dokumentiert (Bestandteil siehe Diskussions-Threads im PR von diesem Plan).
2. Tool-Schemas formal als Zod-Schema-Datei skizzieren — vor Implementation, weil das die REST-API-Form festlegt.
3. v1 System-Prompt für den Speckit-Agent als TypeScript-Konstante festlegen (siehe ADR "Resolved Phase-0 Design Questions / 3").

**Verification:** ADR + Plan-Dokument + Schema-Sketch + System-Prompt im Repo, beide Pläne (alt + neu) kreuzverlinkt.

**Commit:** `docs: ADR + zod schema sketch + system prompt for browser-side spec agent`

---

### Phase 1: REST Tool Surface (1.5–2 Wochen) — ✅ done

Server-side endpoints, jeweils TDD-first. All seven tasks landed across
PRs #79–#84, with several CR-driven hardening passes documented below.

**Landed endpoints (under `/api/orgs/:orgSlug/projects/:projSlug/`):**
| Method | Path | Backed by |
|---|---|---|
| GET    | `files`                          | `[slug]/projects/[projSlug]/files/index.get.ts` |
| GET    | `files/:path`                    | `files/[...path].get.ts` |
| POST   | `search`                         | `search.post.ts` |
| GET    | `spec-public-state`              | `spec-public-state.get.ts` |
| POST   | `spec-drafts`                    | `spec-drafts/index.post.ts` |
| GET    | `spec-drafts`                    | `spec-drafts/index.get.ts` (404 sink) |
| GET    | `spec-drafts/mine`               | `spec-drafts/mine.get.ts` |
| GET    | `spec-drafts/:draftId`           | `spec-drafts/[draftId].get.ts` |
| PATCH  | `spec-drafts/:draftId`           | `spec-drafts/[draftId].patch.ts` |
| DELETE | `spec-drafts/:draftId`           | `spec-drafts/[draftId].delete.ts` |
| POST   | `spec-drafts/:draftId/publish`   | `spec-drafts/[draftId]/publish.post.ts` |

**Stores:** `server/shared/utils/spec-draft-store.ts` +
`server/shared/utils/spec-public-state.ts`.

**Schemas:** `server/shared/utils/spec-tools-schemas.ts`. Phase 2 will
need these in the browser bundle — see the file's own header for the
"move to top-level `shared/`" guidance.

**Tests:** `tests/api/spec-tools.e2e.test.ts` covers all endpoints
(38 tests in this file alone).

#### Task 1.1: DB-Migration für Draft-Bundle + Public-Version — ✅ done (#79)

**Deviations from sketch:**
- Schema landed in the existing monolithic `server/shared/database/schema.ts` (not new per-table files) to match repo convention.
- `status` column gained a DB-level `CHECK ("status" IN ('draft', 'published'))` constraint (migration `0013_public_captain_britain.sql`) after CR pointed out that Drizzle's `enum:` option is TS-only.
- `conversation` is `jsonb` (default `'[]'::jsonb`), not `text` as originally sketched.
- RLS policies deferred — the store enforces ownership/visibility at the app layer instead (see store comments).


**Files:**
- Create: `server/shared/database/schema/spec-drafts.ts`
- Modify: `server/shared/database/schema/projects.ts` (add `spec_public_version`)
- Modify: `server/shared/database/schema/index.ts` (export)
- Generated (NIE hand-editieren — Drizzle verwaltet diese; `drizzle-kit generate` aus dem Schema heraus): `server/shared/database/migrations/NNNN_*.sql` + journal/snapshot

**Schema:**
```ts
export const specDrafts = pgTable("spec_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
  title: text("title").notNull(),                                // user-visible label
  status: text("status").$type<"draft" | "published">().notNull().default("draft"),
  baseVersion: integer("base_version").notNull(),                // public version this draft was forked from
  conversation: text("conversation").notNull().default("[]"),    // JSON array, Vercel-AI-SDK message format
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }), // nullable, set on publish
}, (table) => ({
  byProjectOwner: index().on(table.projectId, table.ownerUserId),
  byProjectStatus: index().on(table.projectId, table.status),
}));

export const specDraftFiles = pgTable("spec_draft_files", {
  draftId: uuid("draft_id").notNull().references(() => specDrafts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                                  // e.g. "spec.md"
  content: text("content").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.draftId, table.name] }),
}));

// In projects schema:
// + specPublicVersion: integer("spec_public_version").notNull().default(0)
```

**Steps:**
1. Schema-Dateien schreiben (spec-drafts.ts neu, projects.ts erweitern).
2. `pnpm drizzle-kit generate` ausführen → Migration wird generiert.
3. RLS-Policies in SEPARATER Migration (Drizzle generiert sie nicht). Beispiele:
   - `spec_drafts`: `(status = 'published' AND project_id IN (SELECT id FROM projects WHERE user_has_project_access(current_setting('app.current_user_id')::uuid, id))) OR (status = 'draft' AND owner_user_id = current_setting('app.current_user_id')::uuid)`
   - `spec_draft_files`: über `draft_id` join auf `spec_drafts`-Policy.
4. `pnpm dev:docker` starten, Migration läuft, Tabellen + RLS existieren.

**Verification:** zwei Test-User in zwei verschiedenen Sessions versuchen jeweils, des anderen status="draft"-Row zu lesen — `SELECT` returnt 0 rows.

**Commit:** `feat(db): spec drafts + public version for browser-side agent`

#### Task 1.2: `GET /api/orgs/{orgSlug}/projects/{projSlug}/files` — List — ✅ done (#79)

**Deviations from sketch:** uses Node's built-in `fs.glob` (Node 22+) instead of `fast-glob`. Drops the `size` field from the output (deferred — unused, and stat-per-dirent doubled the work). Adds `truncated: boolean` so the LLM cannot silently assume the listing was exhaustive. `safeGlob` rejects absolute paths (CR-#79).


**Files:**
- Create: `server/api/projects/[id]/files/index.get.ts`
- Test: `tests/api/projects/files-list.test.ts`

**Step 1: Failing test**
```ts
it("lists files within the project directory only", async () => {
  // setup: project with files A, B; second project with file C
  const res = await fetch(`/api/projects/${projectId}/files`, { headers: authHeaders });
  const json = await res.json();
  expect(json.files.map(f => f.path).sort()).toEqual(["A.md", "B.md"]);
  expect(json.files.find(f => f.path === "C.md")).toBeUndefined();
});

it("rejects path traversal in glob param", async () => {
  const res = await fetch(`/api/projects/${projectId}/files?glob=../../**`, { headers: authHeaders });
  expect(res.status).toBe(400);
});
```

**Step 2: Implement endpoint**
- Use `project-access` middleware (existiert) für Authz.
- Validate `glob` via Zod, reject `..` und absolute Pfade.
- `fast-glob` mit `cwd` = project-dir, `dot: false`, `onlyFiles: false`.

**Step 3: Verify both tests pass.**

**Commit:** `feat(api): list project files endpoint`

#### Task 1.3: `GET /api/orgs/{orgSlug}/projects/{projSlug}/files/{*path}` — Read — ✅ done (#80)

**Deviations from sketch:** path traversal closed with `fs.open(O_RDONLY | O_NOFOLLOW)` so the size check, realpath check, and read all bind to the same FileHandle — closes the TOCTOU window that the original lstat→realpath→readFile sequence had (CR-#80). 1 MiB cap. Heuristic UTF-8 vs base64 by null-byte presence + strict decode.


**Files:**
- Create: `server/api/projects/[id]/files/[...path].get.ts`
- Test: `tests/api/projects/files-read.test.ts`

**Critical:** Path-Traversal-Schutz ist **die zentrale Security-Boundary**. Test muss explizit `..` und symlinks abdecken.

**Tests:**
- Read normaler Datei
- Reject `../../etc/passwd`
- Reject Symlinks außerhalb des Projekt-Roots (via `fs.realpath` + Vergleich mit `project-dir`)
- Reject Pfade die nicht im project-dir sind

**Implementation (as shipped in #80):** `fs.open(absolutePath, O_RDONLY | O_NOFOLLOW)` opens the leaf without following a final symlink and binds size check, realpath check and read to the same `FileHandle` — that closes the TOCTOU window an earlier `lstat → realpath → readFile` sequence would have left open. Realpath of the opened handle is then compared against the project-dir; reject if the relative path starts with `..` or is absolute. (The resolve+realpath+relative sketch above is the original design and is kept for context; the implementation supersedes it.)

**Commit:** `feat(api): read project file endpoint with path-traversal protection`

#### Task 1.4: `POST /api/orgs/{orgSlug}/projects/{projSlug}/search` — Code Search — ✅ done (#81)

**Deviations from sketch:** Spawns `rg --json -F` (fixed-strings, so the LLM doesn't have to reason about regex escaping; `(.*)` no longer means anything special). `--no-config` to ignore user-level rg config. Argv array (no shell). Stream stdout, kill process at `limit` matches. `ripgrep` added to the Alpine base image so prod ships with it.


**Files:**
- Create: `server/api/projects/[id]/search.post.ts`
- Test: `tests/api/projects/search.test.ts`

**Implementation:** Spawn `rg --json --glob ... query` im project-dir, parse Output, limitieren auf z.B. 100 Matches. ripgrep ist bereits im Specifyr-Dockerfile installiert (per `apk add ripgrep` oder analog).

**Tests:**
- Search findet known content
- Honors glob filter
- Limits result count
- Reject query mit shell-metacharacters? — eigentlich nicht nötig, weil wir argv-Array nutzen, kein shell. Aber Test trotzdem als Doku.

**Commit:** `feat(api): code search endpoint via ripgrep`

#### Task 1.5: Spec-Draft CRUD-Endpoints — ✅ done (#82)

**Deviations from sketch:**
- All six routes land under `server/projects/api/orgs/[slug]/projects/[projSlug]/spec-drafts/` (org-scoped layout, not the sketch's `/api/projects/[id]/…`).
- Store lives at `server/shared/utils/spec-draft-store.ts`.
- Visibility model surfaced in the store comments: `status='draft'` is owner-only with **404 masking** (we don't leak existence to non-owners); `status='published'` is visible to any project-access caller.
- `deleteDraft` is single-statement DELETE with status filter in WHERE — race-safe against a concurrent publish flipping the row (CR-#82). The follow-up SELECT only fires when 0 rows were deleted, to distinguish 404 from 409.


**Files:**
- Create: `server/api/projects/[id]/spec-drafts/index.post.ts` (create new draft)
- Create: `server/api/projects/[id]/spec-drafts/index.get.ts` — wirft 404, weil "alle Drafts" sinnlos ist
- Create: `server/api/projects/[id]/spec-drafts/mine.get.ts` (list my drafts)
- Create: `server/api/projects/[id]/spec-drafts/[draftId].get.ts` (read single draft + files + conversation)
- Create: `server/api/projects/[id]/spec-drafts/[draftId].patch.ts` (update existing — "Save to Server")
- Create: `server/api/projects/[id]/spec-drafts/[draftId].delete.ts` (discard)
- Test: `tests/api/projects/spec-drafts-crud.test.ts`

**Endpoint-Semantik:**
- `POST /spec-drafts` mit `{ title, baseVersion, files, conversation }` → 201, `{ draftId, updatedAt }`. `baseVersion` muss <= `project.spec_public_version` sein.
- `GET /spec-drafts/mine` → `{ drafts: [{ id, title, baseVersion, status, updatedAt, publishedAt }] }` für caller's drafts in diesem Projekt.
- `GET /spec-drafts/{id}` → `{ title, files, baseVersion, conversation, status }`. Owner kann always lesen; Published auch für andere; Draft fremder User: 404.
- `PATCH /spec-drafts/{id}` mit `{ title?, files?, conversation? }`. Owner only. Setzt `updatedAt`. Files-Update ersetzt den ganzen Bundle (vereinfacht Diff-Tracking). `baseVersion` ist hier *nicht* änderbar — beim Conflict-Resolution-Flow re-derived der Publish-Endpoint die `baseVersion` aus dem aktuellen `spec_public_version` (siehe Publish-Semantik unten), der Browser muss nicht explizit rebasen.
- `DELETE /spec-drafts/{id}` — Owner only, nur wenn `status="draft"` (published kann nicht gelöscht werden für Audit-Trail).

**Tests (TDD, je Endpoint einzeln):**
- POST mit `baseVersion > spec_public_version` → 400
- User A kann User B's draft (status="draft") NICHT lesen → 404
- Published drafts: andere User-im-Projekt sehen sie → 200
- PATCH von fremdem User → 403
- DELETE von published → 409 ("cannot delete published draft")

**Commits (5 separate, einer pro Endpoint, jeweils TDD):**
- `feat(api): create spec draft`
- `feat(api): list my spec drafts`
- `feat(api): get spec draft`
- `feat(api): patch spec draft (owner only)`
- `feat(api): delete spec draft (owner only, drafts only)`

#### Task 1.6: Publish-Endpoint mit Compare-and-Swap — ✅ done (#84)

**Deviations from sketch:**
- Both `projects` row AND `specDrafts` row are `SELECT FOR UPDATE` inside the tx. The draft lock blocks the owner's concurrent PATCH/DELETE from racing the publish (CR-#83).
- `currentPublicFiles` is read INSIDE the publish tx and returned as part of the conflict result — the version + files pair therefore comes from one atomic moment under the project lock (CR-#83).
- Final `status='published'` UPDATE keeps the `owner + status='draft'` filter and verifies one row was affected — a row that snuck under the row lock would have left the draft published-or-gone, so the publish rolls back rather than committing a half-done snapshot.
- Disk-write happens inside the tx; if it throws the tx rolls back and disk is left in a partial state the next publish overwrites. Accepted Phase-1 narrow window, documented in `spec-public-state.ts`.
- File names re-validated against a flat-name contract at the disk boundary (`writePublicSpecFiles`) — defense in depth, the wire-boundary Zod check is the primary guard (CR-#83).


**Files:**
- Create: `server/api/projects/[id]/spec-drafts/[draftId]/publish.post.ts`
- Create: `server/shared/utils/spec-publish.ts` (transactional logic)
- Test: `tests/api/projects/spec-drafts-publish.test.ts`

**Logik (Option A — DB-first-commit, disk-rename-after):**
```ts
// In a transaction:
1. SELECT spec_public_version FROM projects WHERE id = :projectId FOR UPDATE;
2. SELECT base_version, files FROM spec_drafts JOIN spec_draft_files WHERE id = :draftId AND owner = :user AND status = "draft";
3. IF draft.base_version != project.spec_public_version: ROLLBACK, return 409 with { currentPublicVersion, currentPublicFiles }
4. Validate every file.name (no "..", no absolute path) und schreibe alle Files in ein per-Publish tmp-Verzeichnis: specs/.tmp/<publish-id>/<name>.
5. UPDATE projects SET spec_public_version = spec_public_version + 1 WHERE id = :projectId;
6. UPDATE spec_drafts SET status = "published", published_at = NOW() WHERE id = :draftId;
7. COMMIT.
// Post-commit (project row lock released — the rename happens outside the tx):
8. fs.renameSync(specs/.tmp/<publish-id>/*, specs/<name>) — atomarer Move pro File.
9. Bei Fehler in Schritt 8 (sollte nicht passieren wenn tmp + final auf gleichem FS): rm -rf specs/.tmp/<publish-id>, log + alert; DB ist bereits committed, also Output ist published — Operator-Recovery nötig.
```

**Warum diese Reihenfolge:** Disk-Write *vor* COMMIT wäre falsch (Crash zwischen Disk-Write und COMMIT → Disk hat neue Spec, DB nicht → Lost-Update). Disk-Write nach COMMIT lässt das Lock-Fenster minimal und der einzige Failure-Modus (rename zwischen tmp und specs/ auf demselben FS) ist praktisch ausgeschlossen.

**Critical:**
- Path-Traversal-Schutz: `name`-Field jedes Files validieren (kein `..`, kein absoluter Pfad), *bevor* tmp-Files geschrieben werden.
- tmp-Pfad bleibt innerhalb von `projects/<org>/<slug>/specs/.tmp/`, ist also auf gleichem Filesystem wie das Ziel → `rename` ist atomar.

**Tests:**
- Happy path: 2 Files Draft → Publish → specs/ contains both, version inkrementiert, draft.status="published"
- Conflict: User A & B fork von version=5; A publishes (succ, version=6); B publishes → 409 mit B's draft.base_version=5 vs. current=6
- Disk-write fail (z.B. permission) → DB rollback, draft bleibt draft
- User tries to publish another user's draft → 403
- Re-publish einer bereits published Drafts → 409 oder 400

**Commit:** `feat(api): publish spec draft with optimistic concurrency`

#### Task 1.7: `GET /api/orgs/{orgSlug}/projects/{projSlug}/spec-public-state` — Read Current Public State — ✅ done (#84)

**Deviations from sketch:**
- Uses a **stabilization read** pattern: `version → files → version`, retry on mismatch. Returns 503 after 5 retries rather than emit an inconsistent pair under a hot publish loop (CR-#83). Promise.all would have allowed cross-moment snapshots.
- Public state lives on disk under `<projectRoot>/specs/`; version lives in `projects.spec_public_version`. Disk = canonical content, DB version = "which version produced what's on disk".


**Files:**
- Create: `server/api/projects/[id]/spec-public-state/index.get.ts`
- Create: `server/api/projects/[id]/spec-public-state/[name].get.ts` (single file)
- Test: `tests/api/projects/spec-public-state.test.ts`

**Semantik:**
- `GET /spec-public-state` → `{ version, files: [{ name, content }] }` für ALLE files in `specs/`.
- `GET /spec-public-state/{name}` → `{ version, name, content }` für einen einzelnen File.
- Version-Counter kommt aus `projects.spec_public_version`. Browser nutzt das als `baseVersion` bei neuen Drafts.

**Path-Traversal-Schutz** für `name`-Param analog Task 1.3.

**Tests:**
- Project ohne Specs (specs/ leer) → `{ version: 0, files: [] }`
- Specs vorhanden → korrekte Files + Version
- name mit `..` → 400

**Commit:** `feat(api): read current public spec state`

---

### Phase 2: Browser Agent (2–2.5 Wochen) — ✅ done (PR #86)

**Entry checklist for a fresh session:**

- Branch from `main`. Most recent Phase-1 PR is #84; main contains the
  full REST surface listed in the Phase 1 table above.
- Browser bundle will need to call the typed REST surface. The Zod
  schemas in `server/shared/utils/spec-tools-schemas.ts` are written
  to be portable; the file's header notes the "move to top-level
  `shared/` directory" option for Nuxt 4 dual-import. Make that call
  in Task 2.5 before importing them client-side.
- The browser only talks to two destinations: the LLM provider (with
  the user's own API key, never via our server) and our REST surface
  (via session cookie). CSP in Task 2.1 must allowlist exactly those
  hostnames.
- Active-Session store is **ephemeral cache only** — Postgres is the
  source of truth. Auto-PATCH after each completed agent turn; see
  the architecture section above.

#### Task 2.1: Dependencies + CSP-Headers

**Files:**
- Modify: `package.json` (add `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `pinia`, `@pinia/nuxt`, `pinia-plugin-persistedstate`)
- Modify: `nuxt.config.ts` (CSP-Headers in nitro routeRules; `@pinia/nuxt` zu `modules` hinzufügen)
- Create: `app/plugins/pinia-persist.client.ts` (registriert `pinia-plugin-persistedstate` als Pinia-Plugin; default-Storage = `localStorage`)

**CSP:**
```ts
nitro: {
  routeRules: {
    "/projects/**": {
      headers: {
        "Content-Security-Policy": [
          "default-src 'self'",
          "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://openrouter.ai",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",  // tailwind
          "img-src 'self' data:",
        ].join("; "),
      },
    },
  },
}
```

**Verification:** Browser DevTools → Network → Response Headers zeigen CSP. Test im Browser: `fetch("https://evil.com")` aus Speckit-Page wird vom Browser blockiert.

**Commit:** `feat(speckit): deps + strict CSP for browser agent`

#### Task 2.2: Provider-Identity Pinia Store (Multi-Identity)

**Files:**
- Create: `app/stores/provider-identity.ts`
- Test: `tests/unit/provider-identity-store.test.ts` (vitest mit `@pinia/testing` + fake `localStorage`)

**Store-Skizze:**
```ts
export const useProviderIdentityStore = defineStore("speckit-provider-identity", {
  state: () => ({
    identities: [] as ProviderIdentity[],
    activeIdentityId: null as string | null,
  }),
  getters: {
    active: (s) => s.identities.find((i) => i.id === s.activeIdentityId) ?? null,
  },
  actions: {
    add(identity: Omit<ProviderIdentity, "id">): string { /* push, return new id */ },
    update(id: string, patch: Partial<ProviderIdentity>) { /* ... */ },
    remove(id: string) { /* splice; if active → null */ },
    setActive(id: string | null) { /* assign */ },
  },
  persist: {
    storage: localStorage,
    pick: ["identities", "activeIdentityId"],
  },
});
```

Persistierung auf `localStorage` ist hier OK (Payload < 10 KB).

**Tests:**
- add → identities enthält neuen Eintrag mit generierter ID
- setActive(id) → `active`-Getter returnt diese identity
- remove(activeId) → `active` ist `null`
- update preserves other fields
- Persistierung: Store-Instanz #2 lädt den State von #1 zurück

**Commit:** `feat(speckit): pinia provider identity store`

#### Task 2.3: Settings-Page für Provider-Identities

**Files:**
- Create: `app/pages/settings/speckit-agent.vue`
- Create: `app/components/speckit/ProviderIdentityList.vue`
- Create: `app/components/speckit/ProviderIdentityForm.vue`

**UI:**
- Liste der konfigurierten Identities mit Active-Badge
- Pro Eintrag: Edit / Delete / Set Active
- "+ Add Identity"-Button öffnet Form
- Form-Felder: Label, Provider-Dropdown, Model (free text), API-Key (type=password), Base-URL (optional)
- Save schließt Form, refresht Liste

**Commit:** `feat(ui): speckit provider identity settings page`

#### Task 2.4: Active-Session Pinia Store

Hält **eine** aktive Draft-Session pro Tab. Server ist Source of Truth; dieser Store ist write-through-Cache + ephemerer Crash-Buffer.

**Files:**
- Create: `app/stores/active-session.ts`
- Test: `tests/unit/active-session-store.test.ts`

**Datenmodell (im Store):**
```ts
type ActiveSession = {
  draftId: string,                   // server draft id
  projectId: string,
  title: string,
  baseVersion: number,
  files: Record<string, string>,     // name → content
  conversation: Message[],           // Vercel-AI-SDK format
  status: "draft" | "published",
  serverUpdatedAt: string,           // last known server timestamp
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; attempt: 1 | 2 | 3 }
  | { kind: "retrying"; nextAttemptAt: number; attempt: 1 | 2 | 3 }
  | { kind: "failed"; reason: string };
```

**Store-Skizze:**
```ts
export const useActiveSessionStore = defineStore("speckit-active-session", {
  state: () => ({
    session: null as ActiveSession | null,
    saveState: { kind: "idle" } as SaveState,
    pendingSave: false,              // true = changes since last successful PATCH
  }),
  actions: {
    // Session lifecycle
    async openDraft(projectId: string, draftId: string) {
      // GET /spec-drafts/{draftId} → replace session, reset saveState
    },
    closeSession() {
      // clear session + saveState; keep localStorage cache until next openDraft
    },

    // Mutations (called by tools / agent loop)
    updateFiles(files: Record<string, string>) {
      // mutate session.files, set pendingSave=true
    },
    appendTurn(turn: Message) {
      // mutate session.conversation, set pendingSave=true
    },

    // Auto-save (called by composable after each completed turn)
    async commitTurn() {
      // PATCH /spec-drafts/{draftId} with { conversation, files }
      // on success: pendingSave=false, saveState=idle, update serverUpdatedAt
      // on failure: schedule retry (2s, 4s, 8s); after 3 fails → saveState=failed
    },
    async retrySaveNow() {
      // user-triggered retry from the failure banner
    },
  },
  persist: {
    storage: localStorage,
    pick: ["session", "pendingSave"],  // saveState is volatile
  },
});
```

**Begründung Active-Session als ein einzelnes Slot statt Map:** Pro Tab gibt es genau einen aktiven Draft. Mehrere Drafts gleichzeitig zu cachen war im alten Modell sinnvoll (Browser = Truth), ist im Server-First-Modell unnötiger State.

**Tests** (vitest, `@pinia/testing`, gemockter `$fetch`, jsdom-eigenes `localStorage`, fake timers für Backoff):
- `openDraft` → fetched GET, ersetzt session
- `appendTurn` → conversation wächst, pendingSave=true
- `updateFiles` → files-Map ersetzt, pendingSave=true
- `commitTurn` success → PATCH gerufen, pendingSave=false, saveState=idle
- `commitTurn` fail × 3 → 3 Retries mit Backoff (fake timers), dann saveState=failed
- `commitTurn` fail × 2, dann success bei Retry 3 → pendingSave=false, saveState=idle
- `retrySaveNow` reset saveState und ruft PATCH erneut
- Persistierung: Store-Reset → localStorage-Reload bringt session + pendingSave zurück (saveState bleibt "idle")

**Commit:** `feat(speckit): active-session pinia store with auto-save + retry`

#### Task 2.5: Browser Tool Definitions

**Files:**
- Create: `app/lib/speckit-tools.ts`
- Test: `tests/unit/speckit-tools.test.ts`

Definiert die 7 LLM-Tools für Vercel AI SDK (siehe Tool-Surface oben). Input-Schemas werden aus dem in Phase 0 angelegten [`server/shared/utils/spec-tools-schemas.ts`](../../server/shared/utils/spec-tools-schemas.ts) importiert (oder via Move nach `shared/` cross-importiert — Entscheidung in Task 2.1). Beispiel:

```ts
import { tool } from "ai";
import { listFilesInput, updateDraftFilesInput } from "...spec-tools-schemas";
import { useActiveSessionStore } from "~/stores/active-session";

export function buildSpeckitTools(ctx: { projectId: string }) {
  const session = useActiveSessionStore();
  return {
    list_files: tool({
      description: "List files in the current project, optionally filtered by glob",
      inputSchema: listFilesInput,
      execute: async ({ glob }) =>
        $fetch(`/api/projects/${ctx.projectId}/files`, { query: { glob } }),
    }),
    update_draft_files: tool({
      description: "Update the current draft's files. Replaces the named file's content. Use this to write spec content.",
      inputSchema: updateDraftFilesInput,
      execute: ({ files }) => {
        // LOCAL only — writes to active-session store. The composable
        // will commitTurn() to the server after the turn finishes.
        const fileMap = Object.fromEntries(files.map((f) => [f.name, f.content]));
        session.updateFiles(fileMap);
        return { ok: true, files: files.map((f) => f.name) };
      },
    }),
    // ... read_file, search_code, read_existing_spec, list_my_drafts, load_draft
  };
}
```

**Tests:** Für jedes Tool: mock `$fetch` + Pinia-Test-Store, verify dass die korrekten Calls gemacht werden.

**Commit:** `feat(speckit): browser-side tool definitions`

#### Task 2.6: Browser-Agent Composable

**Files:**
- Create: `app/composables/useSpeckitAgent.ts`
- Test: `tests/unit/use-speckit-agent.test.ts`

**API:**
```ts
const {
  session,            // Ref<ActiveSession | null>
  saveState,          // Ref<SaveState> — drives the save indicator
  isStreaming,        // Ref<boolean>
  currentToolCall,    // Ref<ToolCall | null>
  sendMessage,        // (text: string) => Promise<void>
  cancel,             // () => void
  publish,            // () => Promise<{ ok } | { conflict: ConflictInfo }>  — User-Action
  retrySave,          // () => Promise<void> — wired to "Save failed — Retry" banner
} = useSpeckitAgent({ projectId, draftId });
```

Internally:
- Auf Mount: `useActiveSessionStore().openDraft(projectId, draftId)` (GET /spec-drafts/{id}).
- Lädt aktive Provider-Identity via `useProviderIdentityStore().active`.
- Konstruiert `streamText({ model: providerForIdentity(active), tools: buildSpeckitTools({ projectId }), messages: session.conversation, system: SPECKIT_SYSTEM_PROMPT })`.
- Während des Streams: `appendTurn` auf den Store für jedes Message-Delta (für UI-Reaktivität). pendingSave=true.
- **Nach Turn-Ende** (Stream onFinish): `useActiveSessionStore().commitTurn()` → PATCH mit `{ conversation, files }`. Failure-Pfad → 3 Auto-Retries mit Backoff (2s/4s/8s) intern im Store; nach final fail `saveState=failed` → UI rendert Banner mit `retrySave`-Button.
- `publish()` setzt voraus, dass `pendingSave === false` (oder triggert vorher `commitTurn`); dann `POST /spec-drafts/{draftId}/publish`; bei 409 returnt ConflictInfo (UI rendert Diff).

**Tests:** Mock-Provider via Vercel AI SDK's `MockLanguageModelV1`. Verify:
- Happy path: text + tool_call + result → conversation im Store komplett, nach onFinish PATCH gerufen, saveState=idle
- Cancel mid-stream → Store-State konsistent (kein partial turn committed)
- Tool-Error → in Conversation als error-message, Stream geht weiter
- Network-Fail bei commitTurn → 3 Retries mit Backoff, dann saveState=failed; retrySave triggert PATCH erneut
- Publish-Conflict → returnt ConflictInfo statt zu throwen
- Publish bei pendingSave=true → wartet auf commitTurn vorher

**Commit:** `feat(speckit): browser agent composable`

#### Task 2.7: Speckit-Chat-Page UI

**Files:**
- Modify: `app/pages/projects/[orgSlug]/[slug]/specs/index.vue`
- Create: `app/components/speckit/ChatPanel.vue`
- Create: `app/components/speckit/DraftSidebar.vue` (list local + server drafts)
- Create: `app/components/speckit/ToolCallBadge.vue`
- Create: `app/components/speckit/PublishDialog.vue` (conflict-resolution UI)

**UI-Flow:**
- Page-Load: load active identity + project's public-state + my server-drafts via REST.
- Sidebar: Liste **aller** meiner Server-Drafts in diesem Projekt (kein "local-only"-Konzept mehr — Server ist Truth), "New Draft"-Button basiert neuer auf aktuellem public-state, danach `openDraft` für den neuen Draft.
- Center: ChatPanel mit streaming-Messages + Tool-Call-Badges. Auf Page-Load: `useActiveSessionStore().openDraft(projectId, draftId)`.
- Toolbar:
  - Save-Indikator (read-only): `{ idle: "Saved", saving: "Saving…", retrying: "Retrying in 4s (2/3)…", failed: "Save failed — Retry" }` ← reaktiv auf `saveState`.
  - "Publish" (disabled wenn `saveState ≠ idle` oder `pendingSave`).
- Conflict-Dialog: Diff-View "your draft vs new public state", User editiert oder cancelt.

Feature-Flag `useBrowserAgent` toggled zwischen altem Server-Side-Chat und neuem Browser-Agent.

**Commit:** `feat(ui): browser-side speckit chat page`

---

### Phase 3: Migration + Feature Flag — ⏭️ skipped

Phase 2 went directly to default. No `useBrowserAgent` flag was added because
the new chat page (`chat.vue`) is wired as a parallel route, not a replacement
for an existing server-side chat — so there was nothing to toggle between. No
data-migration script was needed; existing on-disk specs are read via the
`read_existing_spec` tool and converted into drafts on-demand by the user via
the normal "New Draft" flow.

Sub-tasks below are retained for historical context but were not executed.

#### Task 3.1: Feature-Flag in App-Config — ⏭️ skipped

**Files:**
- Modify: `nuxt.config.ts` (`runtimeConfig.public.useBrowserAgent`)
- Modify: `app/pages/projects/[orgSlug]/[slug]/specs/index.vue` (toggle between old/new)

**Commit:** `feat: feature flag for browser-agent rollout`

#### Task 3.2: Data-Migration für existierende Speckit-Plans

**Files:**
- Create: `scripts/migrate-existing-specs-to-drafts.ts`

Existierende Specs liegen als Files unter `projects/<org>/<slug>/specs/`. Beim ersten Login eines Users in einem migrierten Projekt: optional „import existing spec as draft" — One-shot, nicht automatisch.

**Commit:** `chore(migration): import existing specs as drafts script`

#### Task 3.3: Browser-Agent als Default umstellen

**Files:**
- Modify: `nuxt.config.ts` (Default `useBrowserAgent = true`)

Nach 1–2 Wochen Beta mit Volunteers. Rollback-Switch bleibt für 1 weitere Woche.

**Commit:** `chore: default speckit chat to browser agent`

---

### Phase 4: Cleanup — ⏸️ blocked on step-chat migration

**Original precondition:** Phase 3 stable for 2+ weeks. Superseded by a
concrete blocker discovered during the 2026-05-20 cleanup attempt:

The `server/projects/api/orgs/[slug]/projects/[projSlug]/steps/[stepId]/sessions/[sid]/turn.post.ts`
endpoint — used by the step-chat UI at `app/pages/specs/[orgSlug]/[projSlug]/steps/[stepId].vue` —
calls `createSpeckitRunnerFactory()`, which spawns `AcpRunner`. The
step-chat UI is **not Speckit**; it is the per-workflow-step chat that
predates the browser-MCP pivot. The Phase-1 architectural sketch implicitly
assumed step-chat would either also be migrated or be retired by Phase 4
time. Neither has happened.

`src/core/run-scheduler.js` (driving `/run/start.post.ts`) is independently
ACP-aware via `fallbackChain: ["hermes", "acp:codex"]`, but
`HermesStreamingRunner.isAvailable()` currently probes for a *local*
binary — the "Hermes on a remote host" architecture the user wants is also
not yet built. So the `/run` feature still requires the ACP fallback today.

**Unblocking path** (tracked in
[`docs/plans/2026-05-20-step-chat-browser-mcp.md`](2026-05-20-step-chat-browser-mcp.md)):
migrate `steps/[stepId].vue` to the same browser-MCP shape that
`chat.vue` already has (Phase 5a), then delete the `run.vue` /
`RunScheduler` in-app task-execution stack along with the rest of the
ACP code (Phase 5b). In-app task execution goes away entirely — that
job belongs to Hermes running on remote hosts (Hermes implementation
lives in `src/runners/hermes-*`; it's part of this repo, just deployed
elsewhere). The git-push handoff between Speckit and Hermes is a
separate Phase 6.

**Voraussetzung (original):** Phase 3 ist seit mindestens 2 Wochen in Produktion ohne Rollback.

#### Task 4.1: Server-Side Speckit-Agent-Code entfernen

**Files (entfernen):**
- `src/runners/acp.js`, `src/runners/claude-code.js`, `src/runners/claude-stream-to-acp.js`
- `server/shared/utils/speckit-agent-runner.ts`
- `server/plugins/drain-turn-broker.ts`
- Alle `server/api/chat/...`-Endpoints die `AcpRunner` aufrufen
- Test-Fixtures dazu

**Vorsicht:** vorher grep, ob andere Pfade davon abhängen (z.B. die Hermes-Runtime nutzt davon nichts, aber genau prüfen). Wenn ja: Refactor vor dem Löschen.

**Commit:** `chore: remove server-side speckit agent execution`

#### Task 4.2: `claude-agent-acp` aus Specifyr-Dockerfile entfernen

**Files:**
- Modify: `Dockerfile` (entferne die `npm install -g @agentclientprotocol/...`-Block)

**Commit:** `chore(docker): drop claude-agent-acp from server image`

#### Task 4.3: Feature-Flag entfernen

**Files:**
- Modify: `nuxt.config.ts` (Flag weg)
- Modify: relevante UI-Stellen

**Commit:** `chore: remove feature flag after browser-agent stable`

---

## Risiken + Offene Fragen

### Bekannte Risiken

| Risiko | Wahrscheinlichkeit | Mitigation |
|---|---|---|
| Browser-CORS-Restrictions verhindern direkte Anthropic-Calls | hoch | Anthropic erlaubt mit `anthropic-dangerous-direct-browser-access: true`. Vercel AI SDK setzt das automatisch. |
| Provider-API-Key landet in `localStorage` → XSS-Vektor | mittel | Strikte CSP-Header (`connect-src` whitelist), Zod-validierte User-Inputs, keine User-HTML-Render-Pfade im Speckit-Bundle. AES-GCM-mit-Passphrase bewusst abgelehnt (siehe ADR). |
| Tool-Call-Latenz fühlt sich langsam an | mittel | Batch-Tool-Endpoint als Fallback wenn UX-Tests es zeigen. |
| Spec-Quality schlechter als heute (anderes Tool-Set) | mittel | A/B mit Beta-User für 2 Wochen vor Default-Switch. Detaillierte Tool-Descriptions + System-Prompt-Tuning. |
| Auto-Save schlägt mit allen 3 Retries fehl, User schließt Tab | niedrig | localStorage hält pendingSave-Flag + komplette Session bis next-open; Banner "Save failed — Retry" beim Wiederbetreten desselben Drafts. Datenverlust nur, wenn User den Cache vorher manuell löscht. |
| Multi-Device-Edit-Race (User A öffnet Draft auf Gerät 1 + Gerät 2, editiert beide) | niedrig | Last-write-wins per PATCH (kein If-Match in v1). Selten genug, dass Coordination-Overhead nicht lohnt; bei realer Häufung später Session-Lock oder updatedAt-Mismatch-Detection. |
| Conversation-JSON wächst unbeschränkt in Postgres | niedrig | Per `updatedAt`-Pruning oder Per-Turn-Cap (z.B. letzte 200 Turns) in einem späteren Release. Initial unbeschränkt. |

### Geklärte Entscheidungen (aus Walkthrough mit Stakeholder, 2026-05-18)

| Frage | Entscheidung | Begründung |
|---|---|---|
| Tool-Surface: Cross-Device-Resume | `list_my_drafts` + `load_draft` als Tools beifügen | Sonst wäre Server-Sync sinnlos |
| Multi-File-Specs: Schema | Draft-Bundle (`spec_drafts` + `spec_draft_files`) | Atomic Publish, klare Gruppierung |
| `read_git_log`-Tool | Nicht initial, später wenn Bedarf | YAGNI, schmale Surface |
| Auto-Save zum Server | Automatisch nach jedem fertigen Agent-Turn (PATCH); 3 Auto-Retries mit Backoff bei Failure, dann manueller Retry | Server = Source of Truth ist die Voraussetzung für Cross-Device-Resume. Per-Turn (statt per-Token) hält Server-Load niedrig. |
| Draft-Sichtbarkeit | Nur Owner sieht Drafts (status="draft") | Klare Privacy-Boundary |
| Canonical-Merge | Single Public-State + Optimistic-Concurrency Publish | Konflikt-Resolution durch User vor Publish |
| Post-Publish-Lifecycle | Draft bleibt als published History sichtbar | Audit-Trail |
| API-Key-Storage | Pinia + persistedstate (`localStorage`), strikte CSP | UX > Passphrase-Theater bei realistischem Threat-Model |
| Cross-Device-Sync der Identity | Kein Sync, per-Device-Setup | Server sieht Keys nie |
| Provider-Granularität | Mehrere Identities pro User, eine aktiv | Flexibel ohne pro-Projekt-Konfig |
| Tool-Call-Telemetrie | Nein, Server-Access-Logs reichen | Nachträglich nachziehbar |
| Conversation-Server-Storage | Files + Conversation, beides — auto-PATCH nach jedem Turn | Cross-Device-Resume inkl. Chat-Kontext; Server = Source of Truth (siehe ADR) |
| `oauth_credentials`-Schicksal | In Phase 4 grep-and-remove falls unbenutzt | Aufgeräumtere Codebase |

### In Phase 0 geklärte Fragen (2026-05-18)

Vollständige Begründung in der [ADR](../adrs/2026-05-18-browser-mcp-architecture.md#resolved-phase-0-design-questions).

1. **Discard-Semantik:** Hard-delete für `status="draft"`. `status="published"` ist immutable (Audit-Trail) → 409 bei DELETE.
2. **Multi-Tab/Multi-Device-Concurrency innerhalb eines Users:** Last-write-wins per PATCH. UI zeigt via `BroadcastChannel` eine Warnung, wenn derselbe Draft in mehreren Tabs *desselben* Geräts offen ist (Cross-Device-Detection erst, wenn Telemetrie zeigt, dass es vorkommt). Cross-Tab-Auto-Sync für State ist bewusst nicht v1 — Begründung in der ADR (Streaming-Flicker).
3. **System-Prompt:** v1 als TypeScript-Konstante in [`app/lib/speckit-system-prompt.ts`](../../app/lib/speckit-system-prompt.ts) eingecheckt. Iteration während Phase 2.

### Out of Scope (separat zu planen)

- Hermes-Runtime-Agents (autonome langlaufende Workflows) — auf separater Hardware, eigenes Repository.
- Browser-side MCP-Server-Discovery (User installiert eigene MCP-Tools) — Browser-Plug-In-Pattern, deutlich später.
- Plan-Draft Realtime-Collaboration (CRDT-Merging zweier paralleler Drafts) — manueller Review/Merge reicht initial.

---

## Definition of Done

- Alle 5 REST-Endpoints implementiert, getestet, mit Path-Traversal-Schutz.
- Browser-Agent läuft Speckit-Chat-Flow E2E mit mindestens Anthropic + OpenAI Provider.
- Conversation + Draft persistieren in Pinia/localStorage UND syncen zum Server.
- `Dockerfile` enthält keinen `@agentclientprotocol/claude-agent-acp` mehr.
- E2E-Test in `tests/e2e/speckit-browser-agent.test.ts`: Login → Provider-Config → New Project → Speckit-Chat-Session mit mindestens 2 Tool-Calls (read_file + save_draft) → Publish Draft → Diff sichtbar.
- Server-Side-AcpRunner-Code entfernt (Phase 4 erreicht).
- ADR + Dieses Plan-Dokument verlinkt von einem CHANGELOG-Eintrag.
