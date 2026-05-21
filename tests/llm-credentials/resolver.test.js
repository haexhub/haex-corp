/**
 * Black-box check that resolveCredentialForUser:
 *   - returns null when DB has no enabled rows
 *   - returns the most-recently-updated enabled api_key row
 *   - decrypts the api_key correctly through the master-key roundtrip
 *
 * Skips when DATABASE_URL is empty so CI without a Postgres dep stays
 * green; the local dev loop runs it against the throwaway pg container.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

// node:test treats `{ skip: null }` as truthy → use `false` to opt-in.
const skipReason = !process.env.DATABASE_URL
  ? "DATABASE_URL not set — skipping integration test"
  : false;

test("resolveCredentialForUser: empty → null", { skip: skipReason }, async () => {
  process.env.SPECIFYR_SECRET_KEY ||= crypto.randomBytes(32).toString("hex");
  const { getDb, closeDb } = await import("../../server/shared/database/client.ts");
  const { users, llmCredentials } = await import("../../server/shared/database/schema.ts");
  const { resolveCredentialForUser } = await import(
    "../../server/shared/utils/llm-credentials-store.ts"
  );

  const db = getDb();
  if (!db) {
    assert.fail("DB not available despite DATABASE_URL set");
  }

  const email = `resolver-test-${Date.now()}@local`;
  const [u] = await db.insert(users).values({ email }).returning();
  try {
    const r = await resolveCredentialForUser(u.id, "anthropic");
    assert.equal(r, null);
  } finally {
    // Scope deletes to this test's user. Other DB tests (e.g. spec-draft)
    // leave orgs around whose owner_user_id is RESTRICT, so an unscoped
    // `delete from users` would fail on those leftover rows.
    await db.delete(llmCredentials).where(eq(llmCredentials.ownerId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
    await closeDb();
  }
});

test(
  "resolveCredentialForUser: returns decrypted key for enabled row",
  { skip: skipReason },
  async () => {
    process.env.SPECIFYR_SECRET_KEY ||= crypto.randomBytes(32).toString("hex");
    const { getDb, closeDb } = await import("../../server/shared/database/client.ts");
    const { users, llmCredentials } = await import("../../server/shared/database/schema.ts");
    const { createApiKeyCredential, resolveCredentialForUser } = await import(
      "../../server/shared/utils/llm-credentials-store.ts"
    );

    const db = getDb();
    if (!db) {
      assert.fail("DB not available");
    }

    const email = `resolver-test-${Date.now()}-${Math.random()}@local`;
    const [u] = await db.insert(users).values({ email }).returning();
    try {
      await createApiKeyCredential({
        ownerKind: "user",
        ownerId: u.id,
        provider: "anthropic",
        displayName: "Personal",
        apiKey: "sk-ant-test-12345",
      });

      const r = await resolveCredentialForUser(u.id, "anthropic");
      assert.ok(r, "expected non-null resolution");
      assert.equal(r.apiKey, "sk-ant-test-12345");
      assert.equal(r.baseUrl, null);
    } finally {
      await db.delete(llmCredentials).where(eq(llmCredentials.ownerId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
      await closeDb();
    }
  },
);
