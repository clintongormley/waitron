import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtButton, WtCombobox } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { printEquipmentLabel, type EquipmentLabel } from "./equipment-label.js";
const ID = "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b";
const OTHER = "7d2c9a10-5b3e-4f61-8a2d-1c0e9b8a7f65";
const q = <T extends Element = Element>(el: EquipmentLabel, test: string) =>
  el.shadowRoot!.querySelector<T>(`[data-test=${test}]`)!;
const active = [
  { id: OTHER, name: "Counter", active: true },
  { id: ID, name: "Portable", active: true },
  { id: "disabled", name: "Off", active: false },
];
beforeEach(() => setLocale("en"));
afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 768);
  vi.restoreAllMocks();
});
async function mount(kind: "printer" | "reader" = "printer") {
  const api = {
    listPrinters: vi.fn().mockResolvedValue(active),
    printEquipmentLabel: vi.fn().mockResolvedValue({ jobId: "job" }),
  };
  const { el, host } = await mountWidget<EquipmentLabel>("dashboard-equipment-label", {
    kind,
    itemId: ID,
    name: "Portable",
    api: api as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(q(el, "equipment-label-qr")).not.toBeNull());
  return { el, host, api };
}
it("offers only active printers, with a printer's own label first, and queues the chosen equipment", async () => {
  const { el, api } = await mount();
  q<WtButton>(el, "venue-print-equipment-label").click();
  await vi.waitFor(() => expect(q(el, "equipment-label-printer")).not.toBeNull());
  const choice = q<WtCombobox>(el, "equipment-label-printer");
  expect(choice.options.map((o) => o.value)).toEqual([ID, OTHER]);
  expect(choice.value).toBe("");
  expect(q<WtButton>(el, "send-equipment-label").disabled).toBe(true);
  choice.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: OTHER }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  q<WtButton>(el, "send-equipment-label").click();
  await vi.waitFor(() =>
    expect(api.printEquipmentLabel).toHaveBeenCalledExactlyOnceWith(OTHER, {
      kind: "printer",
      id: ID,
    }),
  );
  await vi.waitFor(() =>
    expect(q(el, "equipment-label-printer-status")?.textContent).toContain("queued"),
  );
});
it("keeps the selected printer and the action enabled after a refusal", async () => {
  const { el, api } = await mount("reader");
  api.printEquipmentLabel.mockRejectedValueOnce(new Error("offline"));
  q<WtButton>(el, "venue-print-equipment-label").click();
  await vi.waitFor(() => expect(q(el, "equipment-label-printer")).not.toBeNull());
  q(el, "equipment-label-printer").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: OTHER } }),
  );
  await el.updateComplete;
  q<WtButton>(el, "send-equipment-label").click();
  await vi.waitFor(() =>
    expect(
      q<HTMLElementTagNameMap["wt-form-actions"]>(el, "equipment-label-printer-actions")?.error,
    ).toBeTruthy(),
  );
  expect(q<WtCombobox>(el, "equipment-label-printer").value).toBe(OTHER);
  expect(q<WtButton>(el, "send-equipment-label").disabled).toBe(false);
  q<WtButton>(el, "send-equipment-label").click();
  await vi.waitFor(() => expect(api.printEquipmentLabel).toHaveBeenCalledTimes(2));
});
it("the real client sends the label request as an authenticated POST", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobId: "j1" })));
  const api = new DashboardApi("", fetcher);
  expect(await api.printEquipmentLabel(OTHER, { kind: "reader", id: ID })).toEqual({ jobId: "j1" });
  expect(fetcher.mock.calls[0]![0]).toBe(`/management-api/printers/${OTHER}/equipment-label`);
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ kind: "reader", id: ID }),
  });
});
it("prints the browser name larger and bolder than the code", async () => {
  const qr =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const printed = vi.fn<(view: Window) => void>();
  printEquipmentLabel({ qr, name: "<b>Portable</b>", code: "CODE" }, printed);
  await vi.waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
  const view = printed.mock.calls[0]![0];
  const [name, code] = [...view.document.querySelectorAll("p")];
  expect(name!.textContent).toBe("<b>Portable</b>");
  expect(parseFloat(view.getComputedStyle(name!).fontSize)).toBeGreaterThan(
    parseFloat(view.getComputedStyle(code!).fontSize),
  );
  expect(Number(view.getComputedStyle(name!).fontWeight)).toBeGreaterThan(
    Number(view.getComputedStyle(code!).fontWeight),
  );
  view.dispatchEvent(new Event("afterprint"));
});
it("shows the read failure and retries the printer list without losing the label", async () => {
  const { el, api } = await mount();
  api.listPrinters.mockRejectedValueOnce(new Error("offline"));
  q<WtButton>(el, "venue-print-equipment-label").click();
  await vi.waitFor(() =>
    expect(
      q<HTMLElementTagNameMap["wt-form-actions"]>(el, "equipment-label-printer-actions")?.error,
    ).toBeTruthy(),
  );
  expect(q<WtButton>(el, "send-equipment-label").disabled).toBe(true);
  q<WtButton>(el, "retry-equipment-printers").click();
  await vi.waitFor(() =>
    expect(q<WtCombobox>(el, "equipment-label-printer").options).toHaveLength(2),
  );
  expect(
    q<HTMLElementTagNameMap["wt-form-actions"]>(el, "equipment-label-printer-actions").error,
  ).toBe("");
});
it("offers no print action for an empty list and keeps it quiet while loading", async () => {
  const { el, api } = await mount();
  let complete!: (printers: never[]) => void;
  api.listPrinters.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  q<WtButton>(el, "venue-print-equipment-label").click();
  await el.updateComplete;
  expect(q<WtButton>(el, "send-equipment-label").variant).toBe("secondary");
  expect(q<WtButton>(el, "send-equipment-label").disabled).toBe(true);
  complete([]);
  await vi.waitFor(() => expect(q<WtCombobox>(el, "equipment-label-printer").options).toEqual([]));
  expect(q<WtButton>(el, "send-equipment-label").disabled).toBe(true);
  expect(api.printEquipmentLabel).not.toHaveBeenCalled();
});
it("ignores a late list after the label changes and opens a new choice", async () => {
  const { el, api } = await mount();
  let complete!: (printers: typeof active) => void;
  api.listPrinters.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  q<WtButton>(el, "venue-print-equipment-label").click();
  await el.updateComplete;
  el.itemId = OTHER;
  await el.updateComplete;
  q<WtButton>(el, "venue-print-equipment-label").click();
  await vi.waitFor(() =>
    expect(q<WtCombobox>(el, "equipment-label-printer").options[0]?.value).toBe(OTHER),
  );
  complete([]);
  await el.updateComplete;
  expect(q<WtCombobox>(el, "equipment-label-printer").options).toHaveLength(2);
});
it("sends once while pending and ignores its late result after switching equipment", async () => {
  const { el, api } = await mount();
  let complete!: (result: { jobId: string }) => void;
  api.printEquipmentLabel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  q<WtButton>(el, "venue-print-equipment-label").click();
  await vi.waitFor(() =>
    expect(q<WtCombobox>(el, "equipment-label-printer").options).toHaveLength(2),
  );
  q(el, "equipment-label-printer").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: ID } }),
  );
  await el.updateComplete;
  q<WtButton>(el, "send-equipment-label").click();
  q<WtButton>(el, "send-equipment-label").click();
  await el.updateComplete;
  expect(api.printEquipmentLabel).toHaveBeenCalledTimes(1);
  expect(q<WtButton>(el, "send-equipment-label").loading).toBe(true);
  el.itemId = OTHER;
  await el.updateComplete;
  complete({ jobId: "old-job" });
  await el.updateComplete;
  expect(q(el, "equipment-label-printer-status")).toBeNull();
});
