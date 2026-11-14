import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtReportDialog, WtTextarea } from "@waitron/ui";
import type { TillApp } from "../src/till-app.js";

export const reportOf = (app: TillApp) => app.shadowRoot!.querySelector("till-problem-report")!;
export const dialogOf = (app: TillApp) =>
  reportOf(app).shadowRoot!.querySelector<WtReportDialog>("wt-report-dialog")!;
export const preview = (dialog: WtReportDialog) =>
  dialog.shadowRoot!.querySelector("pre")!.textContent!;
export const data = (text: string) => JSON.parse(text.split("```json\n")[1]!.split("\n```")[0]!);
export async function openStrip(app: TillApp) {
  const report = reportOf(app);
  expect(report).not.toBeNull();
  await userEvent.click(report.shadowRoot!.querySelector<WtButton>("[data-report-problem]")!);
  await expect.poll(() => dialogOf(app).open).toBe(true);
  return dialogOf(app);
}
export async function editReport(dialog: WtReportDialog, value: string) {
  const field = dialog.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!;
  await field.updateComplete;
  await userEvent.fill(field.shadowRoot!.querySelector("textarea")!, value);
  await expect.poll(() => dialog.description).toBe(value);
}
export function closed(dialog: WtReportDialog) {
  return new Promise<void>((resolve) =>
    dialog.addEventListener("wt-close", () => resolve(), { once: true }),
  );
}
