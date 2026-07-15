export type LessonAvailabilityAccess = {
  state: string;
  listed: boolean;
  canOpen: boolean;
};

export function canSubscribeToLessonAvailability(
  access: LessonAvailabilityAccess | null | undefined,
) {
  return Boolean(
    access?.listed && access.state === "coming_soon" && !access.canOpen,
  );
}

export function shouldFulfillLessonAvailabilitySubscription(input: {
  previousAccess: LessonAvailabilityAccess | null | undefined;
  nextAccess: LessonAvailabilityAccess | null | undefined;
}) {
  return (
    canSubscribeToLessonAvailability(input.previousAccess) &&
    Boolean(input.nextAccess?.listed && input.nextAccess.canOpen)
  );
}

