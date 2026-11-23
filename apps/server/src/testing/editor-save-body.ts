/** An editor read without the eat-in class it still carries, which a save refuses. */
export function saveBodyOf(read: Record<string, unknown>): Record<string, unknown> {
  const body = { ...read };
  delete body.vatClass;
  return body;
}
