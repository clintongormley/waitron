import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./printers-dialog.js";
import type { TillPrintersDialog } from "./printers-dialog.js";

afterEach(cleanupWidgets);

const P1 = { id: "P1", name: "Counter printer" };
const P2 = { id: "P2", name: "Bar printer" };
const S1 = { id: "S1", name: "Portable slip printer" };

const STATES: [string, Partial<TillPrintersDialog>][] = [
  [
    "a list to pick from and a single printer",
    {
      receipt: { current: "P1", choices: [P1, P2] },
      paymentSlip: { current: "S1", choices: [S1] },
    },
  ],
  [
    "one printer listed that the device is not on",
    {
      receipt: { current: "P1", choices: [P1] },
      paymentSlip: { current: "S-off", choices: [S1] },
    },
  ],
  [
    "no printers listed",
    { receipt: { current: null, choices: [] }, paymentSlip: { current: null, choices: [] } },
  ],
  [
    "a refusal under the receipt printer",
    {
      receipt: { current: "P1", choices: [P1, P2] },
      paymentSlip: { current: "S1", choices: [S1] },
      error: { code: "device.binding_invalid", field: "receiptPrinterId" },
    },
  ],
  [
    "a refusal naming no field it shows",
    {
      receipt: { current: "P1", choices: [P1, P2] },
      paymentSlip: { current: "S1", choices: [S1] },
      error: { code: "server.internal" },
    },
  ],
];

describe.each(["light", "dark"] as const)("till-printers-dialog a11y (%s theme)", (theme) => {
  it.each(STATES)("has no violations with %s", async (_name, props) => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillPrintersDialog>(
      "till-printers-dialog",
      { open: true, ...props },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
