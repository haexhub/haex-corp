import path from "node:path";
import fs from "node:fs/promises";
import YAML from "yaml";
import { projectCwd } from "./specifyr-stores";
import { findLocalExtensionPath } from "./app-config";

// Resolve the on-disk directory for an extension slug. Two locations are
// considered, in order:
//   1. `<projectCwd>/.specify/extensions/<slug>/` — the canonical per-project
//      install path written by `specify extension add`. Empty when the project
//      was never `specify init`-ed or when the install failed (e.g. the
//      `specify` CLI was not available at project creation time).
//   2. The globally-registered local-extension path from the app config — this
//      covers the BUNDLED_LOCAL_EXTENSIONS list (e.g. speckit-company shipping
//      with the image) plus any path registered via `specify extension add --dev`.
// Without the fallback, a project whose meta.json points at a workflow whose
// extension was only ever registered globally (not installed per-project)
// silently degrades to spec-kit standard without any of the extension's
// command-body instructions, so the agent gets the step label but no guidance
// on what to actually do.
async function resolveExtensionDir(
  orgId: string,
  projectSlug: string,
  extensionSlug: string,
): Promise<string | null> {
  const projectExtDir = path.join(
    projectCwd(orgId, projectSlug),
    ".specify",
    "extensions",
    extensionSlug,
  );
  try {
    await fs.access(path.join(projectExtDir, "extension.yml"));
    return projectExtDir;
  } catch {
    /* not installed per-project — try the global registry */
  }
  const localPath = await findLocalExtensionPath(extensionSlug, process.cwd());
  if (!localPath) return null;
  try {
    await fs.access(path.join(localPath, "extension.yml"));
    return localPath;
  } catch {
    return null;
  }
}

// Shape of .specify/extensions/.registry (spec-kit CLI's install-state file).
interface ExtensionRegistryEntry {
  enabled?: boolean;
}
interface ExtensionRegistry {
  extensions?: Record<string, ExtensionRegistryEntry>;
}

// Returns the set of slugs the spec-kit CLI considers enabled for this project,
// or `null` if the registry is absent/unreadable. `null` means "don't filter" — callers
// should treat every on-disk extension as installed, preserving behavior for projects
// that predate the registry or manage extensions outside the CLI. A readable-but-broken
// registry still returns `null` (we can't trust it, so we don't act on it).
async function readEnabledExtensionSlugs(orgId: string, projectSlug: string): Promise<Set<string> | null> {
  const registryPath = path.join(projectCwd(orgId, projectSlug), ".specify", "extensions", ".registry");
  let content: string;
  try {
    content = await fs.readFile(registryPath, "utf8");
  } catch {
    return null;
  }
  let parsed: ExtensionRegistry;
  try {
    parsed = JSON.parse(content) as ExtensionRegistry;
  } catch {
    return null;
  }
  const entries = parsed.extensions;
  if (!entries || typeof entries !== "object") return null;
  const enabled = new Set<string>();
  for (const [slug, entry] of Object.entries(entries)) {
    if (entry?.enabled === true) enabled.add(slug);
  }
  return enabled;
}

// A Workflow description as the client consumes it.
export interface WorkflowStep {
  id: string;
  label: string;
  command: string;
  summary: string;
  description: string;
  tips: string[];
  artifacts: string[];
  isRun?: boolean;
  runAction?: string;
}

export interface WorkflowDefinition {
  id: string;
  label: string;
  description: string;
  source: "built-in" | "extension";
  extensionSlug?: string;
  steps: WorkflowStep[];
}

interface ExtensionCommandYaml {
  name: string;
  file?: string;
  description?: string;
  is_run?: boolean;
  run_action?: string;
  artifacts?: string[];
}

// Strip a leading YAML frontmatter block (`---\n...---\n`) if present.
function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return md;
  const rest = md.slice(end + 4);
  return rest.startsWith("\n") ? rest.slice(1) : rest;
}

