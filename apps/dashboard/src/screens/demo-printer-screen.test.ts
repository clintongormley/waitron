import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { DemoPrinterScreen } from "./demo-printer-screen.js";
import { setLocale } from "../i18n/t.js";
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
