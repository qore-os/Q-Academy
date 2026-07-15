import { z } from "zod";

export const DEFAULT_MEMBER_WELCOME_SETTINGS = Object.freeze({
  enabled: false,
  title: "Willkommen in deiner Academy",
  welcomeText:
    "Schoen, dass du da bist. Hier findest du alles fuer deinen Lernstart.",
  videoUrl: null,
  promptProfileImage: false,
  promptProfileCompletion: false,
});

const secureVideoUrlSchema = z
  .string()
  .trim()
  .url("Bitte eine gueltige Video-URL eingeben.")
  .max(2000)
  .transform((value, context) => {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Die Video-URL muss HTTPS verwenden und darf keine Zugangsdaten enthalten.",
      });
      return z.NEVER;
    }
    return parsed.toString();
  });

export const memberWelcomeSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    title: z.string().trim().min(1).max(160),
    welcomeText: z.string().trim().min(1).max(5000),
    videoUrl: secureVideoUrlSchema.nullable(),
    promptProfileImage: z.boolean(),
    promptProfileCompletion: z.boolean(),
  })
  .strict();

export const memberWelcomeSettingsUpdateSchema = z
  .object({
    enabled: memberWelcomeSettingsInputSchema.shape.enabled.optional(),
    title: memberWelcomeSettingsInputSchema.shape.title.optional(),
    welcomeText: memberWelcomeSettingsInputSchema.shape.welcomeText.optional(),
    videoUrl: memberWelcomeSettingsInputSchema.shape.videoUrl.optional(),
    promptProfileImage:
      memberWelcomeSettingsInputSchema.shape.promptProfileImage.optional(),
    promptProfileCompletion:
      memberWelcomeSettingsInputSchema.shape.promptProfileCompletion.optional(),
  })
  .strict();

export type MemberWelcomeSettingsInput = z.infer<
  typeof memberWelcomeSettingsInputSchema
>;
export type MemberWelcomeSettingsUpdate = z.infer<
  typeof memberWelcomeSettingsUpdateSchema
>;

export type MemberWelcomeSettingsView = MemberWelcomeSettingsInput & {
  version: number;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type MemberWelcomeSettingsMutationResult =
  MemberWelcomeSettingsView & { changed: boolean };

export type PendingMemberWelcome = MemberWelcomeSettingsInput & {
  version: number;
};

export function changedMemberWelcomeFields(
  current: MemberWelcomeSettingsInput,
  next: MemberWelcomeSettingsInput,
) {
  return (Object.keys(current) as Array<keyof MemberWelcomeSettingsInput>).filter(
    (key) => current[key] !== next[key],
  );
}

export function isMemberWelcomePending(input: {
  enabled: boolean;
  memberRole: "owner" | "admin" | "trainer" | "member";
  memberStatus: "active" | "invited" | "disabled";
  configurationVersion: number;
  acknowledgedVersion: number | null;
}) {
  return (
    input.enabled &&
    input.memberRole === "member" &&
    input.memberStatus === "active" &&
    input.configurationVersion >= 1 &&
    (input.acknowledgedVersion ?? 0) < input.configurationVersion
  );
}
