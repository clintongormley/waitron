import type { PagePrinterRow, Printer } from "../api/client.js";
import { deep, mountReceiptApp } from "./department-receipt-app-fixture.js";
export const receiptPrinter: Printer = {
  id: "p1",
  name: "Kitchen",
  transport: "network_tcp",
  host: "10.0.0.9",
  port: 9100,
  localKey: null,
  pollId: null,
  paperWidth: "80mm",
  resolution: "180dpi",
  hasCashDrawer: false,
  portable: false,
  pickupRoles: ["receipt", "payment_slip"],
  holder: null,
  pendingJobs: 0,
  lastPrintAt: null,
  lastPrintAgentId: null,
  active: true,
};
export const officePrinter: PagePrinterRow = {
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
  agentId: "a1",
  agentName: "Kitchen agent",
};
export function mountPrinterApp(
  options: Parameters<typeof mountReceiptApp>[0] & {
    printers?: Printer[];
    pagePrinters?: PagePrinterRow[];
  } = {},
) {
  return mountReceiptApp({
    path: "/printers/view/printers",
    permissions: ["venue.view", "hardware.manage"],
    modules: [],
    ...options,
    respond(path, init) {
      const custom = options.respond?.(path, init);
      if (custom) return custom;
      const lists: Record<string, unknown> = {
        "/management-api/printers": options.printers ?? [receiptPrinter],
        "/management-api/page-printers": options.pagePrinters ?? [],
        "/management-api/pairing-mode": {
          open: false,
          openUntil: null,
          deviceAddress: "https://waitron.local",
          timeZone: "UTC",
        },
        "/management-api/print-agents": [],
        "/management-api/printer-profiles": [],
        "/management-api/printer-stations": [],
        "/management-api/print-jobs": [],
        "/management-api/discovered-printers": [],
        "/management-api/join-requests?kind=print_agent": [],
      };
      return path in lists
        ? Promise.resolve(
            new Response(JSON.stringify(lists[path]), {
              headers: { "content-type": "application/json" },
            }),
          )
        : undefined;
    },
  });
}
export const printerScreen = (app: Awaited<ReturnType<typeof mountPrinterApp>>["app"]) =>
  deep(
    app.shadowRoot!,
    "dashboard-printers-screen",
  ) as HTMLElementTagNameMap["dashboard-printers-screen"];
