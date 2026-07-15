type IntegerQueryParameter = {
  kind: "integer";
  defaultValue: number;
  minimum: number;
  maximum: number;
  detail: string;
};

type EnumQueryParameter<Values extends readonly string[] = readonly string[]> = {
  kind: "enum";
  values: Values;
  defaultValue: null;
  detail: string;
};

type InternalJobQueryParameter =
  | IntegerQueryParameter
  | EnumQueryParameter;

type InternalJobQuerySchema = Record<string, InternalJobQueryParameter>;

type ParsedQueryParameter<Parameter> =
  Parameter extends IntegerQueryParameter
    ? number
    : Parameter extends EnumQueryParameter<infer Values>
      ? Values[number] | null
      : never;

export type ParsedInternalJobQuery<Schema extends InternalJobQuerySchema> = {
  [Name in keyof Schema]: ParsedQueryParameter<Schema[Name]>;
};

export type InternalJobQueryResult<Schema extends InternalJobQuerySchema> =
  | { ok: true; value: ParsedInternalJobQuery<Schema> }
  | { ok: false; detail: string };

export const INTERNAL_JOB_DISPATCH_MAX_LIMIT = 100;
export const INTERNAL_CLEANUP_MAX_LIMIT = 1_000;
export const INTERNAL_WEBHOOK_DISPATCH_MAX_LIMIT = 100;
export const INTERNAL_MEDIA_DISPATCH_MAX_LIMIT = 1;
export const INTERNAL_MEDIA_MAINTENANCE_MAX_LIMIT = 5;

export const INTERNAL_JOB_DISPATCH_QUERY = {
  limit: {
    kind: "integer",
    defaultValue: 25,
    minimum: 1,
    maximum: INTERNAL_JOB_DISPATCH_MAX_LIMIT,
    detail: "limit muss eine ganze Zahl zwischen 1 und 100 sein.",
  },
  cleanup: {
    kind: "enum",
    values: ["dry-run", "run"],
    defaultValue: null,
    detail: "Der Parameter cleanup unterstuetzt nur run oder dry-run.",
  },
  cleanupLimit: {
    kind: "integer",
    defaultValue: 250,
    minimum: 1,
    maximum: INTERNAL_CLEANUP_MAX_LIMIT,
    detail: "cleanupLimit muss eine ganze Zahl zwischen 1 und 1000 sein.",
  },
} as const satisfies InternalJobQuerySchema;

export const INTERNAL_WEBHOOK_DISPATCH_QUERY = {
  limit: {
    kind: "integer",
    defaultValue: 25,
    minimum: 1,
    maximum: INTERNAL_WEBHOOK_DISPATCH_MAX_LIMIT,
    detail: "limit muss eine ganze Zahl zwischen 1 und 100 sein.",
  },
} as const satisfies InternalJobQuerySchema;

export const INTERNAL_MEDIA_DISPATCH_QUERY = {
  limit: {
    kind: "integer",
    defaultValue: 1,
    minimum: 1,
    maximum: INTERNAL_MEDIA_DISPATCH_MAX_LIMIT,
    detail: "limit muss fuer Medienjobs 1 sein.",
  },
} as const satisfies InternalJobQuerySchema;

export const INTERNAL_MEDIA_MAINTENANCE_QUERY = {
  limit: {
    kind: "integer",
    defaultValue: 5,
    minimum: 1,
    maximum: INTERNAL_MEDIA_MAINTENANCE_MAX_LIMIT,
    detail: "limit muss eine ganze Zahl zwischen 1 und 5 sein.",
  },
} as const satisfies InternalJobQuerySchema;

export function parseInternalJobQuery<
  const Schema extends InternalJobQuerySchema,
>(
  request: Pick<Request, "url">,
  schema: Schema,
): InternalJobQueryResult<Schema> {
  const searchParams = new URL(request.url).searchParams;
  const seen = new Set<string>();
  for (const name of searchParams.keys()) {
    if (!Object.hasOwn(schema, name)) {
      return {
        ok: false,
        detail: "Die Anfrage enthaelt unbekannte Query-Parameter.",
      };
    }
    if (seen.has(name)) {
      return {
        ok: false,
        detail: "Query-Parameter duerfen nur einmal gesetzt werden.",
      };
    }
    seen.add(name);
  }

  const parsed: Record<string, number | string | null> = {};
  for (const [name, parameter] of Object.entries(schema)) {
    const rawValue = searchParams.get(name);
    if (rawValue === null) {
      parsed[name] = parameter.defaultValue;
      continue;
    }
    if (parameter.kind === "enum") {
      const value = parameter.values.find((candidate) => candidate === rawValue);
      if (value === undefined) return { ok: false, detail: parameter.detail };
      parsed[name] = value;
      continue;
    }
    if (rawValue.length > 16 || !/^(?:0|[1-9]\d*)$/.test(rawValue)) {
      return { ok: false, detail: parameter.detail };
    }
    const value = Number(rawValue);
    if (
      !Number.isSafeInteger(value) ||
      value < parameter.minimum ||
      value > parameter.maximum
    ) {
      return { ok: false, detail: parameter.detail };
    }
    parsed[name] = value;
  }

  return {
    ok: true,
    value: parsed as ParsedInternalJobQuery<Schema>,
  };
}

export function internalJobProblem(
  requestId: string,
  status: 400 | 401,
  detail: string,
) {
  return Response.json(
    {
      type: "about:blank",
      title: status === 401 ? "Unauthorized" : "Bad Request",
      status,
      detail,
      requestId,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/problem+json",
        "X-Request-Id": requestId,
      },
    },
  );
}
