"use client";

import { useSyncExternalStore } from "react";

const subscribeToHydration = () => () => undefined;
const hydratedClientSnapshot = () => true;
const hydratedServerSnapshot = () => false;

export function useHydrated() {
  return useSyncExternalStore(
    subscribeToHydration,
    hydratedClientSnapshot,
    hydratedServerSnapshot,
  );
}
