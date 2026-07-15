"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTeamPermission } from "@/lib/auth";
import { releaseEmailSuppressionAsAdmin } from "@/lib/email-feedback";
import { emailSuppressionReleaseSchema } from "@/lib/email-feedback-model";

export type EmailSuppressionActionState = {
  ok: boolean;
  code?: "invalid" | "released" | "release_failed";
};

export async function releaseEmailSuppressionAction(
  _state: EmailSuppressionActionState,
  formData: FormData,
): Promise<EmailSuppressionActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const suppressionId = z.string().uuid().safeParse(formData.get("id"));
  const parsed = emailSuppressionReleaseSchema.safeParse({
    reason: formData.get("reason"),
  });
  if (!suppressionId.success || !parsed.success) {
    return { ok: false, code: "invalid" };
  }
  try {
    await releaseEmailSuppressionAsAdmin({
      organizationId: actor.organizationId,
      suppressionId: suppressionId.data,
      actorId: actor.id,
      reason: parsed.data.reason,
    });
    revalidatePath("/admin/email/suppressions");
    return { ok: true, code: "released" };
  } catch {
    return { ok: false, code: "release_failed" };
  }
}
