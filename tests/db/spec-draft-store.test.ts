/**
 * findOrCreateStepDraft: open-draft uniqueness per (project, user, step).
 *
 * The endpoint surface lives behind project-access middleware; here we
 * exercise the store primitive that backs it. The same-user-twice and
 * different-user-same-step scenarios assert that the partial unique
 * index correctly scopes by owner.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { skipIfNoDb, withDb, seedUser } from "../helpers/db.ts";

test(
  "findOrCreateStepDraft creates a new draft when none exists",
  { skip: skipIfNoDb },
  async () => {
    await withDb(async () => {
      const { findOrCreateStepDraft } = await import(
        "../../server/shared/utils/spec-draft-store.ts"
      );
      const { recordProjectOwnership } = await import(
        "../../server/shared/utils/project-store.ts"
      );
      const { createOrgWithAdmin } = await import(
        "../../server/shared/utils/org-store.ts"
      );
      const u = await seedUser();
      const org = await createOrgWithAdmin("Acme", u.id);
      const project = await recordProjectOwnership("p1", {
        ownerOrgId: org.id,
      });
      assert.ok(project);

      const draft = await findOrCreateStepDraft({
        projectId: project!.id,
        ownerUserId: u.id,
        stepId: "spec",
        baseVersion: 0,
        initialTitle: "Step: spec",
      });

      assert.equal(draft.created, true);
      assert.equal(draft.title, "Step: spec");
      assert.equal(draft.status, "draft");
      assert.equal(draft.baseVersion, 0);
      assert.deepEqual(draft.files, []);
      assert.deepEqual(draft.conversation, []);
    });
  },
);

test(
  "findOrCreateStepDraft returns the same draft on a second call (same user + step)",
  { skip: skipIfNoDb },
  async () => {
    await withDb(async () => {
      const { findOrCreateStepDraft } = await import(
        "../../server/shared/utils/spec-draft-store.ts"
      );
      const { recordProjectOwnership } = await import(
        "../../server/shared/utils/project-store.ts"
      );
      const { createOrgWithAdmin } = await import(
        "../../server/shared/utils/org-store.ts"
      );
      const u = await seedUser();
      const org = await createOrgWithAdmin("Acme", u.id);
      const project = await recordProjectOwnership("p1", {
        ownerOrgId: org.id,
      });

      const first = await findOrCreateStepDraft({
        projectId: project!.id,
        ownerUserId: u.id,
        stepId: "spec",
        baseVersion: 0,
        initialTitle: "Step: spec",
      });
      const second = await findOrCreateStepDraft({
        projectId: project!.id,
        ownerUserId: u.id,
        stepId: "spec",
        baseVersion: 0,
        initialTitle: "Step: spec",
      });

      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(second.id, first.id);
    });
  },
);

test(
  "findOrCreateStepDraft gives each user their own draft for the same step",
  { skip: skipIfNoDb },
  async () => {
    await withDb(async () => {
      const { findOrCreateStepDraft } = await import(
        "../../server/shared/utils/spec-draft-store.ts"
      );
      const { recordProjectOwnership } = await import(
        "../../server/shared/utils/project-store.ts"
      );
      const { createOrgWithAdmin } = await import(
        "../../server/shared/utils/org-store.ts"
      );
      const alice = await seedUser("alice");
      const bob = await seedUser("bob");
      const org = await createOrgWithAdmin("Acme", alice.id);
      const project = await recordProjectOwnership("p1", {
        ownerOrgId: org.id,
      });

      const aliceDraft = await findOrCreateStepDraft({
        projectId: project!.id,
        ownerUserId: alice.id,
        stepId: "spec",
        baseVersion: 0,
        initialTitle: "Step: spec",
      });
      const bobDraft = await findOrCreateStepDraft({
        projectId: project!.id,
        ownerUserId: bob.id,
        stepId: "spec",
        baseVersion: 0,
        initialTitle: "Step: spec",
      });

      assert.equal(aliceDraft.created, true);
      assert.equal(bobDraft.created, true);
      assert.notEqual(aliceDraft.id, bobDraft.id);
    });
  },
);

test(
  "findOrCreateStepDraft accepts any non-empty stepId (no taxonomy)",
  { skip: skipIfNoDb },
  async () => {
    await withDb(async () => {
      const { findOrCreateStepDraft } = await import(
        "../../server/shared/utils/spec-draft-store.ts"
      );
      const { recordProjectOwnership } = await import(
        "../../server/shared/utils/project-store.ts"
      );
      const { createOrgWithAdmin } = await import(
        "../../server/shared/utils/org-store.ts"
      );
      const u = await seedUser();
      const org = await createOrgWithAdmin("Acme", u.id);
      const project = await recordProjectOwnership("p1", {
        ownerOrgId: org.id,
      });

      // The endpoint validates path-param shape (min 1, max 128). The
      // store itself doesn't care about a taxonomy of step IDs: any
      // string forms a key. Two unfamiliar step IDs get distinct drafts.
      const a = await findOrCreateStepDraft({
        projectId: project!.id,
        ownerUserId: u.id,
        stepId: "unknown-step-xyz",
        baseVersion: 0,
        initialTitle: "Step: unknown-step-xyz",
      });
      const b = await findOrCreateStepDraft({
        projectId: project!.id,
        ownerUserId: u.id,
        stepId: "another-step",
        baseVersion: 0,
        initialTitle: "Step: another-step",
      });

      assert.equal(a.created, true);
      assert.equal(b.created, true);
      assert.notEqual(a.id, b.id);
    });
  },
);
