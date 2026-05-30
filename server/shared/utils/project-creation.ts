import path from "node:path";
import fs from "node:fs/promises";
import { installExtensionsInProject, type ExtensionInstallRecord } from "./extension-install";
import { dataDir, orgProjectsDir, projectArtifactsDir } from "./data-dirs";
import { getProjectByOrgAndSlug } from "./project-store";
import { SPECIFYR_DIR, ensureDir, exists, slugify, writeJson, writeText } from "./fs-helpers";
import { runCommand } from "./process-helpers";

function projectArtifactDir(cwd: string, orgId: string, slug: string): string {
  return path.join(cwd, SPECIFYR_DIR, orgId, slug);
}

interface ProjectMeta {
  slug: string;
  title: string;
  description: string;
  createdAt: string;
  projectRoot: string;
  workflow: string;
  specifyInit: {
    attemptedAt: string;
    status: "completed" | "pending_manual_setup";
    command: string;
    message: string;
  };
}

async function createArtifactDir(
  cwd: string,
  orgId: string,
  slug: string,
  meta: ProjectMeta,
): Promise<void> {
  const baseDir = projectArtifactDir(cwd, orgId, slug);
  if (await exists(baseDir)) {
    throw new Error(`Project '${slug}' already exists in org.`);
  }
  await ensureDir(baseDir);
  await writeText(path.join(baseDir, "spec.md"), "");
  await writeText(path.join(baseDir, "plan.md"), "");
  await writeText(path.join(baseDir, "tasks.md"), "");
  await writeJson(path.join(baseDir, "meta.json"), meta);
}

export async function createProjectRecord(options: {
  title: string;
  description: string;
  extensions?: string[];
  workflow?: string;
  ownerOrgId?: string | null;
}) {
  const title = options.title.trim();
  const description = options.description.trim();
  const slug = slugify(title);

  if (!slug) {
    throw new Error("Could not derive a valid project slug.");
  }
  if (!options.ownerOrgId) {
    throw new Error("ownerOrgId is required");
  }

  const projectsParent = orgProjectsDir(options.ownerOrgId);
  const projectRoot = path.join(projectsParent, slug);
  await ensureDir(projectsParent);

  const existingRow = await getProjectByOrgAndSlug(options.ownerOrgId, slug);
  if (existingRow) {
    const err: Error & { statusCode?: number; code?: string } = new Error(
      `A project with slug '${slug}' already exists in this organization.`,
    );
    err.statusCode = 409;
    err.code = "PROJECT_SLUG_TAKEN";
    throw err;
  }

  // Orphan check: clean leftover FS dirs from a previously-failed create.
  const artifactDir = projectArtifactsDir(options.ownerOrgId, slug);
  for (const stale of [artifactDir, projectRoot]) {
    try {
      await fs.stat(stale);
      console.warn(`[project-creation] removing orphan dir: ${stale}`);
      await fs.rm(stale, { recursive: true, force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    }
  }

  // `specify init <slug> --ai generic --no-git`: non-interactive bootstrap so
  // the spec-kit directory layout (.specify/) is created. Git init runs
  // separately below so each project has its own repo boundary.
  const initArgs = ["init", slug, "--ai", "generic", "--no-git"];
  const initResult = await runCommand("specify", initArgs, { cwd: projectsParent });

  const workflow = options.workflow ?? "spec-kit";
  const meta: ProjectMeta = {
    slug,
    title,
    description,
    createdAt: new Date().toISOString(),
    projectRoot,
    workflow,
    specifyInit: {
      attemptedAt: new Date().toISOString(),
      status: initResult.ok ? "completed" : "pending_manual_setup",
      command: `specify ${initArgs.join(" ")}`,
      message: initResult.ok
        ? initResult.stdout || "Spec Kit initialized successfully."
        : initResult.stderr || "Could not run `specify init` automatically.",
    },
  };

  if (!initResult.ok) {
    // `specify` binary missing / non-zero exit: we still finish the create so
    // the user gets a writable project dir, but log loudly so an operator
    // notices that scaffold steps were skipped. The status flag in meta.json
    // (`pending_manual_setup`) is the durable record.
    console.warn(
      `[project-creation] specify init ${slug} failed (status=pending_manual_setup): ` +
        (initResult.stderr || "Command not found"),
    );
    await ensureDir(projectRoot);
  }

  const gitInit = await runCommand("git", ["init", "-b", "main"], { cwd: projectRoot });
  if (!gitInit.ok) {
    throw new Error(gitInit.stderr || "Failed to initialize git repository.");
  }
  const gitConfigEmail = await runCommand(
    "git",
    ["config", "user.email", "specifyr@local"],
    { cwd: projectRoot },
  );
  if (!gitConfigEmail.ok) {
    throw new Error(gitConfigEmail.stderr || "Failed to set git user.email.");
  }
  const gitConfigName = await runCommand("git", ["config", "user.name", "specifyr"], {
    cwd: projectRoot,
  });
  if (!gitConfigName.ok) {
    throw new Error(gitConfigName.stderr || "Failed to set git user.name.");
  }

  // Exclude installed extensions from git — they have their own repos.
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const existingGitignore = await fs
    .readFile(gitignorePath, "utf8")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
  const extensionIgnoreRule = ".specify/extensions/";
  if (!existingGitignore.split(/\r?\n/).includes(extensionIgnoreRule)) {
    const needsNewline = existingGitignore.length > 0 && !existingGitignore.endsWith("\n");
    await fs.writeFile(
      gitignorePath,
      `${existingGitignore}${needsNewline ? "\n" : ""}${extensionIgnoreRule}\n`,
    );
  }

  await createArtifactDir(dataDir(), options.ownerOrgId, slug, meta);

  const chosenExtensions = Array.from(
    new Set((options.extensions ?? []).map((x) => String(x).trim()).filter(Boolean)),
  );
  let extensionRecords: ExtensionInstallRecord[] = [];
  if (initResult.ok && chosenExtensions.length > 0) {
    const { manifest } = await installExtensionsInProject(
      options.ownerOrgId,
      slug,
      chosenExtensions,
      "auto",
    );
    extensionRecords = manifest.extensions;
  }

  return {
    slug,
    title,
    description,
    projectRoot,
    specifyInit: meta.specifyInit,
    extensions: extensionRecords,
  };
}
