import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { lessons, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

export type ModuleStructureTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export async function lockModuleStructure(
  transaction: ModuleStructureTransaction,
  input: { organizationId: string; moduleId: string },
) {
  await transaction.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`exam-module:${input.moduleId}`}, 0)
    )
  `);
  const [learningModule] = await transaction
    .select({ id: modules.id, kind: modules.kind })
    .from(modules)
    .where(
      and(
        eq(modules.id, input.moduleId),
        eq(modules.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!learningModule) {
    throw new ApiError(404, "not_found", "Modul nicht gefunden.");
  }
  return learningModule;
}

export async function assertLearningModuleStructureMutation(
  transaction: ModuleStructureTransaction,
  input: { organizationId: string; moduleId: string },
) {
  const learningModule = await lockModuleStructure(transaction, input);
  if (learningModule.kind !== "learning") {
    throw new ApiError(
      409,
      "conflict",
      learningModule.kind === "link"
        ? "Ein Link-Modul kann keine Lerninhalte enthalten."
        : "Die feste Struktur eines Pruefungsmoduls kann nicht erweitert werden.",
    );
  }
  return learningModule;
}

export async function lockLessonModuleStructure(
  transaction: ModuleStructureTransaction,
  input: { organizationId: string; lessonId: string },
) {
  const [reference] = await transaction
    .select({ moduleId: lessons.moduleId })
    .from(lessons)
    .where(
      and(
        eq(lessons.id, input.lessonId),
        eq(lessons.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!reference) {
    throw new ApiError(404, "not_found", "Lektion nicht gefunden.");
  }
  const learningModule = await lockModuleStructure(transaction, {
    organizationId: input.organizationId,
    moduleId: reference.moduleId,
  });
  const [current] = await transaction
    .select({ moduleId: lessons.moduleId })
    .from(lessons)
    .where(
      and(
        eq(lessons.id, input.lessonId),
        eq(lessons.organizationId, input.organizationId),
        eq(lessons.moduleId, reference.moduleId),
      ),
    )
    .limit(1);
  if (!current) {
    throw new ApiError(
      409,
      "conflict",
      "Die Lektionsstruktur wurde gleichzeitig geaendert.",
    );
  }
  return learningModule;
}

export async function assertLessonStructureMutation(
  transaction: ModuleStructureTransaction,
  input: {
    organizationId: string;
    lessonId: string;
    mutation: "update" | "delete";
    type?: string;
  },
) {
  const learningModule = await lockLessonModuleStructure(transaction, input);
  if (learningModule.kind !== "exam") return learningModule;
  if (input.mutation === "delete") {
    throw new ApiError(
      409,
      "conflict",
      "Die einzige Pruefung eines Pruefungsmoduls kann nicht geloescht werden.",
    );
  }
  if (input.type !== undefined && input.type !== "exam") {
    throw new ApiError(
      409,
      "conflict",
      "Der Lektionstyp eines Pruefungsmoduls muss Pruefung bleiben.",
    );
  }
  return learningModule;
}

export function assertExamModuleRetainsPage(
  moduleKind: "learning" | "exam" | "link",
  remainingPageCount: number,
) {
  if (moduleKind === "exam" && remainingPageCount < 1) {
    throw new ApiError(
      409,
      "conflict",
      "Ein Pruefungsmodul muss mindestens eine Pruefungsseite behalten.",
    );
  }
}
