import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";

type PrivacyLockTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type PrivacyLegalHoldSubject = {
  organizationId: string;
  subjectReference: string;
};

export async function lockPrivacyLegalHoldSubjects(
  transaction: PrivacyLockTransaction,
  subjects: PrivacyLegalHoldSubject[],
) {
  const uniqueSubjects = [
    ...new Map(
      subjects.map((subject) => [
        `${subject.organizationId}\0${subject.subjectReference}`,
        subject,
      ]),
    ).values(),
  ].sort((left, right) =>
    `${left.organizationId}\0${left.subjectReference}`.localeCompare(
      `${right.organizationId}\0${right.subjectReference}`,
    ),
  );
  for (const subject of uniqueSubjects) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`q-academy:privacy-legal-hold:v1:${subject.organizationId}:${subject.subjectReference}`}::text, 0))`,
    );
  }
}
