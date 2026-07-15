import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { and, asc, eq } from "drizzle-orm";

import {
  communityAreas,
  communitySpaces,
  organizations,
  postLikes,
  posts,
  teamRoleAssignments,
  teamRoles,
  users,
} from "../src/db/schema";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
process.env.AUTH_RATE_LIMIT_SECRET ??=
  "community-interaction-lock-secret-at-least-32-bytes";

const { db, postgresClient } = await import("../src/db/index");
const layout = await import("../src/lib/community-layout");
const { assertCommunityManager } = await import(
  "../src/lib/community-management-auth"
);
const {
  deleteCommunitySpaceWithPointReversal,
  setPostReactionMutation,
} = await import("../src/lib/community-mutations");

after(async () => {
  await postgresClient.end();
});

async function orderedSpaces(organizationId: string, areaId: string) {
  return db
    .select({ id: communitySpaces.id, position: communitySpaces.sortOrder })
    .from(communitySpaces)
    .where(
      and(
        eq(communitySpaces.organizationId, organizationId),
        eq(communitySpaces.areaId, areaId),
      ),
    )
    .orderBy(asc(communitySpaces.sortOrder), asc(communitySpaces.id));
}

test("community layout timestamps stay valid when the application clock lags", async (context) => {
  const suffix = randomUUID();
  const [organization] = await db
    .insert(organizations)
    .values({ name: `Layout clock ${suffix}`, slug: `layout-clock-${suffix}` })
    .returning({ id: organizations.id });
  let timersMocked = false;

  try {
    const [owner] = await db
      .insert(users)
      .values({
        organizationId: organization.id,
        email: `layout-clock-${suffix}@example.test`,
        passwordHash: "not-a-login-hash",
        firstName: "Layout",
        lastName: "Clock",
        role: "owner",
      })
      .returning({ id: users.id });
    await db.insert(communityAreas).values({
      organizationId: organization.id,
      title: "Existing",
      slug: `existing-${suffix}`,
      sortOrder: 0,
    });

    context.mock.timers.enable({
      apis: ["Date"],
      now: new Date("2000-01-01T00:00:00.000Z"),
    });
    timersMocked = true;

    await layout.createCommunityArea({
      organizationId: organization.id,
      actorId: owner.id,
      title: "New",
      slug: `new-${suffix}`,
      position: 1,
    });

    const areas = await db
      .select({ position: communityAreas.sortOrder })
      .from(communityAreas)
      .where(eq(communityAreas.organizationId, organization.id))
      .orderBy(asc(communityAreas.sortOrder), asc(communityAreas.id));
    assert.deepEqual(
      areas.map((area) => area.position),
      [0, 1],
    );
  } finally {
    if (timersMocked) context.mock.timers.reset();
    await db.delete(organizations).where(eq(organizations.id, organization.id));
  }
});

