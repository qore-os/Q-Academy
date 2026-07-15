import { z } from "zod";

export const NATIVE_START_DESTINATIONS = ["dashboard", "community"] as const;
export const nativeStartDestinationSchema = z.enum(NATIVE_START_DESTINATIONS);
export type NativeStartDestination = z.infer<
  typeof nativeStartDestinationSchema
>;

export function sanitizeNativeStartDestination(
  value: unknown,
): NativeStartDestination {
  const candidate =
    value && typeof value === "object" && "destination" in value
      ? (value as { destination?: unknown }).destination
      : value;
  return nativeStartDestinationSchema.safeParse(candidate).success
    ? (candidate as NativeStartDestination)
    : "dashboard";
}

export function nativeStartPath(destination: NativeStartDestination) {
  return destination === "community" ? "/academy/community" : "/academy";
}
