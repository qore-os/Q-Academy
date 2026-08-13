import { addDays, subDays, subHours } from "date-fns";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { hash } from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import postgres from "postgres";
import {
  activityEvents,
  aiAgents,
  aiAgentVersions,
  aiConversations,
  aiMessages,
  announcements,
  apiKeys,
  assessmentAnswers,
  assessmentAttempts,
  badgeDefinitions,
  bundleCourses,
  bundles,
  comments,
  communityAreas,
  communityProfileSettings,
  communityPublicProfileFields,
  communitySpaces,
  contentBlocks,
  courseAccessGrants,
  courseAuthors,
  courseCategories,
  courseCertificates,
  courseCollaborators,
  courseLearningGoals,
  customFieldDefinitions,
  customFieldValues,
  dataFormFields,
  dataForms,
  dataProfileDefinitions,
  dataProfileFields,
  dataProfileValues,
  courseModules,
  courseWidgets,
  courseVersions,
  publishedCourseLinkEdges,
  courses,
  enrollments,
  eventAttendees,
  events,
  feedbackEntries,
  groupMembers,
  groups,
  hubs,
  lessonProgress,
  lessonPages,
  lessons,
  memberDataProfiles,
  memberBundles,
  modules,
  memberWelcomeSettings,
  notifications,
  organizations,
  platformSettings,
  pointTransactions,
  postLikes,
  postVotes,
  posts,
  submissions,
  users,
  userBadges,
  type CourseVersionSnapshot,
} from "../src/db/schema";
import { API_SCOPES } from "../src/lib/api/scopes";
import {
  buildAssessmentQuestionSnapshot,
  orderingItemId,
} from "../src/lib/assessment-engine";
import { loadProjectEnvironment } from "./load-environment";
import {
  assertDestructiveSeedAllowed,
  assertSeedDatabaseIdentity,
} from "./seed-guard";

loadProjectEnvironment();
const seedTarget = assertDestructiveSeedAllowed(process.env);

const client = postgres(seedTarget.databaseUrl, { max: 1, prepare: false });
const db = drizzle(client);

function contentBlockForSeedSnapshot(
  block: typeof contentBlocks.$inferSelect,
) {
  if (
    block.type !== "ordering" ||
    !Array.isArray(block.data.options) ||
    block.data.options.length < 2
  ) {
    return block;
  }
  const itemIds = block.data.options.map((option) =>
    orderingItemId(block.id, option),
  );
  return {
    ...block,
    data: {
      ...block.data,
      presentationOrder: [...itemIds.slice(1), itemIds[0]],
    },
  };
}

