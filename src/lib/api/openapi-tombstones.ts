export const API_TOMBSTONE_OPERATIONS = [
  "get /modules/{id}/sections",
  "post /modules/{id}/sections",
  "get /sections/{id}",
  "patch /sections/{id}",
  "delete /sections/{id}",
  "get /sections/{id}/lessons",
  "post /sections/{id}/lessons",
  "put /sections/{id}/lesson-visibility",
  "patch /sections/{id}/lesson-visibility",
] as const;
