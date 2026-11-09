import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { mountThemed, expectNoA11yViolations } from "../a11y-helpers.js";
import { WtReportDialog, type ReportDialogCopy } from "./wt-report-dialog.js";

afterEach(cleanup);
const copy: ReportDialogCopy = {
  heading: "Report a problem",
  scope: "Save only this browser's activity.",
  warning: "Do not include personal information.",
  description: "What happened?",
  preview: "Report preview",
  invalid: "Check your description.",
  cancel: "Cancel",
  download: "Download report",
};
const states: [string, Partial<WtReportDialog>][] = [
  ["ready", {}],
  [
    "invalid description",
    { description: "Invalid input", validationError: "Use up to 2,000 characters." },
  ],
  [
    "failed download",
    {
      description: "The bill is hard to read.",
      downloadError: "Could not create the download. Try again.",
    },
  ],
  ["closed", { open: false }],
];
describe.each(["light", "dark"] as const)("report dialog a11y (%s)", (theme) => {
  test.each(states)("%s", async (_, state) => {
    const el = (await mountThemed(
      "<wt-report-dialog></wt-report-dialog>",
      theme,
    )) as WtReportDialog;
    Object.assign(el, {
      open: true,
      copy,
      preview: '```json\n{"description":"The bill is hard to read."}\n```',
      ...state,
    });
    await el.updateComplete;
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    for (const child of el.shadowRoot!.querySelectorAll("wt-textarea, wt-button, wt-form-actions"))
      await (child as WtReportDialog).updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(state.open ?? true);
    await expectNoA11yViolations(host);
  });
});
