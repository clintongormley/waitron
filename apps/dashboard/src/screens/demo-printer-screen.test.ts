import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { DemoPrinterScreen } from "./demo-printer-screen.js";
import { setLocale } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
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
