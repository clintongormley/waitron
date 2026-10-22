import type { Transaction } from "@waitron/db";
import type { TrustedReading } from "@waitron/fiscal";

/** `error` is the strip's red, `warning` its amber, `notice` its blue (A798 design §4.2). */
export type StaffNoticeSeverity = "error" | "warning" | "notice";

/** One notice for the staff on a device that sells. It carries no words: the till words `code`
 * with `params` in its own language files. `key` is unique among the notices answered by all
 * the sources one owner gives. */
export interface StaffNotice {
  readonly key: string;
  readonly code: string;
  readonly severity: StaffNoticeSeverity;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface StaffNoticeContext {
  readonly tx: Transaction;
  /** One reading of the box's clock for the whole ask, so every source judges the same instant. */
  readonly reading: Pick<TrustedReading, "instant" | "offsetMinutes">;
}

/** A check asked on each read of the notices. */
export interface StaffNoticeSource {
  read(ctx: StaffNoticeContext): Promise<readonly StaffNotice[]>;
}
