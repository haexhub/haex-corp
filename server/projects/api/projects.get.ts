import { inArray } from "drizzle-orm";
import { getDb } from "@db/client";
import { orgs } from "@db/schema";
import { listProjectKeysForUser } from "@su/project-store";

/**
 * Lists every project the current user can access across all of their
 * orgs. Used by the global project sidebar.
 *
 * Access rule: caller sees a project iff they are an admin of the owning
 * org OR an explicit project member (see project-store.listProjectKeysForUser).
 * The response includes `orgSlug` so the UI can build org-scoped links.
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.userId;
  if (!userId) return [];

  const ownedKeys = await listProjectKeysForUser(userId);
  if (ownedKeys.length === 0) return [];

  const db = getDb();
  if (!db) return ownedKeys;
  const orgIds = [...new Set(ownedKeys.map((k) => k.orgId))];
  const orgRows = await db
    .select({ id: orgs.id, slug: orgs.slug })
    .from(orgs)
    .where(inArray(orgs.id, orgIds));
  const slugByOrgId = new Map(orgRows.map((o) => [o.id, o.slug]));
  return ownedKeys.map((p) => ({ ...p, orgSlug: slugByOrgId.get(p.orgId) ?? null }));
});
