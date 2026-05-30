import { randomBytes } from "node:crypto";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../database/client";
import {
  orgInvites,
  orgMemberships,
  orgs,
  users,
  type Org,
  type OrgInvite,
  type OrgMembership,
} from "../database/schema";
import { createOrgSchema } from "./per-org-schema";

export type OrgWithRole = Org & { role: OrgMembership["role"] };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

/**
 * Creates an org with the given user as both `owner_user_id` and an
 * `admin` membership row, atomically. The owner_user_id is immutable
 * except via {@link transferOrgOwnership}; membership guards key off
 * it (owner cannot be removed/demoted).
 */
export async function createOrgWithAdmin(
  name: string,
  creatorUserId: string,
): Promise<Org> {
  const db = getDb();
  if (!db) throw new Error("DB not configured");

  const slug = slugify(name);
  if (!slug) throw new Error("name does not produce a valid slug");

  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(orgs)
      .values({
        slug,
        name: name.trim(),
        ownerUserId: creatorUserId,
        createdBy: creatorUserId,
      })
      .returning();
    if (!org) throw new Error("org insert returned nothing");
    await tx.insert(orgMemberships).values({
      orgId: org.id,
      userId: creatorUserId,
      role: "admin",
    });
    // Per-org schema hosts the org_secrets + project_secrets tables used
    // by extension credentials and the git remote PAT.
    await createOrgSchema(tx, org.id);
    return org;
  });
}

export async function listOrgsForUser(userId: string): Promise<OrgWithRole[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: orgs.id,
      slug: orgs.slug,
      name: orgs.name,
      ownerUserId: orgs.ownerUserId,
      createdBy: orgs.createdBy,
      createdAt: orgs.createdAt,
      role: orgMemberships.role,
    })
    .from(orgs)
    .innerJoin(orgMemberships, eq(orgMemberships.orgId, orgs.id))
    .where(eq(orgMemberships.userId, userId))
    .orderBy(desc(orgs.createdAt));
  return rows;
}

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(orgs)
    .where(eq(orgs.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function getMembership(
  orgId: string,
  userId: string,
): Promise<OrgMembership | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}

export type MemberRow = {
  userId: string;
  email: string;
  displayName: string | null;
  role: OrgMembership["role"];
  joinedAt: Date;
};

export async function listMembers(orgId: string): Promise<MemberRow[]> {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: orgMemberships.role,
      joinedAt: orgMemberships.createdAt,
    })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, orgId));
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createInvite(input: {
  orgId: string;
  invitedEmail: string;
  invitedRole: "admin" | "member";
  createdBy: string;
}): Promise<OrgInvite> {
  const db = getDb();
  if (!db) throw new Error("DB not configured");

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [row] = await db
    .insert(orgInvites)
    .values({
      token,
      orgId: input.orgId,
      invitedEmail: input.invitedEmail.toLowerCase(),
      invitedRole: input.invitedRole,
      createdBy: input.createdBy,
      expiresAt,
    })
    .returning();
  if (!row) throw new Error("invite insert returned no row");
  return row;
}

export async function listOpenInvites(orgId: string): Promise<OrgInvite[]> {
  const db = getDb();
  if (!db) return [];
  return db
    .select()
    .from(orgInvites)
    .where(
      and(
        eq(orgInvites.orgId, orgId),
        isNull(orgInvites.acceptedAt),
        isNull(orgInvites.revokedAt),
      ),
    )
    .orderBy(desc(orgInvites.createdAt));
}

export type AcceptResult =
  | { ok: true; orgId: string; orgSlug: string; role: "admin" | "member" }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "revoked" };

/**
 * Atomically marks the invite accepted and inserts/updates membership.
 * The recipient identity is the authenticated user — we don't trust
 * the email field for redemption (it's display-only).
 */
export async function acceptInvite(
  token: string,
  acceptingUserId: string,
): Promise<AcceptResult> {
  const db = getDb();
  if (!db) throw new Error("DB not configured");

  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(orgInvites)
      .where(eq(orgInvites.token, token))
      .limit(1);
    if (!invite) return { ok: false as const, reason: "not_found" as const };
    if (invite.acceptedAt)
      return { ok: false as const, reason: "already_used" as const };
    if (invite.revokedAt)
      return { ok: false as const, reason: "revoked" as const };
    if (invite.expiresAt.getTime() < Date.now())
      return { ok: false as const, reason: "expired" as const };

    await tx
      .insert(orgMemberships)
      .values({
        orgId: invite.orgId,
        userId: acceptingUserId,
        role: invite.invitedRole,
      })
      .onConflictDoUpdate({
        target: [orgMemberships.orgId, orgMemberships.userId],
        set: { role: invite.invitedRole },
      });

    await tx
      .update(orgInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(orgInvites.token, token));

    const [org] = await tx
      .select()
      .from(orgs)
      .where(eq(orgs.id, invite.orgId))
      .limit(1);
    if (!org) throw new Error("invite references missing org");
    return {
      ok: true as const,
      orgId: invite.orgId,
      orgSlug: org.slug,
      role: invite.invitedRole,
    };
  });
}

