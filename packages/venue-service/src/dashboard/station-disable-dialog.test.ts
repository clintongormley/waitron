import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { PrepStationsApi, type StationClosing } from "./routing-client.js";
import { StationDisableDialog } from "./station-disable-dialog.js";

class DisableTestApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("station-disable-test-app", DisableTestApp);
let app: DisableTestApp;
afterEach(() => {
  app?.remove();
  setLocale("en");
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
const closing: StationClosing = {
  openDishCount: 3,
  destinations: [
    { id: "bar", name: "Bar", isDefault: true },
    { id: "grill", name: "Grill", isDefault: false },
  ],
};
async function mount(
  read: Promise<StationClosing> = Promise.resolve(closing),
  write?: Promise<void>,
) {
  setLocale("en");
  const request = vi.fn(async (...args: unknown[]) => (args[1] === "GET" ? read : write));
  app = document.createElement("station-disable-test-app") as DisableTestApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const dialog = new StationDisableDialog();
  dialog.api = new PrepStationsApi(request as never);
  dialog.stationId = "kitchen";
  dialog.stationName = "Kitchen";
  dialog.namingCells = ["Food · Terrace", "Bread · Every zone"];
  app.append(dialog);
  await dialog.updateComplete;
  return { dialog, request };
}
const query = (dialog: StationDisableDialog, selector: string) =>
  dialog.shadowRoot!.querySelector<HTMLElement>(selector);
async function ready(dialog: StationDisableDialog) {
  await expect.poll(() => query(dialog, "[data-test=disable-confirm]")).not.toBeNull();
}
async function choose(dialog: StationDisableDialog, value: string) {
  dialog
    .shadowRoot!.querySelector("wt-combobox")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await dialog.updateComplete;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

it("Disable lists naming cells and holds the action until waiting dishes have a disposition", async () => {
  const { dialog, request } = await mount();
  await ready(dialog);
  expect(dialog.shadowRoot!.textContent).toContain("Food · Terrace");
  expect(dialog.shadowRoot!.textContent).toContain("Bread · Every zone");
  await expect
    .poll(() => dialog.shadowRoot!.querySelector("wt-combobox")?.label)
    .toBe("3 waiting dishes");
  expect(query(dialog, "[data-test=disable-confirm]")!.hasAttribute("disabled")).toBe(true);
  expect(request.mock.calls).toEqual([
    ["/management-api/stations/kitchen/closing", "GET", undefined, { passive: true }],
  ]);
});
it.each([
  ["bar", { openDishes: "send", sendsToStationId: "bar" }],
  ["__leave__", { openDishes: "leave" }],
])("Disable makes one request for choice %s without saving a fallback", async (value, body) => {
  const { dialog, request } = await mount();
  await ready(dialog);
  await choose(dialog, value as string);
  query(dialog, "[data-test=disable-confirm]")!.click();
  await expect.poll(() => request.mock.calls.length).toBe(2);
  expect(request.mock.calls[1]).toEqual(["/management-api/stations/kitchen", "DELETE", body]);
  await expect.poll(() => query(dialog, "wt-modal")).toBeNull();
  expect(unload()).toBe(false);
});
it("Disable with no waiting dishes needs one confirmation and no destination", async () => {
  const { dialog, request } = await mount(Promise.resolve({ ...closing, openDishCount: 0 }));
  await ready(dialog);
  expect(query(dialog, "wt-combobox")).toBeNull();
  expect(query(dialog, "[data-test=disable-confirm]")!.hasAttribute("disabled")).toBe(false);
  query(dialog, "[data-test=disable-confirm]")!.click();
  await expect.poll(() => request.mock.calls.length).toBe(2);
  expect(request.mock.calls[1]).toEqual(["/management-api/stations/kitchen", "DELETE"]);
});
it("Disable cannot act before its read finishes and retries a failed read", async () => {
  const read = deferred<StationClosing>();
  const { dialog, request } = await mount(read.promise);
  expect(query(dialog, "[data-test=disable-confirm]")?.hasAttribute("disabled") ?? true).toBe(true);
  read.reject({ code: "connection.failed" });
  await expect.poll(() => query(dialog, "[data-test=disable-retry]")).not.toBeNull();
  request.mockImplementation(async () => closing);
  query(dialog, "[data-test=disable-retry]")!.click();
  await ready(dialog);
  expect(query(dialog, "[role=alert]")).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
});
it("Disable refusal retains the choice and remains retryable", async () => {
  const write = deferred<void>();
  const { dialog, request } = await mount(undefined, write.promise);
  await ready(dialog);
  await choose(dialog, "bar");
  query(dialog, "[data-test=disable-confirm]")!.click();
  write.reject({ code: "station.default_cannot_disable" });
  await expect.poll(() => query(dialog, "[role=alert]")).not.toBeNull();
  expect(dialog.shadowRoot!.querySelector("wt-combobox")!.value).toBe("bar");
  expect(query(dialog, "[data-test=disable-confirm]")!.hasAttribute("disabled")).toBe(false);
  expect(unload()).toBe(true);
  request.mockImplementation(async () => undefined);
  query(dialog, "[data-test=disable-confirm]")!.click();
  await expect.poll(() => query(dialog, "wt-modal")).toBeNull();
  expect(request.mock.calls[2]).toEqual([
    "/management-api/stations/kitchen",
    "DELETE",
    { openDishes: "send", sendsToStationId: "bar" },
  ]);
});
it("Disable pending write blocks dismissal, duplicate requests and changes to its choice", async () => {
  const write = deferred<void>();
  const { dialog, request } = await mount(undefined, write.promise);
  await ready(dialog);
  await choose(dialog, "bar");
  query(dialog, "[data-test=disable-confirm]")!.click();
  await dialog.updateComplete;
  expect(await dialog.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")).toBe(false);
  await choose(dialog, "grill");
  query(dialog, "[data-test=disable-confirm]")!.click();
  expect(request).toHaveBeenCalledTimes(2);
  expect(dialog.shadowRoot!.querySelector("wt-combobox")!.value).toBe("bar");
  write.resolve();
  await expect.poll(() => query(dialog, "wt-modal")).toBeNull();
});
it("Disable protects a changed choice on Cancel and permits Discard", async () => {
  const { dialog, request } = await mount();
  await ready(dialog);
  await choose(dialog, "bar");
  expect(unload()).toBe(true);
  query(dialog, "[data-test=disable-cancel]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => question.open).toBe(false);
  expect(dialog.shadowRoot!.querySelector("wt-combobox")!.value).toBe("bar");
  query(dialog, "[data-test=disable-cancel]")!.click();
  await expect.poll(() => question.open).toBe(true);
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => query(dialog, "wt-modal")).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  expect(unload()).toBe(false);
});
it("Disable ignores a departed read after reconnecting for a different station", async () => {
  const old = deferred<StationClosing>();
  const { dialog, request } = await mount(old.promise);
  dialog.remove();
  dialog.stationId = "grill";
  request.mockImplementation(async () => ({ ...closing, openDishCount: 0 }));
  app.append(dialog);
  await ready(dialog);
  old.resolve(closing);
  await Promise.resolve();
  await dialog.updateComplete;
  expect(query(dialog, "wt-combobox")).toBeNull();
  query(dialog, "[data-test=disable-confirm]")!.click();
  await expect.poll(() => request.mock.calls.length).toBe(3);
  expect(request.mock.calls[2]).toEqual(["/management-api/stations/grill", "DELETE"]);
});
it("Disable ignores a departed write after reconnecting for a different station", async () => {
  const old = deferred<void>();
  const { dialog, request } = await mount(undefined, old.promise);
  await ready(dialog);
  await choose(dialog, "bar");
  query(dialog, "[data-test=disable-confirm]")!.click();
  dialog.remove();
  dialog.stationId = "grill";
  request.mockImplementation(async () => ({ ...closing, openDishCount: 0 }));
  app.append(dialog);
  await ready(dialog);
  old.resolve();
  await Promise.resolve();
  await dialog.updateComplete;
  expect(query(dialog, "wt-modal")).not.toBeNull();
  expect(query(dialog, "[data-test=disable-confirm]")!.hasAttribute("disabled")).toBe(false);
});

it.each([
  { code: "station.destination_invalid" },
  { code: "management.request_invalid", params: { field: "sendsToStationId" } },
])(
  "Disable names a refused destination beside the choice and at the bottom ($code)",
  async (error) => {
    const write = deferred<void>();
    const { dialog } = await mount(undefined, write.promise);
    await ready(dialog);
    await choose(dialog, "grill");
    query(dialog, "[data-test=disable-confirm]")!.click();
    write.reject(error);
    await expect
      .poll(() => query(dialog, "[data-field-error=openDishes]")?.textContent)
      .toContain("Choose another station.");
    expect(query(dialog, "[data-test=disable-error]")!.textContent).toContain(
      "Choose another station.",
    );
    expect(query(dialog, "[data-test=disable-confirm]")!.hasAttribute("disabled")).toBe(false);
  },
);
it("Disable always offers Leave even when there is no destination", async () => {
  const { dialog, request } = await mount(Promise.resolve({ ...closing, destinations: [] }));
  await ready(dialog);
  await expect.poll(() => dialog.shadowRoot!.querySelector("wt-combobox")?.options.length).toBe(1);
  await choose(dialog, "__leave__");
  query(dialog, "[data-test=disable-confirm]")!.click();
  await expect.poll(() => request.mock.calls.length).toBe(2);
  expect(request.mock.calls[1]).toEqual([
    "/management-api/stations/kitchen",
    "DELETE",
    { openDishes: "leave" },
  ]);
});
it("Disable rejects a destination absent from the preflight choices", async () => {
  const { dialog, request } = await mount();
  await ready(dialog);
  await choose(dialog, "kitchen");
  query(dialog, "[data-test=disable-confirm]")!.click();
  await dialog.updateComplete;
  expect(query(dialog, "[data-test=disable-confirm]")!.hasAttribute("disabled")).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});
it("Disable departed controls cannot submit or change a replacement opening", async () => {
  const { dialog, request } = await mount();
  await ready(dialog);
  const oldConfirm = query(dialog, "[data-test=disable-confirm]")!;
  const oldChoice = dialog.shadowRoot!.querySelector("wt-combobox")!;
  dialog.remove();
  dialog.stationId = "grill";
  app.append(dialog);
  await ready(dialog);
  await choose(dialog, "bar");
  oldChoice.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "__leave__" } }));
  oldConfirm.click();
  await dialog.updateComplete;
  expect(dialog.shadowRoot!.querySelector("wt-combobox")!.value).toBe("bar");
  expect(request).toHaveBeenCalledTimes(2);
});
it("Disable reverting a choice leaves Cancel free of a discard question", async () => {
  const { dialog, request } = await mount();
  await ready(dialog);
  await choose(dialog, "bar");
  await choose(dialog, "");
  expect(unload()).toBe(false);
  query(dialog, "[data-test=disable-cancel]")!.click();
  await expect.poll(() => query(dialog, "wt-modal")).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
});

