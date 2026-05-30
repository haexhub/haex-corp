import { loadStepStateStore } from "@su/specifyr-stores";
import { getProjectStepIds } from "@su/workflows";

export default defineEventHandler(async (event) => {
  const orgId = event.context.orgId!;
  const slug = event.context.projectSlug!;
  const { store } = loadStepStateStore();
  const stepIds = await getProjectStepIds(orgId, slug);
  return store.listSteps(orgId, slug, stepIds);
});
