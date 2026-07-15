"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { ApiError } from "@/lib/api/errors";
import { requireTeamPermission } from "@/lib/auth";
import { logServerError } from "@/lib/server-error-logging";
import { updateTranscriptSearchSettings } from "@/lib/transcript-search-settings";
import { transcriptSearchSettingsTextSchema } from "@/lib/transcript-search-settings-model";

export type TranscriptSearchSettingsActionState = {
  error?: string;
  success?: string;
  excludedSearchTerms?: string[];
  code?: TranscriptSearchSettingsActionCode;
};

export type TranscriptSearchSettingsActionCode =
  | "transcriptInvalid"
  | "transcriptSaved"
  | "noChanges"
  | "transcriptFailed";

export async function updateTranscriptSearchSettingsAction(
  _state: TranscriptSearchSettingsActionState,
  formData: FormData,
): Promise<TranscriptSearchSettingsActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsed = transcriptSearchSettingsTextSchema.safeParse(
    formData.get("excludedSearchTerms"),
  );
  if (!parsed.success) {
    return {
      code: "transcriptInvalid",
      error:
        parsed.error.issues[0]?.message ??
        "Bitte die ausgeschlossenen Suchbegriffe pruefen.",
    };
  }

  try {
    const saved = await db.transaction((tx) =>
      updateTranscriptSearchSettings(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        source: "admin_ui",
        settings: { excludedSearchTerms: parsed.data },
      }),
    );
    revalidatePath("/admin/settings");
    revalidatePath("/academy", "layout");
    return {
      code: saved.changed ? "transcriptSaved" : "noChanges",
      success: saved.changed
        ? `${saved.excludedSearchTerms.length} Suchausschluesse gespeichert.`
        : "Keine Aenderungen gespeichert.",
      excludedSearchTerms: saved.excludedSearchTerms,
    };
  } catch (error) {
    if (error instanceof ApiError) return { code: "transcriptFailed", error: error.message };
    logServerError(error, { action: "platform.transcript_search.update" });
    return {
      code: "transcriptFailed",
      error: "Die Transkript-Sucheinstellungen konnten nicht gespeichert werden.",
    };
  }
}
