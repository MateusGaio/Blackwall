// MIT License — Copyright (c) 2026 Mateus Gaio

type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  jitter?: () => number;
  isRetryable: (error: unknown) => boolean;
  retryAfterMs?: (error: unknown) => number | undefined;
  signal?: AbortSignal;
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

export async function withRetry<T>(task: (attempt: number) => Promise<T>, options: RetryOptions) {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 5));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 2_000);
  const jitter = options.jitter ?? (() => Math.random() * 250);
  let attempt = 1;
  while (true) {
    if (options.signal?.aborted) throw abortError();
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt >= attempts || !options.isRetryable(error)) throw error;
      const retryAfterMs = options.retryAfterMs?.(error);
      const exponential = baseDelayMs * 2 ** (attempt - 1);
      const delayMs = Math.max(retryAfterMs ?? 0, exponential + jitter());
      options.onRetry?.({ attempt, delayMs, error });
      await abortableDelay(delayMs, options.signal);
      attempt += 1;
    }
  }
}
