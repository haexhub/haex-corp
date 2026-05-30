import { z } from "zod";
import { loadStepStateStore } from "@su/specifyr-stores";
import { triggerAutoPush } from "@su/repository-autosync";
import { parseBody, parseParams, stepParams } from "@su/validation";

const completeSchema = z.object({
  sessionId: z.string().trim().min(1).max(128).optional(),
});

export default defineEventHandler(async (event) => {
  const orgId = event.context.orgId!;
  const slug = event.context.projectSlug!;
  const { stepId } = parseParams(event, stepParams);
  const body = await parseBody(event, completeSchema);

  const { store } = loadStepStateStore();

  const updated = await store.markComplete(orgId, slug, stepId, body.sessionId ?? null);

  triggerAutoPush(orgId, slug);

  return updated;
});
