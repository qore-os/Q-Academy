type OperationResponseContract = {
  deprecated?: boolean;
  responses: Record<string, unknown>;
  "x-always-error"?: boolean;
};

export function hasValidOpenApiResponseContract(
  operation: OperationResponseContract,
) {
  const statuses = Object.keys(operation.responses);
  if (statuses.some((status) => /^[23]\d\d$/.test(status))) return true;
  return (
    operation.deprecated === true &&
    operation["x-always-error"] === true &&
    statuses.includes("409")
  );
}
