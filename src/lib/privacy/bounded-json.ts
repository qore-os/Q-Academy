import { isProxy } from "node:util/types";

const DEFAULT_MAX_DEPTH = 256;

export class BoundedJsonError extends Error {
  constructor(
    public readonly code: "invalid_value" | "size_exceeded",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BoundedJsonError";
  }
}

type Measurement = { omitted: boolean };

function assertBound(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`The bounded JSON ${name} is invalid.`);
  }
}

function stringBytes(value: string, add: (bytes: number) => void) {
  add(2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      add(2);
    } else if (
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      add(2);
    } else if (code <= 0x1f) {
      add(6);
    } else if (code <= 0x7f) {
      add(1);
    } else if (code <= 0x7ff) {
      add(2);
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (following >= 0xdc00 && following <= 0xdfff) {
        add(4);
        index += 1;
      } else {
        add(6);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      add(6);
    } else {
      add(3);
    }
  }
}

function invalidValue(message: string): never {
  throw new BoundedJsonError("invalid_value", message);
}

function isCanonicalArrayIndex(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return false;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff;
}

function assertSafeArrayPrototypeChain(value: unknown[]) {
  let prototype = Object.getPrototypeOf(value);
  while (prototype !== null) {
    if (isProxy(prototype)) {
      invalidValue("Proxy array prototypes are not supported in bounded JSON.");
    }
    const toJson = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    if (
      toJson &&
      (!("value" in toJson) || typeof toJson.value === "function")
    ) {
      invalidValue("Custom JSON encoders are not supported.");
    }
    if (
      Object.getOwnPropertyNames(prototype).some(isCanonicalArrayIndex)
    ) {
      invalidValue("Array prototype index properties are not supported.");
    }
    if (prototype === Array.prototype) return;
    prototype = Object.getPrototypeOf(prototype);
  }
  invalidValue("The array prototype chain is invalid.");
}

