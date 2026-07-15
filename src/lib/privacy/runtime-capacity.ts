const DEFAULT_PROCESS_LIMIT = 1;

type CapacityStore = {
  active: Set<symbol>;
};

export type PrivacyRuntimeCapacityLease = Readonly<{
  token: symbol;
}>;

export class PrivacyRuntimeCapacity {
  constructor(
    private readonly limit = DEFAULT_PROCESS_LIMIT,
    private readonly store: CapacityStore = { active: new Set() },
  ) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new TypeError("The privacy runtime capacity limit is invalid.");
    }
  }

  claim(): PrivacyRuntimeCapacityLease | null {
    if (this.store.active.size >= this.limit) return null;
    const token = Symbol("privacy-runtime-capacity-lease");
    this.store.active.add(token);
    return { token };
  }

  release(lease: PrivacyRuntimeCapacityLease) {
    return this.store.active.delete(lease.token);
  }
}

const CAPACITY_STORE_KEY = Symbol.for("q-academy.privacy-runtime-capacity.v2");

function processCapacityStore() {
  const existing = Reflect.get(globalThis, CAPACITY_STORE_KEY) as
    | CapacityStore
    | undefined;
  if (existing?.active instanceof Set) return existing;
  const created: CapacityStore = { active: new Set() };
  Reflect.set(globalThis, CAPACITY_STORE_KEY, created);
  return created;
}

const runtimeCapacity = new PrivacyRuntimeCapacity(
  DEFAULT_PROCESS_LIMIT,
  processCapacityStore(),
);

export function claimPrivacyRuntimeCapacity() {
  return runtimeCapacity.claim();
}

export function releasePrivacyRuntimeCapacity(
  lease: PrivacyRuntimeCapacityLease,
) {
  return runtimeCapacity.release(lease);
}
