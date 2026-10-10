import { afterEach, describe, expect, test } from "vitest";
import type { DeleteImpact } from "@waitron/shared";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { DeleteDialogCopy, WtDeleteDialog } from "./wt-delete-dialog.js";
import "./wt-delete-dialog.js";

afterEach(cleanup);

const copy: DeleteDialogCopy = {
  heading: "Delete printer?",
  refusals: "Why it can't be deleted",
  ends: "Work that will end",
  removes: "Settings that will be removed",
  irreversible: "This can't be undone.",
  cancel: "Cancel",
  confirm: "Delete",
  retry: "Try again",
  loading: "Checking what this affects",
  item: (item) => `${item.count} ${item.key}: ${item.targets.map((t) => t.name).join(", ")}`,
  refusal: (refusal) => `${refusal.code}: ${refusal.targets.map((t) => t.name).join(", ")}`,
};

const ready: DeleteImpact = {
  target: { id: "printer-p", name: "Printer P" },
  refusals: [],
  ends: [{ key: "print_jobs", count: 3, targets: [] }],
  removes: [{ key: "station_printers", count: 1, targets: [{ id: "st-1", name: "Grill" }] }],
};

const refused: DeleteImpact = {
  ...ready,
  refusals: [
    {
      code: "reader.payment_in_progress",
      params: {},
      targets: [{ id: "pay-1", name: "Payment 1" }],
    },
  ],
};

const empty: DeleteImpact = { ...ready, ends: [], removes: [] };

type State = Partial<
  Pick<WtDeleteDialog, "open" | "impact" | "loading" | "submitting" | "readError" | "actionError">
>;

const states: [string, State][] = [
  ["open and ready", { impact: ready }],
  ["open and refused", { impact: refused }],
  ["loading", { impact: null, loading: true }],
  ["after a failed read", { impact: null, readError: "Could not load what this affects." }],
  ["after a failed delete", { impact: ready, actionError: "The printer could not be deleted." }],
  ["while deleting", { impact: ready, submitting: true }],
  ["with an empty impact", { impact: empty }],
  ["closed", { impact: ready, open: false }],
];

describe.each(["light", "dark"] as const)("delete dialog a11y (%s)", (theme) => {
  test.each(states)("%s", async (_, state) => {
    const el = (await mountThemed(
      "<wt-delete-dialog></wt-delete-dialog>",
      theme,
    )) as WtDeleteDialog;
    el.copy = copy;
    Object.assign(el, { open: true, ...state });
    await el.updateComplete;
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    for (const button of el.shadowRoot!.querySelectorAll("wt-button")) await button.updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(state.open ?? true);
    await expectNoA11yViolations(host);
  });
});