// Extensions can declare artifacts in two ways:
//
// 1. Explicit "## Output Artifact(s)" section — preferred; beats every heuristic.
// 2. Inline backtick paths scattered through prose — filtered by step-id token matching.
//
// Fallback: when token matching finds nothing, return all extracted paths rather than
// nothing (handles steps whose output name is semantically but not lexically related to
// the step id, e.g. "init" produces "constitution.md").
const ARTIFACT_PATH_RE = /`([a-zA-Z0-9_./\-<>]+\.(?:md|json|ya?ml|txt))`/g;
const ACTION_VERBS = new Set(["create", "execute", "update", "generate", "write", "make"]);

function stepTokens(stepId: string): string[] {
  return stepId
    .split(/[-_]/)
    .filter((t) => t.length > 0 && !ACTION_VERBS.has(t.toLowerCase()));
}

// Detects template segments: uppercase 2+ letters (NNN, XXX) or angle-bracket placeholders
// (<role>, <slug>). Both styles mean "fill in the blank", not a real filename.
const TEMPLATE_SEGMENT_RE = /(?:^|-|_|\.)[A-Z]{2,}(?:-|_|\.|$)/;
const ANGLE_PLACEHOLDER_RE = /<[a-z][a-z0-9-]*>/;

function isTemplatePath(p: string): boolean {
  return p.split("/").some((seg) => TEMPLATE_SEGMENT_RE.test(seg) || ANGLE_PLACEHOLDER_RE.test(seg));
}

// Collapse a template path to the parent directory of its first template segment so the
// ArtifactViewer can render a directory listing as a fallback.
//   "docs/aide/items/NNN-name.md"   → "docs/aide/items"
//   ".specify/org/specs/<role>.md"  → ".specify/org/specs"
function templateToParentDir(p: string): string {
  const parts = p.split("/");
  const firstTemplate = parts.findIndex(
    (seg) => TEMPLATE_SEGMENT_RE.test(seg) || ANGLE_PLACEHOLDER_RE.test(seg)
  );
  if (firstTemplate > 0) return parts.slice(0, firstTemplate).join("/");
  // Legacy: trailing uppercase-only segments (original behaviour).
  while (parts.length > 0 && TEMPLATE_SEGMENT_RE.test(parts[parts.length - 1] ?? "")) {
    parts.pop();
  }
  return parts.join("/");
}

// Return the body of the first "## Output Artifact(s)" section, or "" if absent.
function outputSection(body: string): string {
  const m = /^##\s+Output(?:\s+Artifact)?s?\s*$/im.exec(body);
  if (!m) return "";
  const start = m.index + m[0].length;
  const nextHeading = body.indexOf("\n##", start);
  return nextHeading === -1 ? body.slice(start) : body.slice(start, nextHeading);
}

// Extract and normalise backtick-quoted file paths from a text block.
// Filters out absolute, explicitly-relative, and internal extension refs (<ext>/...).
// Template paths are collapsed to their parent directory.
function collectPaths(text: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(ARTIFACT_PATH_RE)) {
    const raw = m[1];
    if (!raw) continue;
    if (raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../") || raw.startsWith("<")) continue;
    const p = isTemplatePath(raw) ? templateToParentDir(raw) : raw;
    if (!p || seen.has(p)) continue;
    seen.add(p);
    result.push(p);
  }
  return result;
}

function extractArtifactPaths(body: string, stepId: string): string[] {
  // 1. Explicit output section is a hard contract: if it exists (even empty), stop here.
  //    An empty section means "this step produces no artifact" — do not fall through.
  const hasOutputSection = /^##\s+Output(?:\s+Artifact)?s?\s*$/im.test(body);
  const explicit = collectPaths(outputSection(body));
  if (hasOutputSection) return explicit;

  // 2. Full-body extraction with token ranking.
  const ordered = collectPaths(body);
  const tokens = stepTokens(stepId).map((t) => t.toLowerCase());
  if (tokens.length === 0) return ordered;

  const matches = ordered.filter((p) => {
    const last = p.split("/").filter(Boolean).pop() ?? "";
    const stem = last.replace(/\.[^.]+$/, "").toLowerCase();
    return tokens.some((t) => stem.includes(t));
  });
  // 3. Nothing matched — return all rather than nothing.
  return matches.length > 0 ? matches : ordered;
}