test("community layout stays dense, tenant-bound and permission-locked", async () => {
  const suffix = randomUUID();
  const [organization, foreignOrganization] = await db
    .insert(organizations)
    .values([
      { name: `Layout ${suffix}`, slug: `layout-${suffix}` },
      { name: `Foreign ${suffix}`, slug: `foreign-layout-${suffix}` },
    ])
    .returning({ id: organizations.id });

  try {
    const [owner, manager, viewer] = await db
      .insert(users)
      .values([
        {
          organizationId: organization.id,
          email: `layout-owner-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Layout",
          lastName: "Owner",
          role: "owner",
        },
        {
          organizationId: organization.id,
          email: `layout-manager-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Layout",
          lastName: "Manager",
          role: "admin",
        },
        {
          organizationId: organization.id,
          email: `layout-viewer-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Layout",
          lastName: "Viewer",
          role: "admin",
        },
      ])
      .returning({ id: users.id });
    const [managerRole, viewerRole] = await db
      .insert(teamRoles)
      .values([
        {
          organizationId: organization.id,
          name: `Community manager ${suffix}`,
          permissions: ["community.view", "community.manage"],
          createdById: owner.id,
        },
        {
          organizationId: organization.id,
          name: `Community viewer ${suffix}`,
          permissions: ["community.view"],
          createdById: owner.id,
        },
      ])
      .returning({ id: teamRoles.id });
    await db.insert(teamRoleAssignments).values([
      {
        organizationId: organization.id,
        userId: manager.id,
        roleId: managerRole.id,
        assignedById: owner.id,
      },
      {
        organizationId: organization.id,
        userId: viewer.id,
        roleId: viewerRole.id,
        assignedById: owner.id,
      },
    ]);

    const areaA = await layout.createCommunityArea({
      organizationId: organization.id,
      actorId: owner.id,
      title: "Area A",
      slug: `area-a-${suffix}`,
    });
    const areaB = await layout.createCommunityArea({
      organizationId: organization.id,
      actorId: manager.id,
      title: "Area B",
      slug: `area-b-${suffix}`,
    });
    const foreignArea = await db
      .insert(communityAreas)
      .values({
        organizationId: foreignOrganization.id,
        title: "Foreign",
        slug: `foreign-${suffix}`,
        sortOrder: 0,
      })
      .returning({ id: communityAreas.id })
      .then((rows) => rows[0]!);

    await assert.rejects(
      layout.createCommunityArea({
        organizationId: organization.id,
        actorId: viewer.id,
        title: "Forbidden",
        slug: `forbidden-${suffix}`,
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "forbidden",
    );

    const createSpace = (title: string, position?: number) =>
      layout.createCommunitySpaceWithLayout({
        organizationId: organization.id,
        actorId: owner.id,
        areaId: areaA.id,
        position,
        title,
        slug: `${title.toLowerCase()}-${suffix}`,
        color: "#2b9188",
        type: "discussion",
      });
    const first = await createSpace("First");
    const middle = await createSpace("Middle");
    const last = await createSpace("Last");
    await db.transaction((tx) =>
      deleteCommunitySpaceWithPointReversal(tx, {
        organizationId: organization.id,
        actorId: owner.id,
        spaceId: middle.id,
        authorization: "manage",
      }),
    );
    assert.deepEqual(
      (await orderedSpaces(organization.id, areaA.id)).map((row) => row.position),
      [0, 1],
    );
    const inserted = await createSpace("Inserted", 1);
    assert.deepEqual(
      (await orderedSpaces(organization.id, areaA.id)).map((row) => row.id),
      [first.id, inserted.id, last.id],
    );

    await layout.moveCommunitySpace({
      organizationId: organization.id,
      actorId: manager.id,
      spaceId: last.id,
      areaId: areaB.id,
      position: 0,
    });
    await Promise.all([
      layout.moveCommunitySpace({
        organizationId: organization.id,
        actorId: owner.id,
        spaceId: first.id,
        areaId: areaA.id,
        position: 1,
      }),
      layout.moveCommunitySpace({
        organizationId: organization.id,
        actorId: manager.id,
        spaceId: inserted.id,
        areaId: areaA.id,
        position: 0,
      }),
    ]);
    assert.deepEqual(
      (await orderedSpaces(organization.id, areaA.id)).map((row) => row.position),
      [0, 1],
    );
    assert.deepEqual(
      (await orderedSpaces(organization.id, areaB.id)).map((row) => row.position),
      [0],
    );

    await assert.rejects(
      layout.moveCommunitySpace({
        organizationId: organization.id,
        actorId: owner.id,
        spaceId: first.id,
        areaId: foreignArea.id,
        position: 0,
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "not_found",
    );
  } finally {
    await db
      .delete(organizations)
      .where(eq(organizations.id, organization.id));
    await db
      .delete(organizations)
      .where(eq(organizations.id, foreignOrganization.id));
  }
});

test("community management lock serializes account revocation", async () => {
  const suffix = randomUUID();
  const [organization] = await db
    .insert(organizations)
    .values({ name: `Layout lock ${suffix}`, slug: `layout-lock-${suffix}` })
    .returning({ id: organizations.id });
  try {
    const [owner] = await db
      .insert(users)
      .values({
        organizationId: organization.id,
        email: `layout-lock-${suffix}@example.test`,
        passwordHash: "not-a-login-hash",
        firstName: "Layout",
        lastName: "Lock",
        role: "owner",
      })
      .returning({ id: users.id });
    let managerLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      managerLocked = resolve;
    });
    let releaseManager!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseManager = resolve;
    });
    const managerTransaction = db.transaction(async (tx) => {
      await assertCommunityManager(tx, {
        organizationId: organization.id,
        actorId: owner.id,
      });
      managerLocked();
      await release;
    });
    await locked;
    const revoke = Promise.resolve(
      db
        .update(users)
        .set({ status: "disabled" })
        .where(
          and(
            eq(users.id, owner.id),
            eq(users.organizationId, organization.id),
          ),
        ),
    );
    assert.equal(
      await Promise.race([
        revoke.then(() => "revoked" as const),
        new Promise<"blocked">((resolve) =>
          setTimeout(() => resolve("blocked"), 100),
        ),
      ]),
      "blocked",
    );
    releaseManager();
    await Promise.all([managerTransaction, revoke]);
    await assert.rejects(
      layout.createCommunityArea({
        organizationId: organization.id,
        actorId: owner.id,
        title: "After revoke",
        slug: `after-revoke-${suffix}`,
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "forbidden",
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organization.id));
  }
});

test("community interaction waits for author deactivation and then fails closed", async () => {
  const suffix = randomUUID();
  const [organization] = await db
    .insert(organizations)
    .values({
      name: `Interaction lock ${suffix}`,
      slug: `interaction-lock-${suffix}`,
    })
    .returning({ id: organizations.id });
  try {
    const [author, viewer] = await db
      .insert(users)
      .values([
        {
          organizationId: organization.id,
          email: `interaction-author-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Interaction",
          lastName: "Author",
        },
        {
          organizationId: organization.id,
          email: `interaction-viewer-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Interaction",
          lastName: "Viewer",
        },
      ])
      .returning({ id: users.id });
    const [area] = await db
      .insert(communityAreas)
      .values({
        organizationId: organization.id,
        title: "Interaction",
        slug: `interaction-${suffix}`,
        sortOrder: 0,
      })
      .returning({ id: communityAreas.id });
    const [space] = await db
      .insert(communitySpaces)
      .values({
        organizationId: organization.id,
        areaId: area.id,
        title: "Interaction",
        slug: `interaction-${suffix}`,
        color: "#2b9188",
        type: "discussion",
        sortOrder: 0,
      })
      .returning({ id: communitySpaces.id });
    const [post] = await db
      .insert(posts)
      .values({
        organizationId: organization.id,
        spaceId: space.id,
        authorId: author.id,
        title: "Interaction",
        content: "Visible until the author is disabled.",
        moderationState: "published",
        publishedAt: new Date(),
      })
      .returning({ id: posts.id });

    let deactivationWritten!: () => void;
    const written = new Promise<void>((resolve) => {
      deactivationWritten = resolve;
    });
    let releaseDeactivation!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseDeactivation = resolve;
    });
    const deactivation = db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ status: "disabled" })
        .where(
          and(
            eq(users.id, author.id),
            eq(users.organizationId, organization.id),
          ),
        );
      deactivationWritten();
      await release;
    });
    await written;
    const reaction = setPostReactionMutation({
      organizationId: organization.id,
      postId: post.id,
      userId: viewer.id,
      reaction: "like",
    });
    assert.equal(
      await Promise.race([
        reaction.then(
          () => "reacted" as const,
          () => "rejected" as const,
        ),
        new Promise<"blocked">((resolve) =>
          setTimeout(() => resolve("blocked"), 100),
        ),
      ]),
      "blocked",
    );
    releaseDeactivation();
    await deactivation;
    await assert.rejects(
      reaction,
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "not_found",
    );
    const reactions = await db
      .select({ id: postLikes.postId })
      .from(postLikes)
      .where(
        and(
          eq(postLikes.organizationId, organization.id),
          eq(postLikes.postId, post.id),
        ),
      );
    assert.equal(reactions.length, 0);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organization.id));
  }
});
