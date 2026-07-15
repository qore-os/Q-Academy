import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { and, eq } from "drizzle-orm";

import {
  communityPublicProfileFields,
  customFieldDefinitions,
  dataProfileDefinitions,
  dataProfileFields,
  dataProfileValues,
  memberDataProfiles,
  organizations,
  users,
} from "../src/db/schema";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
process.env.DATABASE_URL = databaseUrl;
process.env.SESSION_SECRET ??=
  "community-profile-session-secret-at-least-32-bytes";

const { db, postgresClient } = await import("../src/db/index");
const profileService = await import("../src/lib/community-public-profile");

after(async () => {
  await postgresClient.end();
});

function foreignKeyViolation(error: unknown) {
  let current = error;
  while (typeof current === "object" && current !== null) {
    if ("code" in current && current.code === "23503") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

test("public profile projection follows the active profile mapping and fails closed", async () => {
  const suffix = randomUUID();
  const [organization] = await db
    .insert(organizations)
    .values({
      name: `Community profile ${suffix}`,
      slug: `community-profile-${suffix}`,
    })
    .returning({ id: organizations.id });

  try {
    const [member] = await db
      .insert(users)
      .values({
        organizationId: organization.id,
        email: `profile-${suffix}@example.test`,
        passwordHash: "not-a-login-hash",
        firstName: "Ada",
        lastName: "Lovelace",
        role: "owner",
        jobTitle: "Engineer",
        bio: "Community bio",
      })
      .returning({ id: users.id });
    const [defaultDefinition, alternateDefinition] = await db
      .insert(dataProfileDefinitions)
      .values([
        {
          organizationId: organization.id,
          key: "default",
          name: "Standard",
          allowMemberCreation: false,
          sortOrder: 0,
        },
        {
          organizationId: organization.id,
          key: `project_${suffix.replaceAll("-", "_")}`,
          name: "Projektprofil",
          sortOrder: 1,
        },
      ])
      .returning({ id: dataProfileDefinitions.id });
    const [alternateField, defaultOnlyField] = await db
      .insert(customFieldDefinitions)
      .values([
        {
          organizationId: organization.id,
          key: `alternate_${suffix.replaceAll("-", "_")}`,
          label: "Alternatives Feld",
          type: "text",
          visibility: "member",
        },
        {
          organizationId: organization.id,
          key: `default_only_${suffix.replaceAll("-", "_")}`,
          label: "Nur Standarddefinition",
          type: "text",
          visibility: "member",
        },
      ])
      .returning({ id: customFieldDefinitions.id, key: customFieldDefinitions.key });
    await db.insert(dataProfileFields).values([
      {
        organizationId: organization.id,
        profileDefinitionId: alternateDefinition.id,
        fieldId: alternateField.id,
        sortOrder: 0,
      },
      {
        organizationId: organization.id,
        profileDefinitionId: defaultDefinition.id,
        fieldId: defaultOnlyField.id,
        sortOrder: 0,
      },
    ]);
    const [profile] = await db
      .insert(memberDataProfiles)
      .values({
        organizationId: organization.id,
        userId: member.id,
        definitionId: alternateDefinition.id,
        name: "Aktives Projektprofil",
        isDefault: true,
      })
      .returning({ id: memberDataProfiles.id });
    await db.insert(dataProfileValues).values([
      {
        organizationId: organization.id,
        userId: member.id,
        profileId: profile.id,
        fieldId: alternateField.id,
        value: "sichtbarer Wert",
      },
      {
        organizationId: organization.id,
        userId: member.id,
        profileId: profile.id,
        fieldId: defaultOnlyField.id,
        value: "darf nicht leaken",
      },
    ]);

    const saved = await profileService.replaceCommunityProfileSettings({
      organizationId: organization.id,
      actorId: member.id,
      expectedRevision: 0,
      completionGateEnabled: true,
      fields: [
        { standardField: "bio" },
        { customFieldId: alternateField.id, requiredForPosting: true },
        { standardField: "job_title" },
        { customFieldId: defaultOnlyField.id },
      ],
    });
    assert.equal(saved.settings.revision, 1);
    assert.equal(saved.fields.length, 4);
    assert.equal(saved.activeMemberCount, 1);
    assert.equal(saved.incompleteActiveMemberCount, 0);

    const publicProfile = await profileService.getCommunityPublicProfile({
      organizationId: organization.id,
      memberId: member.id,
    });
    assert.deepEqual(
      publicProfile.fields.map((field) => field.key),
      ["bio", alternateField.key, "job_title", defaultOnlyField.key],
    );
    assert.equal(publicProfile.customFields[0]?.value, "sichtbarer Wert");
    assert.equal(publicProfile.customFields[1]?.value, "");
    assert.ok(
      publicProfile.customFields.every(
        (field) => field.value !== "darf nicht leaken",
      ),
    );
    assert.equal(
      (await profileService.getOwnCommunityProfileCompletion({
        organizationId: organization.id,
        userId: member.id,
      })).complete,
      true,
    );

    await assert.rejects(
      db
        .delete(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.id, alternateField.id),
            eq(customFieldDefinitions.organizationId, organization.id),
          ),
        ),
      foreignKeyViolation,
    );

    await db
      .delete(communityPublicProfileFields)
      .where(
        eq(communityPublicProfileFields.organizationId, organization.id),
      );
    const invalidConfiguration =
      await profileService.getOwnCommunityProfileCompletion({
        organizationId: organization.id,
        userId: member.id,
      });
    assert.equal(invalidConfiguration.complete, false);
    assert.equal(
      invalidConfiguration.missingFields[0]?.key,
      "profile_configuration",
    );

    const reset = await profileService.replaceCommunityProfileSettings({
      organizationId: organization.id,
      actorId: member.id,
      expectedRevision: 1,
      completionGateEnabled: false,
      fields: [],
    });
    assert.equal(reset.settings.revision, 2);
    assert.deepEqual(reset.fields, []);
    assert.equal(reset.incompleteActiveMemberCount, 0);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organization.id));
  }
});

