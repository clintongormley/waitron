import type { Decimal } from "@waitron/shared";

// The modelo 303 export route's DR303 box-27 verification WITNESS, shared by the PGlite
// (`report-api.test.ts`) and real-Postgres (`report-api.rls.test.ts`) suites. It is an INDEPENDENT
// oracle — deliberately NOT the reporting serializer's own `formatNumericField` (nor any
// `@waitron/reporting` import) — so a bug in that serializer cannot self-mask against a test that
// reuses it. `modelo-303-demo.ts` keeps its OWN copy on purpose (a script is a different layer).

/** Box 27's fixed 0-based byte offset + length on página 1 — the SAME the demo/serializer test pin
 * (`dr303.test.ts`'s OFFSET table places box 27 at 1023, len 17). A layout shift turns those red. */
export const BOX_27 = { offset: 1023, len: 17 } as const;

/**
 * Independently packs a Decimal into an AEAT fixed-width numeric field — the demo's OWN witness
 * (`modelo-303-demo.ts`'s `packAeatNumeric`), NOT the serializer's `formatNumericField`: magnitude in
 * cents, right-aligned and zero-filled, a negative value taking an 'N' in position 1. Used to DERIVE
 * the expected box bytes from the seeded figures, so a bug in the serializer's own formatter cannot
 * mask itself.
 */
export function packAeatNumeric(value: Decimal, width: number): string {
  const negative = value.startsWith("-");
  const magnitude = (negative ? value.slice(1) : value).replace(".", "");
  return negative ? "N" + magnitude.padStart(width - 1, "0") : magnitude.padStart(width, "0");
}
