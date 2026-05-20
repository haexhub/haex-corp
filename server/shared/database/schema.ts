import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  cidr,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Pre-existing Postgres role for haex-claude-proxy. CREATE ROLE +
// Passwort-Lifecycle managt die Ansible-Role (Passwort lebt in
// secrets.yml, gehört nicht in Migrations). Table-level GRANTs auf
// runner_sessions + llm_credentials kommen aus einer Drizzle-Migration
// (siehe migrations/0001_grant_claude_proxy_access.sql), damit Schema-
// Änderungen + zugehörige Rechte atomar zusammen ausgerollt werden.
// Hier nur als `existing()` referenziert, damit Drizzle Policies auf
// diese Rolle targeten kann ohne die Rolle selbst zu generieren.
export const haexClaudeProxyRole = pgRole("haex_claude_proxy").existing();

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
    // /24 from SPECIFYR_BRIDGE_POOL, allocated at org-create, fixed for
    // the lifetime of the org. Used later by `docker network create
    // --subnet=...` and Specifyr's IPAM when picking container_ip for
    // agent runs. Nullable because pre-existing rows get backfilled by
    // migration 0006; new rows are always populated by the allocator.
    bridgeSubnet: cidr("bridge_subnet"),
    // Org-create is a saga (DDL commit, then later vault HTTP call). Only
    // 'ready' orgs may spawn agents; 'pending_vault_init' means the per-
    // org schema exists but DEKs/keys haven't been provisioned by vault
    // yet. The vault HTTP call is Phase 3 — Phase 1 leaves new orgs in
    // 'pending_vault_init' indefinitely and the agent-start guard returns
    // 503.
    initStatus: text("init_status", {
      enum: ["pending_vault_init", "ready"],
    }).notNull().default("pending_vault_init"),
  },
  (t) => ({
    // Partial unique: NULLs allowed during the 0006 backfill window and
    // for any row that pre-dates the allocator, but two orgs may never
    // share a populated subnet (network-isolation invariant).
    bridgeSubnetUq: uniqueIndex("orgs_bridge_subnet_uq")
      .on(t.bridgeSubnet)
      .where(sql`${t.bridgeSubnet} IS NOT NULL`),
    // Allocator only ever produces /24s; reject anything else at the DB
    // boundary so a buggy hand-insert can't break the IPAM assumption.
    bridgeSubnetIs24: check(
      "orgs_bridge_subnet_is_24_chk",
      sql`${t.bridgeSubnet} IS NULL OR masklen(${t.bridgeSubnet}) = 24`,
    ),
  }),
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

