export function readAdditiveControl<T>(read: () => T): {
  value: T | null;
  corruption: string | null;
} {
  try {
    return { value: read(), corruption: null };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_SQLITE_ERROR" ||
      !("errcode" in error) ||
      error.errcode !== 11
    ) {
      throw error;
    }
    return { value: null, corruption: error.message };
  }
}
