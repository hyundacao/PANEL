export const ORIGINAL_INVENTORY_SEARCH_TIMEOUT_MS = 10_000;

export const withOriginalInventorySearchTimeout = <T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  parentSignal?: AbortSignal,
  timeoutMs = ORIGINAL_INVENTORY_SEARCH_TIMEOUT_MS
): Promise<T> => new Promise((resolve, reject) => {
  const controller = new AbortController();
  const cleanup = () => {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', cancel);
  };
  const cancel = () => {
    cleanup();
    controller.abort();
    reject(parentSignal?.reason ?? new Error('SEARCH_CANCELLED'));
  };
  const timer = setTimeout(() => {
    cleanup();
    controller.abort();
    reject(new Error('SEARCH_TIMEOUT'));
  }, timeoutMs);
  if (parentSignal?.aborted) { cancel(); return; }
  parentSignal?.addEventListener('abort', cancel, { once: true });
  try {
    Promise.resolve(run(controller.signal)).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); }
    );
  } catch (error) { cleanup(); reject(error); }
});
