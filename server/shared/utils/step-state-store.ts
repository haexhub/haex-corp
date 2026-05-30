import fs from "node:fs/promises";
import path from "node:path";

export const STEP_ORDER = ["constitution", "specify", "plan", "tasks", "implement"] as const;
export const STEP_STATUSES = ["untouched", "in_progress", "complete", "stale"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface StepState {
  id: string;
  status: StepStatus;
  lastSessionId: string | null;
  staleSince: string | null;
  staleReason: string | null;
  updatedAt: string;
}

const SPECIFYR_DIR = ".specifyr";

function defaultStepState(stepId: string): StepState {
  return {
    id: stepId,
    status: "untouched",
    lastSessionId: null,
    staleSince: null,
    staleReason: null,
    updatedAt: new Date().toISOString(),
  };
}

async function readJsonOrNull<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export class StepStateStore {
  private readonly rootDir: string;

  constructor(cwd: string) {
    this.rootDir = path.join(cwd, SPECIFYR_DIR);
  }

  private stepFilePath(orgId: string, slug: string, stepId: string): string {
    return path.join(this.rootDir, orgId, slug, "steps", `${stepId}.json`);
  }

  async getStep(orgId: string, slug: string, stepId: string): Promise<StepState> {
    const saved = await readJsonOrNull<StepState>(this.stepFilePath(orgId, slug, stepId));
    return saved ?? defaultStepState(stepId);
  }

  async listSteps(
    orgId: string,
    slug: string,
    stepIds: readonly string[] = STEP_ORDER,
  ): Promise<StepState[]> {
    const results: StepState[] = [];
    for (const stepId of stepIds) {
      results.push(await this.getStep(orgId, slug, stepId));
    }
    return results;
  }

  async saveStep(orgId: string, slug: string, state: StepState): Promise<StepState> {
    const updated: StepState = { ...state, updatedAt: new Date().toISOString() };
    await writeJsonFile(this.stepFilePath(orgId, slug, state.id), updated);
    return updated;
  }

  async setStatus(
    orgId: string,
    slug: string,
    stepId: string,
    status: StepStatus,
    extra: Partial<StepState> = {},
  ): Promise<StepState> {
    if (!STEP_STATUSES.includes(status)) {
      throw new Error(`Unknown step status: ${status}`);
    }
    const current = await this.getStep(orgId, slug, stepId);
    const next: StepState = { ...current, ...extra, status, id: stepId };
    if (status !== "stale") {
      next.staleSince = null;
      next.staleReason = null;
    }
    return this.saveStep(orgId, slug, next);
  }

  async markComplete(
    orgId: string,
    slug: string,
    stepId: string,
    sessionId: string | null,
  ): Promise<StepState> {
    return this.setStatus(orgId, slug, stepId, "complete", { lastSessionId: sessionId });
  }

  async markInProgress(
    orgId: string,
    slug: string,
    stepId: string,
    sessionId: string | null,
  ): Promise<StepState> {
    const current = await this.getStep(orgId, slug, stepId);
    if (current.status === "complete") return current;
    return this.setStatus(orgId, slug, stepId, "in_progress", { lastSessionId: sessionId });
  }

  async markDownstreamStale(
    orgId: string,
    slug: string,
    fromStepId: string,
    reason: string,
    stepIds: readonly string[] = STEP_ORDER,
  ): Promise<void> {
    const fromIdx = stepIds.indexOf(fromStepId);
    if (fromIdx === -1) return;
    const now = new Date().toISOString();
    for (let i = fromIdx + 1; i < stepIds.length; i++) {
      const id = stepIds[i];
      if (!id) continue;
      const current = await this.getStep(orgId, slug, id);
      if (current.status !== "complete") continue;
      await this.saveStep(orgId, slug, {
        ...current,
        status: "stale",
        staleSince: now,
        staleReason: reason,
      });
    }
  }
}
