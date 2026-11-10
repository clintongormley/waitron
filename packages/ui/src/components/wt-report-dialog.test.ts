import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, mount, formMessageOf } from "../test-helpers.js";
import type { WtTextarea } from "./wt-textarea.js";
import type { WtButton } from "./wt-button.js";
import type { WtFormActions } from "./wt-form-actions.js";
import type { WtModal } from "./wt-modal.js";
import type { WtReportDialog as ReportDialog, ReportDialogCopy } from "./wt-report-dialog.js";
import "../index.js";

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
async function opened() {
  const el = (await mount("<wt-report-dialog></wt-report-dialog>")) as ReportDialog;
  Object.assign(el, { open: true, copy, description: "", preview: "```json\n{}\n```" });
  await settle(el);
  return el;
}
async function settle(el: ReportDialog) {
  await el.updateComplete;
  for (const child of el.shadowRoot?.querySelectorAll<WtTextarea | WtButton | WtModal>(
    "wt-textarea, wt-button, wt-modal",
  ) ?? [])
    await child.updateComplete;
}
function download(el: ReportDialog) {
  return el.shadowRoot?.querySelector<WtButton>("[data-download]");
}

test("shows the scope, warning and exact named read-only preview", async () => {
  const el = await opened();
  expect(el.shadowRoot).not.toBeNull();
  expect(el.shadowRoot!.textContent).toContain(copy.scope);
  expect(el.shadowRoot?.textContent).toContain(copy.warning);
  const preview = el.shadowRoot!.querySelector<HTMLElement>('[aria-label="Report preview"]')!;
  expect(preview.textContent).toBe("```json\n{}\n```");
  expect(preview.matches("input,textarea,[contenteditable=true]")).toBe(false);
  expect(preview.tabIndex).toBe(0);
});

test("re-emits an edit once with its value and stops the inner change", async () => {
  const el = await opened();
  const edits: CustomEvent[] = [],
    triggers: Event[] = [];
  el.addEventListener("wt-description-change", (e) => edits.push(e as CustomEvent));
  el.addEventListener("wt-change", (e) => triggers.push(e));
  const field = el.shadowRoot?.querySelector<WtTextarea>("wt-textarea");
  expect(field).toBeDefined();
  const input = field!.shadowRoot!.querySelector("textarea")!;
  expect(input.name).toBe("problemDescription");
  expect(input.hasAttribute("maxlength")).toBe(false);
  input.value = "The bill is hard to read.";
  input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  expect(
    edits.map((e) => ({ detail: e.detail, bubbles: e.bubbles, composed: e.composed })),
  ).toEqual([{ detail: { value: "The bill is hard to read." }, bubbles: true, composed: true }]);
  expect(triggers).toEqual([]);
});

test("downloads the visible bytes and keeps a failed download retryable", async () => {
  const el = await opened();
  const sends: CustomEvent[] = [];
  el.addEventListener("wt-report-download", (e) => sends.push(e as CustomEvent));
  expect(download(el)).toBeDefined();
  await userEvent.click(download(el)!);
  expect(sends.map((e) => e.detail)).toEqual([{ description: "", preview: "```json\n{}\n```" }]);
  el.downloadError = "Could not create the download. Try again.";
  await settle(el);
  expect(download(el)!.disabled).toBe(false);
  expect(
    (await formMessageOf(el.shadowRoot!.querySelector<WtFormActions>("wt-form-actions")!))
      ?.textContent,
  ).toBe("Could not create the download. Try again.");
  await userEvent.click(download(el)!);
  expect(sends).toHaveLength(2);
  el.validationError = copy.invalid;
  await settle(el);
  expect(download(el)!.disabled).toBe(true);
});

test("uses the close guard for Cancel and emits one close only after it allows leaving", async () => {
  const el = await opened();
  let allow = false;
  const guard = vi.fn(async () => allow);
  el.beforeClose = guard;
  await settle(el);
  const cancel = el.shadowRoot!.querySelector<WtButton>('wt-button[slot="cancel"]')!;
  await userEvent.click(cancel);
  expect(guard).toHaveBeenCalledWith("cancel");
  expect(el.open).toBe(true);
  const closed = new Promise<CustomEvent>((resolve) =>
    el.addEventListener("wt-close", (e) => resolve(e as CustomEvent), { once: true }),
  );
  allow = true;
  await userEvent.click(cancel);
  const event = await closed;
  expect({ detail: event.detail, bubbles: event.bubbles, composed: event.composed }).toEqual({
    detail: {},
    bubbles: true,
    composed: true,
  });
  expect(el.open).toBe(false);
});

test("paints its read-only preview from tokens", async () => {
  const el = await opened();
  el.style.setProperty("--wt-space-3", "13px");
  el.style.setProperty("--wt-color-surface-sunken", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
  const preview = getComputedStyle(el.shadowRoot!.querySelector("pre")!);
  expect(preview.whiteSpace).toBe("pre-wrap");
  expect(preview.paddingTop).toBe("13px");
  expect(preview.backgroundColor).toBe("rgb(1, 2, 3)");
  expect(preview.color).toBe("rgb(4, 5, 6)");
});
