import { html, type ReactiveElement, type TemplateResult } from "lit";
import { addDecimal, compareDecimal, decimal } from "@waitron/shared";
import "./split-equally.js";
import type { SplitEquallyStartDetail } from "./split-equally.js";
import type { BillBalance } from "../api/payments-api.js";
import type { PaidShare, ShareRun } from "../state/share-run.js";

/** What Split equally shows is read from these afresh at every render: the run is the one record
 * of who has paid. */
interface SplitSource {
  readonly balance: BillBalance | null;
  readonly receiptGuests: number | null;
  readonly run: ShareRun;
}

interface SplitShown {
  readonly taken: boolean;
  readonly startCount: number | null;
  readonly left: string;
  readonly paid: readonly PaidShare[];
}

function shown({ balance, receiptGuests, run }: SplitSource): SplitShown {
  const held =
    balance === null
      ? decimal("0")
      : addDecimal(decimal(balance.received), decimal(balance.reserved));
  return {
    taken: compareDecimal(held, decimal("0")) > 0,
    startCount: run.of ?? receiptGuests,
    left: balance?.outstanding ?? "0.00",
    paid: run.paid,
  };
}

/** What the starting count is read from; a card received leaves it as it was. */
const startsFrom = ({ taken, startCount, left, paid }: SplitShown): string =>
  `${taken} ${startCount} ${left} ${paid.length}`;

/** One opening of Split equally. The count kept from before holds only while what the screen
 * starts from is as it was at opening; once that changes, the starting rule applies. */
export class SplitOpening {
  readonly #source: () => SplitSource;
  #kept: number | null;
  readonly #from: string;

  /** `stillToPay` is the share's count already chosen, null when none is to be kept. */
  constructor(source: () => SplitSource, stillToPay: number | null) {
    this.#source = source;
    const now = source();
    this.#kept = stillToPay === null ? null : stillToPay + now.run.paidCount;
    this.#from = startsFrom(shown(now));
  }

  now(): SplitShown & { keptCount: number | null } {
    const now = shown(this.#source());
    if (startsFrom(now) !== this.#from) this.#kept = null;
    return { ...now, keptCount: this.#kept };
  }
}

/** Focuses the first of `selectors` found in `host` once it has rendered, entering a top bar's
 * back control. */
async function focusIn(host: ReactiveElement, ...selectors: string[]): Promise<void> {
  await host.updateComplete;
  for (const selector of selectors) {
    let found = host.shadowRoot?.querySelector<HTMLElement>(selector);
    if (found?.localName === "wt-top-bar") {
      await (found as ReactiveElement).updateComplete;
      found = found.shadowRoot!.querySelector<HTMLElement>("wt-button");
    }
    if (found === null || found === undefined) continue;
    await (found as Partial<ReactiveElement>).updateComplete;
    return found.focus();
  }
}

const SHARE_WAY = '[data-quiet-pay-way="share"], input[name="way"][value="share"]';

export function splitEquallyScreen(
  host: ReactiveElement,
  opening: SplitOpening,
  billName: string,
  back: () => void,
  start: (detail: SplitEquallyStartDetail) => void,
): TemplateResult {
  const now = opening.now();
  return html`<till-split-equally
    .billName=${billName}
    .left=${now.left}
    .taken=${now.taken}
    .startCount=${now.startCount}
    .keptCount=${now.keptCount}
    .paid=${now.paid}
    @split-equally-back=${(event: Event) => {
      event.stopPropagation();
      back();
      void focusIn(host, SHARE_WAY);
    }}
    @split-equally-start=${(event: CustomEvent<SplitEquallyStartDetail>) => {
      event.stopPropagation();
      start(event.detail);
      void focusIn(host, "[data-quiet-pay] wt-top-bar", SHARE_WAY);
    }}
  ></till-split-equally>`;
}
