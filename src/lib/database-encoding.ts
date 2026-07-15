export const REQUIRED_DATABASE_ENCODING = "UTF8" as const;

export function assertUtf8DatabaseEncoding(value: unknown) {
  const encoding = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (encoding !== REQUIRED_DATABASE_ENCODING) {
    throw new Error(
      `PostgreSQL server_encoding must be ${REQUIRED_DATABASE_ENCODING} (received ${encoding || "unknown"}).`,
    );
  }
  return REQUIRED_DATABASE_ENCODING;
}
