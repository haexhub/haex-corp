import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../database/client";
import { projects, specDraftFiles, specDrafts } from "../database/schema";
import {
  readPublicSpecFiles,
  writePublicSpecFiles,
  type PublicSpecFile,
} from "./spec-public-state";

/**
 * DB-backed store for the browser-side Speckit agent's spec drafts.
 *
 * Visibility:
 *   - status='draft' rows are owner-only. We do not leak existence to
 *     non-owners — getDraftWithFiles returns null instead of 403, the
 *     endpoint surfaces it as 404.
 *   - status='published' rows are visible to any project-access caller.
 *     The project-access middleware already gates the URL; we don't
 *     re-check membership here.
 *
 * Files are managed as a SET, not as individual rows: the publish path
 * needs to diff "draft files vs. current public files" trivially, and
 * supporting partial file updates would just shift that complexity
 * onto Task 1.6. So PATCH .files replaces the whole set.
 */

export interface DraftFileInput {
  name: string;
  content: string;
}

export interface CreateDraftInput {
  projectId: string;
  ownerUserId: string;
  title: string;
  baseVersion: number;
  files: DraftFileInput[];
  conversation: unknown[];
}

export interface CreateDraftResult {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function createDraft(
  input: CreateDraftInput,
): Promise<CreateDraftResult> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");

  return db.transaction(async (tx) => {
    const [draft] = await tx
      .insert(specDrafts)
      .values({
        projectId: input.projectId,
        ownerUserId: input.ownerUserId,
        title: input.title,
        baseVersion: input.baseVersion,
        conversation: input.conversation,
      })
      .returning();
    if (!draft) throw new Error("draft insert returned nothing");

    if (input.files.length > 0) {
      await tx.insert(specDraftFiles).values(
        input.files.map((f) => ({
          draftId: draft.id,
          name: f.name,
          content: f.content,
        })),
      );
    }
    return {
      id: draft.id,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  });
}

export interface DraftSummary {
  id: string;
  title: string;
  baseVersion: number;
  status: "draft" | "published";
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

export async function listDraftsForUser(
  projectId: string,
  ownerUserId: string,
): Promise<DraftSummary[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: specDrafts.id,
      title: specDrafts.title,
      baseVersion: specDrafts.baseVersion,
      status: specDrafts.status,
      createdAt: specDrafts.createdAt,
      updatedAt: specDrafts.updatedAt,
      publishedAt: specDrafts.publishedAt,
    })
    .from(specDrafts)
    .where(
      and(
        eq(specDrafts.projectId, projectId),
        eq(specDrafts.ownerUserId, ownerUserId),
      ),
    )
    .orderBy(desc(specDrafts.updatedAt));
  return rows.map((r) => ({ ...r, status: r.status as "draft" | "published" }));
}

export interface DraftWithFiles extends DraftSummary {
  conversation: unknown[];
  files: Array<{ name: string; content: string }>;
}

