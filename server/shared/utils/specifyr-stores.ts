import fs from "node:fs/promises";
import { dataDir, projectDir, hostProjectDir } from "./data-dirs";
import { StepStateStore, STEP_ORDER } from "./step-state-store";

export function loadStepStateStore() {
  return { store: new StepStateStore(dataDir()), STEP_ORDER };
}

export function projectCwd(orgId: string, slug: string): string {
  return projectDir(orgId, slug);
}

/**
 * Host-side equivalent of `process.cwd()` for use in Docker bind-mount sources.
 *
 * When specifyr runs inside a container, `process.cwd()` is `/app` — a path the
 * Docker daemon cannot resolve when spawning sibling containers via
 * /var/run/docker.sock. Operators should set `SPECIFYR_HOST_PROJECT_ROOT` to
 * the host path that maps to /app.
 */
export function hostProjectRoot(): string {
  return process.env.SPECIFYR_HOST_PROJECT_ROOT || process.cwd();
}

export function projectHostCwd(orgId: string, slug: string): string {
  return hostProjectDir(orgId, slug);
}

export async function assertProjectExists(orgId: string, slug: string): Promise<void> {
  const cwd = projectCwd(orgId, slug);
  try {
    await fs.access(cwd);
  } catch {
    throw createError({
      statusCode: 404,
      statusMessage: `Project directory not found: projects/${orgId}/${slug}/`,
    });
  }
}
