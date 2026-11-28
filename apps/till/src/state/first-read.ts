export type FirstReadStage = "placeholder" | "waiting" | "unreachable";
export type FirstReadView = "quiet" | FirstReadStage;

export function startFirstRead<T>(
  read: (signal: AbortSignal) => Promise<T>,
  show: (stage: FirstReadStage) => void,
  limitMs?: number,
) {
  const controller = new AbortController();
  const { signal } = controller;
  let rejectOnAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectOnAbort = () => reject(signal.reason);
    signal.addEventListener("abort", rejectOnAbort, { once: true });
  });
  const cancel = () => controller.abort();
  const shapes = setTimeout(() => show("placeholder"), 300);
  const notice = setTimeout(() => show("waiting"), 5_000);
  const recovery = setTimeout(() => show("unreachable"), 15_000);
  const limit = limitMs === undefined ? undefined : setTimeout(cancel, limitMs);
  const operation = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return read(signal);
  });
  const result = Promise.race([operation, cancelled])
    .catch((error: unknown) => {
      cancel();
      throw error;
    })
    .finally(() => {
      clearTimeout(shapes);
      clearTimeout(notice);
      clearTimeout(recovery);
      clearTimeout(limit);
      signal.removeEventListener("abort", rejectOnAbort);
    });
  return { result, cancel };
}