it("Disable departed Retry cannot restart a replacement opening's read", async () => {
  const read = deferred<StationClosing>();
  const { dialog, request } = await mount(read.promise);
  read.reject({ code: "connection.failed" });
  await expect.poll(() => query(dialog, "[data-test=disable-retry]")).not.toBeNull();
  const retry = query(dialog, "[data-test=disable-retry]")!;
  dialog.remove();
  dialog.stationId = "grill";
  request.mockImplementation(async () => closing);
  app.append(dialog);
  await ready(dialog);
  retry.click();
  await dialog.updateComplete;
  expect(request).toHaveBeenCalledTimes(2);
});

it("Disable rereads when new dishes arrive after a no-work preflight", async () => {
  const { dialog, request } = await mount(Promise.resolve({ ...closing, openDishCount: 0 }));
  await ready(dialog);
  await expect
    .poll(() => query(dialog, "[data-test=disable-confirm]")?.hasAttribute("disabled"))
    .toBe(false);
  request.mockImplementation(async (...args: unknown[]) => {
    if (args[1] === "DELETE")
      throw { code: "management.request_invalid", params: { field: "openDishes" } };
    return closing;
  });
  query(dialog, "[data-test=disable-confirm]")!.click();
  await expect.poll(() => dialog.shadowRoot!.querySelector("wt-combobox")?.options.length).toBe(3);
  expect(request.mock.calls[2]).toEqual([
    "/management-api/stations/kitchen/closing",
    "GET",
    undefined,
    { passive: true },
  ]);
  expect(query(dialog, "[data-test=disable-confirm]")!.hasAttribute("disabled")).toBe(true);
});

it("Disable tells assistive technology that the open-dish choice is required", async () => {
  const { dialog } = await mount();
  await ready(dialog);
  const combo = dialog.shadowRoot!.querySelector("wt-combobox")!;
  await combo.updateComplete;
  expect(combo.shadowRoot!.querySelector('[role="combobox"]')!.getAttribute("aria-required")).toBe(
    "true",
  );
  expect(combo.shadowRoot!.querySelector("[data-required]")?.textContent).toBe("*");
});
