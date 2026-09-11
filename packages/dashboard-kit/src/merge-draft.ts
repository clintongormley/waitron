/** Keep edited scalar fields while replacing clean fields with the latest server values. */
export class DraftRows<T extends { id: string }> {
  #saved = new Map<string, T>();

  merge(current: readonly T[], incoming: readonly T[]): T[] {
    const drafts = new Map(current.map((row) => [row.id, row]));
    const result = incoming.map((row) => {
      const draft = drafts.get(row.id);
      const saved = this.#saved.get(row.id);
      const merged = { ...row };
      if (draft !== undefined && saved !== undefined) {
        for (const key of Object.keys(row) as (keyof T)[]) {
          if (!Object.is(draft[key], saved[key])) merged[key] = draft[key];
        }
      }
      return merged;
    });
    this.#saved = new Map(incoming.map((row) => [row.id, { ...row }]));
    return result;
  }
}
