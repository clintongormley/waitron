interface Entry<V> {
  at: number;
  value: Promise<V>;
}

export interface TtlCache<V> {
  get(key: string, compute: () => Promise<V>): Promise<V>;
}

export function createTtlCache<V>(opts: { ttlMs: number; now: () => Date }): TtlCache<V> {
  const entries = new Map<string, Entry<V>>();
  return {
    async get(key, compute) {
      const nowMs = opts.now().getTime();
      const hit = entries.get(key);
      if (hit && nowMs - hit.at < opts.ttlMs) return hit.value;
      const value = compute();
      entries.set(key, { at: nowMs, value });
      // A rejected compute must not stick: drop it so the next call retries.
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
  };
}