export async function revokeInvite(token: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("DB not configured");
  await db
    .update(orgInvites)
    .set({ revokedAt: new Date() })
    .where(eq(orgInvites.token, token));
}

/**
 * Counts the admins in an org. Used by the demote/remove guards to
 * prevent orphaning the org with zero admins.
 */
export async function countAdmins(orgId: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(orgMemberships)
    .where(
      and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "admin")),
    );
  return Number(row?.n ?? 0);
}

export type MemberMutationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_member"
        | "owner_immutable"
        | "would_orphan_admins"
        | "would_orphan_member";
    };

/**
 * Promotes/demotes a member's role. Guards:
 *   - The org owner cannot be demoted from admin (their role is
 *     pinned by `orgs.owner_user_id`).
 *   - Demoting the last admin orphans the org and is rejected.
 */
export async function updateMembershipRole(
  orgId: string,
  userId: string,
  role: "admin" | "member",
): Promise<MemberMutationResult> {
  const db = getDb();
  if (!db) return { ok: false, reason: "not_member" };

  return db.transaction(async (tx) => {
    const [org] = await tx
      .select()
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);
    if (!org) return { ok: false as const, reason: "not_member" as const };
    const [m] = await tx
      .select()
      .from(orgMemberships)
      .where(
        and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
      )
      .limit(1);
    if (!m) return { ok: false as const, reason: "not_member" as const };

    if (org.ownerUserId === userId && role === "member") {
      return { ok: false as const, reason: "owner_immutable" as const };
    }
    if (m.role === "admin" && role === "member") {
      const [adminCount] = await tx
        .select({ n: count() })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, orgId),
            eq(orgMemberships.role, "admin"),
          ),
        );
      if (Number(adminCount?.n ?? 0) <= 1) {
        return { ok: false as const, reason: "would_orphan_admins" as const };
      }
    }

    await tx
      .update(orgMemberships)
      .set({ role })
      .where(
        and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
      );
    return { ok: true as const };
  });
}

/**
 * Removes a member. Guards:
 *   - The org owner cannot be removed (transfer ownership first).
 *   - Removing the last admin orphans the org and is rejected.
 */
export async function removeMembership(
  orgId: string,
  userId: string,
): Promise<MemberMutationResult> {
  const db = getDb();
  if (!db) return { ok: false, reason: "not_member" };

  return db.transaction(async (tx) => {
    const [org] = await tx
      .select()
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);
    if (!org) return { ok: false as const, reason: "not_member" as const };
    const [m] = await tx
      .select()
      .from(orgMemberships)
      .where(
        and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
      )
      .limit(1);
    if (!m) return { ok: false as const, reason: "not_member" as const };

    if (org.ownerUserId === userId) {
      return { ok: false as const, reason: "owner_immutable" as const };
    }
    if (m.role === "admin") {
      const [adminCount] = await tx
        .select({ n: count() })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, orgId),
            eq(orgMemberships.role, "admin"),
          ),
        );
      if (Number(adminCount?.n ?? 0) <= 1) {
        return { ok: false as const, reason: "would_orphan_admins" as const };
      }
    }

    await tx
      .delete(orgMemberships)
      .where(
        and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
      );
    return { ok: true as const };
  });
}

export type TransferOwnershipResult =
  | { ok: true }
  | { ok: false; reason: "not_member" | "same_owner" };

/**
 * Transfers ownership atomically. The new owner must already be a
 * member; on success both the old and new owners hold an `admin`
 * membership row (the old owner is no longer pinned and can be
 * removed/demoted afterwards via the normal endpoints).
 */
export async function transferOrgOwnership(
  orgId: string,
  newOwnerUserId: string,
): Promise<TransferOwnershipResult> {
  const db = getDb();
  if (!db) return { ok: false, reason: "not_member" };

  return db.transaction(async (tx) => {
    const [org] = await tx
      .select()
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);
    if (!org) return { ok: false as const, reason: "not_member" as const };
    if (org.ownerUserId === newOwnerUserId) {
      return { ok: false as const, reason: "same_owner" as const };
    }
    const [m] = await tx
      .select()
      .from(orgMemberships)
      .where(
        and(
          eq(orgMemberships.orgId, orgId),
          eq(orgMemberships.userId, newOwnerUserId),
        ),
      )
      .limit(1);
    if (!m) return { ok: false as const, reason: "not_member" as const };

    await tx
      .update(orgs)
      .set({ ownerUserId: newOwnerUserId })
      .where(eq(orgs.id, orgId));

    // Both the old and new owner should be admins post-transfer. The
    // new owner gets promoted (no-op if already admin); the old owner
    // is left as admin (they were already, since the previous schema
    // pinned them).
    await tx
      .update(orgMemberships)
      .set({ role: "admin" })
      .where(
        and(
          eq(orgMemberships.orgId, orgId),
          eq(orgMemberships.userId, newOwnerUserId),
        ),
      );
    await tx
      .update(orgMemberships)
      .set({ role: "admin" })
      .where(
        and(
          eq(orgMemberships.orgId, orgId),
          eq(orgMemberships.userId, org.ownerUserId),
        ),
      );

    return { ok: true as const };
  });
}
