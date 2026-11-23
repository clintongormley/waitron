import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, mount, formMessageOf } from "../test-helpers.js";
import type { WtTextarea } from "./wt-textarea.js";
import type { WtButton } from "./wt-button.js";
import type { WtFormActions } from "./wt-form-actions.js";
import type { WtModal } from "./wt-modal.js";
import type {
  WtReportDialog as ReportDialog,
  ReportDialogCloud,
  ReportDialogCopy,
} from "./wt-report-dialog.js";
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

const cloudCopy: ReportDialogCopy = {
  ...copy,
  cloud: {
    scope: "Send this box's report to Waitron Cloud.",
    descriptionReview: "Waitron reviews your description first.",
    descriptionDirect: "Your description goes straight to Waitron.",
    waiting: "Your description is waiting.",
    descriptionQueued: "Your description will follow.",
    preview: "Cloud attachment",
    send: "Send to Waitron",
    sent: "Report sent.",
    queued: "Report queued.",
    refused: "Waitron Cloud refused the report.",
    descriptionRefused: "Waitron Cloud is busy; try your description later.",
  },
};
const words = cloudCopy.cloud!;

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}
type Preview = Awaited<ReturnType<ReportDialogCloud["previewProblemReport"]>>;
type Sent = Awaited<ReturnType<ReportDialogCloud["sendProblemReport"]>>;
function fakeCloud() {
  const previews: ReturnType<typeof deferred<Preview>>[] = [];
  const sends: ReturnType<typeof deferred<Sent>>[] = [];
  const cloud = {
    previewProblemReport: vi.fn<ReportDialogCloud["previewProblemReport"]>(() => {
      previews.push(deferred<Preview>());
      return previews.at(-1)!.promise;
    }),
    sendProblemReport: vi.fn<ReportDialogCloud["sendProblemReport"]>(() => {
      sends.push(deferred<Sent>());
      return sends.at(-1)!.promise;
    }),
  };
  return { cloud, previews, sends };
}
const attachment = { available: true, id: "report-7", attachment: "box log: 3 lines" } as const;

/** Mounts with the cloud set while closed, then opens, so opening alone starts the preview. */
async function cloudDialog(dialogCopy = cloudCopy) {
  const fake = fakeCloud();
  const el = (await mount("<wt-report-dialog></wt-report-dialog>")) as ReportDialog;
  Object.assign(el, { copy: dialogCopy, cloud: fake.cloud, preview: "```json\n{}\n```" });
  await settle(el);
  expect(fake.cloud.previewProblemReport).not.toHaveBeenCalled();
  el.open = true;
  await settle(el);
  return { el, ...fake };
}
async function cloudReady(preview: Preview = attachment) {
  const opened = await cloudDialog();
  opened.previews[0]!.resolve(preview);
  await opened.previews[0]!.promise;
  await settle(opened.el);
  return opened;
}
const sendButton = (el: ReportDialog) => el.shadowRoot!.querySelector<WtButton>("[data-send]");
/** The status's text without the template's line breaks and indentation; a space the dialog wrote at the end or between words stays. */
const statusText = (el: ReportDialog) =>
  el.shadowRoot!.querySelector('[role="status"]')!.textContent!.replace(/^\n\s*|\n\s*$/g, "");
async function messageText(el: ReportDialog) {
  return (await formMessageOf(el.shadowRoot!.querySelector<WtFormActions>("wt-form-actions")!))
    ?.textContent;
}
async function sendAnswered(
  el: ReportDialog,
  sends: ReturnType<typeof deferred<Sent>>[],
  answer: (pending: ReturnType<typeof deferred<Sent>>) => void,
) {
  sendButton(el)!.click();
  const pending = sends.at(-1)!;
  answer(pending);
  await pending.promise.catch(() => undefined);
  await settle(el);
}

test("starts closed and empty, with no message and Download disabled", async () => {
  const el = (await mount("<wt-report-dialog></wt-report-dialog>")) as ReportDialog;
  expect(el.open).toBe(false);
  el.copy = copy;
  el.open = true;
  await settle(el);
  expect(el.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!.value).toBe("");
  expect(el.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!.error).toBe("");
  expect(el.shadowRoot!.querySelector('[aria-label="Report preview"]')!.textContent).toBe("");
  expect(await messageText(el)).toBeFalsy();
  expect(download(el)!.disabled).toBe(true);
  const downloads: Event[] = [];
  el.addEventListener("wt-report-download", (e) => downloads.push(e));
  download(el)!.click();
  expect(downloads).toEqual([]);
  expect(sendButton(el)).toBeNull();
});