async function createPublishedSeedVersion(course: typeof courses.$inferSelect) {
  const learningGoalRows = await db
    .select()
    .from(courseLearningGoals)
    .where(
      and(
        eq(courseLearningGoals.courseId, course.id),
        eq(courseLearningGoals.organizationId, course.organizationId),
      ),
    )
    .orderBy(asc(courseLearningGoals.sortOrder), asc(courseLearningGoals.id));
  const authorRows = await db
    .select({
      relation: courseAuthors,
      author: {
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        avatarUrl: users.avatarUrl,
        jobTitle: users.jobTitle,
        bio: users.bio,
      },
    })
    .from(courseAuthors)
    .innerJoin(
      users,
      and(
        eq(users.id, courseAuthors.userId),
        eq(users.organizationId, courseAuthors.organizationId),
      ),
    )
    .where(
      and(
        eq(courseAuthors.courseId, course.id),
        eq(courseAuthors.organizationId, course.organizationId),
      ),
    )
    .orderBy(asc(courseAuthors.sortOrder), asc(courseAuthors.id));
  const widgetRows = await db
    .select({
      widget: courseWidgets,
      author: {
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        avatarUrl: users.avatarUrl,
        jobTitle: users.jobTitle,
        bio: users.bio,
      },
    })
    .from(courseWidgets)
    .leftJoin(
      users,
      and(
        eq(users.id, courseWidgets.authorUserId),
        eq(users.organizationId, courseWidgets.organizationId),
      ),
    )
    .where(
      and(
        eq(courseWidgets.courseId, course.id),
        eq(courseWidgets.organizationId, course.organizationId),
      ),
    )
    .orderBy(asc(courseWidgets.sortOrder), asc(courseWidgets.id));
  const moduleRows = await db
    .select({
      id: modules.id,
      organizationId: modules.organizationId,
      title: modules.title,
      kind: modules.kind,
      linkedCourseId: modules.linkedCourseId,
      description: modules.description,
      folder: modules.folder,
      isReusable: modules.isReusable,
      estimatedMinutes: modules.estimatedMinutes,
      createdAt: modules.createdAt,
      updatedAt: modules.updatedAt,
      sortOrder: courseModules.sortOrder,
      indentLevel: courseModules.indentLevel,
      accessMode: courseModules.accessMode,
      dripDays: courseModules.dripDays,
      delayPendingState: courseModules.delayPendingState,
      availableFrom: courseModules.availableFrom,
      availableUntil: courseModules.availableUntil,
      windowDefaultState: courseModules.windowDefaultState,
      windowState: courseModules.windowState,
      requestAccessEnabled: courseModules.requestAccessEnabled,
      isRequired: courseModules.isRequired,
    })
    .from(courseModules)
    .innerJoin(
      modules,
      and(
        eq(modules.id, courseModules.moduleId),
        eq(modules.organizationId, course.organizationId),
      ),
    )
    .where(
      and(
        eq(courseModules.courseId, course.id),
        eq(courseModules.organizationId, course.organizationId),
      ),
    )
    .orderBy(asc(courseModules.sortOrder), asc(modules.id));
  const moduleIds = moduleRows
    .filter((learningModule) => learningModule.kind !== "link")
    .map((learningModule) => learningModule.id);
  const linkedTargetIds = moduleRows.flatMap((learningModule) =>
    learningModule.kind === "link" && learningModule.linkedCourseId
      ? [learningModule.linkedCourseId]
      : [],
  );
  const linkedTargets = linkedTargetIds.length
    ? await db
        .select({
          id: courses.id,
          publishedVersionId: courses.publishedVersionId,
        })
        .from(courses)
        .where(
          and(
            eq(courses.organizationId, course.organizationId),
            inArray(courses.id, linkedTargetIds),
          ),
        )
    : [];
  const linkedTargetVersionById = new Map(
    linkedTargets.map((target) => [target.id, target.publishedVersionId]),
  );
  for (const targetId of linkedTargetIds) {
    if (!linkedTargetVersionById.get(targetId)) {
      throw new Error(
        `Seed link target ${targetId} must be published before ${course.slug}.`,
      );
    }
  }
  const lessonRows = moduleIds.length
    ? await db
        .select()
        .from(lessons)
        .where(
          and(
            eq(lessons.organizationId, course.organizationId),
            inArray(lessons.moduleId, moduleIds),
          ),
        )
        .orderBy(asc(lessons.moduleId), asc(lessons.sortOrder), asc(lessons.id))
    : [];
  const lessonIds = lessonRows.map((lesson) => lesson.id);
  const pageRows = lessonIds.length
    ? await db
        .select()
        .from(lessonPages)
        .where(inArray(lessonPages.lessonId, lessonIds))
        .orderBy(
          asc(lessonPages.lessonId),
          asc(lessonPages.sortOrder),
          asc(lessonPages.id),
        )
    : [];
  const blockRows = lessonIds.length
    ? await db
        .select()
        .from(contentBlocks)
        .where(inArray(contentBlocks.lessonId, lessonIds))
        .orderBy(
          asc(contentBlocks.lessonId),
          asc(contentBlocks.sortOrder),
          asc(contentBlocks.id),
        )
    : [];
  const blocksByLesson = new Map<string, typeof blockRows>();
  const blocksByPage = new Map<string, typeof blockRows>();
  for (const block of blockRows) {
    const snapshotBlock = contentBlockForSeedSnapshot(block);
    const target = block.pageId ? blocksByPage : blocksByLesson;
    const key = block.pageId ?? block.lessonId;
    const blocks = target.get(key) ?? [];
    blocks.push(snapshotBlock);
    target.set(key, blocks);
  }
  const pagesByLesson = new Map<
    string,
    CourseVersionSnapshot["modules"][number]["lessons"][number]["pages"]
  >();
  for (const page of pageRows) {
    const pages = pagesByLesson.get(page.lessonId) ?? [];
    pages.push({
      ...page,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
      blocks: blocksByPage.get(page.id) ?? [],
    });
    pagesByLesson.set(page.lessonId, pages);
  }
  const lessonsByModule = new Map<
    string,
    CourseVersionSnapshot["modules"][number]["lessons"]
  >();
  for (const lesson of lessonRows) {
    const moduleLessonRows = lessonsByModule.get(lesson.moduleId) ?? [];
    moduleLessonRows.push({
      ...lesson,
      availableAt: lesson.availableAt?.toISOString() ?? null,
      createdAt: lesson.createdAt.toISOString(),
      updatedAt: lesson.updatedAt.toISOString(),
      blocks: blocksByLesson.get(lesson.id) ?? [],
      pages: pagesByLesson.get(lesson.id) ?? [],
    });
    lessonsByModule.set(lesson.moduleId, moduleLessonRows);
  }
  const publishedAt = new Date();
  const snapshot: CourseVersionSnapshot = {
    schemaVersion: 6,
    accessPolicyVersion: 2,
    moduleKindVersion: 1,
    courseOutlineVersion: 1,
    capturedAt: publishedAt.toISOString(),
    course: {
      ...course,
      createdAt: course.createdAt.toISOString(),
      updatedAt: publishedAt.toISOString(),
      firstPublishedAt: (
        course.firstPublishedAt ?? publishedAt
      ).toISOString(),
    },
    learningGoals: learningGoalRows.map((goal) => ({
      ...goal,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString(),
    })),
    authors: authorRows.map(({ relation, author }) => ({
      ...relation,
      createdAt: relation.createdAt.toISOString(),
      author,
    })),
    widgets: widgetRows.map(({ widget, author }) => ({
      ...widget,
      createdAt: widget.createdAt.toISOString(),
      updatedAt: widget.updatedAt.toISOString(),
      author,
    })),
    modules: moduleRows.map((learningModule) => ({
      ...learningModule,
      targetVersionIdAtCapture:
        learningModule.kind === "link" && learningModule.linkedCourseId
          ? (linkedTargetVersionById.get(learningModule.linkedCourseId) ?? null)
          : null,
      availableFrom: learningModule.availableFrom?.toISOString() ?? null,
      availableUntil: learningModule.availableUntil?.toISOString() ?? null,
      createdAt: learningModule.createdAt.toISOString(),
      updatedAt: learningModule.updatedAt.toISOString(),
      lessons: lessonsByModule.get(learningModule.id) ?? [],
    })),
  };
  const [version] = await db
    .insert(courseVersions)
    .values({
      organizationId: course.organizationId,
      courseId: course.id,
      version: 1,
      snapshot,
      changelog: "Initiale Demo-Veroeffentlichung.",
      publishedAt,
      createdById: course.createdById,
    })
    .returning({ id: courseVersions.id });
  await db
    .update(courses)
    .set({
      publishedVersionId: version.id,
      firstPublishedAt: course.firstPublishedAt ?? publishedAt,
      updatedAt: publishedAt,
    })
    .where(eq(courses.id, course.id));
  const linkModules = moduleRows.filter(
    (learningModule) =>
      learningModule.kind === "link" && learningModule.linkedCourseId,
  );
  if (linkModules.length) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select q_academy_lock_course_link_graph(${course.organizationId}::uuid)`,
      );
      await tx.insert(publishedCourseLinkEdges).values(
        linkModules.map((learningModule) => ({
          organizationId: course.organizationId,
          sourceCourseId: course.id,
          sourceVersionId: version.id,
          linkModuleId: learningModule.id,
          targetCourseId: learningModule.linkedCourseId!,
        })),
      );
    });
  }
}

const [databaseIdentity] = await client<
  { databaseName: string; serverAddress: string | null }[]
>`
  select
    current_database() as "databaseName",
    host(inet_server_addr()) as "serverAddress"
`;
assertSeedDatabaseIdentity({
  expectedDatabaseName: seedTarget.databaseName,
  actualDatabaseName: databaseIdentity.databaseName,
  serverAddress: databaseIdentity.serverAddress,
});

console.log(`Resetting Q-Academy demo data in ${seedTarget.databaseName}...`);
await db.transaction(async (tx) => {
  // The destructive demo seed is already restricted to an explicitly
  // confirmed loopback database. These named guards intentionally block
  // ordinary tenant deletion; suspend only their row-delete checks while
  // the complete demo tenant is removed atomically. A failed transaction
  // rolls every trigger change back with the data reset.
  await tx.execute(
    sql`ALTER TABLE privacy_request_events DISABLE TRIGGER privacy_request_events_append_only`,
  );
  await tx.execute(
    sql`ALTER TABLE community_moderation_events DISABLE TRIGGER community_moderation_events_immutable_rows_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_action_events DISABLE TRIGGER ai_agent_action_events_append_only_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_membership_provenance DISABLE TRIGGER ai_agent_membership_provenance_reject_delete_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_action_requests DISABLE TRIGGER ai_agent_action_requests_payload_protect_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_versions DISABLE TRIGGER ai_agent_versions_protect_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_version_sources DISABLE TRIGGER ai_agent_version_sources_protect_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_version_access_grants DISABLE TRIGGER ai_agent_version_access_grants_protect_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_version_actions DISABLE TRIGGER ai_agent_version_actions_protect_trigger`,
  );
  await tx.execute(sql`DELETE FROM organizations`);
  await tx.execute(sql`DELETE FROM auth_rate_limits`);
  await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
  await tx.execute(
    sql`ALTER TABLE ai_agent_version_actions ENABLE TRIGGER ai_agent_version_actions_protect_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_version_access_grants ENABLE TRIGGER ai_agent_version_access_grants_protect_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_version_sources ENABLE TRIGGER ai_agent_version_sources_protect_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_versions ENABLE TRIGGER ai_agent_versions_protect_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_action_requests ENABLE TRIGGER ai_agent_action_requests_payload_protect_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_action_events ENABLE TRIGGER ai_agent_action_events_append_only_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE ai_agent_membership_provenance ENABLE TRIGGER ai_agent_membership_provenance_reject_delete_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE community_moderation_events ENABLE TRIGGER community_moderation_events_immutable_rows_trigger`,
  );
  await tx.execute(
    sql`ALTER TABLE privacy_request_events ENABLE TRIGGER privacy_request_events_append_only`,
  );
});

const localDataRoot = path.resolve(".data");
const privacyExportRoot = path.resolve(localDataRoot, "privacy-exports");
const privacyExportRelative = path.relative(localDataRoot, privacyExportRoot);
if (
  !privacyExportRelative ||
  privacyExportRelative.startsWith("..") ||
  path.isAbsolute(privacyExportRelative)
) {
  throw new Error("The local privacy export reset path is invalid.");
}
await rm(privacyExportRoot, { recursive: true, force: true });

const [organization] = await db
  .insert(organizations)
  .values({
    name: "Q-Academy",
    slug: "q-academy",
    description:
      "Die interne Akademie fuer produktive und verantwortungsvolle KI-Nutzung.",
    primaryColor: "#17324d",
    accentColor: "#2bb7a9",
    logoMark: "Q",
  })
  .returning();

const passwordHash = await hash("Demo123!", 12);

const userSeed = [
  [
    "admin@q-academy.de",
    "Anna",
    "Berger",
    "owner",
    "Academy Lead",
    "Learning & Development",
    2480,
  ],
  [
    "marco@q-academy.de",
    "Marco",
    "Stein",
    "trainer",
    "KI-Trainer",
    "Enablement",
    1640,
  ],
  [
    "sarah@q-academy.de",
    "Sarah",
    "Nguyen",
    "admin",
    "Community Managerin",
    "People",
    1920,
  ],
  [
    "lea@q-academy.de",
    "Lea",
    "Hartmann",
    "member",
    "Product Managerin",
    "Produkt",
    860,
  ],
  [
    "jonas@q-academy.de",
    "Jonas",
    "Wolf",
    "member",
    "Account Executive",
    "Sales",
    720,
  ],
  [
    "melina@q-academy.de",
    "Melina",
    "Koch",
    "member",
    "UX Researcherin",
    "Produkt",
    1180,
  ],
  [
    "david@q-academy.de",
    "David",
    "Yilmaz",
    "member",
    "Team Lead Sales",
    "Sales",
    940,
  ],
  [
    "nora@q-academy.de",
    "Nora",
    "Fischer",
    "member",
    "Content Strategin",
    "Marketing",
    690,
  ],
  [
    "emil@q-academy.de",
    "Emil",
    "Roth",
    "member",
    "Data Analyst",
    "Operations",
    810,
  ],
  [
    "mina@q-academy.de",
    "Mina",
    "Seidel",
    "member",
    "People Partner",
    "People",
    530,
  ],
  [
    "felix@q-academy.de",
    "Felix",
    "Brandt",
    "member",
    "Software Engineer",
    "Engineering",
    1010,
  ],
  [
    "aylin@q-academy.de",
    "Aylin",
    "Demir",
    "member",
    "Marketing Lead",
    "Marketing",
    1340,
  ],
] as const;

const insertedUsers = await db
  .insert(users)
  .values(
    userSeed.map(
      (
        [email, firstName, lastName, role, jobTitle, department, points],
        index,
      ) => ({
        organizationId: organization.id,
        email,
        passwordHash,
        firstName,
        lastName,
        role,
        jobTitle,
        department,
        points,
        bio:
          index === 3
            ? "Ich entwickle digitale Produkte und teste, wie KI unsere taegliche Arbeit besser machen kann."
            : null,
        lastLoginAt:
          index < 8
            ? subHours(new Date(), index * 3 + 1)
            : subDays(new Date(), index),
        createdAt: subDays(new Date(), 70 - index * 3),
      }),
    ),
  )
  .returning();

const userByEmail = new Map(insertedUsers.map((user) => [user.email, user]));
const admin = userByEmail.get("admin@q-academy.de")!;
const trainer = userByEmail.get("marco@q-academy.de")!;
const member = userByEmail.get("lea@q-academy.de")!;

const demoApiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
await db.insert(apiKeys).values({
  organizationId: organization.id,
  name: "Lokale Entwicklung",
  prefix: demoApiKey.slice(0, 17),
  keyHash: createHash("sha256").update(demoApiKey).digest("hex"),
  scopes: [...API_SCOPES],
  createdById: admin.id,
});

const profileFields = await db
  .insert(customFieldDefinitions)
  .values([
    {
      organizationId: organization.id,
      key: "standort",
      label: "Standort",
      type: "select",
      category: "Organisation",
      options: ["Berlin", "Hamburg", "Remote"],
      sortOrder: 1,
    },
    {
      organizationId: organization.id,
      key: "ki_erfahrung",
      label: "KI-Erfahrung",
      type: "select",
      category: "Lernprofil",
      options: ["Einsteiger", "Fortgeschritten", "Experte"],
      sortOrder: 1,
    },
    {
      organizationId: organization.id,
      key: "lernziele",
      label: "Persoenliche Lernziele",
      type: "text",
      category: "Lernprofil",
      sortOrder: 2,
    },
  ])
  .returning();

await db.insert(customFieldValues).values([
  {
    organizationId: organization.id,
    userId: member.id,
    fieldId: profileFields[0].id,
    value: "Berlin",
  },
  {
    organizationId: organization.id,
    userId: member.id,
    fieldId: profileFields[1].id,
    value: "Fortgeschritten",
  },
  {
    organizationId: organization.id,
    userId: member.id,
    fieldId: profileFields[2].id,
    value: "KI-gestuetzte Research- und Produktworkflows sicher aufbauen",
  },
]);

const insertedProfileDefinitions = await db
  .insert(dataProfileDefinitions)
  .values([
    {
      organizationId: organization.id,
      key: "default",
      name: "Standardprofil",
      description: "Allgemeine Angaben fuer personalisierte Lerninhalte.",
      allowMemberCreation: false,
      sortOrder: 0,
    },
    {
      organizationId: organization.id,
      key: "projektprofil",
      name: "Projektprofil",
      description:
        "Zusaetzliche Profile fuer unterschiedliche Projekte und Lernziele.",
      allowMemberCreation: true,
      sortOrder: 1,
    },
  ])
  .returning();
const defaultProfileDefinition = insertedProfileDefinitions.find(
  (definition) => definition.key === "default",
)!;
const projectProfileDefinition = insertedProfileDefinitions.find(
  (definition) => definition.key === "projektprofil",
)!;
const profileFieldByKey = new Map(
  profileFields.map((field) => [field.key, field]),
);

await db.insert(dataProfileFields).values([
  ...profileFields.map((field, index) => ({
    organizationId: organization.id,
    profileDefinitionId: defaultProfileDefinition.id,
    fieldId: field.id,
    sortOrder: index,
  })),
  {
    organizationId: organization.id,
    profileDefinitionId: projectProfileDefinition.id,
    fieldId: profileFieldByKey.get("ki_erfahrung")!.id,
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    profileDefinitionId: projectProfileDefinition.id,
    fieldId: profileFieldByKey.get("lernziele")!.id,
    sortOrder: 1,
  },
]);

const defaultMemberProfiles = await db
  .insert(memberDataProfiles)
  .values(
    insertedUsers.map((seededUser) => ({
      organizationId: organization.id,
      userId: seededUser.id,
      definitionId: defaultProfileDefinition.id,
      name: "Standardprofil",
      isDefault: true,
    })),
  )
  .returning();
const memberDefaultProfile = defaultMemberProfiles.find(
  (profile) => profile.userId === member.id,
)!;

const [memberProjectProfile] = await db
  .insert(memberDataProfiles)
  .values({
    organizationId: organization.id,
    userId: member.id,
    definitionId: projectProfileDefinition.id,
    name: "KI-Research Pilot",
  })
  .returning();

await db.insert(dataProfileValues).values([
  {
    organizationId: organization.id,
    userId: member.id,
    profileId: memberDefaultProfile.id,
    fieldId: profileFieldByKey.get("standort")!.id,
    value: "Berlin",
  },
  {
    organizationId: organization.id,
    userId: member.id,
    profileId: memberDefaultProfile.id,
    fieldId: profileFieldByKey.get("ki_erfahrung")!.id,
    value: "Fortgeschritten",
  },
  {
    organizationId: organization.id,
    userId: member.id,
    profileId: memberDefaultProfile.id,
    fieldId: profileFieldByKey.get("lernziele")!.id,
    value: "KI-gestuetzte Research- und Produktworkflows sicher aufbauen",
  },
  {
    organizationId: organization.id,
    userId: member.id,
    profileId: memberProjectProfile.id,
    fieldId: profileFieldByKey.get("ki_erfahrung")!.id,
    value: "Fortgeschritten",
  },
  {
    organizationId: organization.id,
    userId: member.id,
    profileId: memberProjectProfile.id,
    fieldId: profileFieldByKey.get("lernziele")!.id,
    value: "Interview-Erkenntnisse mit Quellenbelegen strukturieren",
  },
]);

const insertedDataForms = await db
  .insert(dataForms)
  .values([
    {
      organizationId: organization.id,
      profileDefinitionId: defaultProfileDefinition.id,
      key: "lernziel_checkin",
      name: "Lernziel-Check-in",
      description:
        "Aktualisiere deine Erfahrung und dein persoenliches Lernziel direkt im Kurs.",
      submitLabel: "Lernziel speichern",
    },
    {
      organizationId: organization.id,
      profileDefinitionId: projectProfileDefinition.id,
      key: "projekt_checkin",
      name: "Projekt-Check-in",
      description: "Pflege die Lernziele eines ausgewaehlten Projektprofils.",
      submitLabel: "Projektprofil speichern",
    },
  ])
  .returning();
const learningProfileForm = insertedDataForms.find(
  (form) => form.key === "lernziel_checkin",
)!;
const projectProfileForm = insertedDataForms.find(
  (form) => form.key === "projekt_checkin",
)!;

await db.insert(dataFormFields).values([
  {
    organizationId: organization.id,
    formId: learningProfileForm.id,
    fieldId: profileFieldByKey.get("ki_erfahrung")!.id,
    requiredOverride: true,
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    formId: learningProfileForm.id,
    fieldId: profileFieldByKey.get("lernziele")!.id,
    requiredOverride: true,
    sortOrder: 1,
  },
  {
    organizationId: organization.id,
    formId: projectProfileForm.id,
    fieldId: profileFieldByKey.get("ki_erfahrung")!.id,
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    formId: projectProfileForm.id,
    fieldId: profileFieldByKey.get("lernziele")!.id,
    requiredOverride: true,
    sortOrder: 1,
  },
]);

const seededBadges = await db
  .insert(badgeDefinitions)
  .values([
    {
      organizationId: organization.id,
      name: "Erste Schritte",
      slug: "erste-schritte",
      description: "Die ersten 500 Community- und Lernpunkte gesammelt.",
      icon: "footprints",
      color: "#2bb7a9",
      pointsThreshold: 500,
    },
    {
      organizationId: organization.id,
      name: "Praxisprofi",
      slug: "praxisprofi",
      description: "Mehr als 1.000 Punkte durch aktives Lernen erreicht.",
      icon: "award",
      color: "#4f7cac",
      pointsThreshold: 1000,
    },
    {
      organizationId: organization.id,
      name: "AI Champion",
      slug: "ai-champion",
      description: "2.000 Punkte und nachhaltigen Wissenstransfer erreicht.",
      icon: "trophy",
      color: "#d6a536",
      pointsThreshold: 2000,
    },
  ])
  .returning();

await db.insert(pointTransactions).values(
  insertedUsers.map((seededUser) => ({
    organizationId: organization.id,
    userId: seededUser.id,
    amount: seededUser.points,
    reason: "seed.initial",
    entityType: "user",
    entityId: seededUser.id,
  })),
);
const badgeAwards = insertedUsers.flatMap((seededUser) =>
  seededBadges
    .filter(
      (badge) =>
        badge.pointsThreshold !== null &&
        seededUser.points >= badge.pointsThreshold,
    )
    .map((badge) => ({
      organizationId: organization.id,
      userId: seededUser.id,
      badgeId: badge.id,
      source: `points:${seededUser.points}`,
    })),
);
if (badgeAwards.length) await db.insert(userBadges).values(badgeAwards);

const insertedGroups = await db
  .insert(groups)
  .values([
    {
      organizationId: organization.id,
      name: "Cohorte Juli 2026",
      description: "Neue Lernkohorte fuer das KI-Basisprogramm.",
      color: "#2bb7a9",
    },
    {
      organizationId: organization.id,
      name: "Sales",
      description: "KI-Anwendungen fuer Beratung und Vertrieb.",
      color: "#ee6c5d",
    },
    {
      organizationId: organization.id,
      name: "Marketing",
      description: "Content, Kampagnen und Markenarbeit mit KI.",
      color: "#d6a536",
    },
    {
      organizationId: organization.id,
      name: "Fuehrungskraefte",
      description: "Strategie, Governance und Change.",
      color: "#4f7cac",
    },
  ])
  .returning();

await db.insert(groupMembers).values([
  { groupId: insertedGroups[0].id, userId: member.id },
  {
    groupId: insertedGroups[0].id,
    userId: userByEmail.get("melina@q-academy.de")!.id,
  },
  {
    groupId: insertedGroups[0].id,
    userId: userByEmail.get("emil@q-academy.de")!.id,
  },
  {
    groupId: insertedGroups[1].id,
    userId: userByEmail.get("jonas@q-academy.de")!.id,
  },
  {
    groupId: insertedGroups[1].id,
    userId: userByEmail.get("david@q-academy.de")!.id,
  },
  {
    groupId: insertedGroups[2].id,
    userId: userByEmail.get("nora@q-academy.de")!.id,
  },
  {
    groupId: insertedGroups[2].id,
    userId: userByEmail.get("aylin@q-academy.de")!.id,
  },
  {
    groupId: insertedGroups[3].id,
    userId: userByEmail.get("david@q-academy.de")!.id,
  },
]);

const insertedCategories = await db
  .insert(courseCategories)
  .values([
    {
      organizationId: organization.id,
      name: "Grundlagen",
      slug: "grundlagen",
      description: "Sicherer Einstieg in generative KI.",
      color: "#2bb7a9",
      sortOrder: 1,
    },
    {
      organizationId: organization.id,
      name: "Praxis",
      slug: "praxis",
      description: "Direkt anwendbare Methoden und Workflows.",
      color: "#ee6c5d",
      sortOrder: 2,
    },
    {
      organizationId: organization.id,
      name: "Leadership",
      slug: "leadership",
      description: "KI-Strategie fuer Teams und Organisationen.",
      color: "#4f7cac",
      sortOrder: 3,
    },
    {
      organizationId: organization.id,
      name: "Compliance",
      slug: "compliance",
      description: "Governance, Datenschutz und Verantwortung.",
      color: "#d6a536",
      sortOrder: 4,
    },
  ])
  .returning();

const categoryBySlug = new Map(
  insertedCategories.map((category) => [category.slug, category]),
);

const insertedCourses = await db
  .insert(courses)
  .values([
    {
      organizationId: organization.id,
      categoryId: categoryBySlug.get("grundlagen")!.id,
      title: "KI-Grundlagen",
      slug: "ki-grundlagen",
      shortDescription:
        "Verstehe generative KI und setze sie sicher im Arbeitsalltag ein.",
      description:
        "Du lernst die wichtigsten Begriffe, Chancen und Grenzen generativer KI kennen. Praktische Uebungen helfen dir, direkt produktiv zu werden.",
      coverImage: "/images/courses/foundations.webp",
      status: "published",
      difficulty: "Grundlagen",
      estimatedMinutes: 155,
      featured: true,
      createdById: admin.id,
    },
    {
      organizationId: organization.id,
      categoryId: categoryBySlug.get("praxis")!.id,
      title: "Prompt Engineering Masterclass",
      slug: "prompt-engineering-masterclass",
      shortDescription: "Von klaren Anweisungen zu verlaesslichen Ergebnissen.",
      description:
        "Entwickle wiederverwendbare Prompt-Muster, strukturiere komplexe Aufgaben und bewerte Ergebnisse systematisch.",
      coverImage: "/images/courses/prompts.webp",
      status: "published",
      difficulty: "Fortgeschritten",
      estimatedMinutes: 210,
      featured: true,
      createdById: trainer.id,
    },
    {
      organizationId: organization.id,
      categoryId: categoryBySlug.get("praxis")!.id,
      title: "KI-Workflows automatisieren",
      slug: "ki-workflows-automatisieren",
      shortDescription: "Verbinde Tools, Daten und KI zu robusten Ablaeufen.",
      description:
        "Von der Prozessanalyse bis zum produktiven Workflow: Du baust Automationen, die nachvollziehbar und wartbar bleiben.",
      coverImage: "/images/courses/workflows.webp",
      status: "published",
      difficulty: "Fortgeschritten",
      estimatedMinutes: 240,
      featured: false,
      createdById: trainer.id,
    },
    {
      organizationId: organization.id,
      categoryId: categoryBySlug.get("compliance")!.id,
      title: "Responsible AI & DSGVO",
      slug: "responsible-ai-dsgvo",
      shortDescription:
        "Entscheide sicher, welche Daten und Tools du verwenden darfst.",
      description:
        "Praxisnahe Leitplanken fuer Datenschutz, Urheberrecht, Bias und nachvollziehbare KI-Entscheidungen.",
      coverImage: "/images/courses/responsible-ai.webp",
      status: "published",
      difficulty: "Alle Level",
      estimatedMinutes: 125,
      featured: true,
      createdById: admin.id,
    },
    {
      organizationId: organization.id,
      categoryId: categoryBySlug.get("leadership")!.id,
      title: "AI Leadership",
      slug: "ai-leadership",
      shortDescription: "Fuehre Teams durch den Wandel von Arbeit mit KI.",
      description:
        "Strategie, Operating Model und Kommunikation fuer Fuehrungskraefte, die KI verantwortungsvoll skalieren wollen.",
      coverImage: "/images/courses/foundations.webp",
      status: "draft",
      difficulty: "Leadership",
      estimatedMinutes: 180,
      featured: false,
      createdById: admin.id,
    },
  ])
  .returning();

const courseBySlug = new Map(
  insertedCourses.map((course) => [course.slug, course]),
);

const insertedModules = await db
  .insert(modules)
  .values([
    {
      organizationId: organization.id,
      title: "Willkommen & Orientierung",
      description: "Ziele, Lernpfad und persoenlicher Ausgangspunkt.",
      folder: "Onboarding",
      estimatedMinutes: 20,
    },
    {
      organizationId: organization.id,
      title: "Wie generative KI arbeitet",
      description: "Modelle, Tokens, Kontext und Wahrscheinlichkeiten.",
      folder: "KI-Grundlagen",
      estimatedMinutes: 55,
    },
    {
      organizationId: organization.id,
      title: "Prompting Basics",
      description: "Ziel, Kontext, Format und Qualitaetskriterien.",
      folder: "Prompting",
      estimatedMinutes: 80,
    },
    {
      organizationId: organization.id,
      title: "Prompt Patterns",
      description: "Wiederverwendbare Muster fuer komplexe Aufgaben.",
      folder: "Prompting",
      estimatedMinutes: 120,
    },
    {
      organizationId: organization.id,
      title: "Workflow Discovery",
      description: "Prozesse analysieren und Automationspotenzial bewerten.",
      folder: "Automation",
      estimatedMinutes: 70,
    },
    {
      organizationId: organization.id,
      title: "Automationen bauen",
      description: "Trigger, Datenfluss, Fehlerpfade und Monitoring.",
      folder: "Automation",
      estimatedMinutes: 130,
    },
    {
      organizationId: organization.id,
      title: "KI-Sicherheit kompakt",
      description: "Wiederverwendbares Pflichtmodul zu Daten und Risiken.",
      folder: "Compliance",
      estimatedMinutes: 50,
      isReusable: true,
    },
    {
      organizationId: organization.id,
      title: "Governance in der Praxis",
      description: "Rollen, Freigaben und Risikoklassen.",
      folder: "Compliance",
      estimatedMinutes: 75,
    },
    {
      organizationId: organization.id,
      title: "Fuehren im KI-Zeitalter",
      description: "Klarheit, Beteiligung und neue Arbeitsweisen.",
      folder: "Leadership",
      estimatedMinutes: 110,
    },
  ])
  .returning();

const moduleByTitle = new Map(
  insertedModules.map((module) => [module.title, module]),
);

await db.insert(courseModules).values(
  [
  {
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    moduleId: moduleByTitle.get("Willkommen & Orientierung")!.id,
    sortOrder: 1,
  },
  {
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    moduleId: moduleByTitle.get("Wie generative KI arbeitet")!.id,
    sortOrder: 2,
    accessMode: "after_previous" as const,
  },
  {
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    moduleId: moduleByTitle.get("Prompting Basics")!.id,
    sortOrder: 3,
    accessMode: "locked" as const,
    requestAccessEnabled: true,
  },
  {
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    moduleId: moduleByTitle.get("Prompting Basics")!.id,
    sortOrder: 1,
  },
  {
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    moduleId: moduleByTitle.get("Prompt Patterns")!.id,
    sortOrder: 2,
    accessMode: "coming_soon" as const,
  },
  {
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    moduleId: moduleByTitle.get("KI-Sicherheit kompakt")!.id,
    sortOrder: 3,
  },
  {
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    moduleId: moduleByTitle.get("Workflow Discovery")!.id,
    sortOrder: 1,
  },
  {
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    moduleId: moduleByTitle.get("Automationen bauen")!.id,
    sortOrder: 2,
    accessMode: "delay_days" as const,
    dripDays: 7,
    delayPendingState: "hidden" as const,
  },
  {
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    moduleId: moduleByTitle.get("KI-Sicherheit kompakt")!.id,
    sortOrder: 3,
  },
  {
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    moduleId: moduleByTitle.get("KI-Sicherheit kompakt")!.id,
    sortOrder: 1,
  },
  {
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    moduleId: moduleByTitle.get("Governance in der Praxis")!.id,
    sortOrder: 2,
  },
  {
    courseId: courseBySlug.get("ai-leadership")!.id,
    moduleId: moduleByTitle.get("Fuehren im KI-Zeitalter")!.id,
    sortOrder: 1,
  },
  {
    courseId: courseBySlug.get("ai-leadership")!.id,
    moduleId: moduleByTitle.get("KI-Sicherheit kompakt")!.id,
    sortOrder: 2,
  },
  ].map((assignment) => ({
    organizationId: organization.id,
    ...assignment,
  })),
);

await db.transaction(async (tx) => {
  await tx.execute(
    sql`select q_academy_lock_course_link_graph(${organization.id}::uuid)`,
  );
  const [courseLinkModule] = await tx
    .insert(modules)
    .values({
      organizationId: organization.id,
      title: "Vertiefung: Prompt Engineering",
      kind: "link",
      linkedCourseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
      description:
        "Oeffnet den weiterfuehrenden Prompt-Kurs fuer Mitglieder mit eigenem Zielkurszugriff.",
      folder: "Kursnavigation",
      estimatedMinutes: 1,
      isReusable: false,
    })
    .returning();
  await tx.insert(courseModules).values({
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    moduleId: courseLinkModule.id,
    sortOrder: 4,
    indentLevel: 1,
    isRequired: false,
  });
});

const lessonTemplates: Record<
  string,
  Array<
    [string, string, "lesson" | "quiz" | "assignment" | "exam" | "live", number]
  >
> = {
  "Willkommen & Orientierung": [
    ["Dein Start in die Q-Academy", "dein-start", "lesson", 8],
    ["Dein KI-Selbstcheck", "ki-selbstcheck", "quiz", 12],
  ],
  "Wie generative KI arbeitet": [
    [
      "Was ein Sprachmodell wirklich tut",
      "sprachmodelle-verstehen",
      "lesson",
      18,
    ],
    ["Kontext, Tokens und Halluzinationen", "kontext-und-tokens", "lesson", 22],
    ["Wissenscheck: Modelle", "wissenscheck-modelle", "quiz", 15],
  ],
  "Prompting Basics": [
    ["Die vier Bausteine guter Prompts", "vier-bausteine", "lesson", 20],
    ["Kontext statt Ratespiel", "kontext-statt-ratespiel", "lesson", 18],
    ["Praxisaufgabe: Dein erster Prompt", "erster-prompt", "assignment", 30],
  ],
  "Prompt Patterns": [
    [
      "Rollen und Perspektiven gezielt nutzen",
      "rollen-und-perspektiven",
      "lesson",
      25,
    ],
    [
      "Beispiele und Bewertungskriterien",
      "beispiele-und-kriterien",
      "lesson",
      28,
    ],
    ["Prompt Review", "prompt-review", "assignment", 35],
  ],
  "Workflow Discovery": [
    ["Den richtigen Prozess auswaehlen", "prozess-auswaehlen", "lesson", 25],
    ["Workflow Canvas", "workflow-canvas", "assignment", 35],
  ],
  "Automationen bauen": [
    ["Trigger, Schritte und Daten", "trigger-schritte-daten", "lesson", 32],
    ["Fehlerpfade und Human-in-the-loop", "fehlerpfade", "lesson", 30],
    ["Dein produktiver Workflow", "produktiver-workflow", "assignment", 45],
  ],
  "KI-Sicherheit kompakt": [
    ["Welche Daten duerfen in welches Tool?", "daten-und-tools", "lesson", 20],
    ["Risiken schnell einschaetzen", "risiken-einschaetzen", "quiz", 18],
    ["Sicherheits-Check", "sicherheits-check", "exam", 12],
  ],
  "Governance in der Praxis": [
    ["Risikoklassen und Freigaben", "risikoklassen", "lesson", 22],
    ["AI Act und DSGVO im Alltag", "ai-act-dsgvo", "lesson", 28],
  ],
  "Fuehren im KI-Zeitalter": [
    ["Von Experimenten zu Standards", "experimente-zu-standards", "lesson", 28],
    ["Teamdialog: Arbeit neu gestalten", "teamdialog", "live", 45],
  ],
};

const insertedLessons: Array<typeof lessons.$inferSelect> = [];
for (const [moduleTitle, templates] of Object.entries(lessonTemplates)) {
  const learningModule = moduleByTitle.get(moduleTitle)!;
  const rows = await db
    .insert(lessons)
    .values(
      templates.map(([title, slug, type, durationMinutes], index) => ({
        organizationId: organization.id,
        moduleId: learningModule.id,
        title,
        slug,
        type,
        durationMinutes,
        ...(type === "exam"
          ? {
              examDurationSeconds: 15 * 60,
              examResultReleaseMode: "immediate" as const,
              examReviewReleaseMode: "after_result" as const,
              examContentAccessMode: "block_course" as const,
            }
          : {}),
        sortOrder: index + 1,
        visibility:
          slug === "teamdialog" ? ("coming_soon" as const) : ("visible" as const),
        summary: `Lerne ${title.toLowerCase()} und uebertrage das Wissen direkt auf deinen Arbeitsalltag.`,
        status: "published" as const,
      })),
    )
    .returning();
  insertedLessons.push(...rows);
}

for (const lesson of insertedLessons) {
  const isQuiz = lesson.type === "quiz" || lesson.type === "exam";
  const isAssignment = lesson.type === "assignment";
  await db.insert(contentBlocks).values([
    {
      lessonId: lesson.id,
      type: "eyebrow",
      sortOrder: 1,
      data: {
        text:
          lesson.type === "lesson" ? "LERNIMPULS" : lesson.type.toUpperCase(),
        accent: "teal",
      },
    },
    {
      lessonId: lesson.id,
      type: "heading",
      sortOrder: 2,
      data: { text: lesson.title },
    },
    {
      lessonId: lesson.id,
      type: "text",
      sortOrder: 3,
      data: {
        text: `In dieser Einheit arbeitest du mit einem klaren Praxisbeispiel. Achte darauf, Annahmen sichtbar zu machen und das Ergebnis nicht nur schneller, sondern auch besser pruefbar zu gestalten.`,
      },
    },
    {
      lessonId: lesson.id,
      type: "info",
      title: "Praxisregel",
      sortOrder: 4,
      data: {
        text: "Gib der KI Ziel, Kontext, Format und Qualitaetskriterien. Pruefe sensible Daten immer vor der Eingabe.",
        accent: "amber",
      },
    },
    isQuiz
      ? {
          lessonId: lesson.id,
          type: "multiple_choice",
          title: "Kurzer Wissenscheck",
          sortOrder: 5,
          required: true,
          data: {
            prompt:
              "Welche Vorgehensweise liefert in der Regel das verlaesslichste Ergebnis?",
            options: [
              "Eine moeglichst kurze Frage ohne Kontext",
              "Ein klarer Auftrag mit Kontext und Pruefkriterien",
              "Dasselbe Prompt mehrfach unveraendert senden",
            ],
            correctOption: 1,
          },
        }
      : isAssignment
        ? {
            lessonId: lesson.id,
            type: "submission",
            title: "Deine Abgabe",
            sortOrder: 5,
            required: true,
            data: {
              prompt:
                "Beschreibe deinen Anwendungsfall, deinen Entwurf und wie du das Ergebnis geprueft hast.",
              accent: "coral",
            },
          }
        : {
            lessonId: lesson.id,
            type: "checklist",
            title: "Transfer in deinen Alltag",
            sortOrder: 5,
            required: true,
            data: {
              items: [
                "Ich kann das Prinzip in eigenen Worten erklaeren.",
                "Ich habe einen konkreten Anwendungsfall notiert.",
                "Ich kenne den naechsten sinnvollen Test.",
              ],
            },
          },
  ]);
}

const responsibleExamFixture = await db.transaction(async (tx) => {
  const [examModule] = await tx
    .insert(modules)
    .values({
      organizationId: organization.id,
      title: "Abschlusspruefung Responsible AI",
      kind: "exam",
      description:
        "Automatische Wissensfragen und eine gepruefte Transferabgabe in einem Pruefungsablauf.",
      folder: "Compliance",
      estimatedMinutes: 35,
      isReusable: true,
    })
    .returning();
  await tx.insert(courseModules).values({
    organizationId: organization.id,
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    moduleId: examModule.id,
    sortOrder: 3,
    isRequired: true,
  });
  const [examLesson] = await tx
    .insert(lessons)
    .values({
      organizationId: organization.id,
      moduleId: examModule.id,
      title: examModule.title,
      slug: "abschlusspruefung-responsible-ai",
      summary:
        "Weise Fachwissen und den sicheren Transfer in einen realen Anwendungsfall nach.",
      type: "exam",
      durationMinutes: 35,
      passingScore: 80,
      maxAttempts: 2,
      shuffleQuestions: true,
      examDurationSeconds: 35 * 60,
      examResultReleaseMode: "manual",
      examReviewReleaseMode: "manual",
      examContentAccessMode: "block_academy",
      sortOrder: 0,
      status: "published",
      visibility: "visible",
    })
    .returning();
  const [examPage] = await tx
    .insert(lessonPages)
    .values({
      lessonId: examLesson.id,
      title: examLesson.title,
      titleSyncedWithLesson: true,
      slug: "abschlusspruefung-responsible-ai",
      sortOrder: 0,
      status: "published",
    })
    .returning();
  const insertedExamBlocks = await tx
    .insert(contentBlocks)
    .values([
      {
        lessonId: examLesson.id,
        pageId: examPage.id,
        type: "info",
        title: "Pruefungshinweis",
        sortOrder: 0,
        data: {
          text: "Beantworte den automatischen Teil und reiche danach deine Transferanalyse ein.",
          accent: "teal",
        },
      },
      {
        lessonId: examLesson.id,
        pageId: examPage.id,
        type: "multiple_choice",
        title: "Datenklassifizierung",
        sortOrder: 1,
        required: true,
        data: {
          prompt:
            "Was muss vor der Nutzung eines KI-Tools zuerst geklaert sein?",
          options: [
            "Die Farbe der Benutzeroberflaeche",
            "Datenklasse, Zweck und freigegebenes Tool",
            "Nur die Laenge des Prompts",
          ],
          correctOption: 1,
        },
      },
      {
        lessonId: examLesson.id,
        pageId: examPage.id,
        type: "submission",
        title: "Transferanalyse",
        sortOrder: 2,
        required: true,
        data: {
          prompt:
            "Analysiere einen realen KI-Anwendungsfall, benenne Risiken, Kontrollen und die verantwortliche Freigabe.",
        },
      },
    ])
    .returning();
  const question = insertedExamBlocks.find(
    (block) => block.type === "multiple_choice",
  );
  const submission = insertedExamBlocks.find(
    (block) => block.type === "submission",
  );
  if (!question || !submission) {
    throw new Error("Responsible-AI-Pruefungsdaten konnten nicht angelegt werden.");
  }
  return { lesson: examLesson, question, submission };
});

const richTextDemoLesson = insertedLessons.find(
  (lesson) => lesson.slug === "vier-bausteine",
)!;
await db.insert(contentBlocks).values({
  lessonId: richTextDemoLesson.id,
  type: "rich_text",
  title: "Vom Prompt zum pruefbaren Ergebnis",
  sortOrder: 6,
  data: {
    richText: {
      version: 1,
      blocks: [
        {
          type: "heading",
          level: 2,
          children: [
            { type: "text", text: "Vom Prompt zum pruefbaren Ergebnis" },
          ],
        },
        {
          type: "paragraph",
          children: [
            { type: "text", text: "Formuliere das Ziel ", bold: true },
            { type: "text", text: "klar und praxisnah", italic: true },
            { type: "text", text: "." },
          ],
        },
        {
          type: "list",
          style: "bullet",
          items: [
            {
              children: [
                { type: "text", text: "Kontext und Zielgruppe benennen" },
              ],
            },
            {
              children: [
                {
                  type: "text",
                  text: "Ergebnis anhand von Kriterien pruefen",
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              href: "https://www.bsi.bund.de/",
              children: [{ type: "text", text: "BSI-Hinweise oeffnen" }],
            },
          ],
        },
      ],
    },
  },
});

const welcomeDemoLesson = insertedLessons.find(
  (lesson) => lesson.slug === "dein-start",
)!;
await db.insert(contentBlocks).values([
  {
    lessonId: welcomeDemoLesson.id,
    type: "gallery",
    title: "Deine Lernreise",
    sortOrder: 6,
    data: {
      gallery: {
        version: 1,
        layout: "featured",
        items: [
          {
            source: "/images/courses/foundations.webp",
            alt: "Visualisierung zum Einstieg in generative KI",
            caption: "Grundlagen verstehen und sicher anwenden.",
          },
          {
            source: "/images/courses/prompts.webp",
            alt: "Visualisierung zu strukturierten Prompts",
            caption: "Auftraege mit Kontext und Kriterien formulieren.",
          },
          {
            source: "/images/courses/workflows.webp",
            alt: "Visualisierung zu automatisierten Arbeitsablaeufen",
            caption: "Erprobte Schritte in robuste Workflows ueberfuehren.",
          },
        ],
      },
    },
  },
  {
    lessonId: welcomeDemoLesson.id,
    type: "data_form",
    title: "Dein Lernziel",
    sortOrder: 7,
    data: { formId: learningProfileForm.id },
  },
  {
    lessonId: welcomeDemoLesson.id,
    type: "button",
    title: "Community oeffnen",
    sortOrder: 8,
    data: {
      button: {
        version: 1,
        label: "Mit der Community austauschen",
        href: "/academy/community",
        variant: "secondary",
      },
    },
  },
]);

const advancedAssessmentLesson = insertedLessons.find(
  (lesson) => lesson.slug === "ki-selbstcheck",
)!;
await db.insert(contentBlocks).values([
  {
    lessonId: advancedAssessmentLesson.id,
    type: "multi_select",
    title: "Verlaessliche KI-Ergebnisse",
    sortOrder: 6,
    required: true,
    data: {
      prompt: "Welche Massnahmen verbessern die Verlaesslichkeit?",
      options: [
        "Kontext und Zielgruppe angeben",
        "Ergebnisse anhand von Quellen pruefen",
        "Antworten ungeprueft uebernehmen",
        "Qualitaetskriterien definieren",
      ],
      correctOptions: [0, 1, 3],
      feedback:
        "Kontext, Quellenpruefung und klare Kriterien machen Ergebnisse belastbarer.",
    },
  },
  {
    lessonId: advancedAssessmentLesson.id,
    type: "fill_blank",
    title: "Fachbegriff einsetzen",
    sortOrder: 7,
    required: true,
    data: {
      prompt:
        "Wie heisst eine inhaltlich plausible, aber sachlich falsche Modellantwort?",
      acceptedAnswers: ["Halluzination", "KI-Halluzination"],
      caseSensitive: false,
      feedback:
        "Solche erfundenen oder sachlich falschen Aussagen werden als Halluzination bezeichnet.",
    },
  },
  {
    lessonId: advancedAssessmentLesson.id,
    type: "ordering",
    title: "Pruefprozess sortieren",
    sortOrder: 8,
    required: true,
    data: {
      prompt: "Bringe den Pruefprozess in die richtige Reihenfolge.",
      options: [
        "Ziel und Kriterien festlegen",
        "Modellantwort erzeugen",
        "Aussagen gegen Quellen pruefen",
        "Ergebnis dokumentiert freigeben",
      ],
      feedback:
        "Ein belastbarer Prozess beginnt mit Kriterien und endet mit der dokumentierten Freigabe.",
    },
  },
]);

const pagedLesson = insertedLessons.find(
  (lesson) => lesson.slug === "sprachmodelle-verstehen",
)!;
const [conceptPage, practicePage] = await db
  .insert(lessonPages)
  .values([
    {
      lessonId: pagedLesson.id,
      title: "Grundidee",
      slug: "grundidee",
      sortOrder: 1,
    },
    { lessonId: pagedLesson.id, title: "Praxis", slug: "praxis", sortOrder: 2 },
  ])
  .returning();
const pagedBlocks = await db
  .select()
  .from(contentBlocks)
  .where(eq(contentBlocks.lessonId, pagedLesson.id))
  .orderBy(contentBlocks.sortOrder);
for (const [index, block] of pagedBlocks.entries()) {
  await db
    .update(contentBlocks)
    .set({ pageId: index < 3 ? conceptPage.id : practicePage.id })
    .where(eq(contentBlocks.id, block.id));
}

await db.insert(courseLearningGoals).values([
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    text: "Generative KI, Sprachmodelle und ihre Grenzen erklaeren",
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    text: "KI-Aufgaben im Arbeitsalltag sicher vorbereiten und pruefen",
    sortOrder: 1,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    text: "Komplexe Aufgaben in belastbare Prompt-Strukturen uebersetzen",
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    text: "Modellergebnisse mit reproduzierbaren Kriterien bewerten",
    sortOrder: 1,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    text: "Geeignete Prozesse fuer KI-Automation identifizieren",
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    text: "Wartbare Workflows mit klaren Kontrollpunkten entwerfen",
    sortOrder: 1,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    text: "Datenschutzrisiken bei KI-Anwendungsfaellen erkennen",
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    text: "Nachvollziehbare Freigabeentscheidungen dokumentieren",
    sortOrder: 1,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ai-leadership")!.id,
    text: "Ein belastbares KI-Zielbild fuer das eigene Team entwickeln",
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ai-leadership")!.id,
    text: "Veraenderung mit Rollen, Leitplanken und Kennzahlen steuern",
    sortOrder: 1,
  },
]);

const communityAdmin = userByEmail.get("sarah@q-academy.de")!;
await db.insert(courseAuthors).values([
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    userId: trainer.id,
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    userId: admin.id,
    sortOrder: 1,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    userId: trainer.id,
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    userId: trainer.id,
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    userId: admin.id,
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    userId: communityAdmin.id,
    sortOrder: 1,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ai-leadership")!.id,
    userId: admin.id,
    sortOrder: 0,
  },
]);

await db.insert(courseCollaborators).values([
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    userId: trainer.id,
    permission: "edit",
    grantedById: admin.id,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    userId: trainer.id,
    permission: "manage",
    grantedById: trainer.id,
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    userId: trainer.id,
    permission: "manage",
    grantedById: trainer.id,
  },
]);

await db.insert(courseWidgets).values([
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    type: "author",
    sortOrder: 0,
    authorUserId: trainer.id,
    authorRole: "KI-Trainer und Lernbegleiter",
    authorDescription:
      "Marco begleitet den Praxistransfer und beantwortet Fragen in der Sprechstunde.",
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    type: "info",
    sortOrder: 1,
    title: "Woechentliche KI-Sprechstunde",
    text: "Bring deine offenen Fragen und einen konkreten Anwendungsfall mit.",
    linkUrl: "/academy/events",
  },
  {
    organizationId: organization.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    type: "image_link",
    sortOrder: 2,
    imageUrl: "/images/courses/prompts.webp",
    altText: "Prompt-Werkstatt in der Q-Academy oeffnen",
    linkUrl: "/academy/community",
  },
]);

const seedPublicationPriority = new Map([
  ["prompt-engineering-masterclass", 0],
  ["ki-grundlagen", 2],
]);
for (const course of insertedCourses
  .filter((entry) => entry.status === "published")
  .sort(
    (left, right) =>
      (seedPublicationPriority.get(left.slug) ?? 1) -
        (seedPublicationPriority.get(right.slug) ?? 1) ||
      left.slug.localeCompare(right.slug),
  )) {
  await createPublishedSeedVersion(course);
}

const otherMembers = insertedUsers.filter(
  (user) => user.role === "member" && user.id !== member.id,
);
const enrollmentRows: Array<typeof enrollments.$inferInsert> = [
  {
    userId: member.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    status: "in_progress" as const,
    progress: 68,
    lastAccessedAt: subHours(new Date(), 4),
  },
  {
    userId: member.id,
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    status: "in_progress" as const,
    progress: 32,
    lastAccessedAt: subDays(new Date(), 2),
  },
  {
    userId: member.id,
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    status: "not_started" as const,
    progress: 0,
  },
  {
    userId: member.id,
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    status: "completed" as const,
    progress: 100,
    completedAt: subDays(new Date(), 8),
    lastAccessedAt: subDays(new Date(), 8),
  },
];

for (let i = 0; i < otherMembers.length; i += 1) {
  const user = otherMembers[i];
  const progress = [18, 44, 72, 86, 100, 57, 28][i % 7];
  enrollmentRows.push({
    userId: user.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    status: progress === 100 ? "completed" : "in_progress",
    progress,
    lastAccessedAt: subDays(new Date(), i % 5),
    ...(progress === 100 ? { completedAt: subDays(new Date(), 3) } : {}),
  });
  if (i % 2 === 0) {
    enrollmentRows.push({
      userId: user.id,
      courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
      status: "in_progress",
      progress: 12 + i * 7,
      lastAccessedAt: subDays(new Date(), 1 + (i % 3)),
    });
  }
}

const insertedEnrollments = await db
  .insert(enrollments)
  .values(enrollmentRows)
  .returning();
await db.insert(courseAccessGrants).values(
  insertedEnrollments.map((enrollment) => ({
    organizationId: organization.id,
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    source: `direct:${enrollment.id}`,
  })),
);

const firstLessons = insertedLessons.slice(0, 6);
const responsibleAiModuleIds = new Set([
  moduleByTitle.get("KI-Sicherheit kompakt")!.id,
  moduleByTitle.get("Governance in der Praxis")!.id,
]);
const responsibleAiLessons = insertedLessons.filter((lesson) =>
  responsibleAiModuleIds.has(lesson.moduleId),
);
await db.insert(lessonProgress).values([
  {
    userId: member.id,
    lessonId: firstLessons[0].id,
    status: "completed",
    percent: 100,
    startedAt: subDays(new Date(), 16),
    completedAt: subDays(new Date(), 16),
  },
  {
    userId: member.id,
    lessonId: firstLessons[1].id,
    status: "completed",
    percent: 100,
    startedAt: subDays(new Date(), 14),
    completedAt: subDays(new Date(), 14),
  },
  {
    userId: member.id,
    lessonId: firstLessons[2].id,
    status: "completed",
    percent: 100,
    startedAt: subDays(new Date(), 10),
    completedAt: subDays(new Date(), 10),
  },
  {
    userId: member.id,
    lessonId: firstLessons[3].id,
    status: "in_progress",
    percent: 45,
    startedAt: subDays(new Date(), 2),
  },
  ...responsibleAiLessons.map((lesson, index) => ({
    userId: member.id,
    lessonId: lesson.id,
    status: "completed" as const,
    percent: 100,
    startedAt: subDays(new Date(), 14 - index),
    completedAt: subDays(new Date(), 12 - index),
  })),
  {
    userId: member.id,
    lessonId: responsibleExamFixture.lesson.id,
    status: "completed",
    percent: 100,
    startedAt: subDays(new Date(), 10),
    completedAt: subDays(new Date(), 9),
  },
]);

const responsibleExamQuestion = buildAssessmentQuestionSnapshot({
  id: responsibleExamFixture.question.id,
  type: responsibleExamFixture.question.type,
  title: responsibleExamFixture.question.title,
  required: responsibleExamFixture.question.required,
  data: responsibleExamFixture.question.data,
});
if (
  !responsibleExamQuestion ||
  responsibleExamQuestion.type !== "multiple_choice"
) {
  throw new Error("Responsible-AI-Pruefungsfrage ist nicht auswertbar.");
}
const responsibleExamCompletedAt = subDays(new Date(), 9);
const [responsibleExamAttempt] = await db
  .insert(assessmentAttempts)
  .values({
    organizationId: organization.id,
    userId: member.id,
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    lessonId: responsibleExamFixture.lesson.id,
    attemptNumber: 1,
    status: "graded",
    score: 100,
    passed: true,
    questionCount: 1,
    correctCount: 1,
    assessmentSnapshot: {
      schemaVersion: 3,
      passingScore: 80,
      maxAttempts: 2,
      shuffleQuestions: true,
      questions: [responsibleExamQuestion],
    },
    startedAt: subDays(new Date(), 10),
    submittedAt: responsibleExamCompletedAt,
    gradedAt: responsibleExamCompletedAt,
  })
  .returning();
await db.insert(assessmentAnswers).values({
  organizationId: organization.id,
  attemptId: responsibleExamAttempt.id,
  blockId: responsibleExamQuestion.blockId,
  questionSnapshot: responsibleExamQuestion,
  selectedOption: responsibleExamQuestion.correctOption,
  answerSnapshot: {
    selectedOption: responsibleExamQuestion.correctOption,
    optionText:
      responsibleExamQuestion.options[responsibleExamQuestion.correctOption],
  },
  correct: true,
  answeredAt: responsibleExamCompletedAt,
});

const completedDemoEnrollment = insertedEnrollments.find(
  (enrollment) =>
    enrollment.userId === member.id &&
    enrollment.courseId === courseBySlug.get("responsible-ai-dsgvo")!.id,
)!;
await db.insert(courseCertificates).values({
  organizationId: organization.id,
  userId: member.id,
  courseId: completedDemoEnrollment.courseId,
  certificateNumber: "QA-2026-DEMO-LEA-0001",
  recipientName: `${member.firstName} ${member.lastName}`,
  courseTitle: courseBySlug.get("responsible-ai-dsgvo")!.title,
  organizationName: organization.name,
  completedAt: completedDemoEnrollment.completedAt!,
  issuedAt: subDays(new Date(), 7),
  issuedById: admin.id,
});

await db.insert(submissions).values([
  {
    organizationId: organization.id,
    userId: member.id,
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    lessonId: responsibleExamFixture.lesson.id,
    blockId: responsibleExamFixture.submission.id,
    title: "Transferanalyse Responsible AI",
    content:
      "Datenklasse, Zweck, Kontrollpunkte und verantwortliche Freigabe sind dokumentiert.",
    status: "approved",
    reviewerId: admin.id,
    feedback: "Risiken, Kontrollen und Freigabeweg sind nachvollziehbar belegt.",
    score: 96,
    submittedAt: subDays(new Date(), 10),
    reviewedAt: subDays(new Date(), 9),
  },
  {
    organizationId: organization.id,
    userId: member.id,
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    lessonId: insertedLessons.find((lesson) => lesson.slug === "erster-prompt")!
      .id,
    title: "Mein erster strukturierter Prompt",
    content:
      "Ziel: Kundenfeedback clustern. Kontext: 42 Interviews. Ausgabe: priorisierte Themen mit Belegen.",
    status: "open",
    submittedAt: subHours(new Date(), 5),
  },
  {
    organizationId: organization.id,
    userId: userByEmail.get("jonas@q-academy.de")!.id,
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    title: "Prompt Review: Discovery Call",
    content:
      "Entwurf fuer eine strukturierte Zusammenfassung von Discovery Calls.",
    status: "in_review",
    reviewerId: trainer.id,
    submittedAt: subHours(new Date(), 9),
  },
  {
    organizationId: organization.id,
    userId: userByEmail.get("nora@q-academy.de")!.id,
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    title: "Workflow Canvas: Content Briefing",
    content:
      "Vom Kampagnenziel zum freigegebenen Content Briefing mit zwei menschlichen Review-Punkten.",
    status: "revision",
    reviewerId: trainer.id,
    feedback: "Ergaenze einen klaren Abbruchpfad fuer fehlende Produktdaten.",
    score: 78,
    submittedAt: subDays(new Date(), 2),
    reviewedAt: subDays(new Date(), 1),
  },
  {
    organizationId: organization.id,
    userId: userByEmail.get("melina@q-academy.de")!.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    title: "KI-Anwendungsfall UX Research",
    content:
      "Hypothesen aus Interviewnotizen ableiten und anschliessend manuell gegen Quellen pruefen.",
    status: "approved",
    reviewerId: trainer.id,
    feedback: "Sehr klarer Scope und gute Pruefschritte.",
    score: 94,
    submittedAt: subDays(new Date(), 5),
    reviewedAt: subDays(new Date(), 4),
  },
  {
    organizationId: organization.id,
    userId: userByEmail.get("emil@q-academy.de")!.id,
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    title: "Workflow Canvas: Monatsreport",
    content:
      "Datenvalidierung, Anomalien markieren, Entwurf erzeugen, Freigabe durch Analyst.",
    status: "open",
    submittedAt: subHours(new Date(), 28),
  },
  {
    organizationId: organization.id,
    userId: userByEmail.get("mina@q-academy.de")!.id,
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
    title: "Risikoanalyse People Operations",
    content:
      "Keine automatisierte Bewertung von Bewerbenden; nur administrative Assistenz ohne Profiling.",
    status: "in_review",
    reviewerId: admin.id,
    submittedAt: subDays(new Date(), 1),
  },
]);

await db.insert(feedbackEntries).values([
  {
    organizationId: organization.id,
    userId: member.id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
    type: "course",
    rating: 5,
    content:
      "Die Beispiele sind direkt auf meinen Produktalltag uebertragbar. Besonders hilfreich war der klare Pruefschritt fuer KI-Ergebnisse.",
    testimonialConsent: true,
    status: "new",
    createdAt: subHours(new Date(), 8),
  },
  {
    organizationId: organization.id,
    userId: userByEmail.get("jonas@q-academy.de")!.id,
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
    type: "course",
    rating: 4,
    content:
      "Guter Praxisfokus. Eine weitere Vorlage fuer Sales-Gespraeche waere eine sinnvolle Ergaenzung.",
    status: "reviewed",
    reviewedById: trainer.id,
    reviewedAt: subHours(new Date(), 5),
    createdAt: subDays(new Date(), 2),
  },
]);

const insertedBundles = await db
  .insert(bundles)
  .values([
    {
      organizationId: organization.id,
      name: "AI Starter",
      description:
        "Grundlagen, Prompting und Responsible AI fuer alle Mitarbeitenden.",
      color: "#2bb7a9",
    },
    {
      organizationId: organization.id,
      name: "AI Builder",
      description:
        "Fortgeschrittenes Programm fuer Automatisierung und produktive Workflows.",
      color: "#ee6c5d",
    },
  ])
  .returning();

await db.insert(bundleCourses).values([
  {
    bundleId: insertedBundles[0].id,
    courseId: courseBySlug.get("ki-grundlagen")!.id,
  },
  {
    bundleId: insertedBundles[0].id,
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
  },
  {
    bundleId: insertedBundles[0].id,
    courseId: courseBySlug.get("responsible-ai-dsgvo")!.id,
  },
  {
    bundleId: insertedBundles[1].id,
    courseId: courseBySlug.get("prompt-engineering-masterclass")!.id,
  },
  {
    bundleId: insertedBundles[1].id,
    courseId: courseBySlug.get("ki-workflows-automatisieren")!.id,
    delayDays: 7,
    availableUntil: addDays(new Date(), 90),
    visible: true,
  },
]);

await db
  .insert(memberBundles)
  .values({ userId: member.id, bundleId: insertedBundles[0].id });
await db.insert(courseAccessGrants).values(
  [
    courseBySlug.get("ki-grundlagen")!.id,
    courseBySlug.get("prompt-engineering-masterclass")!.id,
    courseBySlug.get("responsible-ai-dsgvo")!.id,
  ].map((courseId) => ({
    organizationId: organization.id,
    userId: member.id,
    courseId,
    source: `member:${member.id}:bundle:${insertedBundles[0].id}`,
  })),
);

await db.insert(hubs).values([
  {
    organizationId: organization.id,
    title: "Dein Lern-Dashboard",
    slug: "lern-dashboard",
    description:
      "Alle wichtigen Links, Ansprechpartner und Termine fuer deinen Lernpfad.",
    layout: [
      {
        id: "quick-links",
        columns: [
          {
            type: "link",
            title: "AI Playbook",
            description: "Standards und freigegebene Tools",
            href: "#",
            color: "teal",
          },
          {
            type: "contact",
            title: "Academy Team",
            description: "Anna & Marco beantworten deine Fragen",
            href: "mailto:academy@q-academy.de",
            color: "navy",
          },
          {
            type: "event",
            title: "Naechste Sprechstunde",
            description: "Dienstag, 10:00 Uhr",
            href: "/academy/events",
            color: "coral",
          },
        ],
      },
      {
        id: "tools",
        columns: [
          {
            type: "text",
            title: "Dein Fokus diese Woche",
            description:
              "Schliesse das Modul Prompting Basics ab und teile einen Prompt in der Community.",
            color: "amber",
          },
          {
            type: "stat",
            title: "Lernserie",
            description: "4 Wochen in Folge aktiv",
            color: "teal",
          },
        ],
      },
      {
        id: "profile-checkin",
        columns: [
          {
            type: "data_form",
            title: "Lernziel-Check-in",
            description:
              "Halte Erfahrung und Lernziel fest, ohne den Hub zu verlassen.",
            formId: learningProfileForm.id,
            color: "#2bb7a9",
          },
        ],
      },
    ],
  },
  {
    organizationId: organization.id,
    title: "AI Tool Center",
    slug: "ai-tool-center",
    description:
      "Freigegebene Tools, Templates und Checklisten fuer produktive KI-Arbeit.",
    layout: [],
  },
]);

const [communityArea] = await db
  .insert(communityAreas)
  .values({
    organizationId: organization.id,
    title: "Allgemein",
    slug: "allgemein",
    description: "Austausch, Diskussionen und Ankuendigungen.",
    sortOrder: 0,
  })
  .returning({ id: communityAreas.id });

await db.insert(communityProfileSettings).values({
  organizationId: organization.id,
  completionGateEnabled: false,
  revision: 1,
});
await db.insert(communityPublicProfileFields).values([
  {
    organizationId: organization.id,
    standardField: "avatar",
    requiredForPosting: false,
    sortOrder: 0,
  },
  {
    organizationId: organization.id,
    standardField: "job_title",
    requiredForPosting: false,
    sortOrder: 1,
  },
  {
    organizationId: organization.id,
    standardField: "community_points",
    requiredForPosting: false,
    sortOrder: 2,
  },
  {
    organizationId: organization.id,
    standardField: "badges",
    requiredForPosting: false,
    sortOrder: 3,
  },
]);

const insertedSpaces = await db
  .insert(communitySpaces)
  .values([
    {
      organizationId: organization.id,
      areaId: communityArea.id,
      title: "Austausch",
      slug: "austausch",
      description: "Fragen, Erfahrungen und neue Ideen.",
      color: "#2bb7a9",
      type: "feed",
      sortOrder: 0,
    },
    {
      organizationId: organization.id,
      areaId: communityArea.id,
      title: "Prompt Lab",
      slug: "prompt-lab",
      description: "Prompts teilen, testen und verbessern.",
      color: "#4f7cac",
      type: "discussion",
      sortOrder: 1,
    },
    {
      organizationId: organization.id,
      areaId: communityArea.id,
      title: "Ankuendigungen",
      slug: "ankuendigungen",
      description: "Neuigkeiten aus der Q-Academy.",
      color: "#d6a536",
      type: "announcement",
      sortOrder: 2,
    },
  ])
  .returning();

const spaceBySlug = new Map(insertedSpaces.map((space) => [space.slug, space]));
const insertedPosts = await db
  .insert(posts)
  .values([
    {
      organizationId: organization.id,
      spaceId: spaceBySlug.get("ankuendigungen")!.id,
      authorId: admin.id,
      title: "Prompt Engineering Masterclass erweitert",
      content:
        "Die neue Prompt Engineering Masterclass ist live. Der Kurs enthaelt ab sofort ein Prompt Review mit persoenlichem Trainer-Feedback.",
      pinned: true,
      locked: true,
      createdAt: subHours(new Date(), 3),
    },
    {
      organizationId: organization.id,
      spaceId: spaceBySlug.get("prompt-lab")!.id,
      authorId: member.id,
      title: "Bewertungsraster fuer Interview-Zusammenfassungen",
      content:
        "Ich habe heute mit einem Bewertungsraster fuer Interview-Zusammenfassungen experimentiert. Der groesste Hebel war, Belege aus dem Originaltext fuer jedes Thema zu verlangen. Welche Pruefkriterien nutzt ihr?",
      createdAt: subHours(new Date(), 7),
    },
    {
      organizationId: organization.id,
      spaceId: spaceBySlug.get("austausch")!.id,
      authorId: userByEmail.get("nora@q-academy.de")!.id,
      content:
        "Unser erster Content-Workflow spart bereits Zeit. Unerwartet wichtig war aber der Abbruchpfad, wenn Produktinformationen fehlen. Sonst klingt der Entwurf gut, ist aber fachlich nicht belastbar.",
      createdAt: subDays(new Date(), 1),
    },
    {
      organizationId: organization.id,
      spaceId: spaceBySlug.get("prompt-lab")!.id,
      authorId: trainer.id,
      title: "Prompt der Woche: Rueckfragen vor der Antwort",
      content:
        "Prompt der Woche: Lass das Modell vor der Antwort drei fehlende Informationen nennen. So wird aus einer unklaren Anfrage ein kurzer, gefuehrter Dialog.",
      createdAt: subDays(new Date(), 2),
    },
    {
      organizationId: organization.id,
      spaceId: spaceBySlug.get("austausch")!.id,
      authorId: userByEmail.get("felix@q-academy.de")!.id,
      content:
        "Hat jemand eine gute Methode, um strukturierte JSON-Ausgaben gegen ein Schema zu testen? Ich sammle gerade robuste Patterns fuer interne Tools.",
      createdAt: subDays(new Date(), 3),
    },
  ])
  .returning();

await db.insert(comments).values([
  {
    organizationId: organization.id,
    postId: insertedPosts[1].id,
    authorId: trainer.id,
    content:
      "Sehr guter Ansatz. Ich ergaenze meist Vollstaendigkeit, Quellenbezug und Unsicherheitsmarkierung.",
  },
  {
    organizationId: organization.id,
    postId: insertedPosts[1].id,
    authorId: userByEmail.get("melina@q-academy.de")!.id,
    content:
      "Bei Research nutze ich zusaetzlich Gegenbeispiele, damit Minderheitsmeinungen nicht verschwinden.",
  },
  {
    organizationId: organization.id,
    postId: insertedPosts[2].id,
    authorId: admin.id,
    content:
      "Das ist genau der Unterschied zwischen Demo und produktivem Workflow. Danke fuers Teilen.",
  },
  {
    organizationId: organization.id,
    postId: insertedPosts[4].id,
    authorId: userByEmail.get("emil@q-academy.de")!.id,
    content:
      "Ich validiere zuerst syntaktisch und danach noch semantische Regeln mit einem zweiten Schritt.",
  },
]);

await db.insert(postLikes).values([
  {
    organizationId: organization.id,
    postId: insertedPosts[0].id,
    userId: member.id,
    reaction: "celebrate",
  },
  {
    organizationId: organization.id,
    postId: insertedPosts[0].id,
    userId: userByEmail.get("nora@q-academy.de")!.id,
    reaction: "like",
  },
  {
    organizationId: organization.id,
    postId: insertedPosts[1].id,
    userId: trainer.id,
    reaction: "insightful",
  },
  {
    organizationId: organization.id,
    postId: insertedPosts[1].id,
    userId: userByEmail.get("melina@q-academy.de")!.id,
    reaction: "celebrate",
  },
  {
    organizationId: organization.id,
    postId: insertedPosts[1].id,
    userId: userByEmail.get("emil@q-academy.de")!.id,
    reaction: "insightful",
  },
  {
    organizationId: organization.id,
    postId: insertedPosts[2].id,
    userId: member.id,
    reaction: "like",
  },
  {
    organizationId: organization.id,
    postId: insertedPosts[3].id,
    userId: member.id,
    reaction: "question",
  },
]);

await db.insert(postVotes).values([
  {
    organizationId: organization.id,
    postId: insertedPosts[1].id,
    userId: trainer.id,
    value: 1,
  },
  {
    organizationId: organization.id,
    postId: insertedPosts[3].id,
    userId: member.id,
    value: 1,
  },
]);

const insertedEvents = await db
  .insert(events)
  .values([
    {
      organizationId: organization.id,
      title: "KI-Sprechstunde",
      description: "Offener Live-Call fuer Fragen aus Kursen und Projekten.",
      type: "live_call",
      startsAt: addDays(new Date(), 2),
      endsAt: addDays(new Date(Date.now() + 60 * 60 * 1000), 2),
      meetingUrl: "https://meet.example.com/q-academy",
      location: "Online",
      color: "#2bb7a9",
      capacity: 40,
      createdById: trainer.id,
    },
    {
      organizationId: organization.id,
      title: "Prompt Lab: Research & Analyse",
      description:
        "Gemeinsam Prompts testen und mit einem Bewertungsraster verbessern.",
      type: "workshop",
      startsAt: addDays(new Date(), 6),
      endsAt: addDays(new Date(Date.now() + 90 * 60 * 1000), 6),
      meetingUrl: "https://meet.example.com/prompt-lab",
      location: "Online",
      color: "#4f7cac",
      capacity: 24,
      createdById: trainer.id,
    },
    {
      organizationId: organization.id,
      title: "Responsible-AI Workshop",
      description: "Eigene Anwendungsfaelle in Risikoklassen einordnen.",
      type: "workshop",
      startsAt: addDays(new Date(), 11),
      endsAt: addDays(new Date(Date.now() + 120 * 60 * 1000), 11),
      location: "Berlin, Workshopraum 2",
      color: "#d6a536",
      capacity: 18,
      createdById: admin.id,
    },
    {
      organizationId: organization.id,
      title: "Abgabe: Workflow Canvas",
      description: "Letzter Termin fuer das persoenliche Trainer-Feedback.",
      type: "deadline",
      startsAt: addDays(new Date(), 15),
      endsAt: addDays(new Date(Date.now() + 30 * 60 * 1000), 15),
      color: "#ee6c5d",
      createdById: trainer.id,
    },
  ])
  .returning();

await db.insert(eventAttendees).values([
  { eventId: insertedEvents[0].id, userId: member.id, status: "going" },
  { eventId: insertedEvents[1].id, userId: member.id, status: "going" },
  {
    eventId: insertedEvents[0].id,
    userId: userByEmail.get("melina@q-academy.de")!.id,
    status: "going",
  },
  {
    eventId: insertedEvents[2].id,
    userId: userByEmail.get("david@q-academy.de")!.id,
    status: "maybe",
  },
]);

const agentDefinitions = [
    {
      name: "Q-Coach",
      description:
        "Beantwortet Lernfragen auf Basis freigeschalteter Kursinhalte.",
      systemPrompt:
        "Antworte knapp, stelle Rueckfragen und verweise auf passende Q-Academy-Lektionen.",
      color: "#2bb7a9",
      icon: "sparkles",
    },
    {
      name: "Prompt Reviewer",
      description:
        "Prueft Prompts auf Ziel, Kontext, Format und Qualitaetskriterien.",
      systemPrompt:
        "Gib strukturiertes Feedback und einen verbesserten Prompt-Entwurf.",
      color: "#4f7cac",
      icon: "message-square-code",
    },
    {
      name: "Onboarding-Assistent",
      description:
        "Ermittelt Lernziel und KI-Erfahrung in einem kurzen Dialog.",
      systemPrompt: "Frage nacheinander Lernziel, Rolle und KI-Erfahrung ab.",
      color: "#ee6c5d",
      icon: "route",
    },
] as const;

const insertedAgents = await db.transaction(async (tx) => {
  const identities = agentDefinitions.map((definition) => ({
    ...definition,
    id: randomUUID(),
    publishedVersionId: randomUUID(),
    draftVersionId: randomUUID(),
  }));
  const rows = await tx
    .insert(aiAgents)
    .values(
      identities.map((agent) => ({
        id: agent.id,
        organizationId: organization.id,
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        color: agent.color,
        icon: agent.icon,
        active: false,
        draftVersionId: agent.publishedVersionId,
        publishedVersionId: null,
      })),
    )
    .returning();
  await tx.insert(aiAgentVersions).values(
    identities.map(
      (agent) =>
        ({
        id: agent.publishedVersionId,
        organizationId: organization.id,
        agentId: agent.id,
        version: 1,
        state: "draft" as const,
        type:
          agent.name === "Onboarding-Assistent"
            ? ("form_assistant" as const)
            : ("learning_coach" as const),
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        color: agent.color,
        icon: agent.icon,
        knowledgeMode: "all_accessible_courses" as const,
        accessMode: "open" as const,
        }) as const,
    ),
  );
  for (const agent of identities) {
    const publishedAt = new Date();
    await tx
      .update(aiAgentVersions)
      .set({ state: "published", publishedAt, updatedAt: publishedAt })
      .where(eq(aiAgentVersions.id, agent.publishedVersionId));
    await tx.insert(aiAgentVersions).values({
      id: agent.draftVersionId,
      organizationId: organization.id,
      agentId: agent.id,
      version: 2,
      state: "draft",
      type:
        agent.name === "Onboarding-Assistent"
          ? "form_assistant"
          : "learning_coach",
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      color: agent.color,
      icon: agent.icon,
      knowledgeMode: "all_accessible_courses",
      accessMode: "open",
    });
    await tx
      .update(aiAgents)
      .set({
        active: true,
        draftVersionId: agent.draftVersionId,
        publishedVersionId: agent.publishedVersionId,
      })
      .where(eq(aiAgents.id, agent.id));
  }
  return tx
    .select()
    .from(aiAgents)
    .where(inArray(aiAgents.id, rows.map((row) => row.id)));
});

const qCoach = insertedAgents.find((agent) => agent.name === "Q-Coach")!;
const [seedConversation] = await db
  .insert(aiConversations)
  .values({
    organizationId: organization.id,
    agentId: qCoach.id,
    agentVersionId: qCoach.publishedVersionId!,
    userId: member.id,
    title: "Sicher in die KI-Grundlagen starten",
    messageCount: 2,
    lastMessageAt: subHours(new Date(), 5),
    createdAt: subHours(new Date(), 5),
    updatedAt: subHours(new Date(), 5),
  })
  .returning();
await db.insert(aiMessages).values([
  {
    organizationId: organization.id,
    conversationId: seedConversation.id,
    role: "user",
    content: "Mit welcher Lektion sollte ich diese Woche beginnen?",
    inputTokens: 9,
    createdAt: subHours(new Date(), 5),
  },
  {
    organizationId: organization.id,
    conversationId: seedConversation.id,
    role: "assistant",
    content:
      "Starte mit der Lektion zu Sprachmodellen im Kurs KI-Grundlagen und plane danach den Wissenscheck ein.",
    inputTokens: 9,
    outputTokens: 20,
    latencyMs: 42,
    provider: "q-academy-fallback",
    model: "academy-context-v1",
    createdAt: subHours(new Date(), 5),
  },
]);

await db.insert(notifications).values([
  {
    userId: admin.id,
    title: "Neue Kursversion veroeffentlicht",
    body: "Die aktuelle Version der KI-Grundlagen ist fuer Mitglieder sichtbar.",
    type: "course",
    href: "/admin/courses",
  },
  {
    userId: member.id,
    title: "Neue Rueckmeldung",
    body: "Marco hat deine Abgabe zum Prompt Review geoeffnet.",
    type: "submission",
    href: "/academy/courses/prompt-engineering-masterclass",
  },
  {
    userId: member.id,
    title: "KI-Sprechstunde",
    body: "Der Live-Call beginnt in zwei Tagen um 10:00 Uhr.",
    type: "event",
    href: "/academy/events",
  },
  {
    userId: member.id,
    title: "Neue Masterclass",
    body: "Die Prompt Engineering Masterclass wurde aktualisiert.",
    type: "course",
    href: "/academy/courses/prompt-engineering-masterclass",
    read: true,
  },
]);

await db.insert(announcements).values({
  organizationId: organization.id,
  title: "Prompt Engineering Masterclass erweitert",
  body: "Der Kurs enthaelt jetzt einen serverseitig bewerteten Wissenscheck und persoenliches Trainer-Feedback.",
  tone: "info",
  placement: "banner",
  audience: "all",
  href: "/academy/courses/prompt-engineering-masterclass",
  actionLabel: "Masterclass ansehen",
  startsAt: subHours(new Date(), 2),
  endsAt: addDays(new Date(), 14),
  dismissible: true,
  createdById: admin.id,
});

const activityTypes = [
  "lesson.completed",
  "lesson.opened",
  "course.opened",
  "post.created",
  "quiz.completed",
];
const activityRows = [];
for (let day = 27; day >= 0; day -= 1) {
  const count = 5 + ((day * 7) % 14);
  for (let index = 0; index < count; index += 1) {
    const actor = insertedUsers[(day + index) % insertedUsers.length];
    activityRows.push({
      organizationId: organization.id,
      userId: actor.id,
      type: activityTypes[(day + index) % activityTypes.length],
      entityType: "course",
      entityId: insertedCourses[(day + index) % 4].id,
      metadata: { minutes: 4 + ((day + index) % 18) },
      createdAt: subHours(subDays(new Date(), day), index),
    });
  }
}
await db.insert(activityEvents).values(activityRows);

await db.insert(platformSettings).values([
  {
    organizationId: organization.id,
    key: "design",
    value: {
      platformName: "Q-Academy",
      primaryColor: "#17324d",
      accentColor: "#2bb7a9",
      logoUrl: null,
      faviconUrl: null,
      fontFamily: "geist",
      cornerRadius: 8,
      loginHostname: null,
      defaultTheme: "light",
    },
  },
  {
    organizationId: organization.id,
    key: "learning",
    value: {
      certificates: true,
      streaks: true,
      communityPoints: true,
      defaultLanguage: "de",
    },
  },
]);

await db.insert(memberWelcomeSettings).values({
  organizationId: organization.id,
  enabled: true,
  title: "Willkommen in der Q-Academy",
  welcomeText:
    "Hier beginnt dein Lernbereich. Richte zuerst dein Profil ein und starte danach mit deinem naechsten Kurs.",
  promptProfileImage: true,
  promptProfileCompletion: true,
  version: 1,
});

console.log("Seed complete.");
console.log("Admin:  admin@q-academy.de / Demo123!");
console.log("Member: lea@q-academy.de / Demo123!");
console.log(`API:    ${demoApiKey}`);

await client.end();
