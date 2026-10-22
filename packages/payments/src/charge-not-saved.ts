import { diskFullIn } from "@waitron/shared";

/**
 * Thrown by `collect` when the processor reported the card charged and saving that outcome failed
 * for a full disk. Its `cause` is the full-disk error, so a caller that does not look for this
 * class answers it as any other full disk; the provider's row is left as it was before the save,
 * for `resolvePending` to capture.
 */
export class ChargeNotSavedError extends Error {
  constructor(cause: unknown) {
    super("the card was charged and its capture could not be saved", { cause });
    this.name = "ChargeNotSavedError";
  }
}

/** Runs the save of a charge the processor reported; a full disk becomes {@link ChargeNotSavedError}. */
export async function saveCharge<T>(save: () => Promise<T>): Promise<T> {
  try {
    return await save();
  } catch (error) {
    if (diskFullIn(error)) throw new ChargeNotSavedError(error);
    throw error;
  }
}
