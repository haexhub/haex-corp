import { count, gte } from "drizzle-orm";
import { getDb } from "@db/client";
import { orgMemberships, orgs, projects, users } from "@db/schema";
import { requirePlatformAdmin } from "@su/platform-admin-auth";

/**
 * Platform-admin landing snapshot: tenant + project + user counts.
 *
 * Single endpoint so the dashboard does one round-trip on load.
 */
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);

  const db = getDb();
  if (!db) {
    throw createError({ statusCode: 503, statusMessage: "DB not configured" });
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [[usersTotalRow], [usersNewRow], [orgsTotalRow], [membershipsTotalRow], [projectsTotalRow]] =
    await Promise.all([
      db.select({ total: count() }).from(users),
      db.select({ total: count() }).from(users).where(gte(users.createdAt, sevenDaysAgo)),
      db.select({ total: count() }).from(orgs),
      db.select({ total: count() }).from(orgMemberships),
      db.select({ total: count() }).from(projects),
    ]);

  const orgsTotal = Number(orgsTotalRow?.total ?? 0);
  const membershipsTotal = Number(membershipsTotalRow?.total ?? 0);

  return {
    users: {
      total: Number(usersTotalRow?.total ?? 0),
      newLast7d: Number(usersNewRow?.total ?? 0),
    },
    orgs: {
      total: orgsTotal,
      avgMembers: orgsTotal > 0 ? Math.round((membershipsTotal / orgsTotal) * 10) / 10 : 0,
    },
    projects: {
      total: Number(projectsTotalRow?.total ?? 0),
    },
    generatedAt: now.toISOString(),
  };
});
