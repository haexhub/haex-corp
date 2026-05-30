import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Mirror of Authentik identity. UPSERT'd by the auth middleware on the
// first request from a previously-unseen email. `email` is the natural
// key — Authentik is the source of truth for who has what address.
//
// `isPlatformAdmin` is populated from the `SPECIFYR_PLATFORM_ADMIN_EMAILS`
// env var on each upsert (see middleware/auth.ts). Storing it on the row
// rather than re-checking the env on every request keeps later
// platform-admin gating cheap and lets future UI surface "promote to
// platform admin" without an env-var round-trip.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  // Set by a platform admin via /admin/users to disable sign-in without
  // deleting the row. Auth middleware short-circuits with 403 when this
  // is non-null, after the email is resolved but before the upsert.
  blockedAt: timestamp("blocked_at", { withTimezone: true }),
  // BCP-47 locale code (e.g. "de", "en"). NULL = use browser/default.
  // Client-side plugin applies this via $i18n.setLocale on login.
  preferredLocale: text("preferred_locale"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// Tenant boundary. Created by any logged-in user; creator becomes
// owner + admin automatically. `slug` is URL-safe, derived from `name`.
//
// `ownerUserId` is immutable except via the dedicated
// transfer-ownership endpoint, which atomically swaps it and ensures
// both old and new owners hold an admin membership row. Membership
// guards key off this column: the owner cannot be removed or demoted.
export const orgs = pgTable(
  "orgs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type Org = typeof orgs.$inferSelect;
export type NewOrg = typeof orgs.$inferInsert;

// Project ownership. `slug` matches the on-disk dir name (and the
// existing artifact-store key); we don't dual-source-of-truth — the
// filesystem stays the source for project content, this row only
// records who owns it.
//
// Mandatory-org model: every project belongs to an org. Personal
// projects no longer exist as a first-class concept — a single-member
// org with the user as owner is the new "personal" workspace.
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    ownerOrgId: uuid("owner_org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Monotonic counter incremented by a successful spec-draft publish.
    // Browser drafts carry a `base_version` snapshot of this counter at
    // fork time; publish is a compare-and-swap (see spec_drafts below).
    specPublicVersion: integer("spec_public_version").notNull().default(0),
  },
  (t) => ({
    ownerOrgIdx: index("projects_owner_org_idx").on(t.ownerOrgId),
    ownerOrgSlugUq: unique("projects_owner_org_slug_uq").on(t.ownerOrgId, t.slug),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const orgMemberships = pgTable(
  "org_memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
    userIdx: index("org_memberships_user_idx").on(t.userId),
  }),
);

export type OrgMembership = typeof orgMemberships.$inferSelect;
export type NewOrgMembership = typeof orgMemberships.$inferInsert;

// Per-project membership. Lets org admins grant access to specific
// projects within their org without elevating the user to org-admin.
// Access rule (see project-access middleware): a user can access a
// project iff they are an org admin OR they are listed here. Project
// creators are auto-added at creation time so the creator never loses
// access by being a non-admin org member.
export const projectMemberships = pgTable(
  "project_memberships",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.userId] }),
    userIdx: index("project_memberships_user_idx").on(t.userId),
  }),
);

export type ProjectMembership = typeof projectMemberships.$inferSelect;
export type NewProjectMembership = typeof projectMemberships.$inferInsert;

// One-time invite tokens. Created by an org admin, redeemed by the
// recipient after they log in via Authelia. `email` is recorded for
// display only — the redemption uses the authenticated user's email,
// so a stolen link can't be redeemed by someone else (within reason —
// see the `revoked_at` lifecycle for compromise handling).
export const orgInvites = pgTable("org_invites", {
  token: text("token").primaryKey(),                  // random 32-byte hex
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  invitedEmail: text("invited_email").notNull(),
  invitedRole: text("invited_role", { enum: ["admin", "member"] }).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type OrgInvite = typeof orgInvites.$inferSelect;
export type NewOrgInvite = typeof orgInvites.$inferInsert;

// Platform-level settings (one row per `key`). JSONB so each setting
// can carry its own shape — `registration.policy` is a string,
// `registration.allowed_domains` is a string[]. Validation lives in
// the helper layer (server/utils/platform-settings.ts), not the DB.
//
// Updating a setting always stamps `updated_by_user_id` for audit, so
// the platform-admin UI can render "last changed by X". `created_at`
// is implicit via the row's existence (no explicit column needed
// because settings are upserted, not appended).
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
});

export type PlatformSetting = typeof platformSettings.$inferSelect;
export type NewPlatformSetting = typeof platformSettings.$inferInsert;

// Per-org spec-kit extensions. Cloned from `source_url` into
// <dataDir>/extensions/orgs/<org_id>/<slug>/ — the FS path is reconstructable
// from the DB row, so we don't store it. `slug` comes from the cloned
// extension.yml's `extension.id`, NOT from user input — this prevents an
// attacker from registering a slug that shadows a bundled extension.
//
// Optional encrypted git credentials (HTTPS basic auth) for private repos:
// the same AES-256-GCM mechanism as secrets-store.ts. NULL credentials
// mean a public repo; partial NULLs are rejected at the store layer.
//
// Visibility: rows are scoped by `org_id` and never bleed across orgs;
// the resolver (server/utils/extension-install.ts) merges them on top of
// the deployment-global localExtensions and the bundled set when an
// owner-org context is known (project-create, project-detail).
export const orgExtensions = pgTable(
  "org_extensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceRef: text("source_ref"), // tag/branch/commit; null = default branch
    credentialUsername: text("credential_username"),
    credentialIv: text("credential_iv"),
    credentialTag: text("credential_tag"),
    credentialData: text("credential_data"),
    registeredBy: uuid("registered_by").references(() => users.id, {
      onDelete: "set null",
    }),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueSlugPerOrg: unique("org_extensions_org_slug_uq").on(t.orgId, t.slug),
    orgIdx: index("org_extensions_org_idx").on(t.orgId),
  }),
);

