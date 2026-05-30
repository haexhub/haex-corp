import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  loadStepStateStore,
  projectCwd,
  assertProjectExists,
} from "@su/specifyr-stores";
import { getProjectWorkflowId } from "@su/workflows";
import { SPEC_KIT_WORKFLOW, loadInstalledExtensionWorkflow } from "@su/workflow-discovery";
import { triggerAutoPush } from "@su/repository-autosync";
import { parseBody, parseParams, stepParams } from "@su/validation";

const autoCompleteSchema = z.object({
  sessionId: z.string().trim().min(1).max(128).optional(),
  requireArtifact: z.boolean().optional(),
});

/**
 * Checks whether the current step's artifact files exist in the project directory.
 * If they do (or if the step defines no artifacts), the step is auto-marked complete,
 * unlocking the next workflow step.
 *
 * Called by the client after each successful turn completes.
 */
export default defineEventHandler(async (event) => {
  const orgId = event.context.orgId!;
  const slug = event.context.projectSlug!;
  const { stepId } = parseParams(event, stepParams);
  await assertProjectExists(orgId, slug);

  const body = await parseBody(event, autoCompleteSchema);
  // requireArtifact=true: only complete if a concrete file exists (used on page load).
  // requireArtifact=false (default): also complete steps with no artifacts after a turn.
  const requireArtifact = body.requireArtifact === true;

  const { store } = loadStepStateStore();
  const current = await store.getStep(orgId, slug, stepId);

  // Already complete — nothing to do.
  if (current.status === "complete") {
    return { completed: false, status: current.status };
  }

  const workflowId = await getProjectWorkflowId(orgId, slug);
  const workflow =
    workflowId === "spec-kit"
      ? SPEC_KIT_WORKFLOW
      : (await loadInstalledExtensionWorkflow(orgId, slug, workflowId)) ?? SPEC_KIT_WORKFLOW;

  const stepDef = workflow.steps.find((s) => s.id === stepId);
  const artifacts = stepDef?.artifacts ?? [];

  const projectDir = projectCwd(orgId, slug);
  const shouldComplete = artifacts.length === 0
    ? !requireArtifact // page-load: skip; post-turn: complete
    : await anyArtifactExists(projectDir, artifacts);

  if (!shouldComplete) {
    return { completed: false, status: current.status };
  }

  const updated = await store.markComplete(orgId, slug, stepId, body.sessionId ?? null);

  triggerAutoPush(orgId, slug);

  return { completed: true, status: updated.status };
});

async function anyArtifactExists(projectDir: string, artifacts: string[]): Promise<boolean> {
  for (const artifact of artifacts) {
    const hasPlaceholder = artifact.includes("<") || artifact.includes(">");
    const isDir = !path.extname(artifact);

    if (hasPlaceholder || isDir) {
      const dir = path.join(projectDir, hasPlaceholder ? path.dirname(artifact) : artifact);
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        if (entries.some((e) => e.isFile())) return true;
      } catch {
        // directory doesn't exist yet
      }
    } else {
      try {
        await fs.access(path.join(projectDir, artifact));
        return true;
      } catch {
        // file doesn't exist yet
      }
    }
  }
  return false;
}
