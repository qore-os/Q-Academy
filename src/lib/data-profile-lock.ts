export function dataProfileMutationLockKey(
  organizationId: string,
  memberId: string,
) {
  return `data-profiles:${organizationId}:${memberId}`;
}

export function dataFormMutationLockKey(
  organizationId: string,
  formId: string,
) {
  return `data-forms:${organizationId}:${formId}`;
}
