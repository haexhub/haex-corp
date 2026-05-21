import { getProjectByOrgAndSlug } from "@su/project-store";
import { findOrCreateStepDraft } from "@su/spec-draft-store";
import { parseParams, stepParams } from "@su/validation";

/**
 * Find-or-create the caller's open draft for this (project, step).
 *
 * Step-chat surface (`steps/[stepId].vue`) calls this on mount to
 * resolve a single draftId. The DB enforces at most one open draft
 * per (project, user, step) via the `byProjectOwnerStep` partial unique
 * index — this endpoint is the only path that creates step-scoped
 * drafts. baseVersion is snapshotted from `projects.spec_public_version`
 * at creation time, same as POST /spec-drafts.
 *
 * Title is a placeholder ("Step: <stepId>") until 5a.4 wires a real UX
 * label. The server doesn't enforce a step taxonomy — any non-empty
 * stepId is accepted; the UI decides which IDs are meaningful.
 *
 * Owner-only: two users with project access for the same step always
 * get distinct drafts. The DB query is scoped by `ownerUserId`.
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.userId!;
  const orgId = event.context.orgId!;
  const projectId = event.context.projectId!;
  const projectSlug = event.context.projectSlug!;
  const { stepId } = parseParams(event, stepParams);

  const proj = await getProjectByOrgAndSlug(orgId, projectSlug);
  if (!proj) {
    throw createError({ statusCode: 404, statusMessage: "project not found" });
  }

  const draft = await findOrCreateStepDraft({
    projectId,
    ownerUserId: userId,
    stepId,
    baseVersion: proj.specPublicVersion,
    initialTitle: `Step: ${stepId}`,
  });

  return {
    id: draft.id,
    title: draft.title,
    baseVersion: draft.baseVersion,
    status: draft.status,
    stepId,
    files: draft.files,
    conversation: draft.conversation,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    publishedAt: draft.publishedAt?.toISOString() ?? null,
    created: draft.created,
  };
});