// LLM provider credentials. Polymorphic owner: user-personal or
// org-shared (Phase 5 wires the org case into the runner). Encrypted
// fields use the same AES-256-GCM master key as secrets-store.ts —
// stored as hex strings (text), not bytea, so the schema stays
// portable to non-Postgres backends if we ever swap.
export const llmCredentials = pgTable(
  "llm_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerKind: text("owner_kind", { enum: ["user", "org"] }).notNull(),
    ownerId: uuid("owner_id").notNull(),

    provider: text("provider", {
      // openrouter behaves as an OpenAI-compatible gateway in front of
      // many model families — single key, flexible model strings like
      // `anthropic/claude-sonnet-4-5`. base_url is the differentiator.
      enum: ["anthropic", "openai", "google", "openrouter"],
    }).notNull(),
    mode: text("mode", { enum: ["api_key", "oauth_claude"] }).notNull(),
    displayName: text("display_name").notNull(),

    // api_key mode: encrypted blob. NULL when mode='oauth_claude' (Phase 8).
    apiKeyIv: text("api_key_iv"),
    apiKeyTag: text("api_key_tag"),
    apiKeyData: text("api_key_data"),

    // oauth_claude mode: OAuth-Credentials werden AES-256-GCM-verschlüsselt
    // direkt in der DB persistiert (kein FS, kein Volume-Mount mehr). Der
    // Plaintext ist das raw JSON aus `~/.claude/.credentials.json`, das die
    // Claude-CLI während des OAuth-Logins schreibt. Master-Key kommt aus
    // SPECIFYR_SECRET_KEY (siehe secrets-store.ts).
    oauthStatus: text("oauth_status", {
      enum: ["pending", "authorized", "expired"],
    }),
    oauthAuthorizedAt: timestamp("oauth_authorized_at", { withTimezone: true }),
    oauthCredentialsIv: text("oauth_credentials_iv"),
    oauthCredentialsTag: text("oauth_credentials_tag"),
    oauthCredentialsData: text("oauth_credentials_data"),
    // Optional Ablaufzeitpunkt aus dem OAuth-Response. Bei Anthropic Pro/Max
    // ist der refresh_token langlebig, der access_token läuft alle paar Min
    // ab — der claude-proxy refresht beim Spawn und schreibt zurück.
    oauthExpiresAt: timestamp("oauth_expires_at", { withTimezone: true }),

    // base_url: per-provider override or the gateway URL (openrouter
    // points at https://openrouter.ai/api/v1). Stored on the credential
    // because it's infrastructure metadata, not per-request choice.
    baseUrl: text("base_url"),
    enabled: boolean("enabled").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("llm_credentials_owner_idx").on(
      t.ownerKind,
      t.ownerId,
      t.provider,
      t.enabled,
    ),
    unique("llm_credentials_owner_provider_name_uq").on(
      t.ownerKind,
      t.ownerId,
      t.provider,
      t.displayName,
    ),
    // RLS für haex-claude-proxy: er darf nur Zeilen sehen/refreshen, deren
    // Owner per Session-Setting freigeschaltet ist. Specifyr (postgres user)
    // umgeht RLS implizit als Tabellen-Owner — Owner-Filter dort weiterhin
    // auf Code-Ebene via existing WHERE-Klauseln. Der proxy MUSS vor jedem
    // Query `SET LOCAL app.current_owner_kind/id` setzen, sonst sieht er
    // nichts (NULL-Setting → Filter trifft nicht zu).
    // Least-privilege: separate SELECT + UPDATE statt FOR ALL. Proxy
    // braucht weder INSERT noch DELETE — Specifyr legt Rows an, Proxy
    // schreibt nur refreshte Tokens via UPDATE zurück.
    pgPolicy("llm_credentials_proxy_owner_isolation_select", {
      as: "permissive",
      for: "select",
      to: haexClaudeProxyRole,
      using: sql`(owner_kind = current_setting('app.current_owner_kind', true) AND owner_id::text = current_setting('app.current_owner_id', true))`,
    }),
    pgPolicy("llm_credentials_proxy_owner_isolation_update", {
      as: "permissive",
      for: "update",
      to: haexClaudeProxyRole,
      using: sql`(owner_kind = current_setting('app.current_owner_kind', true) AND owner_id::text = current_setting('app.current_owner_id', true))`,
      withCheck: sql`(owner_kind = current_setting('app.current_owner_kind', true) AND owner_id::text = current_setting('app.current_owner_id', true))`,
    }),
  ],
).enableRLS();

export type LlmCredential = typeof llmCredentials.$inferSelect;
export type NewLlmCredential = typeof llmCredentials.$inferInsert;

// Agent runtime selection per owner + workflow purpose. Credentials
// answer "how do we authenticate?"; this table answers "which agent,
// provider, and model should run this workflow?".
//
// `purpose='speckit'` → one profile per owner (the workflow agent).
// `purpose='company-agent'` → one profile per (owner, agent_role) so
// the same user can run, e.g., the CEO on Claude and the developer on
// GPT inside one company. `agent_role` stays '' for speckit so a single
// composite UNIQUE handles both shapes without partial indexes.
export const llmAgentProfiles = pgTable(
  "llm_agent_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerKind: text("owner_kind", { enum: ["user", "org"] }).notNull(),
    ownerId: uuid("owner_id").notNull(),
    purpose: text("purpose", { enum: ["speckit", "company-agent"] }).notNull(),
    agentRole: text("agent_role").notNull().default(""),
    runnerKey: text("runner_key").notNull(),
    provider: text("provider", {
      enum: ["anthropic", "openai", "google", "openrouter"],
    }).notNull(),
    model: text("model").notNull(),
    credentialId: uuid("credential_id").references(() => llmCredentials.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerPurposeRoleIdx: index("llm_agent_profiles_owner_purpose_role_idx").on(
      t.ownerKind,
      t.ownerId,
      t.purpose,
      t.agentRole,
    ),
    uniquePurposeRole: unique("llm_agent_profiles_owner_purpose_role_uq").on(
      t.ownerKind,
      t.ownerId,
      t.purpose,
      t.agentRole,
    ),
  }),
);

