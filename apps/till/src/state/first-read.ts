export type FirstReadStage = "placeholder" | "waiting";
export type FirstReadView = "quiet" | FirstReadStage | "unreachable";

export function startFirstRead<T>(
  read: (signal: AbortSignal) => Promise<T>,
  show: (stage: FirstReadStage) => void,
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
  const deadline = setTimeout(cancel, 15_000);
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
      clearTimeout(deadline);
      signal.removeEventListener("abort", rejectOnAbort);
    });
  return { result, cancel };
}
