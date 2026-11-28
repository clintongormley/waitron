import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { DemoPrinterScreen } from "./demo-printer-screen.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { PrintPaper } from "../widgets/print-paper.js";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupWidgets();
  setLocale("es-ES");
});

it("releases paper renderers when jobs leave the recent list", async () => {
  const preview = {
    widthDots: 512,
    columns: 42,
    text: "Receipt\n",
    blocks: [{ kind: "text" as const, text: "Receipt\n" }],
    qrData: [],
    omittedGraphics: false,
    truncated: false,
    unsupported: false,
  };
  const job = { id: "old", kind: "document", createdAt: "2026-10-03T12:00:00.000Z", preview };
  const listDemoPrinterJobs = vi
    .fn()
    .mockResolvedValueOnce([job])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([job]);
  const instances: PrintPaper[] = [];
  const originalRender = PrintPaper.prototype.render;
  vi.spyOn(PrintPaper.prototype, "render").mockImplementation(function (this: PrintPaper, ...args) {
    instances.push(this);
    return originalRender.apply(this, args);
  });
  const { el } = await mountWidget<DemoPrinterScreen>("dashboard-demo-printer-screen", {
    api: { listDemoPrinterJobs } as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(instances.length).toBeGreaterThan(0));
  const first = instances[0];
  const refresh = el.shadowRoot!.querySelector("wt-button")!;
  refresh.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelectorAll("[data-test=printed-job]")).toHaveLength(0),
  );
  refresh.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelectorAll("[data-test=printed-job]")).toHaveLength(1),
  );
  expect(instances.at(-1)).not.toBe(first);
});

it("shows printed paper and a separate drawer opening, newest first", async () => {
  setLocale("en-GB");
  const api = {
    listDemoPrinterJobs: vi.fn().mockResolvedValue([
      { id: "drawer", kind: "drawer", createdAt: "2026-10-03T12:01:00.000Z", preview: null },
      {
        id: "ticket",
        kind: "document",
        createdAt: "2026-10-03T12:00:00.000Z",
        preview: {
          widthDots: 512,
          columns: 42,
          text: "Kitchen ticket\n",
          blocks: [{ kind: "text", text: "Kitchen ticket\n" }],
          qrData: [],
          omittedGraphics: false,
          truncated: false,
          unsupported: false,
        },
      },
    ]),
  } as unknown as DashboardApi;
  const { el, host } = await mountWidget<DemoPrinterScreen>("dashboard-demo-printer-screen", {
    api,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelectorAll("[data-test=printed-job]")).toHaveLength(2),
  );
  const entries = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=printed-job]")];
  expect(entries[0]?.textContent).toContain("drawer opened");
  expect(entries[1]?.querySelector(".paper")?.textContent).toContain("Kitchen ticket");
  host.style.width = "1000px";
  expect(entries[1]!.getBoundingClientRect().width).toBeLessThan(500);
});

const documentJob = (id: string, text: string | null) => ({
  id,
  kind: "document",
  createdAt: "2026-10-03T12:00:00.000Z",
  preview:
    text === null
      ? null
      : {
          widthDots: 512,
          columns: 42,
          text,
          blocks: [{ kind: "text" as const, text }],
          qrData: [],
          omittedGraphics: false,
          truncated: false,
          unsupported: false,
        },
});

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ready, fail) => {
    resolve = ready;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const printed = (el: DemoPrinterScreen) =>
  el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=printed-job]");
const alertOf = (el: DemoPrinterScreen) => el.shadowRoot!.querySelector('[role="alert"]');