export async function getDraftWithFiles(
  draftId: string,
  projectId: string,
  callerUserId: string,
): Promise<DraftWithFiles | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(specDrafts)
    .where(
      and(
        eq(specDrafts.id, draftId),
        eq(specDrafts.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) return null;
  // status='draft' is owner-only. status='published' is visible to any
  // project-access caller (already enforced by the middleware).
  if (row.status === "draft" && row.ownerUserId !== callerUserId) return null;

  const files = await db
    .select({ name: specDraftFiles.name, content: specDraftFiles.content })
    .from(specDraftFiles)
    .where(eq(specDraftFiles.draftId, draftId))
    .orderBy(asc(specDraftFiles.name));

  return {
    id: row.id,
    title: row.title,
    baseVersion: row.baseVersion,
    status: row.status as "draft" | "published",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    conversation: row.conversation as unknown[],
    files,
  };
}

export interface FindOrCreateStepDraftInput {
  projectId: string;
  ownerUserId: string;
  stepId: string;
  baseVersion: number;
  initialTitle: string;
}

export type FindOrCreateStepDraftResult = DraftWithFiles & {
  created: boolean;
};

/**
 * Look up the caller's open draft for (project, user, stepId); create
 * one if none exists. Used by the step-chat surface (one draft per
 * (project, user, step), enforced by the `byProjectOwnerStep` partial
 * unique index).
 *
 * Race-handling: SELECT then INSERT in a tx. If a concurrent caller
 * raced us into INSERT under the unique index, the INSERT throws — we
 * re-SELECT and return that row. New drafts start with empty files +
 * empty conversation.
 */
export async function findOrCreateStepDraft(
  input: FindOrCreateStepDraftInput,
): Promise<FindOrCreateStepDraftResult> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");

  return db.transaction(async (tx) => {
    async function selectOpen(): Promise<typeof specDrafts.$inferSelect | null> {
      const [row] = await tx
        .select()
        .from(specDrafts)
        .where(
          and(
            eq(specDrafts.projectId, input.projectId),
            eq(specDrafts.ownerUserId, input.ownerUserId),
            eq(specDrafts.stepId, input.stepId),
            eq(specDrafts.status, "draft"),
          ),
        )
        .limit(1);
      return row ?? null;
    }

    const existing = await selectOpen();
    if (existing) {
      return {
        id: existing.id,
        title: existing.title,
        baseVersion: existing.baseVersion,
        status: existing.status as "draft" | "published",
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
        publishedAt: existing.publishedAt,
        conversation: existing.conversation as unknown[],
        files: [],
        created: false,
      };
    }

    let inserted;
    try {
      [inserted] = await tx
        .insert(specDrafts)
        .values({
          projectId: input.projectId,
          ownerUserId: input.ownerUserId,
          stepId: input.stepId,
          title: input.initialTitle,
          baseVersion: input.baseVersion,
          conversation: [],
        })
        .returning();
    } catch (err) {
      // Concurrent caller won the race under the partial unique index.
      const raced = await selectOpen();
      if (!raced) throw err;
      return {
        id: raced.id,
        title: raced.title,
        baseVersion: raced.baseVersion,
        status: raced.status as "draft" | "published",
        createdAt: raced.createdAt,
        updatedAt: raced.updatedAt,
        publishedAt: raced.publishedAt,
        conversation: raced.conversation as unknown[],
        files: [],
        created: false,
      };
    }
    if (!inserted) throw new Error("draft insert returned nothing");
    return {
      id: inserted.id,
      title: inserted.title,
      baseVersion: inserted.baseVersion,
      status: inserted.status as "draft" | "published",
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
      publishedAt: inserted.publishedAt,
      conversation: inserted.conversation as unknown[],
      files: [],
      created: true,
    };
  });
}

export interface PatchDraftInput {
  title?: string;
  files?: DraftFileInput[];
  conversation?: unknown[];
}

export type PatchDraftResult =
  | { ok: true; updatedAt: Date }
  | { error: "not_found" };

export async function patchDraft(
  draftId: string,
  projectId: string,
  ownerUserId: string,
  patch: PatchDraftInput,
): Promise<PatchDraftResult> {
  const db = getDb();
  if (!db) return { error: "not_found" };

  return db.transaction(async (tx) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.conversation !== undefined) {
      updates.conversation = patch.conversation;
    }

    // The owner+status filter is in the WHERE so a non-owner or a
    // published-status row just returns 0 affected rows → not_found
    // (we don't reveal "draft is published" to non-owners).
    const [updated] = await tx
      .update(specDrafts)
      .set(updates)
      .where(
        and(
          eq(specDrafts.id, draftId),
          eq(specDrafts.projectId, projectId),
          eq(specDrafts.ownerUserId, ownerUserId),
          eq(specDrafts.status, "draft"),
        ),
      )
      .returning({ updatedAt: specDrafts.updatedAt });
    if (!updated) return { error: "not_found" as const };

    if (patch.files !== undefined) {
      await tx
        .delete(specDraftFiles)
        .where(eq(specDraftFiles.draftId, draftId));
      if (patch.files.length > 0) {
        await tx.insert(specDraftFiles).values(
          patch.files.map((f) => ({
            draftId,
            name: f.name,
            content: f.content,
          })),
        );
      }
    }
    return { ok: true as const, updatedAt: updated.updatedAt };
  });
}

export type DeleteDraftResult =
  | { ok: true }
  | { error: "not_found" }
  | { error: "published_immutable" };

