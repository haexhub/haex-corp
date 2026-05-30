import { eq } from "drizzle-orm";
import { getDb } from "@db/client";
import { projects } from "@db/schema";
import { canUserAccessProject } from "@su/project-store";

/**
 * Lists projects within the org identified by the URL.
 *
 * Auth (enforced by project-access middleware): caller must be a member of :orgSlug.
 *
 * Filtering:
 *   - org admins see every project in the org
 *   - org members see only projects they have an explicit project_memberships
 *     row for
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.userId!;
  const orgId = event.context.orgId!;
  const orgSlug = event.context.orgSlug!;
  const orgRole = event.context.orgRole;

  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select({ orgId: projects.ownerOrgId, slug: projects.slug })
    .from(projects)
    .where(eq(projects.ownerOrgId, orgId));

  if (orgRole === "admin") {
    return rows.map((p) => ({ ...p, orgSlug }));
  }

  const visible: typeof rows = [];
  for (const p of rows) {
    if (await canUserAccessProject(orgId, p.slug, userId)) {
      visible.push(p);
    }
  }
  return visible.map((p) => ({ ...p, orgSlug }));
});