export function measureBoundedJsonBytes(
  value: unknown,
  input: {
    maxBytes: number;
    space?: number;
    trailingNewline?: boolean;
    maxDepth?: number;
  },
) {
  const space = input.space ?? 0;
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  assertBound(input.maxBytes, "byte limit");
  if (
    !Number.isSafeInteger(space) ||
    space < 0 ||
    space > 10 ||
    !Number.isSafeInteger(maxDepth) ||
    maxDepth < 1
  ) {
    throw new TypeError("The bounded JSON formatting options are invalid.");
  }

  let bytes = 0;
  const active = new Set<object>();
  const add = (amount: number) => {
    bytes += amount;
    if (!Number.isSafeInteger(bytes) || bytes > input.maxBytes) {
      throw new BoundedJsonError(
        "size_exceeded",
        "The JSON value exceeds the configured byte limit.",
      );
    }
  };

  const measure = (
    current: unknown,
    depth: number,
    arrayValue: boolean,
  ): Measurement => {
    if (depth > maxDepth) {
      invalidValue("The JSON value exceeds the supported nesting depth.");
    }
    if (current === null) {
      add(4);
      return { omitted: false };
    }
    switch (typeof current) {
      case "string":
        stringBytes(current, add);
        return { omitted: false };
      case "boolean":
        add(current ? 4 : 5);
        return { omitted: false };
      case "number": {
        const encoded = Number.isFinite(current)
          ? JSON.stringify(current)!
          : "null";
        add(encoded.length);
        return { omitted: false };
      }
      case "undefined":
      case "function":
      case "symbol":
        if (arrayValue) add(4);
        return { omitted: !arrayValue };
      case "bigint":
        invalidValue("BigInt values cannot be encoded as JSON.");
        break;
      case "object":
        break;
      default:
        invalidValue("The JSON value has an unsupported type.");
    }

    const object = current as object;
    if (isProxy(object)) {
      invalidValue("Proxy values are not supported in bounded JSON.");
    }
    if (object instanceof Date) {
      if (Object.getPrototypeOf(object) !== Date.prototype) {
        invalidValue("Date subclasses are not supported in bounded JSON.");
      }
      if (
        Object.hasOwn(object, "toJSON") ||
        Object.hasOwn(object, "valueOf") ||
        Object.hasOwn(object, "toISOString") ||
        object.toJSON !== Date.prototype.toJSON
      ) {
        invalidValue("Custom JSON encoders are not supported.");
      }
      const time = object.valueOf();
      if (!Number.isFinite(time)) add(4);
      else stringBytes(object.toISOString(), add);
      return { omitted: false };
    }
    const toJsonDescriptor = Object.getOwnPropertyDescriptor(object, "toJSON");
    const prototype = Object.getPrototypeOf(object);
    const inheritedToJsonDescriptor = prototype
      ? Object.getOwnPropertyDescriptor(prototype, "toJSON")
      : undefined;
    if (
      (toJsonDescriptor &&
        (!("value" in toJsonDescriptor) ||
          typeof toJsonDescriptor.value === "function")) ||
      (inheritedToJsonDescriptor &&
        (!("value" in inheritedToJsonDescriptor) ||
          typeof inheritedToJsonDescriptor.value === "function"))
    ) {
      invalidValue("Custom JSON encoders are not supported.");
    }
    if (active.has(object)) invalidValue("Circular JSON values are not supported.");
    active.add(object);
    try {
      if (Array.isArray(object)) {
        assertSafeArrayPrototypeChain(object);
        if (object.length > input.maxBytes) {
          throw new BoundedJsonError(
            "size_exceeded",
            "The JSON array exceeds the configured byte limit.",
          );
        }
        add(1);
        for (let index = 0; index < object.length; index += 1) {
          if (index === 0) add(space ? 1 + space * (depth + 1) : 0);
          else add(space ? 2 + space * (depth + 1) : 1);
          const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
          if (descriptor && !("value" in descriptor)) {
            invalidValue("JSON accessors are not supported.");
          }
          measure(descriptor?.value, depth + 1, true);
        }
        if (object.length && space) add(1 + space * depth);
        add(1);
        return { omitted: false };
      }

      if (prototype !== Object.prototype && prototype !== null) {
        invalidValue("Only plain objects, arrays and dates can be encoded.");
      }
      add(1);
      let included = 0;
      for (const key of Object.keys(object)) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (!descriptor || !("value" in descriptor)) {
          invalidValue("JSON accessors are not supported.");
        }
        const valueType = typeof descriptor.value;
        if (
          valueType === "undefined" ||
          valueType === "function" ||
          valueType === "symbol"
        ) {
          continue;
        }
        add(
          included === 0
            ? space
              ? 1 + space * (depth + 1)
              : 0
            : space
              ? 2 + space * (depth + 1)
              : 1,
        );
        stringBytes(key, add);
        add(space ? 2 : 1);
        measure(descriptor.value, depth + 1, false);
        included += 1;
      }
      if (included && space) add(1 + space * depth);
      add(1);
      return { omitted: false };
    } finally {
      active.delete(object);
    }
  };

  const result = measure(value, 0, false);
  if (result.omitted) invalidValue("The top-level JSON value is not serializable.");
  if (input.trailingNewline) add(1);
  return bytes;
}

export function stringifyBoundedJson(
  value: unknown,
  input: {
    maxBytes: number;
    space?: number;
    trailingNewline?: boolean;
    maxDepth?: number;
  },
) {
  const measuredBytes = measureBoundedJsonBytes(value, input);
  let json: string;
  try {
    const encoded = JSON.stringify(value, null, input.space ?? 0);
    if (encoded === undefined) invalidValue("The top-level JSON value is not serializable.");
    json = input.trailingNewline ? `${encoded}\n` : encoded;
  } catch (error) {
    if (error instanceof BoundedJsonError) throw error;
    throw new BoundedJsonError(
      "invalid_value",
      "The JSON value could not be serialized.",
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  const actualBytes = Buffer.byteLength(json, "utf8");
  if (actualBytes !== measuredBytes || actualBytes > input.maxBytes) {
    throw new BoundedJsonError(
      "invalid_value",
      "The JSON value changed during bounded serialization.",
    );
  }
  return { json, sizeBytes: actualBytes };
}
