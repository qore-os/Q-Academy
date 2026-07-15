export const MEDIA_MAINTENANCE_WORK_BUDGET_MS = 8 * 60_000;
export const MEDIA_MAINTENANCE_MIN_NEW_IO_MS = 75_000;
export const MEDIA_MAINTENANCE_MIN_NEW_PHASE_MS = 10_000;

export class MediaMaintenanceDeadlineError extends Error {
  readonly code = "media_maintenance_deadline";

  constructor() {
    super("The media maintenance work budget was exhausted.");
    this.name = "MediaMaintenanceDeadlineError";
  }
}

type MediaMaintenanceBudgetOptions = Readonly<{
  ioLimit: number;
  timeoutMs?: number;
  minimumNewIoMs?: number;
  now?: () => number;
}>;

export class MediaMaintenanceBudget {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;

  private readonly controller = new AbortController();
  private readonly minimumNewIoMs: number;
  private readonly now: () => number;
  private readonly timeout: ReturnType<typeof setTimeout>;
  private remainingIo: number;

  constructor(options: MediaMaintenanceBudgetOptions) {
    const timeoutMs = options.timeoutMs ?? MEDIA_MAINTENANCE_WORK_BUDGET_MS;
    const minimumNewIoMs =
      options.minimumNewIoMs ?? MEDIA_MAINTENANCE_MIN_NEW_IO_MS;
    if (!Number.isSafeInteger(options.ioLimit) || options.ioLimit < 1) {
      throw new TypeError("The media maintenance I/O limit must be positive.");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new TypeError("The media maintenance deadline must be positive.");
    }
    if (
      !Number.isSafeInteger(minimumNewIoMs) ||
      minimumNewIoMs < 0 ||
      minimumNewIoMs >= timeoutMs
    ) {
      throw new TypeError(
        "The media maintenance start reserve must fit inside its deadline.",
      );
    }

    this.now = options.now ?? Date.now;
    this.deadlineAt = this.now() + timeoutMs;
    this.minimumNewIoMs = minimumNewIoMs;
    this.remainingIo = options.ioLimit;
    this.signal = this.controller.signal;
    this.timeout = setTimeout(() => {
      this.controller.abort(new MediaMaintenanceDeadlineError());
    }, timeoutMs);
  }

  get remainingIoAssets() {
    return this.remainingIo;
  }

  get remainingMs() {
    return Math.max(0, this.deadlineAt - this.now());
  }

  canStartPhase(minimumRemainingMs = MEDIA_MAINTENANCE_MIN_NEW_PHASE_MS) {
    return !this.signal.aborted && this.remainingMs >= minimumRemainingMs;
  }

  canStartIoAsset() {
    return (
      this.remainingIo > 0 && this.canStartPhase(this.minimumNewIoMs)
    );
  }

  tryClaimIoAsset() {
    if (!this.canStartIoAsset()) return false;
    this.remainingIo -= 1;
    return true;
  }

  async runAbortable<T>(operation: (signal: AbortSignal) => Promise<T>) {
    this.signal.throwIfAborted();
    const operationPromise = Promise.resolve().then(() =>
      operation(this.signal),
    );
    let removeAbortListener: () => void = () => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () =>
        reject(
          this.signal.reason instanceof Error
            ? this.signal.reason
            : new MediaMaintenanceDeadlineError(),
        );
      this.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () =>
        this.signal.removeEventListener("abort", onAbort);
    });
    try {
      return await Promise.race([operationPromise, aborted]);
    } catch (error) {
      if (!this.signal.aborted) throw error;
      await operationPromise.catch(() => undefined);
      this.signal.throwIfAborted();
      throw error;
    } finally {
      removeAbortListener();
    }
  }

  close() {
    clearTimeout(this.timeout);
  }
}

export async function runMediaMaintenanceWithinBudget<T>(options: {
  ioLimit: number;
  work: (budget: MediaMaintenanceBudget) => Promise<T>;
  release: () => Promise<void>;
  timeoutMs?: number;
  minimumNewIoMs?: number;
}) {
  const budget = new MediaMaintenanceBudget({
    ioLimit: options.ioLimit,
    timeoutMs: options.timeoutMs,
    minimumNewIoMs: options.minimumNewIoMs,
  });
  try {
    return await budget.runAbortable(() => options.work(budget));
  } finally {
    budget.close();
    await options.release();
  }
}