test("keeps its own button clicks and the modal's close inside, and re-emits no close it did not cause", async () => {
  const el = await opened();
  const clicks: Event[] = [],
    closes: Event[] = [],
    downloads: CustomEvent[] = [];
  el.addEventListener("click", (e) => clicks.push(e));
  el.addEventListener("wt-close", (e) => closes.push(e));
  el.addEventListener("wt-report-download", (e) => downloads.push(e as CustomEvent));
  await userEvent.click(download(el)!);
  expect(downloads.map((e) => [e.bubbles, e.composed])).toEqual([[true, true]]);
  const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
  const innerClose = new Promise((resolve) =>
    modal.addEventListener("wt-close", resolve, { once: true }),
  );
  el.open = false;
  await innerClose;
  expect(closes).toEqual([]);
  el.open = true;
  await settle(el);
  const cancelled = new Promise((resolve) =>
    modal.addEventListener("wt-close", resolve, { once: true }),
  );
  await userEvent.click(el.shadowRoot!.querySelector<WtButton>('wt-button[slot="cancel"]')!);
  await cancelled;
  expect(closes).toHaveLength(1);
  expect(clicks).toEqual([]);
});

test("loads the Cloud preview once on opening and shows the Cloud copy around it", async () => {
  const { el, cloud } = await cloudReady();
  expect(cloud.previewProblemReport).toHaveBeenCalledTimes(1);
  const text = el.shadowRoot!.textContent!;
  expect(text).toContain(words.scope);
  expect(text).not.toContain(copy.scope);
  expect(text).toContain(words.descriptionReview);
  expect(text).not.toContain(words.descriptionDirect);
  const paragraphs = [...el.shadowRoot!.querySelectorAll("p")].map((p) => p.textContent);
  expect(paragraphs).toEqual([
    words.scope,
    words.preview,
    copy.warning,
    words.descriptionReview,
    copy.preview,
  ]);
  const pre = el.shadowRoot!.querySelector<HTMLElement>("[data-cloud-preview]")!;
  expect(pre.getAttribute("aria-label")).toBe(words.preview);
  expect(pre.textContent!.trim()).toBe("box log: 3 lines");
  expect(sendButton(el)!.textContent!.trim()).toBe(words.send);
  expect(sendButton(el)!.disabled).toBe(false);
  expect(sendButton(el)!.getAttribute("variant")).toBe("primary");
  expect(statusText(el)).toBe("");
  expect(download(el)!.slot).toBe("secondary");
  expect(download(el)!.getAttribute("variant")).toBe("secondary");
  expect(download(el)!.disabled).toBe(false);
});

test("tells an administrator their description goes straight to Waitron", async () => {
  const { el } = await cloudReady({ ...attachment, admin: true });
  expect(el.shadowRoot!.textContent).toContain(words.descriptionDirect);
  expect(el.shadowRoot!.textContent).not.toContain(words.descriptionReview);
});

test("keeps the plain dialog when the Cloud preview is unavailable, fails, or the copy has no Cloud words", async () => {
  for (const settleWith of [
    (p: ReturnType<typeof deferred<Preview>>) => p.resolve({ available: false }),
    (p: ReturnType<typeof deferred<Preview>>) => p.reject(new Error("offline")),
  ]) {
    const { el, previews } = await cloudDialog();
    settleWith(previews[0]!);
    await previews[0]!.promise.catch(() => undefined);
    await settle(el);
    expect(el.shadowRoot!.textContent).toContain(copy.scope);
    expect(el.shadowRoot!.querySelector("[data-cloud-preview]")).toBeNull();
    expect(sendButton(el)).toBeNull();
    expect(download(el)!.slot).toBe("");
    expect(download(el)!.getAttribute("variant")).toBe("primary");
    cleanup();
  }
  const { el, previews } = await cloudDialog(copy);
  previews[0]!.resolve(attachment);
  await previews[0]!.promise;
  await settle(el);
  expect(el.shadowRoot!.textContent).toContain(copy.scope);
  expect(sendButton(el)).toBeNull();
});

