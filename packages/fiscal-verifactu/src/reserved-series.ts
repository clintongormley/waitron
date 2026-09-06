// Side-effect only: registers this package's codes on the shared registry. See ./errors.ts.
import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { invoiceSeries, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { registroSif } from "./schema/sif.js";

/** `NumSerieFactura` (`<code>/<counter>`) is capped at 60 characters (packages/verifactu validate). A
 * base must leave room for one `-<installation number>` suffix and the counter, each at most ten
 * digits (`integer`), so it may be at most 38 characters. */
const NUM_SERIE_MAX = 60;
const MAX_INT_DIGITS = 10;
export const MAX_BASE_CODE_LENGTH = NUM_SERIE_MAX - (1 + MAX_INT_DIGITS) - (1 + MAX_INT_DIGITS);

/**
 * Suffix each base with the installation number, preserving purpose. Given a fresh installation
 * number, codes derived for different installations are disjoint. The write path's
 * `series.code_collision` refusal is the backstop for collisions with other configured codes.
 */
export function deriveReservedSeriesCodes(
  bases: readonly { code: string; purpose: string }[],
  numeroInstalacion: number,
): { code: string; purpose: string }[] {
  return bases.map((s) => ({ code: `${s.code}-${numeroInstalacion}`, purpose: s.purpose }));
}

/**
 * The base of a code: `code` with every trailing `-<digits>` group whose digits are an installation
 * number this tenant has registered (any node, live or revoked) removed. `FA-7` from a promoted standby
 * and `FA-210441234` from an earlier restore both give `FA`; a human's `FA-2026` stays unless 2026 was
 * an installation number. Keeps every derived code to ONE suffix however many restores or
 * reservations a lineage goes through.
 */
export function stripOwnSuffixes(code: string, registered: ReadonlySet<number>): string {
  let base = code;
  for (;;) {
    const match = /^(.*)-(\d{1,10})$/.exec(base);
    if (match === null || !registered.has(Number(match[2]))) return base;
    base = match[1]!;
  }
}

/**
 * A node's live series, ordered by original code and stripped of the tenant's own suffixes:
 * one base per (code, purpose) pair, preserving first-seen order. Retired series remain history.
 * Throws `series.code_too_long` for a base that cannot carry a suffix within the cap.
 */
export async function liveSeriesBases(
  tx: Transaction,
  node: { tenantId: string; nodeId: string },
): Promise<{ code: string; purpose: string }[]> {
  const live = await tx
    .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
    .from(invoiceSeries)
    .where(
      and(
        eq(invoiceSeries.tenantId, node.tenantId),
        eq(invoiceSeries.nodeId, node.nodeId),
        isNull(invoiceSeries.retiredAt),
      ),
    )
    .orderBy(invoiceSeries.code);
  const numbers = await tx
    .select({ n: registroSif.numeroInstalacion })
    .from(registroSif)
    .where(eq(registroSif.tenantId, node.tenantId));
  const registered = new Set(numbers.map((r) => r.n));
  const seen = new Set<string>();
  const bases: { code: string; purpose: string }[] = [];
  for (const series of live) {
    const code = stripOwnSuffixes(series.code, registered);
    const key = JSON.stringify([code, series.purpose]);
    if (seen.has(key)) continue;
    if (code.length > MAX_BASE_CODE_LENGTH) {
      throw new AppError("series.code_too_long", { code });
    }
    seen.add(key);
    bases.push({ code, purpose: series.purpose });
  }
  return bases;
}
