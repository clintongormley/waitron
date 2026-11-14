/** How far down a `cause` chain to look before giving up. The bound exists so no chain — cyclic or
 * merely long — can spin, not because five levels are known to be needed. Exported so other walks
 * over a cause chain can use the same bound. */
export const MAX_CAUSE_DEPTH = 5;

/**
 * The first `code` in an error's `cause` chain that `accept` recognises, or `null`.
 *
 * Termination rests on `MAX_CAUSE_DEPTH`; the `cause === current` line is only an early exit for a
 * self-referencing error.
 */
export function firstCodeInCauseChain(
  error: unknown,
  accept: (code: string) => boolean,
): string | null {
  for (const layer of causeLayers(error)) {
    if (typeof layer !== "object" || layer === null) return null;
    const code: unknown = (layer as { code?: unknown }).code;
    if (typeof code === "string" && accept(code)) return code;
  }
  return null;
}

/** Outermost first; consumers decide which kinds of layer they can read. */
export function* causeLayers(error: unknown): Generator<unknown> {
  let current = error;
  for (let depth = 0; current !== undefined && depth < MAX_CAUSE_DEPTH; depth++) {
    yield current;
    if (current === null || (typeof current !== "object" && typeof current !== "function")) return;
    const next: unknown = (current as { cause?: unknown }).cause;
    if (next === current) return;
    current = next;
  }
}
