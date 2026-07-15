export const ORBIT_TRANSFER_WARNING_CODES = [
  "target_seat_limit_exceeded",
  "external_course_link_neutralized",
  "tenant_dependency_removed",
] as const;

export type OrbitTransferWarningCode =
  (typeof ORBIT_TRANSFER_WARNING_CODES)[number];

export function orbitTransferWarningsAccepted(
  required: readonly OrbitTransferWarningCode[],
  accepted: readonly OrbitTransferWarningCode[],
) {
  const normalizedRequired = [...new Set(required)].sort();
  const normalizedAccepted = [...new Set(accepted)].sort();
  if (
    normalizedRequired.length !== required.length ||
    normalizedAccepted.length !== accepted.length ||
    normalizedRequired.length !== normalizedAccepted.length
  ) {
    return false;
  }
  return normalizedRequired.every(
    (warning, index) => warning === normalizedAccepted[index],
  );
}

export function orbitTransferConfirmationMatches(input: {
  expectedToken: string;
  confirmationToken: string;
  requiredWarnings: readonly OrbitTransferWarningCode[];
  acceptedWarnings: readonly OrbitTransferWarningCode[];
}) {
  return (
    input.confirmationToken === input.expectedToken &&
    orbitTransferWarningsAccepted(
      input.requiredWarnings,
      input.acceptedWarnings,
    )
  );
}
