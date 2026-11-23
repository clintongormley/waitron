/** An editor read without the eat-in class it still carries, which a save refuses. */
export function saveBodyOf<T extends object>(read: T): Omit<T, "vatClass"> {
  const rest = { ...read } as Record<string, unknown>;
  delete rest.vatClass;
  return rest as Omit<T, "vatClass">;
}
