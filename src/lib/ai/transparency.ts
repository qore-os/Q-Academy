import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  aiExternalUseAcknowledgements,
  organizations,
  platformSettings,
  users,
} from "@/db/schema";
import { brandingFromRow } from "@/lib/branding";
import { buildAiTransparencyNotice } from "@/lib/ai/transparency-model";
import { ApiError } from "@/lib/api/errors";

type AiTransparencyReader = Pick<typeof db, "select">;

async function currentAiTransparencyNotice(
  organizationId: string,
  reader: AiTransparencyReader = db,
) {
  const [row] = await reader
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      primaryColor: organizations.primaryColor,
      accentColor: organizations.accentColor,
      logoMark: organizations.logoMark,
      settings: platformSettings.value,
    })
    .from(organizations)
    .leftJoin(
      platformSettings,
      and(
        eq(platformSettings.organizationId, organizations.id),
        eq(platformSettings.key, "design"),
      ),
    )
    .where(
      and(
        eq(organizations.id, organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ApiError(404, "not_found", "Academy nicht gefunden.");
  }
  const branding = brandingFromRow(row);
  return buildAiTransparencyNotice({
    privacyPolicyUrl: branding.privacyPolicyUrl,
    transparencyPolicyUrl: branding.aiTransparencyUrl,
  });
}

export async function getAiTransparencyState(input: {
  organizationId: string;
  userId: string;
}) {
  const notice = await currentAiTransparencyNotice(input.organizationId);
  const [state] = await db
    .select({
      userId: users.id,
      acknowledgedAt: aiExternalUseAcknowledgements.acknowledgedAt,
    })
    .from(users)
    .leftJoin(
      aiExternalUseAcknowledgements,
      and(
        eq(aiExternalUseAcknowledgements.userId, users.id),
        eq(
          aiExternalUseAcknowledgements.organizationId,
          users.organizationId,
        ),
        eq(aiExternalUseAcknowledgements.noticeDigest, notice.digest),
      ),
    )
    .where(
      and(
        eq(users.organizationId, input.organizationId),
        eq(users.id, input.userId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!state) {
    throw new ApiError(404, "not_found", "Aktives Mitglied nicht gefunden.");
  }
  return {
    required: !state.acknowledgedAt,
    acknowledgedAt: state.acknowledgedAt,
    notice,
  };
}

export async function acknowledgeAiTransparencyNotice(input: {
  organizationId: string;
  userId: string;
  expectedDigest: string;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('tenant-branding-login-hostname'))`,
    );
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.userId),
          eq(users.organizationId, input.organizationId),
          eq(users.status, "active"),
        ),
      )
      .for("update")
      .limit(1);
    if (!user) {
      throw new ApiError(404, "not_found", "Aktives Mitglied nicht gefunden.");
    }
    const notice = await currentAiTransparencyNotice(
      input.organizationId,
      tx,
    );
    if (notice.digest !== input.expectedDigest) {
      throw new ApiError(
        409,
        "conflict",
        "Der KI-Transparenzhinweis wurde aktualisiert. Bitte lies die aktuelle Fassung.",
        { currentDigest: notice.digest },
      );
    }
    const [created] = await tx
      .insert(aiExternalUseAcknowledgements)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        noticeVersion: notice.version,
        noticeDigest: notice.digest,
        privacyPolicyUrl: notice.privacyPolicyUrl,
        transparencyPolicyUrl: notice.transparencyPolicyUrl,
      })
      .onConflictDoNothing({
        target: [
          aiExternalUseAcknowledgements.organizationId,
          aiExternalUseAcknowledgements.userId,
          aiExternalUseAcknowledgements.noticeDigest,
        ],
      })
      .returning({
        id: aiExternalUseAcknowledgements.id,
        acknowledgedAt: aiExternalUseAcknowledgements.acknowledgedAt,
      });
    if (created) {
      await tx.insert(activityEvents).values({
        organizationId: input.organizationId,
        userId: input.userId,
        type: "ai.external_use.acknowledged",
        entityType: "ai_external_use_acknowledgement",
        entityId: created.id,
        metadata: {
          noticeVersion: notice.version,
          noticeDigest: notice.digest,
          privacyPolicyUrl: notice.privacyPolicyUrl,
          transparencyPolicyUrl: notice.transparencyPolicyUrl,
        },
      });
    }
    const [stored] = created
      ? [created]
      : await tx
          .select({
            id: aiExternalUseAcknowledgements.id,
            acknowledgedAt: aiExternalUseAcknowledgements.acknowledgedAt,
          })
          .from(aiExternalUseAcknowledgements)
          .where(
            and(
              eq(
                aiExternalUseAcknowledgements.organizationId,
                input.organizationId,
              ),
              eq(aiExternalUseAcknowledgements.userId, input.userId),
              eq(aiExternalUseAcknowledgements.noticeDigest, notice.digest),
            ),
          )
          .limit(1);
    if (!stored) {
      throw new ApiError(
        500,
        "internal_error",
        "Der KI-Transparenzhinweis konnte nicht bestaetigt werden.",
      );
    }
    return {
      required: false,
      acknowledgedAt: stored.acknowledgedAt,
      notice,
    };
  });
}

export async function requireAiTransparencyAcknowledgement(input: {
  organizationId: string;
  userId: string;
}) {
  const state = await getAiTransparencyState(input);
  if (state.required) {
    throw new ApiError(
      428,
      "precondition_required",
      "Vor der ersten KI-Nutzung muss der Transparenzhinweis bestaetigt werden.",
      { noticeDigest: state.notice.digest },
    );
  }
  return state;
}
