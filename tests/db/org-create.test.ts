/**
 * End-to-end test for createOrgWithAdmin: org row + admin membership +
 * per-org schema for secrets.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { skipIfNoDb, withDb, seedUser } from "../helpers/db.ts";

test(
  "createOrgWithAdmin provisions the per-org schema with secret tables",
  { skip: skipIfNoDb },
  async () => {
    await withDb(async (db) => {
      const { createOrgWithAdmin } = await import(
        "../../server/shared/utils/org-store.ts"
      );
      const { orgSchemaName } = await import(
        "../../server/shared/utils/per-org-schema.ts"
      );
      const u = await seedUser();
      const org = await createOrgWithAdmin("Vault Co", u.id);

      const schema = orgSchemaName(org.id);
      const rows = (await db.execute(sql`
        SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = ${schema}
      `)) as unknown as { rows: Array<{ n: number }> };
      assert.ok((rows.rows[0]?.n ?? 0) >= 2, "per-org schema is empty");
    });
  },
);
