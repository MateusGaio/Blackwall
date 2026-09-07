// MIT License — Copyright (c) 2026 Mateus Gaio

type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  /** Returns a fractional jitter in the inclusive range [-0.25, 0.25]. */
  jitter?: () => number;
  isRetryable: (error: unknown) => boolean;
  retryAfterMs?: (error: unknown) => number | undefined;
  signal?: AbortSignal;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
};

function abortError() {
  const error = new Error("A operação foi cancelada.");
  error.name = "AbortError";
  return error;
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, delayMs));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const MAX_DELAY_WITHOUT_RETRY_AFTER_MS = 30_000;

function boundedJitter(value: number): number {
  return Math.min(0.25, Math.max(-0.25, Number.isFinite(value) ? value : 0));
}

export async function withRetry<T>(task: (attempt: number) => Promise<T>, options: RetryOptions) {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 5));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 2_000);
  const jitter = options.jitter ?? (() => Math.random() * 0.5 - 0.25);
  const sleep = options.sleep ?? abortableDelay;
  let attempt = 1;
  while (true) {
    if (options.signal?.aborted) throw abortError();
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt >= attempts || !options.isRetryable(error)) throw error;
      const retryAfterMs = options.retryAfterMs?.(error);
      const exponential = baseDelayMs * 2 ** (attempt - 1);
      const jitteredExponential = exponential * (1 + boundedJitter(jitter()));
      const delayWithoutHeader = Math.min(
        MAX_DELAY_WITHOUT_RETRY_AFTER_MS,
        Math.max(0, jitteredExponential),
      );
      const delayMs =
        retryAfterMs === undefined
          ? delayWithoutHeader
          : Math.max(0, retryAfterMs, jitteredExponential);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs, options.signal);
      attempt += 1;
    }
  }
}