export type OrgExtension = typeof orgExtensions.$inferSelect;
export type NewOrgExtension = typeof orgExtensions.$inferInsert;

// Fine-grained, additive permissions on top of the admin/member role.
// A row grants one named permission to one user in one org; admins get
// every permission implicitly (the check in server/utils/org-permissions
// short-circuits on role='admin' before reading this table).
//
// `permission` is enumerated at the type AND DB level (CHECK constraint)
// so a typo can't drift past validation. New permissions extend the
// enum + a code path that uses them.
//
// Lifecycle: a delegated grant must vanish if the underlying membership
// vanishes — otherwise re-adding a previously-removed user resurrects
// their old `manage_extensions` privilege. The composite FK to
// `org_memberships(org_id, user_id)` with ON DELETE CASCADE makes
// membership the single source of authority. Deleting the org or user
// also cascades, transitively, via that membership row.
export const orgMemberPermissions = pgTable(
  "org_member_permissions",
  {
    orgId: uuid("org_id").notNull(),
    userId: uuid("user_id").notNull(),
    permission: text("permission", { enum: ["manage_extensions"] }).notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId, t.permission] }),
    userIdx: index("org_member_permissions_user_idx").on(t.userId),
    membershipFk: foreignKey({
      name: "org_member_permissions_membership_fk",
      columns: [t.orgId, t.userId],
      foreignColumns: [orgMemberships.orgId, orgMemberships.userId],
    }).onDelete("cascade"),
    permissionCheck: check(
      "org_member_permissions_permission_chk",
      sql`${t.permission} IN ('manage_extensions')`,
    ),
  }),
);

export type OrgMemberPermission = typeof orgMemberPermissions.$inferSelect;
export type NewOrgMemberPermission = typeof orgMemberPermissions.$inferInsert;

// Per-user private spec drafts. The browser-side spec agent (see
// docs/plans/2026-05-18-browser-mcp-spec-agent.md) auto-PATCHes a draft
// after every completed turn — Postgres is the source of truth for
// drafts and their conversation history. The browser only caches the
// currently active session.
//
// `status='draft'` rows are owner-only; `status='published'` rows are
// audit-trail entries visible to anyone with project access (handled in
// the app layer — see project-access middleware + per-endpoint WHEREs;
// row-level security is not used for user-scoped data elsewhere in this
// schema, so we stay consistent).
//
// `base_version` snapshots `projects.spec_public_version` at fork time;
// publish is a compare-and-swap that succeeds iff base_version still
// matches the current public version (see the publish endpoint).
export const specDrafts = pgTable(
  "spec_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    baseVersion: integer("base_version").notNull(),
    // Scopes a draft to a single workflow step (e.g. "spec", "plan",
    // "tasks"). NULL = free-form chat.vue draft, not bound to a step.
    // The `byProjectOwnerStep` unique index enforces at most one open
    // draft per (project, user, step). See plans/2026-05-21-step-chat-
    // browser-mcp-build.md Task 5a.1.
    stepId: text("step_id"),
    // Vercel-AI-SDK message array. Validated at the wire boundary
    // (Zod in spec-tools-schemas.ts); stored as jsonb so we get
    // write-time JSON validation without parsing on every read.
    conversation: jsonb("conversation").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => ({
    byProjectOwner: index("spec_drafts_project_owner_idx").on(
      t.projectId,
      t.ownerUserId,
    ),
    byProjectStatus: index("spec_drafts_project_status_idx").on(
      t.projectId,
      t.status,
    ),
    // One open draft per (project, user, step). Filtered on the active
    // status so historical published drafts don't block a fresh draft
    // for the same step.
    byProjectOwnerStep: uniqueIndex("spec_drafts_project_owner_step_uq")
      .on(t.projectId, t.ownerUserId, t.stepId)
      .where(sql`step_id IS NOT NULL AND status = 'draft'`),
    // Drizzle's `enum:` option is TS-only — the DB column is plain TEXT
    // and would accept any string from a non-API writer. Enforce the
    // allowed set at the DB layer too so a stray INSERT can't silently
    // break the status-filtered indexes / publish workflow.
    statusCheck: check(
      "spec_drafts_status_chk",
      sql`${t.status} IN ('draft', 'published')`,
    ),
  }),
);

export type SpecDraft = typeof specDrafts.$inferSelect;
export type NewSpecDraft = typeof specDrafts.$inferInsert;

// Spec file contents per draft. Composite primary key (draft_id, name)
// lets the publish endpoint diff trivially and treat the bundle as the
// unit of write — patching files is "replace the set", not "merge in
// place" (vereinfacht die Conflict-Resolution beim Publish).
export const specDraftFiles = pgTable(
  "spec_draft_files",
  {
    draftId: uuid("draft_id")
      .notNull()
      .references(() => specDrafts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: text("content").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.draftId, t.name] }),
  }),
);

export type SpecDraftFile = typeof specDraftFiles.$inferSelect;
export type NewSpecDraftFile = typeof specDraftFiles.$inferInsert;
