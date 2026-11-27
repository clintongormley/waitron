import { html, type TemplateResult } from "lit";
import { addDecimal, compareDecimal, decimal } from "@waitron/shared";
import "./split-equally.js";
import type { SplitEquallyStartDetail } from "./split-equally.js";
import type { BillBalance } from "../api/payments-api.js";
import type { PaidShare, ShareRun } from "../state/share-run.js";

/** What Split equally opens with, fixed while it is shown so a later render does not reset the
 * count being chosen. */
export interface SplitOpening {
  readonly taken: boolean;
  readonly startCount: number | null;
  readonly keptCount: number | null;
  readonly paid: readonly PaidShare[];
}

/** `stillToPay` is the share's count already chosen, null when none is. */
export function splitOpening(
  balance: BillBalance | null,
  receiptGuests: number | null,
  run: ShareRun,
  stillToPay: number | null,
): SplitOpening {
  const held =
    balance === null
      ? decimal("0")
      : addDecimal(decimal(balance.received), decimal(balance.reserved));
  return {
    taken: compareDecimal(held, decimal("0")) > 0,
    startCount: run.of ?? receiptGuests,
    keptCount: stillToPay === null ? null : stillToPay + run.paidCount,
    paid: run.paid,
  };
}

export function splitEquallyScreen(
  opening: SplitOpening,
  billName: string,
  left: string,
  back: () => void,
  start: (detail: SplitEquallyStartDetail) => void,
): TemplateResult {
  return html`<till-split-equally
    .billName=${billName}
    .left=${left}
    .taken=${opening.taken}
    .startCount=${opening.startCount}
    .keptCount=${opening.keptCount}
    .paid=${opening.paid}
    @split-equally-back=${(event: Event) => {
      event.stopPropagation();
      back();
    }}
    @split-equally-start=${(event: CustomEvent<SplitEquallyStartDetail>) => {
      event.stopPropagation();
      start(event.detail);
    }}
  ></till-split-equally>`;
}