interface ExtensionYaml {
  schema_version?: string;
  extension?: {
    id?: string;
    name?: string;
    description?: string;
    version?: string;
  };
  provides?: {
    commands?: ExtensionCommandYaml[];
  };
  hooks?: unknown;
  tags?: string[];
}

// An extension is treated as a full-project workflow (vs. a utility that augments spec-kit) when
// ALL of the following hold:
//   (a) it declares the `workflow` tag in its extension.yml,
//   (b) it ships no hooks (hook-providing extensions inject into an existing flow — they are
//       utilities, not replacement flows),
//   (c) it ships at least 3 commands (1–2 commands is a single utility, not a workflow).
// The tag alone is too loose — community authors use it as a category label.
const WORKFLOW_MIN_COMMANDS = 3;

function isWorkflowShape(parsed: ExtensionYaml): boolean {
  const tags = Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).toLowerCase()) : [];
  if (!tags.includes("workflow")) return false;
  const hooks = parsed.hooks;
  const hasHooks = Array.isArray(hooks) ? hooks.length > 0 : !!hooks;
  if (hasHooks) return false;
  const commands = Array.isArray(parsed.provides?.commands) ? parsed.provides!.commands : [];
  if (commands.length < WORKFLOW_MIN_COMMANDS) return false;
  return true;
}

// Built-in spec-kit workflow — always available, no extension needed.
export const SPEC_KIT_WORKFLOW: WorkflowDefinition = {
  id: "spec-kit",
  label: "Spec Kit (Standard)",
  description:
    "Der klassische 5-Step-Flow: Constitution → Specify → Plan → Tasks → Implement. Feature-basierte Entwicklung.",
  source: "built-in",
  steps: [
    {
      id: "constitution",
      label: "Constitution",
      command: "/speckit.constitution",
      summary: "Prinzipien und Leitplanken des Projekts festlegen.",
      description:
        "Definiere die Grundsätze, an denen sich das Projekt durchgängig orientiert — Code-Qualität, Test-Standards, UX-Konsistenz, Performance. Das Ergebnis lebt in .specify/memory/constitution.md und dient Claude als Bezugsrahmen für alle späteren Schritte.",
      tips: [
        "Konkrete Regeln schlagen abstrakte Prinzipien: „Jede öffentliche API braucht OpenAPI-Spec\" statt „sauberer Code\".",
        "Widersprüchliche Prinzipien sorgen später für halb-umgesetzte Specs — lieber weniger, dafür eindeutig.",
        "Die Constitution legst du normalerweise einmal fest und änderst sie selten."
      ],
      artifacts: [".specify/memory/constitution.md"]
    },
    {
      id: "specify",
      label: "Specify",
      command: "/speckit.specify",
      summary: "Was und warum — Feature-Spec erarbeiten.",
      description:
        "Beschreibe WAS gebaut werden soll und WARUM. User-Stories, Feature-Verhalten, konkrete Szenarien, Akzeptanzkriterien.",
      tips: [
        "Spec-kit legt pro Feature einen nummerierten Ordner unter .specify/specs/ an.",
        "Benutze „Als erledigt markieren\", wenn die Spec wirklich steht.",
        "Nachträgliche Änderungen markieren Plan und Tasks automatisch als „veraltet\"."
      ],
      artifacts: [".specify/specs/<feature>/spec.md"]
    },
    {
      id: "plan",
      label: "Plan",
      command: "/speckit.plan",
      summary: "Wie — Technischen Plan ableiten.",
      description:
        "Übersetze die Spec in das WIE: Technologie-Stack, Architektur, Datenmodell, Integrations-Punkte, wichtige Bibliotheken.",
      tips: [
        "Konkrete Versionen und Libraries schreiben ist ok — spätestens Tasks brauchen das.",
        "Alternative Ansätze gegenüberstellen hilft, offene Fragen zu finden.",
        "Der Plan kann iterativ verfeinert werden — neue Session starten statt alten zu überschreiben."
      ],
      artifacts: [".specify/specs/<feature>/plan.md"]
    },
    {
      id: "tasks",
      label: "Tasks",
      command: "/speckit.tasks",
      summary: "Ausführbare Aufgaben mit Abhängigkeiten.",
      description:
        "Zerlege den Plan in konkrete, eigenständig ausführbare Aufgaben. Jede Task trägt ID, Abhängigkeiten und Erfolgskriterien.",
      tips: [
        "Tasks sollen so klein sein, dass ein Agent sie in einer Session erledigen kann.",
        "Wenn Abhängigkeiten fehlen, fährt der Scheduler später sequenziell."
      ],
      artifacts: [".specify/specs/<feature>/tasks.md", ".specifyr/<slug>/tasks.graph.json"]
    },
    {
      id: "implement",
      label: "Implement",
      command: "/speckit.implement",
      summary: "Tasks via Hermes ausführen.",
      description:
        "Hermes führt die Tasks aus — unabhängige parallel, abhängige sequenziell.",
      tips: [
        "Hermes lernt pro Projekt isoliert (.hermes/memory/).",
        "Bei fehlender Hermes-Binary wird auf Claude Code fallback umgeschaltet."
      ],
      artifacts: [],
      isRun: true
    }
  ]
};

