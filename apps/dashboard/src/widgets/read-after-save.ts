export const READ_AFTER_SAVE_RETRY_MS = [2000, 4000, 8000, 16000];

/**
 * Answers carry no version, so only a read begun after a save's answer arrived is known to be at
 * least as new as the save. `read` resolves true when it was answered; a failed one is tried again
 * after each delay while `wanted()` still holds.
 */
export async function readAfterSave(
  read: () => Promise<boolean>,
  wanted: () => boolean,
): Promise<void> {
  if (await read()) return;
  for (const delay of READ_AFTER_SAVE_RETRY_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (!wanted()) return;
    if (await read()) return;
  }
}
