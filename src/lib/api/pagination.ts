import { ApiError } from "@/lib/api/errors";

export type Pagination = { limit: number; offset: number; cursor: string | null };

function decodeCursor(value: string) {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as { offset?: unknown };
    if (!Number.isInteger(parsed.offset) || Number(parsed.offset) < 0) throw new Error("invalid cursor");
    return Number(parsed.offset);
  } catch {
    throw new ApiError(400, "bad_request", "Der Cursor ist ungueltig.");
  }
}

export function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

export function parsePagination(url: URL): Pagination {
  const rawLimit = Number(url.searchParams.get("limit") ?? 25);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    throw new ApiError(400, "bad_request", "limit muss eine Ganzzahl zwischen 1 und 100 sein.");
  }
  const cursor = url.searchParams.get("cursor");
  return { limit: rawLimit, offset: cursor ? decodeCursor(cursor) : 0, cursor };
}

export function paginationMeta(pagination: Pagination, returned: number, hasMore: boolean) {
  return {
    limit: pagination.limit,
    returned,
    nextCursor: hasMore ? encodeCursor(pagination.offset + pagination.limit) : null,
  };
}
