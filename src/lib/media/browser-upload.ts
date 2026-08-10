export function browserUploadHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => name.toLowerCase() !== "content-length",
    ),
  );
}

export function browserUploadErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) return message;
  }
  return fallback;
}
