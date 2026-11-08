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
      typeof error.errcode !== "number" ||
      (error.errcode & 0xff) !== 11
    ) {
      throw error;
    }
    return { value: null, corruption: error.message };
  }
}