test("posting profile check holds a share lock on required standard fields", async () => {
  const suffix = randomUUID();
  const [organization] = await db
    .insert(organizations)
    .values({
      name: `Community profile lock ${suffix}`,
      slug: `community-profile-lock-${suffix}`,
    })
    .returning({ id: organizations.id });

  try {
    const [member] = await db
      .insert(users)
      .values({
        organizationId: organization.id,
        email: `profile-lock-${suffix}@example.test`,
        passwordHash: "not-a-login-hash",
        firstName: "Grace",
        lastName: "Hopper",
        role: "owner",
        jobTitle: "Admiral",
      })
      .returning({ id: users.id });
    await profileService.replaceCommunityProfileSettings({
      organizationId: organization.id,
      actorId: member.id,
      expectedRevision: 0,
      completionGateEnabled: true,
      fields: [{ standardField: "job_title", requiredForPosting: true }],
    });

    let releaseCheck!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseCheck = resolve;
    });
    let checked!: () => void;
    const checkComplete = new Promise<void>((resolve) => {
      checked = resolve;
    });
    const guardedMutation = db.transaction(async (tx) => {
      await profileService.assertCommunityProfileComplete(tx, {
        organizationId: organization.id,
        userId: member.id,
      });
      checked();
      await release;
    });
    await checkComplete;
    const clearRequiredField = Promise.resolve(
      db
        .update(users)
        .set({ jobTitle: null })
        .where(
          and(
            eq(users.id, member.id),
            eq(users.organizationId, organization.id),
          ),
        ),
    );
    const firstOutcome = await Promise.race([
      clearRequiredField.then(() => "updated" as const),
      new Promise<"blocked">((resolve) =>
        setTimeout(() => resolve("blocked"), 100),
      ),
    ]);
    assert.equal(firstOutcome, "blocked");
    releaseCheck();
    await Promise.all([guardedMutation, clearRequiredField]);
    assert.equal(
      (await profileService.getOwnCommunityProfileCompletion({
        organizationId: organization.id,
        userId: member.id,
      })).complete,
      false,
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organization.id));
  }
});
