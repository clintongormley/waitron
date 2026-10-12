import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { PagePrinterRow } from "../api/client.js";
import { fill, t } from "../i18n/t.js";
import type { PagePrintersPanel } from "./page-printers-panel.js";
import "./page-printers-panel.js";

afterEach(async () => {
  cleanupWidgets();
  await page.viewport(1280, 900);
});

const row = (over: Partial<PagePrinterRow> = {}): PagePrinterRow => ({
  id: "pp1",
  name: "Office",
  host: "10.0.0.56",
  port: 631,
  resourcePath: "/ipp/print",
  documentFormat: "application/pdf",
  supportedFormats: ["application/pdf"],
  media: "iso_a4_210x297mm",
  resolutionDpi: 300,
  active: true,
  invoicePrinter: true,
  agentId: "a1",
  agentName: "Cocina agent",
  ...over,
});
const ROWS = [
  row(),
  row({ id: "pp2", name: "Back office", host: "10.0.0.57", invoicePrinter: false }),
  row({ id: "pp3", name: "Old laser", active: false, invoicePrinter: false, agentName: null }),
];

const states = [
  "populated",
  "without printer.manage",
  "choice staged",
  "choice refused",
  "disabled the chosen printer",
  "re-read failed",
  "rename open",
  "rename refused blank",
  "rename refused by the server",
  "menu open at phone width",
  "test page printing",
  "test page held",
  "test page printed",
  "test page failed",
] as const;
type State = (typeof states)[number];

async function settle(el: PagePrintersPanel): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}
function deepQuery(root: ShadowRoot | HTMLElement, sel: string): HTMLElement | null {
  const found = root.querySelector<HTMLElement>(sel);
  if (found) return found;
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.shadowRoot) {
      const nested = deepQuery(node.shadowRoot, sel);
      if (nested) return nested;
    }
  }
  return null;
}

describe.each(["light", "dark"] as const)("page printers panel (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state: State) => {
    if (state.includes("at phone width")) await page.viewport(390, 900);
    const api = {
      updatePagePrinter:
        state === "rename refused by the server"
          ? vi.fn().mockRejectedValue({ code: "page_printer.not_found" })
          : vi.fn().mockResolvedValue(undefined),
      setInvoicePrinter:
        state === "choice refused"
          ? vi.fn().mockRejectedValue({ code: "page_printer.not_found" })
          : vi.fn().mockResolvedValue(undefined),
      printPagePrinterTestPage: vi.fn().mockResolvedValue({ id: "tp1", status: "waiting" }),
      background: {
        readPagePrinterTestPage: vi.fn().mockResolvedValue(
          {
            "test page printing": { id: "tp1", status: "printing" },
            "test page held": { id: "tp1", status: "printing", hold: "output_full" },
            "test page printed": { id: "tp1", status: "sent" },
            "test page failed": { id: "tp1", status: "failed", failureCode: "printer_unreachable" },
          }[state as string] ?? null,
        ),
      },
    };
    const reload =
      state === "re-read failed"
        ? vi.fn().mockRejectedValue({ code: "connection.failed" })
        : vi.fn().mockResolvedValue(undefined);
    const { el, host } = await mountWidget<PagePrintersPanel>(
      "dashboard-page-printers-panel",
      {
        api,
        rows: ROWS,
        canManage: state !== "without printer.manage",
        reload,
        testPagePollMs: 1,
      } as Partial<PagePrintersPanel>,
      theme,
    );
    await settle(el);
    const q = (selector: string) => deepQuery(el.shadowRoot!, selector)!;
    if (state.startsWith("choice") || state === "re-read failed") {
      await chooseOption(q("[data-test=invoice-printer-choice]"), "pp2");
      await settle(el);
    }
    if (state === "choice refused" || state === "re-read failed") {
      q("[data-test=save-invoice-printer]").click();
      await vi.waitFor(() =>
        expect(
          deepQuery(
            el.shadowRoot!,
            state === "re-read failed"
              ? "[data-test=page-printers-read-error]"
              : "[data-test=invoice-printer-actions]",
          ),
        ).not.toBeNull(),
      );
      await settle(el);
    }
    if (state === "disabled the chosen printer") {
      q("[data-test=disable-page-printer-pp1]").click();
      await vi.waitFor(() =>
        expect(deepQuery(el.shadowRoot!, "[data-test=invoice-printer-cleared]")).not.toBeNull(),
      );
    }
    if (state.startsWith("rename")) {
      q("[data-test=rename-page-printer-pp2]").click();
      await settle(el);
    }
    if (state === "rename refused blank" || state === "rename refused by the server") {
      const input = q(
        "[data-test=rename-page-printer-modal] wt-input[name=name]",
      ).shadowRoot!.querySelector("input")!;
      await userEvent.fill(
        page.elementLocator(input),
        state === "rename refused blank" ? " " : "Upstairs",
      );
      await settle(el);
      q("[data-test=confirm-rename-page-printer]").click();
      await vi.waitFor(() =>
        expect(
          (q("[data-test=rename-page-printer-actions]") as HTMLElement & { error: string }).error,
        ).not.toBe(""),
      );
      await settle(el);
    }
    if (state.startsWith("test page")) {
      q("[data-test=print-test-page-pp2]").click();
      await vi.waitFor(() =>
        expect(
          deepQuery(el.shadowRoot!, "[data-test=page-printer-test-page-pp2]")?.textContent,
        ).not.toBe(t("printers.test_page_waiting")),
      );
      if (state === "test page held")
        await vi.waitFor(() =>
          expect(
            deepQuery(el.shadowRoot!, "[data-test=page-printer-test-page-pp2]")?.textContent,
          ).toBe(
            fill("printers.test_page_held", { reason: t("printers.test_page_hold_output_full") }),
          ),
        );
      await settle(el);
    }
    if (state === "menu open at phone width") {
      (q("dashboard-row-actions") as unknown as WtRowActions).show();
      await settle(el);
    }
    await expectNoA11yViolations(host);
  });
});