// IMPORTANT: every step instruction must explicitly tell the agent to use the
// Write/Edit tools and write the artifact to disk. Without this, claude-sonnet
// readily generates the content as inline text in its reply and tells the user
// "I have no write permission" — even though the ACP runner is launched with
// `--allow-dangerously-skip-permissions` and the tools are available. The
// agent's behavior is conservative: it only writes when explicitly instructed.
const BUILT_IN_SPEC_KIT_STEP_INSTRUCTIONS: Record<string, string> = {
  constitution: [
    "You are running the provider-neutral Spec Kit Constitution step.",
    "Use the Write tool with the RELATIVE path `.specify/memory/constitution.md` (NOT an absolute path like `/app/...` — your cwd IS the project repository root, paths are resolved against it). If the file already exists, use the Edit/Read tools to refine it instead of replacing useful existing content.",
    "DO NOT output the constitution content inline as chat text — it MUST land on disk via the Write tool. Your reply should be a short summary of what you wrote plus any open questions.",
    "Capture project principles as concrete, testable rules for code quality, testing, UX, performance, security, and delivery.",
  ].join("\n"),
  specify: [
    "You are running the provider-neutral Spec Kit Specify step.",
    "Use the Write tool to create or update the current feature spec at `.specify/specs/<feature>/spec.md` in the current working directory. Pick a short kebab-case feature folder name if none exists yet.",
    "DO NOT output the spec content inline as chat text — it MUST land on disk. Your reply should be a short summary of the spec plus any open questions.",
    "Describe what is being built and why: user stories, scenarios, acceptance criteria, constraints, and out-of-scope items. Keep implementation details light unless they are required to disambiguate behavior.",
  ].join("\n"),
  plan: [
    "You are running the provider-neutral Spec Kit Plan step.",
    "Use the Read tool to load the current feature spec under `.specify/specs/`, then use the Write tool to create or update `plan.md` in that same feature directory.",
    "DO NOT output the plan inline as chat text — it MUST land on disk. Your reply should be a short summary of the plan plus any open questions.",
    "Produce an implementation plan covering architecture, data model, interfaces, dependencies, risks, and validation strategy. Prefer concrete technical decisions over vague options, while recording meaningful tradeoffs.",
  ].join("\n"),
  tasks: [
    "You are running the provider-neutral Spec Kit Tasks step.",
    "Use the Read tool to load the current feature `spec.md` and `plan.md`, then use the Write tool to create or update `tasks.md` in that feature directory.",
    "DO NOT output the task list inline as chat text — it MUST land on disk. Your reply should be a short summary of the tasks plus any open questions.",
    "Write executable tasks with stable IDs such as `T001`, clear acceptance criteria, and explicit dependencies when needed. Mark tasks that can safely run in parallel with `[P]`.",
  ].join("\n"),
  implement: [
    "You are running the provider-neutral Spec Kit Implement step.",
    "Execute the selected implementation task in the current repository. Use the Read/Edit/Write/Bash tools as needed — keep changes scoped and verify them when practical.",
    "Update files directly with the Edit/Write tools, run focused checks via Bash, and summarize the completed work in your reply.",
  ].join("\n"),
};

