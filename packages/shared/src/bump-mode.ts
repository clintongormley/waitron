export const BUMP_MODES = ["line", "ticket"] as const;
export type BumpMode = (typeof BUMP_MODES)[number];

export function isBumpMode(value: unknown): value is BumpMode {
  return (BUMP_MODES as readonly unknown[]).includes(value);
}