export async function deleteDraft(
  draftId: string,
  projectId: string,
  ownerUserId: string,
): Promise<DeleteDraftResult> {
  const db = getDb();
  if (!db) return { error: "not_found" };

  // Race-safe: the status filter lives INSIDE the DELETE's WHERE, so a
  // concurrent publish that flips the row to 'published' between our
  // request reaching the DB and the DELETE running will exclude it from
  // the predicate — deleted.length stays 0 and we follow up to figure
  // out whether the miss was "not yours / gone" or "you own this but
  // it's been published" (the 409 case the UI needs to distinguish
  // from a generic 404).
  const deleted = await db
    .delete(specDrafts)
    .where(
      and(
        eq(specDrafts.id, draftId),
        eq(specDrafts.projectId, projectId),
        eq(specDrafts.ownerUserId, ownerUserId),
        eq(specDrafts.status, "draft"),
      ),
    )
    .returning({ id: specDrafts.id });
  if (deleted.length > 0) return { ok: true };

  const [row] = await db
    .select({ status: specDrafts.status })
    .from(specDrafts)
    .where(
      and(
        eq(specDrafts.id, draftId),
        eq(specDrafts.projectId, projectId),
        eq(specDrafts.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  if (row?.status === "published") return { error: "published_immutable" };
  return { error: "not_found" };
}

export type PublishDraftResult =
  | { ok: true; newPublicVersion: number }
  | { error: "not_found" }
  | {
      error: "conflict";
      currentPublicVersion: number;
      currentPublicFiles: PublicSpecFile[];
    };

/**
 * Publish a draft via compare-and-swap on `projects.spec_public_version`.
 *
 * Sequence inside one tx:
 *   1. SELECT FOR UPDATE on the projects row — locks out concurrent
 *      publishes until commit/rollback.
 *   2. SELECT FOR UPDATE on the draft row too — blocks the owner's
 *      concurrent PATCH/DELETE on the same draft until we're done.
 *      Without this lock, the draft could be patched mid-publish and
 *      we'd write a snapshot that doesn't match what the user sees.
 *   3. Compare draft.baseVersion to spec_public_version. Mismatch →
 *      conflict response. The conflict body's `currentPublicFiles` is
 *      read here, BEFORE the project lock releases, so the {version,
 *      files} pair is from one atomic moment.
 *   4. Replace files on disk under <projectRoot>/specs/.
 *   5. Increment spec_public_version, flip draft.status='published'.
 *      The final UPDATE keeps the owner+status='draft' filter so a
 *      racing PATCH/DELETE that landed under the same row lock would
 *      have left it published-or-gone; the final write affects 0 rows
 *      in that pathological case and we treat it as not_found.
 *
 * Disk write inside the tx: if it throws, the tx rolls back and disk
 * is left in whatever partial state the FS operations produced —
 * accepted Phase-1 narrow window (see spec-public-state.ts).
 */
export async function publishDraft(
  draftId: string,
  projectId: string,
  orgId: string,
  projectSlug: string,
  ownerUserId: string,
): Promise<PublishDraftResult> {
  const db = getDb();
  if (!db) return { error: "not_found" };

  return db.transaction(async (tx) => {
    const [proj] = await tx
      .select({ specPublicVersion: projects.specPublicVersion })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update")
      .limit(1);
    if (!proj) return { error: "not_found" as const };

    const [draft] = await tx
      .select({
        id: specDrafts.id,
        baseVersion: specDrafts.baseVersion,
      })
      .from(specDrafts)
      .where(
        and(
          eq(specDrafts.id, draftId),
          eq(specDrafts.projectId, projectId),
          eq(specDrafts.ownerUserId, ownerUserId),
          eq(specDrafts.status, "draft"),
        ),
      )
      .for("update")
      .limit(1);
    if (!draft) return { error: "not_found" as const };

    if (draft.baseVersion !== proj.specPublicVersion) {
      // Read disk under the still-held project lock so the version +
      // files pair we return cannot interleave with another publish.
      const currentPublicFiles = await readPublicSpecFiles(
        orgId,
        projectSlug,
      );
      return {
        error: "conflict" as const,
        currentPublicVersion: proj.specPublicVersion,
        currentPublicFiles,
      };
    }

    const files = await tx
      .select({ name: specDraftFiles.name, content: specDraftFiles.content })
      .from(specDraftFiles)
      .where(eq(specDraftFiles.draftId, draftId));

    await writePublicSpecFiles(orgId, projectSlug, files);

    const newVersion = proj.specPublicVersion + 1;
    await tx
      .update(projects)
      .set({ specPublicVersion: newVersion })
      .where(eq(projects.id, projectId));
    const now = new Date();
    const flipped = await tx
      .update(specDrafts)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      .where(
        and(
          eq(specDrafts.id, draftId),
          eq(specDrafts.ownerUserId, ownerUserId),
          eq(specDrafts.status, "draft"),
        ),
      )
      .returning({ id: specDrafts.id });
    if (flipped.length === 0) {
      // Concurrent PATCH/DELETE landed under the same FOR UPDATE — the
      // draft is no longer in a publishable state. Roll back by
      // throwing, so the version-bump and disk write don't commit.
      throw new Error("draft no longer in 'draft' status at publish time");
    }

    return { ok: true as const, newPublicVersion: newVersion };
  });
}
