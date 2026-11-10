import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtReportDialog, WtTextarea } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { diag } from "./diagnostics.js";
import { setLocale } from "./i18n/t.js";
import "./problem-report.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale("en-GB");
});
async function fixture() {
  vi.stubGlobal("isSecureContext", false);
  setLocale("en-GB");
  const { el } = await mountWidget<HTMLElement & { updateComplete: Promise<boolean> }>(
    "setup-problem-report",
    {},
  );
  const trigger = el.shadowRoot?.querySelector<WtButton>("[data-report-problem]");
  expect(trigger).toBeDefined();
  await userEvent.click(trigger!);
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector<WtReportDialog>("wt-report-dialog")!;
  await dialog.updateComplete;
  return { el, dialog, trigger: trigger! };
}
function preview(dialog: WtReportDialog) {
  return dialog.shadowRoot!.querySelector("pre")!.textContent!;
}
async function describeProblem(dialog: WtReportDialog, value: string) {
  const field = dialog.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("textarea")!;
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  await dialog.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await dialog.updateComplete;
}
function data(text: string) {
  return JSON.parse(text.split("```json\n")[1]!.split("\n```")[0]!);
}

it("freezes the opening activity and facts while description edits update the preview", async () => {
  diag.record("info", "api", {
    phase: "end",
    method: "GET",
    path: "/management-api/session/me",
    status: 200,
  });
  const { dialog } = await fixture();
  const opened = data(preview(dialog));
  diag.record("info", "api", {
    phase: "end",
    method: "DELETE",
    path: "/later-private-route",
    status: 403,
  });
  await describeProblem(dialog, "The bill is hard to read.");
  const edited = data(preview(dialog));
  expect(edited.description).toBe("The bill is hard to read.");
  expect({
    id: edited.id,
    openedAt: edited.openedAt,
    trail: edited.trail,
    client: edited.client,
  }).toEqual({
    id: opened.id,
    openedAt: opened.openedAt,
    trail: opened.trail,
    client: opened.client,
  });
  expect(
    edited.trail.some((row: { fields: { method?: string } }) => row.fields.method === "DELETE"),
  ).toBe(false);
});

it("downloads exactly the visible file, releases its URL and makes no network or storage write", async () => {
  const { dialog } = await fixture();
  await describeProblem(dialog, "The bill is hard to read.");
  const visible = preview(dialog),
    urls: string[] = [],
    blobs: Blob[] = [];
  const realURL = URL.createObjectURL.bind(URL);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    const url = realURL(blob);
    urls.push(url);
    return url;
  });
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const files: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    files.push(this.download);
  });
  const fetch = vi.fn(() => {
    throw new Error("Reporting must not use the network");
  });
  vi.stubGlobal("fetch", fetch);
  const storage = vi.spyOn(Storage.prototype, "setItem");
  const button = dialog.shadowRoot!.querySelector<WtButton>("[data-download]")!;
  await userEvent.click(button);
  expect(await blobs[0]!.text()).toBe(visible);
  expect(files).toEqual([`problem-report-${data(visible).id}.md`]);
  expect(revoke).toHaveBeenCalledWith(urls[0]);
  expect(document.querySelector(`a[href="${urls[0]}"]`)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
});

it("retains the editable description after a failed download and retries without a new snapshot", async () => {
  const { dialog } = await fixture();
  await describeProblem(dialog, "The bill is hard to read.");
  const visible = preview(dialog),
    realURL = URL.createObjectURL.bind(URL);
  vi.spyOn(URL, "createObjectURL")
    .mockImplementationOnce(() => {
      throw new Error("Download refused");
    })
    .mockImplementation(realURL);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const button = dialog.shadowRoot!.querySelector<WtButton>("[data-download]")!;
  await userEvent.click(button);
  await dialog.updateComplete;
  expect(dialog.open).toBe(true);
  expect(dialog.description).toBe("The bill is hard to read.");
  expect(dialog.downloadError).not.toBe("");
  expect(button.disabled).toBe(false);
  expect(preview(dialog)).toBe(visible);
  await userEvent.click(button);
  await expect.poll(() => dialog.open).toBe(false);
});
