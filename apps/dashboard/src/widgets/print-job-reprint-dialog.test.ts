import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { WtButton, WtCombobox } from "@waitron/ui";
import { cleanupWidgets, dialogMessageOf, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, setLocale, t } from "../i18n/t.js";
import type { DashboardApi, PrintJobRow, Printer } from "../api/client.js";
import "./print-job-reprint-dialog.js";
import type { PrintJobReprintDialog } from "./print-job-reprint-dialog.js";

const printer = (
  id: string,
  name: string,
  active: boolean,
  paperWidth: Printer["paperWidth"] = "80mm",
  resolution: Printer["resolution"] = "180dpi",
): Printer => ({
  id,
  name,
  active,
  transport: "network_tcp",
  host: "10.0.0.9",
  port: 9100,
  localKey: null,
  pollId: null,
  paperWidth,
  resolution,
  hasCashDrawer: false,
  portable: false,
  pickupRoles: ["receipt"],
  holder: null,
  pendingJobs: 0,
  lastPrintAt: null,
  lastPrintAgentId: null,
});

const printers: Printer[] = [
  printer("p1", "Kitchen", true),
  printer("p2", "Terrace", true, "58mm", "203dpi"),
  printer("p3", "Bar", true),
  printer("p4", "Old counter", false),
];

const job = (overrides: Partial<PrintJobRow> = {}): PrintJobRow => ({
  id: "j1",
  printerId: "p1",
  printerName: "Kitchen",
  status: "done",
  canResend: true,
  attempts: 1,
  lastError: null,
  createdAt: "2026-11-09T12:00:00.000Z",
  deliveredAt: "2026-11-09T12:00:05.000Z",
  reprintRule: "any",
  reprintPrinterIds: ["p2", "p3"],
  stuck: false,
  ...overrides,
});

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

async function mount(row: PrintJobRow, api: Partial<DashboardApi> = {}) {
  const resendPrintJob = vi.fn().mockResolvedValue({ jobId: "resent" });
  const stub = { resendPrintJob, ...api } as DashboardApi;
  const { el } = await mountWidget<PrintJobReprintDialog>("dashboard-print-job-reprint-dialog", {
    api: stub,
    job: row,
    printers,
  });
  return { el, api: stub };
}

const combobox = (el: PrintJobReprintDialog) =>
  el.shadowRoot!.querySelector<WtCombobox>("wt-combobox[name=printerId]");
const reprint = (el: PrintJobReprintDialog) =>
  el.shadowRoot!.querySelector<WtButton>("[data-test=reprint-send]")!;
const offered = (el: PrintJobReprintDialog) => combobox(el)!.options.map((o) => o.label);

it("offers the original chosen, then every other receipt printer by name, whatever its width, with no hint", async () => {
  const { el } = await mount(job());
  expect(combobox(el)!.label).toBe(t("printers.reprint_printer"));
  expect(offered(el)).toEqual(["Kitchen", "Bar", "Terrace"]);
  expect(combobox(el)!.value).toBe("p1");
  expect(combobox(el)!.hint).toBe("");
  expect(reprint(el).disabled).toBe(false);
  expect(reprint(el).variant).toBe("primary");
});

it("says only printers wide enough are offered for a kitchen ticket or refund receipt", async () => {
  const { el } = await mount(job({ reprintRule: "wide_enough", reprintPrinterIds: ["p3"] }));
  expect(offered(el)).toEqual(["Kitchen", "Bar"]);
  expect(combobox(el)!.hint).toBe(t("printers.reprint_wide_enough"));
});

it("offers only its own printer for any other printout, and says so", async () => {
  const { el } = await mount(job({ reprintRule: "own", reprintPrinterIds: [] }));
  expect(offered(el)).toEqual(["Kitchen"]);
  expect(combobox(el)!.hint).toBe(t("printers.reprint_own_only"));
});

it("chooses nothing when the original is disabled, and keeps Reprint quiet until a printer is chosen", async () => {
  const { el } = await mount(job({ printerId: "p4", printerName: "Old counter" }));
  expect(offered(el)).toEqual(["Bar", "Terrace"]);
  expect(combobox(el)!.value).toBe("");
  expect(reprint(el).disabled).toBe(true);
  expect(reprint(el).variant).toBe("secondary");
  await chooseOption(combobox(el)!, "p3");
  await el.updateComplete;
  expect(reprint(el).disabled).toBe(false);
  expect(reprint(el).variant).toBe("primary");
});

it.each([
  ["own", [], "printers.reprint_original_off"],
  ["wide_enough", [], "printers.reprint_none"],
] as const)(
  "says what to do when a disabled original's %s printout has nowhere else to go",
  async (reprintRule, reprintPrinterIds, key) => {
    const { el } = await mount(
      job({
        printerId: "p4",
        printerName: "Old counter",
        reprintRule,
        reprintPrinterIds: [...reprintPrinterIds],
      }),
    );
    expect(combobox(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reprint-nowhere]")!.textContent!.trim()).toBe(
      fill(key, { printer: "Old counter" }),
    );
    expect(reprint(el).disabled).toBe(true);
  },
);

it("offers a stuck printout only the other printers, chooses nothing and says it is cancelled where it waits", async () => {
  const { el } = await mount(job({ status: "queued", deliveredAt: null, stuck: true }));
  expect(offered(el)).toEqual(["Bar", "Terrace"]);
  expect(combobox(el)!.value).toBe("");
  expect(el.shadowRoot!.querySelector("[data-test=reprint-stuck]")!.textContent!.trim()).toBe(
    fill("printers.reprint_stuck", { printer: "Kitchen" }),
  );
  expect(reprint(el).disabled).toBe(true);
});

it("sends the chosen printer once while the request is on its way, then says where it went", async () => {
  let finish!: (value: { jobId: string }) => void;
  const resendPrintJob = vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const { el } = await mount(job(), { resendPrintJob });
  const reprinted = vi.fn();
  el.addEventListener("reprinted", reprinted);
  await chooseOption(combobox(el)!, "p2");
  reprint(el).click();
  reprint(el).click();
  await el.updateComplete;
  expect(resendPrintJob).toHaveBeenCalledExactlyOnceWith("j1", "p2");
  expect(reprinted).not.toHaveBeenCalled();
  finish({ jobId: "resent" });
  await vi.waitFor(() => expect(reprinted).toHaveBeenCalledOnce());
  expect((reprinted.mock.calls[0]![0] as CustomEvent).detail).toEqual({ printerName: "Terrace" });
});

it("shows a refusal at the bottom and leaves Reprint usable", async () => {
  const { el } = await mount(job(), {
    resendPrintJob: vi.fn().mockRejectedValue({ code: "print_job.printer_unsuitable" }),
  });
  const reprinted = vi.fn();
  el.addEventListener("reprinted", reprinted);
  reprint(el).click();
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await vi.waitFor(async () =>
    expect(await dialogMessageOf(dialog)).toBe(codeMessage("print_job.printer_unsuitable")),
  );
  expect(reprint(el).disabled).toBe(false);
  expect(reprint(el).loading).toBe(false);
  expect(reprinted).not.toHaveBeenCalled();
});

it("asks to close on Cancel", async () => {
  const { el } = await mount(job());
  const closed = vi.fn();
  el.addEventListener("reprint-close", closed);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=reprint-cancel]")!.click();
  await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
});
