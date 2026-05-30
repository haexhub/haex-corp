import { sql } from "drizzle-orm";

type DbHandle = {
  execute: (q: ReturnType<typeof sql.raw>) => Promise<unknown>;
};

// UUID-with-underscores: Postgres identifiers can't contain hyphens
// unquoted. Quoting works but produces uglier names — replacing `-`
// with `_` keeps the schema/role names readable in psql.
export function orgSchemaName(orgId: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)
  ) {
    throw new Error(`invalid org id (not a UUID): ${orgId}`);
  }
  return `org_${orgId.replace(/-/g, "_")}`;
}

/**
 * Per-org Postgres schema with two encrypted-secret tables:
 *
 * - `org_secrets`: keyed by `key` (e.g. extension git credentials)
 * - `project_secrets`: keyed by (project_slug, key); used for the
 *   reserved `__git_remote_token` PAT plus any other project-scoped
 *   credentials.
 *
 * Encryption format (iv, tag, ciphertext) is produced by
 * server/shared/utils/secrets-store.ts via AES-256-GCM + SPECIFYR_SECRET_KEY.
 *
 * Idempotent — every DDL statement uses IF NOT EXISTS. Run inside a
 * transaction so a partial failure rolls back atomically with the
 * surrounding org-create.
 */
export async function createOrgSchema(
  tx: DbHandle,
  orgId: string,
): Promise<void> {
  const schema = orgSchemaName(orgId);

  const ddl = `
    CREATE SCHEMA IF NOT EXISTS "${schema}";

    CREATE TABLE IF NOT EXISTS "${schema}".org_secrets (
      key text PRIMARY KEY,
      iv text NOT NULL,
      tag text NOT NULL,
      encrypted_value text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS "${schema}".project_secrets (
      project_slug text NOT NULL,
      key text NOT NULL,
      iv text NOT NULL,
      tag text NOT NULL,
      encrypted_value text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_slug, key)
    );
  `;
  await tx.execute(sql.raw(ddl));
}
