import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./cancel-credit-dialog.js";
import type { DialogRefusal } from "../state/bill-payment.js";
import type { CancelCreditDone, TillCancelCreditDialog } from "./cancel-credit-dialog.js";

afterEach(cleanupWidgets);

interface State {
  refusal: DialogRefusal | null;
  busy: boolean;
  pressed: boolean;
  done: CancelCreditDone | null;
}

const states: [string, State][] = [
  ["empty", { refusal: null, busy: false, pressed: false, done: null }],
  ["with the reason missing", { refusal: null, busy: false, pressed: true, done: null }],
  [
    "refused",
    {
      refusal: { code: "series.no_rectificative_for_node" },
      busy: false,
      pressed: false,
      done: null,
    },
  ],
  ["sending", { refusal: null, busy: true, pressed: false, done: null }],
  ["done", { refusal: null, busy: false, pressed: false, done: { creditNote: "R/3" } }],
];

describe.each(["light", "dark"] as const)("till-cancel-credit-dialog a11y (%s theme)", (theme) => {
  it.each(states)("%s has no violations", async (_, state) => {
    const { el, host } = await mountWidget<TillCancelCreditDialog>(
      "till-cancel-credit-dialog",
      {
        invoiceNumber: "A/12",
        amount: "24.50",
        refusal: state.refusal,
        busy: state.busy,
        done: state.done,
      },
      theme,
    );
    if (state.pressed) {
      el.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-confirm]")!.click();
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});