test("ignores a preview that arrives after the dialog closed or its Cloud changed", async () => {
  const { el, cloud, previews } = await cloudDialog();
  const first = cloud.previewProblemReport.mock.calls[0]![0];
  el.open = false;
  await settle(el);
  expect(first.aborted).toBe(true);
  el.open = true;
  await settle(el);
  expect(cloud.previewProblemReport).toHaveBeenCalledTimes(2);
  previews[0]!.resolve(attachment);
  await previews[0]!.promise;
  await settle(el);
  expect(el.shadowRoot!.textContent).toContain(copy.scope);
  const second = cloud.previewProblemReport.mock.calls[1]![0];
  const other = fakeCloud();
  el.cloud = other.cloud;
  await settle(el);
  expect(second.aborted).toBe(true);
  previews[1]!.resolve(attachment);
  await previews[1]!.promise;
  await settle(el);
  expect(el.shadowRoot!.querySelector("[data-cloud-preview]")).toBeNull();
  expect(other.cloud.previewProblemReport).toHaveBeenCalledTimes(1);
  const third = other.cloud.previewProblemReport.mock.calls[0]![0];
  el.remove();
  expect(third.aborted).toBe(true);
});

test("sends without a description when it is blank, and the untrimmed text otherwise", async () => {
  const { el, cloud, sends } = await cloudReady();
  const signal = cloud.previewProblemReport.mock.calls[0]![0];
  el.description = "   ";
  await settle(el);
  const outside: Event[] = [];
  el.addEventListener("click", (e) => outside.push(e));
  await userEvent.click(sendButton(el)!);
  expect(outside).toEqual([]);
  expect(cloud.sendProblemReport.mock.calls).toEqual([["report-7", signal]]);
  await settle(el);
  expect(sendButton(el)!.disabled).toBe(true);
  expect(sendButton(el)!.getAttribute("variant")).toBe("primary");
  sendButton(el)!.click();
  expect(cloud.sendProblemReport).toHaveBeenCalledTimes(1);
  sends[0]!.reject(new Error("down"));
  await sends[0]!.promise.catch(() => undefined);
  await settle(el);
  el.description = "  The till froze  ";
  await settle(el);
  sendButton(el)!.click();
  expect(cloud.sendProblemReport.mock.calls[1]).toEqual(["report-7", signal, "  The till froze  "]);
});

test("reports each delivery, and saves a sent description only when Cloud took it", async () => {
  const cases: {
    description: string;
    answer: Record<string, unknown>;
    status: string;
    saved: boolean;
  }[] = [
    {
      description: "Printer jam",
      answer: { delivery: "sent", description: "waiting" },
      status: `${words.sent} ${words.waiting}`,
      saved: true,
    },
    {
      description: "Printer jam",
      answer: { delivery: "queued", description: "queued" },
      status: `${words.queued} ${words.descriptionQueued}`,
      saved: true,
    },
    {
      description: "Printer jam",
      answer: { delivery: "queued" },
      status: words.queued,
      saved: false,
    },
    {
      description: "",
      answer: { delivery: "sent", description: "queued" },
      status: `${words.sent} ${words.descriptionQueued}`,
      saved: false,
    },
  ];
  for (const each of cases) {
    const { el, sends } = await cloudReady();
    el.description = each.description;
    await settle(el);
    const saved: CustomEvent[] = [];
    el.addEventListener("wt-description-saved", (e) => saved.push(e as CustomEvent));
    await sendAnswered(el, sends, (p) => p.resolve(each.answer as Sent));
    expect(statusText(el)).toBe(each.status);
    expect(sendButton(el)!.disabled).toBe(true);
    expect(sendButton(el)!.getAttribute("variant")).toBe("secondary");
    expect(await messageText(el)).toBeFalsy();
    expect(
      saved.map((e) => ({ detail: e.detail, bubbles: e.bubbles, composed: e.composed })),
    ).toEqual(
      each.saved ? [{ detail: { value: "Printer jam" }, bubbles: true, composed: true }] : [],
    );
    cleanup();
  }
});

test("treats an unexpected delivery as refused, saves nothing and lets Send try again", async () => {
  const { el, sends } = await cloudReady();
  el.description = "Printer jam";
  await settle(el);
  await sendAnswered(el, sends, (p) => p.reject({ code: "cloud.busy" }));
  expect(await messageText(el)).toBe(words.descriptionRefused);
  const saved: Event[] = [];
  el.addEventListener("wt-description-saved", (e) => saved.push(e));
  await sendAnswered(el, sends, (p) =>
    p.resolve({ delivery: "lost", description: "waiting" } as unknown as Sent),
  );
  expect(await messageText(el)).toBe(words.refused);
  expect(statusText(el)).toBe("");
  expect(saved).toEqual([]);
  expect(sendButton(el)!.disabled).toBe(false);
  expect(sendButton(el)!.getAttribute("variant")).toBe("primary");
});

