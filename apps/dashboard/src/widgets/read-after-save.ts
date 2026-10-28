export const READ_AFTER_SAVE_RETRY_MS = [2000, 4000, 8000, 16000];

/**
 * For answers that carry no version, only a read begun after a save's answer arrived is known to
 * be at least as new as the save. `read` resolves true when it was answered; a failed one is tried
 * again after each delay while `wanted()` still holds. Aborting `signal` clears the pending wait.
 */
export async function readAfterSave(
  read: () => Promise<boolean>,
  wanted: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  if (await read()) return;
  for (const delay of READ_AFTER_SAVE_RETRY_MS) {
    if (!(await wait(delay, signal))) return;
    if (!wanted()) return;
    if (await read()) return;
  }
}

function wait(delay: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const stop = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve(true);
    }, delay);
    signal.addEventListener("abort", stop, { once: true });
  });
}
