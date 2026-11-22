/** A six-digit join code as two groups of three, joined by a no-break space so it never wraps. */
export function groupedJoinCode(code: string): string {
  return `${code.slice(0, 3)}\u00a0${code.slice(3)}`;
}
