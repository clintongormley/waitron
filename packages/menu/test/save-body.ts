/** An editor read without the eat-in class it still carries, which a save refuses. */
export function saveBodyOf<T>(read: T): T {
  if (typeof read !== "object" || read === null) return read;
  const rest = { ...read } as Record<string, unknown>;
  delete rest.vatClass;
  return rest as T;
}
