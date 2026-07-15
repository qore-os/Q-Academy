import { z } from "zod";

export const eventStatusSchema = z.enum(["scheduled", "cancelled"]);
export type EventStatus = z.infer<typeof eventStatusSchema>;

const lifecycleReasonSchema = z
  .string()
  .trim()
  .min(3, "Bitte gib einen nachvollziehbaren Grund an.")
  .max(500, "Der Grund darf hoechstens 500 Zeichen lang sein.");

const lifecycleDateSchema = z
  .union([z.date(), z.string().datetime({ offset: true })])
  .transform((value) => (value instanceof Date ? value : new Date(value)));

export const cancelEventLifecycleSchema = z
  .object({
    action: z.literal("cancel"),
    reason: lifecycleReasonSchema,
  })
  .strict();

export const rescheduleEventLifecycleSchema = z
  .object({
    action: z.literal("reschedule"),
    startsAt: lifecycleDateSchema,
    endsAt: lifecycleDateSchema,
    reason: lifecycleReasonSchema,
  })
  .strict();

export const eventLifecycleCommandSchema = z.discriminatedUnion("action", [
  cancelEventLifecycleSchema,
  rescheduleEventLifecycleSchema,
]);

export type EventLifecycleCommand = z.infer<
  typeof eventLifecycleCommandSchema
>;

export type EventLifecycleState = {
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
};

export type EventLifecycleResolution =
  | {
      ok: true;
      action: "cancelled" | "rescheduled";
      fromStatus: EventStatus;
      toStatus: EventStatus;
      startsAt: Date;
      endsAt: Date;
      reason: string;
    }
  | {
      ok: false;
      reason:
        | "already_cancelled"
        | "unchanged"
        | "invalid_window"
        | "start_not_future";
    };

export function resolveEventLifecycleTransition(
  current: EventLifecycleState,
  command: EventLifecycleCommand,
  now = new Date(),
): EventLifecycleResolution {
  if (command.action === "cancel") {
    if (current.status === "cancelled") {
      return { ok: false, reason: "already_cancelled" };
    }
    return {
      ok: true,
      action: "cancelled",
      fromStatus: current.status,
      toStatus: "cancelled",
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      reason: command.reason,
    };
  }

  if (command.endsAt <= command.startsAt) {
    return { ok: false, reason: "invalid_window" };
  }
  if (command.startsAt <= now) {
    return { ok: false, reason: "start_not_future" };
  }
  if (
    current.status === "scheduled" &&
    current.startsAt.getTime() === command.startsAt.getTime() &&
    current.endsAt.getTime() === command.endsAt.getTime()
  ) {
    return { ok: false, reason: "unchanged" };
  }
  return {
    ok: true,
    action: "rescheduled",
    fromStatus: current.status,
    toStatus: "scheduled",
    startsAt: command.startsAt,
    endsAt: command.endsAt,
    reason: command.reason,
  };
}