export function loadBuiltInSpecKitStepInstructions(stepId: string): string | null {
  return BUILT_IN_SPEC_KIT_STEP_INSTRUCTIONS[stepId] ?? null;
}

// Humanize a command-suffix slug: "create-vision" → "Create Vision"
function humanizeStepId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Parse an extension.yml buffer into a WorkflowDefinition, if the extension declares
// itself as a workflow (tags include "workflow"). Returns null otherwise.
export function parseExtensionWorkflow(yamlContent: string): WorkflowDefinition | null {
  let parsed: ExtensionYaml;
  try {
    parsed = YAML.parse(yamlContent) as ExtensionYaml;
  } catch {
    return null;
  }

  if (!isWorkflowShape(parsed)) return null;

  const id = parsed.extension?.id?.trim();
  if (!id) return null;

  const commands = parsed.provides!.commands!;

  const steps: WorkflowStep[] = commands
    .map((cmd) => {
      const fullCommand = cmd.name?.trim();
      if (!fullCommand) return null;
      // Derive a short step id from the last dot-segment of the command name:
      // "speckit.aide.create-vision" → "create-vision"
      const shortId = fullCommand.split(".").pop() ?? fullCommand;
      const description = cmd.description?.trim() ?? "";
      const step: WorkflowStep = {
        id: shortId,
        label: humanizeStepId(shortId),
        command: `/${fullCommand}`,
        summary: description.split(/\. /)[0] || description,
        description,
        tips: [],
        artifacts: [],
        ...(cmd.is_run && { isRun: true }),
        ...(cmd.run_action && { runAction: cmd.run_action })
      };
      return step;
    })
    .filter((s): s is WorkflowStep => s !== null);

  if (steps.length === 0) return null;

  return {
    id,
    label: parsed.extension?.name?.trim() ?? id,
    description: parsed.extension?.description?.trim() ?? "",
    source: "extension",
    extensionSlug: id,
    steps
  };
}