test("says Cloud is busy only for a busy refusal of a written description", async () => {
  const cases: { description: string; error: unknown; message: string }[] = [
    {
      description: "Printer jam",
      error: { code: "cloud.busy" },
      message: words.descriptionRefused,
    },
    { description: "  ", error: { code: "cloud.busy" }, message: words.refused },
    { description: "Printer jam", error: { code: "cloud.down" }, message: words.refused },
    { description: "Printer jam", error: {}, message: words.refused },
    { description: "Printer jam", error: null, message: words.refused },
    { description: "Printer jam", error: "cloud.busy", message: words.refused },
  ];
  for (const each of cases) {
    const { el, sends } = await cloudReady();
    el.description = each.description;
    await settle(el);
    await sendAnswered(el, sends, (p) => p.reject(each.error));
    expect(await messageText(el), JSON.stringify(each)).toBe(each.message);
    expect(sendButton(el)!.disabled).toBe(false);
    cleanup();
  }
});

test("a description error disables Send, marks the field and asks for a fix below it; after a refusal, the message below is the refusal", async () => {
  const { el, sends } = await cloudReady();
  el.validationError = copy.invalid;
  await settle(el);
  expect(sendButton(el)!.disabled).toBe(true);
  expect(sendButton(el)!.getAttribute("variant")).toBe("secondary");
  expect(el.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!.error).toBe(copy.invalid);
  expect(await messageText(el)).toBe(copy.invalid);
  el.validationError = "";
  await settle(el);
  await sendAnswered(el, sends, (p) => p.reject(new Error("down")));
  el.validationError = copy.invalid;
  await settle(el);
  expect(await messageText(el)).toBe(words.refused);
  expect(el.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!.error).toBe(copy.invalid);
});

test("forgets a send whose dialog closed before Cloud answered", async () => {
  for (const answer of [
    (p: ReturnType<typeof deferred<Sent>>) =>
      p.resolve({ delivery: "sent", description: "waiting" }),
    (p: ReturnType<typeof deferred<Sent>>) => p.reject({ code: "cloud.busy" }),
  ]) {
    const { el, cloud, previews, sends } = await cloudReady();
    el.description = "Printer jam";
    await settle(el);
    const saved: Event[] = [];
    el.addEventListener("wt-description-saved", (e) => saved.push(e));
    sendButton(el)!.click();
    el.open = false;
    await settle(el);
    expect(cloud.sendProblemReport.mock.calls[0]![1].aborted).toBe(true);
    el.open = true;
    await settle(el);
    previews[1]!.resolve(attachment);
    await previews[1]!.promise;
    await settle(el);
    answer(sends[0]!);
    await sends[0]!.promise.catch(() => undefined);
    await settle(el);
    expect(statusText(el)).toBe("");
    expect(await messageText(el)).toBeFalsy();
    expect(sendButton(el)!.disabled).toBe(false);
    expect(saved).toEqual([]);
    cleanup();
  }
});

test("clears a delivery when reopened, and sends nothing once taken off the page", async () => {
  const { el, cloud, previews, sends } = await cloudReady();
  await sendAnswered(el, sends, (p) => p.resolve({ delivery: "sent" }));
  expect(statusText(el)).toBe(words.sent);
  el.open = false;
  await settle(el);
  el.open = true;
  await settle(el);
  previews[1]!.resolve(attachment);
  await previews[1]!.promise;
  await settle(el);
  expect(statusText(el)).toBe("");
  expect(sendButton(el)!.disabled).toBe(false);
  const button = sendButton(el)!;
  el.remove();
  button.click();
  expect(cloud.sendProblemReport).toHaveBeenCalledTimes(1);
});

test("drops a refusal's Cloud wording when the copy loses its Cloud words", async () => {
  for (const error of [{ code: "cloud.busy" }, new Error("down")]) {
    const { el, sends } = await cloudReady();
    el.description = "Printer jam";
    await settle(el);
    await sendAnswered(el, sends, (p) => p.reject(error));
    el.copy = copy;
    await settle(el);
    expect(el.shadowRoot!.textContent).toContain(copy.scope);
    expect(sendButton(el)).toBeNull();
    expect(await messageText(el)).toBeFalsy();
    cleanup();
  }
});
