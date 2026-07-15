import type { CourseVersionSnapshot, User } from "@/db/schema";

export const ORBIT_TRANSFER_AUTHOR_ROLES = [
  "owner",
  "admin",
  "trainer",
] as const satisfies readonly User["role"][];

export const MAX_ORBIT_TRANSFER_AUTHOR_MAPPINGS = 1_000;
export const MAX_ORBIT_TRANSFER_REQUEST_BYTES = 262_144;

export type OrbitTransferAuthorMapping = {
  sourceUserId: string;
  targetUserId: string;
};

export type OrbitTransferAuthorProfile = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  bio: string | null;
};

export type OrbitTransferSourceAttribution = {
  sourceUserId: string;
  courseIds: string[];
  courseAuthorCourseIds: string[];
  profile: OrbitTransferAuthorProfile;
};

export type OrbitTransferSourceAuthor = OrbitTransferSourceAttribution & {
  email: string | null;
  role: User["role"] | null;
  status: User["status"] | null;
  automaticTargetUserId: string | null;
};

export type OrbitTransferTargetAuthor = {
  targetUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: (typeof ORBIT_TRANSFER_AUTHOR_ROLES)[number];
};

type AuthorDirectoryUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  bio: string | null;
  role: User["role"];
  status: User["status"];
};