// Read an installed extension's YAML from disk and return its workflow if applicable.
// Also loads each step's command-markdown file to populate `body` and extract `artifacts`.
export async function loadInstalledExtensionWorkflow(
  orgId: string,
  projectSlug: string,
  extensionSlug: string
): Promise<WorkflowDefinition | null> {
  const extDir = await resolveExtensionDir(orgId, projectSlug, extensionSlug);
  if (!extDir) return null;
  const ymlPath = path.join(extDir, "extension.yml");

  let ymlContent: string;
  try {
    ymlContent = await fs.readFile(ymlPath, "utf8");
  } catch {
    return null;
  }
  const wf = parseExtensionWorkflow(ymlContent);
  if (!wf) return null;

  let parsedYaml: ExtensionYaml;
  try {
    parsedYaml = YAML.parse(ymlContent) as ExtensionYaml;
  } catch {
    return wf;
  }
  const commands = parsedYaml.provides?.commands ?? [];
  const cmdByName = new Map<string, ExtensionCommandYaml>();
  for (const cmd of commands) {
    if (cmd.name) cmdByName.set(cmd.name, cmd);
  }

  for (const step of wf.steps) {
    // Command looks like `/speckit.aide.create-vision` — drop the leading slash to match yml.
    const cmdName = step.command.replace(/^\//, "");
    const cmdDef = cmdByName.get(cmdName);
    if (!cmdDef) continue;

    // Prefer explicit artifact declarations in extension.yml over body heuristics.
    if (Array.isArray(cmdDef.artifacts) && cmdDef.artifacts.length > 0) {
      step.artifacts = cmdDef.artifacts;
      continue;
    }

    if (!cmdDef.file) continue;
    try {
      const raw = await fs.readFile(path.join(extDir, cmdDef.file), "utf8");
      step.artifacts = extractArtifactPaths(stripFrontmatter(raw), step.id);
    } catch {
      // Missing command file — step stays without artifacts; the UI degrades gracefully.
    }
  }

  return wf;
}

// Enumerate all installed extensions under the project and return those that declare a workflow.
// Cross-checks against .specify/extensions/.registry: if present, only slugs marked `enabled: true`
// are considered installed, so orphaned extension folders (e.g. a failed `extension remove`) stop
// leaking into the picker. If the registry is missing, all on-disk folders are scanned as before.
export async function listProjectWorkflowExtensions(orgId: string, projectSlug: string): Promise<WorkflowDefinition[]> {
  const extRoot = path.join(projectCwd(orgId, projectSlug), ".specify", "extensions");
  let entries: string[];
  try {
    entries = await fs.readdir(extRoot);
  } catch {
    return [];
  }
  const enabledSlugs = await readEnabledExtensionSlugs(orgId, projectSlug);
  const workflows: WorkflowDefinition[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (enabledSlugs && !enabledSlugs.has(name)) continue;
    const wf = await loadInstalledExtensionWorkflow(orgId, projectSlug, name);
    if (wf) workflows.push(wf);
  }
  return workflows;
}

// Load the raw markdown body of a single step's command file, stripped of frontmatter.
// Returns null if the extension, command, or file cannot be read.
export async function loadStepCommandBody(
  orgId: string,
  projectSlug: string,
  extensionSlug: string,
  stepId: string
): Promise<string | null> {
  const extDir = await resolveExtensionDir(orgId, projectSlug, extensionSlug);
  if (!extDir) return null;
  let ymlContent: string;
  try {
    ymlContent = await fs.readFile(path.join(extDir, "extension.yml"), "utf8");
  } catch {
    return null;
  }
  let parsedYaml: ExtensionYaml;
  try {
    parsedYaml = YAML.parse(ymlContent) as ExtensionYaml;
  } catch {
    return null;
  }
  for (const cmd of parsedYaml.provides?.commands ?? []) {
    const shortId = cmd.name?.split(".").pop() ?? "";
    if (shortId === stepId && cmd.file) {
      try {
        const raw = await fs.readFile(path.join(extDir, cmd.file), "utf8");
        return stripFrontmatter(raw);
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Return the full set of workflows available for a given project:
// always spec-kit, plus any installed workflow-extension.
export async function listProjectWorkflows(orgId: string, projectSlug: string): Promise<WorkflowDefinition[]> {
  const extensionWorkflows = await listProjectWorkflowExtensions(orgId, projectSlug);
  return [SPEC_KIT_WORKFLOW, ...extensionWorkflows];
}

// Resolve a workflow id to its definition for the project. Falls back to spec-kit.
export async function getProjectWorkflow(
  orgId: string,
  projectSlug: string,
  workflowId: string | null | undefined
): Promise<WorkflowDefinition> {
  if (!workflowId || workflowId === "spec-kit") return SPEC_KIT_WORKFLOW;
  const wf = await loadInstalledExtensionWorkflow(orgId, projectSlug, workflowId);
  return wf ?? SPEC_KIT_WORKFLOW;
}
