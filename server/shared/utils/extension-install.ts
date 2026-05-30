import path from "node:path";
import fs from "node:fs/promises";
import { projectCwd } from "./specifyr-stores";
import { extensionsDir, projectArtifactsDir } from "./data-dirs";
import { findLocalExtensionPath } from "./app-config";
import { getOrgExtensionBySlug } from "./org-extensions-store";
import { runCommand } from "./process-helpers";

export interface ExtensionInstallRecord {
  slug: string;
  installedAt: string;
  source: "auto" | "manual";
  status: "installed" | "failed";
  message?: string;
}

export interface ExtensionsManifest {
  slug: string;
  extensions: ExtensionInstallRecord[];
  updatedAt: string | null;
}

function manifestPathFor(orgId: string, projectSlug: string): string {
  return path.join(projectArtifactsDir(orgId, projectSlug), "extensions.json");
}

export async function readManifest(orgId: string, projectSlug: string): Promise<ExtensionsManifest> {
  const file = manifestPathFor(orgId, projectSlug);
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as ExtensionsManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { slug: projectSlug, extensions: [], updatedAt: null };
    }
    throw err;
  }
}

async function writeManifest(orgId: string, projectSlug: string, manifest: ExtensionsManifest): Promise<void> {
  const file = manifestPathFor(orgId, projectSlug);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function installExtensionsInProject(
  orgId: string,
  projectSlug: string,
  extensionSlugs: string[],
  source: "auto" | "manual" = "manual",
): Promise<{ manifest: ExtensionsManifest; installed: ExtensionInstallRecord[]; skipped: string[] }> {
  const manifest = await readManifest(orgId, projectSlug);
  const alreadyInstalled = new Set(
    manifest.extensions.filter((e) => e.status === "installed").map((e) => e.slug),
  );
  const toInstall = extensionSlugs
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !alreadyInstalled.has(s));
  const skipped = extensionSlugs.filter((s) => alreadyInstalled.has(s.trim()));

  if (toInstall.length === 0) {
    return { manifest, installed: [], skipped };
  }

  const cwd = projectCwd(orgId, projectSlug);

  // Ensure the community catalog is registered as install-allowed. Idempotent
  // best-effort: if already registered, the CLI fails gracefully.
  await runCommand(
    "specify",
    [
      "extension",
      "catalog",
      "add",
      "https://raw.githubusercontent.com/github/spec-kit/main/extensions/catalog.community.json",
      "--name",
      "community-allowed",
      "--priority",
      "1",
      "--install-allowed",
    ],
    { cwd },
  );

  const installed: ExtensionInstallRecord[] = [];

  for (const slug of toInstall) {
    // Resolution order: org-scoped → app-config localExtensions → global
    // extensions dir → community catalog.
    let localPath: string | null = null;
    let resolutionFailed = false;
    let resolutionFailureMessage = "";
    if (orgId) {
      const orgRow = await getOrgExtensionBySlug(orgId, slug);
      if (orgRow) {
        const onDisk = await fs.access(orgRow.path).then(() => true).catch(() => false);
        if (onDisk) {
          localPath = orgRow.path;
        } else {
          resolutionFailed = true;
          resolutionFailureMessage = `org extension '${slug}' is registered but the on-disk clone is missing — re-add the extension`;
        }
      }
    }
    if (!resolutionFailed && !localPath) {
      localPath = await findLocalExtensionPath(slug);
    }
    if (!resolutionFailed && !localPath) {
      const globalPath = path.join(extensionsDir(), slug);
      try {
        await fs.access(globalPath);
        localPath = globalPath;
      } catch {
        // not in global dir
      }
    }
    let result: { ok: boolean; stdout?: string; stderr?: string };
    if (resolutionFailed) {
      result = { ok: false, stderr: resolutionFailureMessage };
    } else {
      const args = localPath
        ? ["extension", "add", "--dev", localPath]
        : ["extension", "add", slug];
      result = await runCommand("specify", args, { cwd });
    }
    const record: ExtensionInstallRecord = {
      slug,
      installedAt: new Date().toISOString(),
      source,
      status: result.ok ? "installed" : "failed",
      message: result.ok
        ? result.stdout?.trim() || undefined
        : (result.stderr || result.stdout || "specify extension add failed").trim(),
    };
    installed.push(record);
    manifest.extensions = manifest.extensions.filter((e) => e.slug !== slug);
    manifest.extensions.push(record);
  }

  manifest.updatedAt = new Date().toISOString();
  await writeManifest(orgId, projectSlug, manifest);

  return { manifest, installed, skipped };
}