export type OrbitTransferAuthorResolution =
  | {
      ok: true;
      sourceAuthors: OrbitTransferSourceAuthor[];
      targetAuthors: OrbitTransferTargetAuthor[];
      authorMappings: OrbitTransferAuthorMapping[];
      complete: boolean;
    }
  | {
      ok: false;
      reason:
        | "duplicate_source"
        | "unknown_source"
        | "unknown_target"
        | "ineligible_target"
        | "course_author_collision";
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OrbitTransferSourceAuthorError extends Error {
  constructor() {
    super("The published snapshot contains inconsistent author attribution.");
    this.name = "OrbitTransferSourceAuthorError";
  }
}

function isValidProfile(
  profile: OrbitTransferAuthorProfile | null | undefined,
  expectedUserId: string,
): profile is OrbitTransferAuthorProfile {
  return Boolean(
    profile &&
      profile.id === expectedUserId &&
      typeof profile.firstName === "string" &&
      typeof profile.lastName === "string",
  );
}

export function extractOrbitTransferSourceAttributions(
  sources: readonly {
    courseId: string;
    organizationId: string;
    snapshot: CourseVersionSnapshot;
  }[],
) {
  const attributions = new Map<
    string,
    {
      courseIds: Set<string>;
      courseAuthorCourseIds: Set<string>;
      profile: OrbitTransferAuthorProfile;
    }
  >();
  const register = (
    sourceUserId: string,
    courseId: string,
    profile: OrbitTransferAuthorProfile,
    isCourseAuthor: boolean,
  ) => {
    const existing = attributions.get(sourceUserId);
    if (existing) {
      if (isCourseAuthor && existing.courseAuthorCourseIds.has(courseId)) {
        throw new OrbitTransferSourceAuthorError();
      }
      existing.courseIds.add(courseId);
      if (isCourseAuthor) existing.courseAuthorCourseIds.add(courseId);
      return;
    }
    attributions.set(sourceUserId, {
      courseIds: new Set([courseId]),
      courseAuthorCourseIds: new Set(isCourseAuthor ? [courseId] : []),
      profile,
    });
  };

  for (const source of sources) {
    for (const author of source.snapshot.authors ?? []) {
      if (
        !UUID_PATTERN.test(author.userId) ||
        author.organizationId !== source.organizationId ||
        author.courseId !== source.courseId ||
        !isValidProfile(author.author, author.userId)
      ) {
        throw new OrbitTransferSourceAuthorError();
      }
      register(author.userId, source.courseId, author.author, true);
    }
    for (const widget of source.snapshot.widgets ?? []) {
      if (widget.type !== "author") continue;
      if (
        widget.organizationId !== source.organizationId ||
        widget.courseId !== source.courseId ||
        !widget.authorUserId ||
        !UUID_PATTERN.test(widget.authorUserId) ||
        !isValidProfile(widget.author, widget.authorUserId)
      ) {
        throw new OrbitTransferSourceAuthorError();
      }
      register(widget.authorUserId, source.courseId, widget.author, false);
    }
  }

  return [...attributions]
    .map(([sourceUserId, attribution]) => ({
      sourceUserId,
      courseIds: [...attribution.courseIds].sort(),
      courseAuthorCourseIds: [...attribution.courseAuthorCourseIds].sort(),
      profile: attribution.profile,
    }))
    .sort((left, right) => left.sourceUserId.localeCompare(right.sourceUserId));
}

function normalizedEmail(email: string) {
  return email.trim().toLocaleLowerCase("en-US");
}

function isEligibleTarget(
  user: AuthorDirectoryUser,
): user is AuthorDirectoryUser & {
  role: (typeof ORBIT_TRANSFER_AUTHOR_ROLES)[number];
  status: "active";
} {
  return (
    user.status === "active" &&
    ORBIT_TRANSFER_AUTHOR_ROLES.some((role) => role === user.role)
  );
}

export function resolveOrbitTransferAuthorMappings(input: {
  attributions: readonly OrbitTransferSourceAttribution[];
  sourceUsers: readonly AuthorDirectoryUser[];
  targetUsers: readonly AuthorDirectoryUser[];
  requestedMappings?: readonly OrbitTransferAuthorMapping[];
}): OrbitTransferAuthorResolution {
  const sourceUsers = new Map(input.sourceUsers.map((user) => [user.id, user]));
  const targetUsers = input.targetUsers.filter(isEligibleTarget);
  if (targetUsers.length !== input.targetUsers.length) {
    return { ok: false, reason: "ineligible_target" };
  }
  const targetById = new Map(targetUsers.map((user) => [user.id, user]));
  const sourceIds = new Set(input.attributions.map((author) => author.sourceUserId));
  const explicit = new Map<string, string>();
  for (const mapping of input.requestedMappings ?? []) {
    if (explicit.has(mapping.sourceUserId)) {
      return { ok: false, reason: "duplicate_source" };
    }
    if (!sourceIds.has(mapping.sourceUserId)) {
      return { ok: false, reason: "unknown_source" };
    }
    if (!targetById.has(mapping.targetUserId)) {
      return { ok: false, reason: "unknown_target" };
    }
    explicit.set(mapping.sourceUserId, mapping.targetUserId);
  }

  const sourceEmailCounts = new Map<string, number>();
  for (const attribution of input.attributions) {
    const source = sourceUsers.get(attribution.sourceUserId);
    if (!source) continue;
    const email = normalizedEmail(source.email);
    sourceEmailCounts.set(email, (sourceEmailCounts.get(email) ?? 0) + 1);
  }
  const targetEmailGroups = new Map<string, AuthorDirectoryUser[]>();
  for (const target of targetUsers) {
    const email = normalizedEmail(target.email);
    targetEmailGroups.set(email, [...(targetEmailGroups.get(email) ?? []), target]);
  }

  const automatic = new Map<string, string>();
  for (const attribution of input.attributions) {
    const source = sourceUsers.get(attribution.sourceUserId);
    if (!source) continue;
    const email = normalizedEmail(source.email);
    const matches = targetEmailGroups.get(email) ?? [];
    if (sourceEmailCounts.get(email) === 1 && matches.length === 1) {
      automatic.set(attribution.sourceUserId, matches[0]!.id);
    }
  }

  const resolved = new Map(automatic);
  for (const [sourceUserId, targetUserId] of explicit) {
    resolved.set(sourceUserId, targetUserId);
  }

  for (const courseId of new Set(
    input.attributions.flatMap((author) => author.courseAuthorCourseIds),
  )) {
    const targets = new Set<string>();
    for (const author of input.attributions) {
      if (!author.courseAuthorCourseIds.includes(courseId)) continue;
      const targetUserId = resolved.get(author.sourceUserId);
      if (!targetUserId) continue;
      if (targets.has(targetUserId)) {
        return { ok: false, reason: "course_author_collision" };
      }
      targets.add(targetUserId);
    }
  }

  const sourceAuthors = input.attributions.map((attribution) => {
    const user = sourceUsers.get(attribution.sourceUserId);
    return {
      ...attribution,
      profile: user
        ? {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            avatarUrl: user.avatarUrl,
            jobTitle: user.jobTitle,
            bio: user.bio,
          }
        : attribution.profile,
      email: user?.email ?? null,
      role: user?.role ?? null,
      status: user?.status ?? null,
      automaticTargetUserId: automatic.get(attribution.sourceUserId) ?? null,
    };
  });
  const targetAuthors = targetUsers.map((user) => ({
    targetUserId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  }));
  const authorMappings = [...resolved]
    .map(([sourceUserId, targetUserId]) => ({ sourceUserId, targetUserId }))
    .sort((left, right) => left.sourceUserId.localeCompare(right.sourceUserId));

  return {
    ok: true,
    sourceAuthors,
    targetAuthors,
    authorMappings,
    complete: authorMappings.length === input.attributions.length,
  };
}

export function canonicalOrbitTransferAuthorMappings(
  mappings: readonly OrbitTransferAuthorMapping[],
) {
  return [...mappings]
    .map(({ sourceUserId, targetUserId }) => ({ sourceUserId, targetUserId }))
    .sort((left, right) =>
      left.sourceUserId.localeCompare(right.sourceUserId) ||
      left.targetUserId.localeCompare(right.targetUserId),
    );
}