export type LlmAgentProfile = typeof llmAgentProfiles.$inferSelect;
export type NewLlmAgentProfile = typeof llmAgentProfiles.$inferInsert;

// Short-lived bearer tokens injected into agent containers in place of
// a real Anthropic API key. The haex-claude-proxy resolves the token
// against this table at request time, then spawns the `claude` CLI with
// HOME pointing at the matching credentials directory. The token itself
// carries no privilege beyond "this owner is allowed to use the proxy
// for this run" — short TTL keeps the blast radius small if a worker
// container is compromised.
//
// owner_kind/owner_id is polymorphic the same way as the rest of the
// schema (no FK on owner_id because of the polymorphism). user_id is
// the requesting user — recorded for auditability + so cascading delete
// of the user takes their sessions with them.
export const runnerSessions = pgTable(
  "runner_sessions",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ownerKind: text("owner_kind", { enum: ["user", "org"] }).notNull(),
    ownerId: uuid("owner_id").notNull(),
    // Bound credential. When set, the proxy uses this row as the source
    // of truth for upstream routing (api_key or oauth_claude mode); when
    // null (legacy rows minted before Session A), the proxy falls back
    // to "the owner's first enabled oauth_claude anthropic credential".
    // ON DELETE SET NULL so revoking a credential invalidates its bound
    // sessions without losing audit history.
    credentialId: uuid("credential_id").references(() => llmCredentials.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("runner_sessions_user_idx").on(t.userId, t.expiresAt),
    // Without an index here, `ON DELETE SET NULL` would do a sequential
    // scan of `runner_sessions` for every credential delete — fine in
    // dev, painful once the table grows.
    credentialIdx: index("runner_sessions_credential_idx").on(t.credentialId),
  }),
);

export type RunnerSession = typeof runnerSessions.$inferSelect;
export type NewRunnerSession = typeof runnerSessions.$inferInsert;

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

// Vault-wide schema for crypto material that is NOT org-scoped. Per-org
// tables (service_credentials, agent_sessions, master_keys, ...) live in
// dynamic `org_<id>` schemas created by createOrgSchema() at org-create
// time — they're intentionally NOT declared here because their schema
// name is parameterised. See server/shared/utils/per-org-schema.ts for
// the DDL.
export const specifyrVaultSchema = pgSchema("specifyr_vault");

// Single JWT signing key for the entire vault. The org boundary is
// enforced by Postgres schema + role + RLS, NOT by per-org JWT crypto —
// see docs/plans/2026-05-13-agent-vault-and-egress.md "Layer 2". Vault
// daemon (Phase 3) wraps the private key with the active KEK and stores
// it here on first boot.
//
// The `oneActive` partial unique index enforces "at most one active row"
// at the DB level so concurrent inserts can't produce two active keys
// (which would break JWT verification semantics — the kid in the JWT
// header is the consumer's discriminator).
export const jwtSigningKey = specifyrVaultSchema.table(
  "jwt_signing_key",
  {
    kid: text("kid").primaryKey(),
    publicKey: text("public_key").notNull(),
    wrappedPrivateKey: text("wrapped_private_key").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    kekKid: text("kek_kid").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    active: boolean("active").notNull().default(true),
  },
  (t) => ({
    oneActive: uniqueIndex("jwt_signing_key_one_active_uq")
      .on(t.active)
      .where(sql`${t.active} = true`),
  }),
);

export type JwtSigningKey = typeof jwtSigningKey.$inferSelect;
export type NewJwtSigningKey = typeof jwtSigningKey.$inferInsert;

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