it("shows why the printed jobs could not be read, and clears it once a refresh reads them", async () => {
  setLocale("en-GB");
  const listDemoPrinterJobs = vi
    .fn()
    .mockRejectedValueOnce({ code: "connection.failed" })
    .mockResolvedValueOnce([documentJob("ticket", "Kitchen ticket\n")]);
  const { el } = await mountWidget<DemoPrinterScreen>("dashboard-demo-printer-screen", {
    api: { listDemoPrinterJobs } as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(alertOf(el)?.textContent).toBe(codeMessage("connection.failed")));
  el.shadowRoot!.querySelector("wt-button")!.click();
  await vi.waitFor(() => expect(printed(el)).toHaveLength(1));
  expect(alertOf(el)).toBeNull();
});

it("reads through the background client when the API has one", async () => {
  const foreground = vi.fn().mockResolvedValue([]);
  const background = vi.fn().mockResolvedValue([documentJob("ticket", "Kitchen ticket\n")]);
  const { el } = await mountWidget<DemoPrinterScreen>("dashboard-demo-printer-screen", {
    api: {
      listDemoPrinterJobs: foreground,
      background: { listDemoPrinterJobs: background },
    } as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(printed(el)).toHaveLength(1));
  expect(background).toHaveBeenCalledOnce();
  expect(foreground).not.toHaveBeenCalled();
});

it("sends no second read while one is still on its way", async () => {
  const first = gate<unknown[]>();
  const listDemoPrinterJobs = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue([documentJob("later", "Later\n")]);
  const { el } = await mountWidget<DemoPrinterScreen>("dashboard-demo-printer-screen", {
    api: { listDemoPrinterJobs } as unknown as DashboardApi,
  });
  el.shadowRoot!.querySelector("wt-button")!.click();
  expect(listDemoPrinterJobs).toHaveBeenCalledOnce();
  first.resolve([documentJob("ticket", "Kitchen ticket\n")]);
  await vi.waitFor(() => expect(printed(el)).toHaveLength(1));
  el.shadowRoot!.querySelector("wt-button")!.click();
  await vi.waitFor(() => expect(listDemoPrinterJobs).toHaveBeenCalledTimes(2));
});

it("draws nothing from a read that ends after the screen was removed", async () => {
  const read = gate<unknown[]>();
  const failed = gate<unknown[]>();
  const listDemoPrinterJobs = vi
    .fn()
    .mockReturnValueOnce(read.promise)
    .mockReturnValueOnce(failed.promise);
  const { el } = await mountWidget<DemoPrinterScreen>("dashboard-demo-printer-screen", {
    api: { listDemoPrinterJobs } as unknown as DashboardApi,
  });
  el.remove();
  read.resolve([documentJob("ticket", "Kitchen ticket\n")]);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  expect(printed(el)).toHaveLength(0);
  document.body.append(el);
  el.remove();
  failed.reject({ code: "connection.failed" });
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  expect(alertOf(el)).toBeNull();
});

it("keeps a document's paper across refreshes and shows a document with no preview as its time alone", async () => {
  const instances: PrintPaper[] = [];
  const originalRender = PrintPaper.prototype.render;
  vi.spyOn(PrintPaper.prototype, "render").mockImplementation(function (this: PrintPaper, ...args) {
    instances.push(this);
    return originalRender.apply(this, args);
  });
  const ticket = documentJob("ticket", "Kitchen ticket\n");
  const listDemoPrinterJobs = vi
    .fn()
    .mockResolvedValueOnce([ticket])
    .mockResolvedValueOnce([ticket, documentJob("blank", null)]);
  const { el } = await mountWidget<DemoPrinterScreen>("dashboard-demo-printer-screen", {
    api: { listDemoPrinterJobs } as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(printed(el)).toHaveLength(1));
  const first = instances.at(-1);
  el.shadowRoot!.querySelector("wt-button")!.click();
  await vi.waitFor(() => expect(printed(el)).toHaveLength(2));
  expect(instances.at(-1)).toBe(first);
  const blank = printed(el)[1]!;
  expect(blank.querySelector("time")).not.toBeNull();
  expect(blank.querySelector('[role="region"]')).toBeNull();
});

it("reads again every two seconds until the screen is removed", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const first = gate<unknown[]>();
    const listDemoPrinterJobs = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([]);
    const { el } = await mountWidget<DemoPrinterScreen>("dashboard-demo-printer-screen", {
      api: { listDemoPrinterJobs } as unknown as DashboardApi,
    });
    expect(listDemoPrinterJobs).toHaveBeenCalledOnce();
    first.resolve([]);
    await first.promise;
    await el.updateComplete;
    vi.advanceTimersByTime(2_000);
    await vi.waitFor(() => expect(listDemoPrinterJobs).toHaveBeenCalledTimes(2));
    el.remove();
    vi.advanceTimersByTime(6_000);
    expect(listDemoPrinterJobs).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
