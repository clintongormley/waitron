import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
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

test.each(["light", "dark"] as const)(
  "Cloud confirmation and feedback are accessible in %s",
  async (theme) => {
    const el = (await mountThemed(
      "<wt-report-dialog></wt-report-dialog>",
      theme,
    )) as WtReportDialog;
    Object.assign(el, {
      open: true,
      preview: "Download-only browser diagnostics",
      description: "Local description",
      cloud: {
        previewProblemReport: async () => ({
          available: true,
          id: "preview",
          attachment: '{"version":"1.2.3"}',
        }),
        sendProblemReport: async () => ({ delivery: "queued" }),
      },
      copy: {
        ...copy,
        cloud: {
          scope: "Send the Cloud attachment or download a separate file.",
          localDescription: "What happened? (download only)",
          preview: "Cloud attachment",
          send: "Send to Waitron Cloud",
          sent: "Sent to Waitron Cloud.",
          queued: "The box will try again.",
          refused: "Could not send. You can download the report instead.",
        },
      },
    });
    await expect
      .poll(() => el.shadowRoot!.querySelector('[aria-label="Cloud attachment"]')?.textContent)
      .toBe('{"version":"1.2.3"}');
    const attachment = el.shadowRoot!.querySelector<HTMLElement>(
      '[aria-label="Cloud attachment"]',
    )!;
    const description = el.shadowRoot!.querySelector("wt-textarea")!;
    expect(attachment.getBoundingClientRect().top).toBeLessThan(
      description.getBoundingClientRect().top,
    );
    const button = el.shadowRoot!.querySelector<HTMLElement>("[data-send]")!;
    await expectNoA11yViolations(host);
    await userEvent.click(button);
    await expect
      .poll(() => el.shadowRoot!.querySelector('[role="status"]')?.textContent?.trim())
      .toBe("The box will try again.");
    expect(
      el.shadowRoot!.querySelector('[role="status"]')!.closest('wt-form-actions[slot="footer"]'),
    ).not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-textarea")!.label).toBe(
      "What happened? (download only)",
    );
    await expectNoA11yViolations(host);
  },
);
