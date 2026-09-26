import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { jobStatusName, transportName } from "../i18n/domain.js";
import type {
  DashboardApi,
  DiscoveredPrinter,
  JoinRequestRow,
  PrintAgentRow,
  PrintJobRow,
  Printer,
  Till,
} from "../api/client.js";
import { PrintersScreen, SCAN_LISTEN_MS, SCAN_POLL_MS } from "./printers-screen.js";
import { LiveData } from "@waitron/dashboard-kit";

beforeEach(() => sessionStorage.removeItem("printers:table"));
afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

const agents: PrintAgentRow[] = [
  {
    id: "a1",
    name: "Cocina agent",
    active: true,
    host: null,
    nodeId: null, // manually enrolled — no provenance marker
    lastSeenAt: "2026-08-25T14:30:00.000Z",
    setupUrl: null,
    enrolledAt: "2026-08-20T09:00:00.000Z",
  },
  {
    id: "a2",
    name: "Barra agent",
    active: false,
    host: null,
    nodeId: "n1", // self-enrolled on a node, then revoked — marker + allow-again
    lastSeenAt: null,
    setupUrl: null,
    enrolledAt: "2026-08-19T09:00:00.000Z",
  },
];

const printers: Printer[] = [
  {
    id: "p1",
    name: "Cocina",
    transport: "network_tcp",
    host: "10.0.0.9",
    port: 9100,
    localKey: null,
    pollId: null,
    ticketScope: "station",
    paperWidth: "80mm",
    resolution: "180dpi",
    characterSet: "wpc1252",
    characterTable: 16,
    hasCashDrawer: false,
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    active: true,
  },
  {
    id: "p2",
    name: "Nube",
    transport: "cloud_poll",
    host: null,
    port: null,
    localKey: null,
    pollId: "poll-1",
    ticketScope: "station",
    paperWidth: "80mm",
    resolution: "180dpi",
    characterSet: "wpc1252",
    characterTable: 16,
    hasCashDrawer: false,
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    active: false,
  },
  {
    id: "p3",
    name: "Barra USB",
    transport: "usb",
    host: null,
    port: null,
    localKey: "SN-2",
    pollId: null,
    ticketScope: "station",
    paperWidth: "80mm",
    resolution: "180dpi",
    characterSet: "wpc1252",
    characterTable: 16,
    hasCashDrawer: false,
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    active: false,
  },
];

// One unregistered USB device, and one already registered, whose seen-status shows on p3's row.
const discovered: DiscoveredPrinter[] = [
  {
    agentId: "a1",
    agentName: "Cocina agent",
    transport: "usb",
    localKey: "SN-1",
    make: "Epson",
    model: "TM-T20",
    name: "EPSON TM-T20",
    alreadyRegistered: false,
    printerId: null,
    lastSeenAt: "2023-11-14T22:13:20.000Z",
  },
  {
    agentId: "a1",
    agentName: "Cocina agent",
    transport: "usb",
    localKey: "SN-2",
    make: "Star",
    model: "TSP143",
    name: null,
    alreadyRegistered: true,
    printerId: "p3",
    lastSeenAt: "2023-11-14T22:13:20.000Z",
  },
];

const discoveredNetwork: DiscoveredPrinter[] = [
  {
    agentId: "a1",
    agentName: "Cocina agent",
    transport: "network_tcp",
    host: "10.0.0.77",
    port: 9100,
    make: "Epson",
    model: "TM-m30",
    name: "Kitchen IP",
    alreadyRegistered: false,
    printerId: null,
    lastSeenAt: "2023-11-14T22:13:20.000Z",
  },
];

// A Scan result that is the registered printer p1: hidden from the results, and reported as seen on
// p1's row.
const discoveredRegisteredNetwork: DiscoveredPrinter[] = [
  {
    agentId: "a1",
    agentName: "Cocina agent",
    transport: "network_tcp",
    host: "10.0.0.5",
    port: 9100,
    name: "Counter",
    alreadyRegistered: true,
    printerId: "p1",
    lastSeenAt: "2023-11-14T22:13:20.000Z",
  },
];

const jobs: PrintJobRow[] = [
  {
    id: "j1",
    printerId: "p1",
    status: "failed",
    canResend: false,
    attempts: 2,
    lastError: "printer offline",
    createdAt: "2026-08-25T14:00:00.000Z",
    deliveredAt: null,
  },
  {
    id: "j2",
    printerId: "p1",
    status: "done",
    canResend: true,
    attempts: 1,
    lastError: null,
    createdAt: "2026-08-25T13:00:00.000Z",
    deliveredAt: "2026-08-25T13:00:05.000Z",
  },
];

const tills: Till[] = [
  { id: "t1", label: "Caja 1", locationId: "loc-1", receiptPrinterId: "p1" },
  { id: "t2", label: "Caja 2", locationId: "loc-1", receiptPrinterId: null },
];

const pending: JoinRequestRow[] = [
  { id: "j1", kind: "print_agent", label: "kitchen-pi", createdAt: "2026-09-08T10:02:00.000Z" },
];

/** The dashboard is never told which number is real; the test knows, so it can check the pending list
 * never shows it. */
const CHOICES = ["12", "47", "83"];
const REAL_NUMBER = "47";

const SHUT = { open: false, openUntil: null, refusedRecently: 0 };
const OPEN = { open: true, openUntil: "2026-09-08T10:20:00.000Z", refusedRecently: 0 };

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listAgents: vi.fn().mockResolvedValue(agents),
    listPrinters: vi.fn().mockResolvedValue(printers),
    listRecentJobs: vi.fn().mockResolvedValue(jobs),
    resendPrintJob: vi.fn().mockResolvedValue({ jobId: "resent" }),
    updateAgent: vi.fn().mockResolvedValue(undefined),
    getPrintJobPreview: vi.fn().mockResolvedValue({
      columns: 42,
      dpi: 180,
      text: "Receipt",
      qrData: [],
      blocks: [{ kind: "text", text: "Receipt" }],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    }),
    revokeAgent: vi.fn().mockResolvedValue(undefined),
    allowAgent: vi.fn().mockResolvedValue(undefined),
    pairingMode: vi.fn().mockResolvedValue(SHUT),
    openPairingMode: vi.fn().mockResolvedValue({ openUntil: OPEN.openUntil }),
    renewPairingMode: vi.fn().mockResolvedValue({ openUntil: OPEN.openUntil }),
    closePairingMode: vi.fn().mockResolvedValue(undefined),
    joinRequests: vi.fn().mockResolvedValue(pending),
    joinChallenge: vi.fn().mockResolvedValue({ choices: CHOICES }),
    denyJoinRequest: vi.fn().mockResolvedValue(undefined),
    acceptPrintAgentJoinRequest: vi.fn().mockResolvedValue(undefined),
    createPrinter: vi.fn().mockResolvedValue({ id: "p9" }),
    updatePrinter: vi.fn().mockResolvedValue(undefined),
    deactivatePrinter: vi.fn().mockResolvedValue(undefined),
    testPrinterDrawer: vi.fn().mockResolvedValue({ jobId: "drawer-test" }),
    testPrint: vi.fn().mockResolvedValue({ jobId: "j9" }),
    sampleReceipt: vi.fn().mockResolvedValue({ jobId: "j10" }),
    testCharacterTables: vi.fn().mockResolvedValue({ jobId: "j11", calibrationLocale: "es-ES" }),
    startPrinterDiscovery: vi.fn().mockResolvedValue({ discoveryUntil: Date.now() + 60_000 }),
    listDiscoveredPrinters: vi.fn().mockResolvedValue([] as DiscoveredPrinter[]),
    listTills: vi.fn().mockResolvedValue(tills),
    ...overrides,
  } as unknown as DashboardApi;
}

async function settleTree(root: ShadowRoot | HTMLElement): Promise<void> {
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if ("updateComplete" in node)
      await (node as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    if (node.shadowRoot) await settleTree(node.shadowRoot);
  }
}
async function flush(el: PrintersScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await settleTree(el.shadowRoot!);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
const q = (el: PrintersScreen, sel: string) => deepQuery(el.shadowRoot!, sel);
const text = (el: PrintersScreen, sel: string) => q(el, sel)?.textContent?.trim();
async function filterPrinters(el: PrintersScreen, value: string): Promise<void> {
  const select = q(el, '[name="status-filter"]') as HTMLSelectElement;
  select.value = value === "all" ? "" : value;
  select.dispatchEvent(new Event("change"));
  await flush(el);
}
async function selectTab(el: PrintersScreen, key: string): Promise<void> {
  q(el, "wt-tabs")!.shadowRoot!.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!.click();
  await flush(el);
}
async function openPrinter(el: PrintersScreen, id = "p1"): Promise<void> {
  await selectTab(el, "printers");
  if (!q(el, `[data-test="edit-printer-${id}"]`)) await filterPrinters(el, "all");
  q(el, `[data-test="edit-printer-${id}"]`)!.click();
  await flush(el);
}
async function openDiscovery(el: PrintersScreen): Promise<void> {
  await selectTab(el, "printers");
  q(el, "[data-test=open-add-printer]")!.click();
  await flush(el);
}

async function addDiscovered(el: PrintersScreen, button: HTMLElement): Promise<void> {
  if (!q(el, '[data-test="name-printer-modal"]')) {
    button.click();
    await flush(el);
  }
  q(el, '[data-test="confirm-add-printer"]')!.click();
}

function typeField(el: PrintersScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function toggleSwitch(el: PrintersScreen, sel: string, checked: boolean): void {
  const input = q(el, sel)!.shadowRoot!.querySelector("input")!;
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function chooseOption(el: PrintersScreen, name: string, value: string): Promise<void> {
  const select = q(el, `select[name="${name}"]`) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
  await flush(el);
}

describe("guided printer calibration", () => {
  it("offers matching codes before printing and saves a selected code", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el);
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    expect(q(el, 'option[value="11-W"]')?.textContent?.trim()).toBe("11-W");
    expect(q(el, '[data-test="finder-expected-W"]')).not.toBeNull();
    expect(q(el, '[data-test="finder-expected-8"]')).not.toBeNull();
    await chooseOption(el, "printer-matching-code", "11-W");
    for (let step = 1; step < 4; step++) {
      q(el, "[data-test=calibration-next]")!.click();
      await flush(el);
    }
    expect(q(el, "[data-test=calibration-step-4]")?.checkVisibility()).toBe(true);
    expect(q(el, "[data-test=calibration-step-3]")?.checkVisibility()).toBe(false);
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith("p1", { characterTable: 11 });
    expect(api.testCharacterTables).not.toHaveBeenCalled();
  });

  it.each([
    ["A", "203dpi", "58mm"],
    ["D", "180dpi", "80mm"],
  ])(
    "derives layout settings from the width and QR answers (%s)",
    async (line, resolution, paperWidth) => {
      const api = stubApi();
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await flush(el);
      await openPrinter(el);
      q(el, "[data-test=calibrate-printer]")!.click();
      await flush(el);
      q(el, "[data-test=calibration-next]")!.click();
      await flush(el);
      expect(q(el, 'select[name="printer-width-line"]')).not.toBeNull();
      await chooseOption(el, "printer-width-line", line!);
      await chooseOption(el, "printer-resolution", resolution!);
      q(el, "[data-test=calibration-next]")!.click();
      await flush(el);
      q(el, "[data-test=print-sample-receipt-p1]")!.click();
      await flush(el);
      expect(api.sampleReceipt).toHaveBeenCalledWith("p1", {
        paperWidth,
        resolution,
        characterSet: "wpc1252",
        characterTable: 16,
      });
    },
  );

  async function openStepFour(api: DashboardApi): Promise<PrintersScreen> {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el);
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    return el;
  }

  it("opens the drawer only on an explicit test and records the operator's observation", async () => {
    let complete!: () => void;
    const api = stubApi({
      testPrinterDrawer: vi.fn().mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = () => resolve({ jobId: "drawer-test" });
          }),
      ),
    });
    const el = await openStepFour(api);
    expect(q(el, "[data-test=test-printer-drawer]")).toBeNull();
    toggleSwitch(el, '[name="printer-cash-drawer"]', true);
    await flush(el);
    expect(api.testPrinterDrawer).not.toHaveBeenCalled();
    q(el, "[data-test=calibration-back]")!.click();
    await flush(el);
    q(el, "[data-test=print-sample-receipt-p1]")!.click();
    await flush(el);
    expect(api.testPrinterDrawer).not.toHaveBeenCalled();
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    const button = q(el, "[data-test=test-printer-drawer]")!;
    button.click();
    button.click();
    expect(api.testPrinterDrawer).toHaveBeenCalledExactlyOnceWith("p1");
    expect(q(el, '[name="printer-drawer-result"]')).toBeNull();
    complete();
    await flush(el);
    q(el, '[name="printer-drawer-result"][value="closed"]')!.click();
    await flush(el);
    expect(q(el, '[data-test="calibration-step-4"]')!.textContent).toContain(
      t("printers.drawer_check"),
    );
    q(el, '[name="printer-drawer-result"][value="opened"]')!.click();
    await flush(el);
    expect(q(el, '[data-test="calibration-step-4"]')!.textContent).not.toContain(
      t("printers.drawer_check"),
    );
    q(el, "[data-test=calibration-back]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    expect(q(el, '[name="printer-cash-drawer"]')!.shadowRoot!.querySelector("input")!.checked).toBe(
      true,
    );
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p1", { hasCashDrawer: true });
  });

  it("shows a drawer test refusal and allows attachment to be turned off", async () => {
    const api = stubApi({
      listPrinters: vi.fn().mockResolvedValue([{ ...printers[0]!, hasCashDrawer: true }]),
      testPrinterDrawer: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });
    const el = await openStepFour(api);
    q(el, "[data-test=test-printer-drawer]")!.click();
    await flush(el);
    expect(text(el, "[data-test=edit-printer-modal] [role=alert]")).toBe(
      codeMessage("printer.not_found"),
    );
    expect(q(el, '[name="printer-drawer-result"]')).toBeNull();
    toggleSwitch(el, '[name="printer-cash-drawer"]', false);
    await flush(el);
    expect(q(el, "[data-test=test-printer-drawer]")).toBeNull();
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p1", { hasCashDrawer: false });
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a drawer test that finishes after calibration closes (%s)",
    async (outcome) => {
      let resolve!: (value: { jobId: string }) => void;
      let reject!: (error: unknown) => void;
      const api = stubApi({
        listPrinters: vi.fn().mockResolvedValue([{ ...printers[0]!, hasCashDrawer: true }]),
        testPrinterDrawer: vi.fn().mockReturnValue(
          new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          }),
        ),
      });
      const el = await openStepFour(api);
      q(el, "[data-test=test-printer-drawer]")!.click();
      await flush(el);
      q(el, "[data-test=cancel-edit-printer]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=edit-printer-modal]")).toBeNull());
      await openPrinter(el);
      if (outcome === "resolve") resolve({ jobId: "late" });
      else reject({ code: "printer.not_found" });
      await flush(el);
      expect(q(el, '[name="printer-drawer-result"]')).toBeNull();
      expect(q(el, "[data-test=edit-printer-modal] [role=alert]")).toBeNull();
    },
  );

  it("does not write unchanged calibration settings", async () => {
    const api = stubApi();
    const el = await openStepFour(api);
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).not.toHaveBeenCalled();
    expect(q(el, "[data-test=edit-printer-modal]")).toBeNull();
  });

  it("preserves connection edits when finishing calibration from the editor", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el);
    typeField(el, "[data-test=printer-name-p1]", "Updated kitchen");
    typeField(el, "[data-test=printer-host-p1]", "10.0.0.88");
    typeField(el, "[data-test=printer-port-p1]", "9101");
    toggleSwitch(el, "[data-test=printer-active-p1]", false);
    await flush(el);
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p1", {
      name: "Updated kitchen",
      host: "10.0.0.88",
      port: 9101,
      active: false,
    });
  });

  it.each(["https://agent.local:9110/", "http://192.168.10.81:9110/"])(
    "links the agent host to its reported setup page %s",
    async (setupUrl) => {
      const api = stubApi({
        listAgents: vi.fn().mockResolvedValue([{ ...agents[0]!, host: "Kitchen box", setupUrl }]),
      });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await flush(el);
      const link = q(el, 'a[target="_blank"]') as HTMLAnchorElement;
      expect(link.href).toBe(setupUrl);
      expect(link.textContent).toBe("Kitchen box");
      expect(link.rel).toBe("noopener noreferrer");
    },
  );

  it("renders unsupported agent URLs as plain host text", async () => {
    const api = stubApi({
      listAgents: vi
        .fn()
        .mockResolvedValue([
          { ...agents[0]!, host: "Kitchen box", setupUrl: "javascript:alert(1)" },
        ]),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    expect(q(el, 'a[target="_blank"]')).toBeNull();
    expect(q(el, '[data-test="agents-table"]')!.shadowRoot!.textContent).toContain("Kitchen box");
  });

  it("opens calibration after adding, retains printed blocks, and saves the tested draft", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    await addDiscovered(el, q(el, "[data-test=register-SN-1]")!);
    await flush(el);
    await vi.waitFor(() =>
      expect(q(el, "[data-test=calibration-step-1]")?.checkVisibility()).toBe(true),
    );
    expect(q(el, "[data-test=new-printer-modal]")).toBeNull();
    q(el, "[data-test=print-character-tables-p9]")!.click();
    await flush(el);
    await chooseOption(el, "printer-table-block", "16");
    q(el, "[data-test=print-character-tables-p9]")!.click();
    await flush(el);
    await chooseOption(el, "printer-table-block", "0");
    expect(q(el, 'option[value="06-8"]')).not.toBeNull();
    expect(api.testCharacterTables).toHaveBeenCalledTimes(2);
    await chooseOption(el, "printer-matching-code", "06-8");
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    expect(q(el, "[data-test=calibration-step-2]")?.checkVisibility()).toBe(true);
    await chooseOption(el, "printer-paper-width", "58mm");
    await chooseOption(el, "printer-resolution", "203dpi");
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    expect(q(el, "[data-test=calibration-step-3]")?.checkVisibility()).toBe(true);
    q(el, "[data-test=print-sample-receipt-p9]")!.click();
    await flush(el);
    expect(api.sampleReceipt).toHaveBeenCalledWith("p9", {
      paperWidth: "58mm",
      resolution: "203dpi",
      characterSet: "pc858",
      characterTable: 6,
    });
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    toggleSwitch(el, '[name="printer-cash-drawer"]', true);
    await flush(el);
    expect(api.updatePrinter).not.toHaveBeenCalled();
    q(el, "[data-test=save-printer-p9]")!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith("p9", {
      paperWidth: "58mm",
      resolution: "203dpi",
      characterSet: "pc858",
      characterTable: 6,
      hasCashDrawer: true,
    });
  });

  it("always offers a remembered status filter, even when every printer is active", async () => {
    const api = stubApi({ listPrinters: vi.fn().mockResolvedValue([printers[0]]) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    const select = q(el, '[name="status-filter"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe("active");
    await chooseOption(el, "status-filter", "disabled");
    expect(q(el, '[data-test="printer-row-p1"]')).toBeNull();
    expect(sessionStorage.getItem("printers:table")).toContain("disabled");
  });
});

describe("printer configuration tabs", () => {
  it.each([
    [[], [], "agents"],
    [[{ ...agents[0]!, active: false }], printers, "agents"],
    [agents, [], "printers"],
    [agents, printers.map((p) => ({ ...p, active: false })), "printers"],
    [agents, printers, "queue"],
  ])("selects the useful first tab for setup %#", async (agentRows, printerRows, selected) => {
    const api = stubApi({
      listAgents: vi.fn().mockResolvedValue(agentRows),
      listPrinters: vi.fn().mockResolvedValue(printerRows),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    const tabs = q(el, "wt-tabs");
    expect(tabs).toBeTruthy();
    expect(
      tabs!.shadowRoot!.querySelector('[aria-selected="true"]')?.getAttribute("data-key"),
    ).toBe(selected);
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe(t("printers.title"));
    expect(t("printers.title", "en-GB")).toBe("Printer configuration");
  });

  it("keeps the selected tab after a live update and hides the other panels", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    const tabs = q(el, "wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="printers"]')!.click();
    await flush(el);
    expect(q(el, "[data-test=open-add-printer]")!.checkVisibility()).toBe(true);
    expect(q(el, "[data-test=open-add-agent]")!.checkVisibility()).toBe(false);
    vi.mocked(api.listPrinters).mockResolvedValue([]);
    liveData.invalidate([{ type: "printers", id: "p1" }]);
    await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(tabs.shadowRoot!.querySelector('[aria-selected="true"]')?.getAttribute("data-key")).toBe(
      "printers",
    );
  });

  it("opens pairing automatically and closes it with the agent modal", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    expect(api.openPairingMode).toHaveBeenCalledOnce();
    expect(q(el, "[data-test=pairing-open]")).toBeNull();
    expect(q(el, "[data-test=refresh-joins]")).toBeNull();
    expect(
      q(el, "[data-test=scan-agents]")!
        .shadowRoot!.querySelector("button")!
        .getAttribute("aria-busy"),
    ).toBe("true");
    q(el, "[data-test=cancel-new-agent]")!.click();
    await flush(el);
    expect(api.closePairingMode).toHaveBeenCalledOnce();
  });

  it("offers one printer scan action without a redundant refresh", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(),
    });
    await flush(el);
    await openDiscovery(el);
    expect(q(el, "[data-test=scan-printers]")).toBeTruthy();
    expect(q(el, "[data-test=refresh-discovered]")).toBeNull();
  });
});

describe("printers-screen", () => {
  it("updates a printer and its recent jobs after a data event while preserving an editing draft", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el);
    typeField(el, "[data-test=printer-name-p1]", "Unsaved name");
    vi.mocked(api.listPrinters).mockResolvedValue(
      printers.map((printer) =>
        printer.id === "p1"
          ? { ...printer, pendingJobs: 7, lastPrintAt: "2026-09-11T12:34:00.000Z" }
          : printer,
      ),
    );
    vi.mocked(api.listRecentJobs).mockResolvedValue([]);

    liveData.invalidate([
      { type: "printers", id: "p1" },
      { type: "print_jobs", id: "j1" },
    ]);
    await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
    await flush(el);
    const row = q(el, "[data-test=printer-row-p1]")!.closest("tr")!;
    expect(
      row.querySelector('[data-column="pending"]')?.textContent?.trim() ?? row.textContent,
    ).toContain("7");
    expect(row.textContent).toContain("2026");
    expect(q(el, "[data-test=job-row-j1]")).toBeNull();
    expect((q(el, "[data-test=printer-name-p1]") as import("@waitron/ui").WtInput).value).toBe(
      "Unsaved name",
    );
    expect(api.listTills).toHaveBeenCalledTimes(1);
  });
  it("loads agents, printers and jobs on connect and renders a row for each", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(api.listAgents).toHaveBeenCalledTimes(1);
    expect(api.listPrinters).toHaveBeenCalledTimes(1);
    expect(api.listRecentJobs).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=agent-row-a1]")).toBeTruthy();
    expect(q(el, "[data-test=agent-row-a2]")).toBeTruthy();
    expect(q(el, "[data-test=printer-row-p1]")).toBeTruthy();
    expect(q(el, "[data-test=printer-row-p2]")).toBeNull();
    expect(q(el, "[data-test=job-row-j1]")).toBeTruthy();
    expect(q(el, "[data-test=job-row-j2]")).toBeTruthy();
  });

  it("renders agent name, active status and formatted last-seen (and Never for a never-seen agent)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=agent-name-a1]")).toBe("Cocina agent");
    expect(text(el, "[data-test=agent-status-a1]")).toBe(t("printers.status_active", "es-ES"));
    expect(text(el, "[data-test=agent-last-seen-a1]")).toBe("2026-08-25 14:30");
    // A revoked, never-authenticated agent.
    expect(text(el, "[data-test=agent-status-a2]")).toBe(t("printers.status_revoked", "es-ES"));
    expect(text(el, "[data-test=agent-last-seen-a2]")).toBe(t("printers.last_seen_never", "es-ES"));
  });

  it("renders each printer's transport and derived connection mode", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await filterPrinters(el, "all");
    expect(text(el, "[data-test=printer-agent-p1]")).toBe("Sin observaciones recientes");
    expect(text(el, "[data-test=printer-agent-p2]")).toBe("—");
    q(el, "[data-test=printer-row-p1]")!.click();
    await flush(el);
    expect(text(el, "[data-test=printer-transport-p1]")).toBe(
      transportName("network_tcp", "es-ES"),
    );
    expect(text(el, "[data-test=printer-connection-p1]")).toBe("Cualquier agente del local");
    q(el, "[data-test=back-to-printers]")!.click();
    await flush(el);
    q(el, "[data-test=printer-row-p2]")!.click();
    await flush(el);
    expect(text(el, "[data-test=printer-transport-p2]")).toBe(transportName("cloud_poll", "es-ES"));
    expect(text(el, "[data-test=printer-connection-p2]")).toBe("Directa (sin agente)");
    q(el, "[data-test=back-to-printers]")!.click();
    await flush(el);
    q(el, "[data-test=printer-row-p3]")!.click();
    await flush(el);
    expect(text(el, "[data-test=printer-connection-p3]")).toBe("Puede cambiar de agente");
  });

  it("renders each job's status, attempts, resolved printer and last error", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=job-status-j1]")).toBe(jobStatusName("failed", "es-ES"));
    expect(text(el, "[data-test=job-attempts-j1]")).toContain("2");
    expect(text(el, "[data-test=job-printer-j1]")).toBe("Cocina"); // resolved from the printer list
    expect(text(el, "[data-test=job-error-j1]")).toBe("printer offline");
    expect(q(el, "[data-test=job-error-j2]")).toBeNull();
  });

  it("shows the empty placeholders when there are no agents, printers or jobs", async () => {
    const api = stubApi({
      listAgents: vi.fn().mockResolvedValue([]),
      listPrinters: vi.fn().mockResolvedValue([]),
      listRecentJobs: vi.fn().mockResolvedValue([]),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(
      (q(el, "[data-test=agents-table]") as import("@waitron/ui").WtDataTable).emptyMessage,
    ).toBe(t("printers.no_agents", "es-ES"));
    expect(q(el, "[data-test=printers-table]")).toBeTruthy();
    expect(
      (q(el, "[data-test=jobs-table]") as import("@waitron/ui").WtDataTable).emptyMessage,
    ).toBe(t("printers.no_jobs", "es-ES"));
  });

  it("shows a localised error banner when the initial load is rejected (and never rejects)", async () => {
    const api = stubApi({ listPrinters: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("server.internal", "es-ES"));
    expect(banner).not.toContain("server.internal");
  });

  // ── Agents: the pairing window ───────────────────────────────────────────────────────────────────

  it("loads the pairing window and the print-agent join queue on connect", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(api.pairingMode).toHaveBeenCalledTimes(1);
    expect(api.joinRequests).toHaveBeenCalledWith("print_agent");
  });

  it("opens the window automatically and shows when it lapses", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    expect(api.openPairingMode).toHaveBeenCalledOnce();
    expect(text(el, "[data-test=pairing-until]")).toBe(
      t("printers.pairing_open_until", "es-ES").replace("{time}", "2026-09-08 10:20"),
    );
    expect(q(el, "[data-test=pairing-open]")).toBeNull();
    expect(q(el, "[data-test=pairing-extend]")).toBeNull();
    expect(q(el, "[data-test=pairing-close]")).toBeNull();
  });

  it("shows an error banner when opening the window is rejected", async () => {
    const api = stubApi({
      openPairingMode: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "authorization.not_permitted",
    );
  });

  // ── Agents: the join queue ───────────────────────────────────────────────────────────────────────

  it("lists a waiting agent by the name it asked for, and shows the setup-page hint with this origin", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    expect(text(el, "[data-test=join-label-j1]")).toBe("kitchen-pi");
    expect(text(el, "[data-test=join-asked-j1]")).toBe("2026-09-08 10:02");
    expect(text(el, "[data-test=join-origin]")).toBe(window.location.origin);
  });

  // Design §1.2 rule 1: the list must never show the answer beside the question.
  it("never renders the request's verification number in the pending list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    const panel = q(el, "[data-test=join-panel]")!;
    expect(panel.textContent).toContain("kitchen-pi");
    expect(panel.textContent).not.toContain(REAL_NUMBER);
    expect(panel.querySelectorAll("[data-choice]")).toHaveLength(0);
    expect(api.joinChallenge).not.toHaveBeenCalled();
  });

  it("shows the empty placeholder when nothing is waiting to join", async () => {
    const api = stubApi({ joinRequests: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    expect(text(el, "[data-test=no-join-requests]")).toBe(t("printers.join_none", "es-ES"));
  });

  it("denies only on the confirming second click, then reloads the queue", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    q(el, "[data-test=join-deny-j1]")!.click();
    await el.updateComplete;
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
    expect(text(el, "[data-test=join-deny-j1]")).toBe(t("printers.join_deny_confirm", "es-ES"));

    q(el, "[data-test=join-deny-j1]")!.click();
    await flush(el);
    expect(api.denyJoinRequest).toHaveBeenCalledWith("j1");
    expect(api.joinRequests).toHaveBeenCalledTimes(3);
  });

  // ── Agents: the accept dialog ────────────────────────────────────────────────────────────────────

  it("opens a row and renders the three numbers as buttons, immediately tappable", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    expect(api.joinChallenge).toHaveBeenCalledWith("j1");
    const buttons = Array.from(el.shadowRoot!.querySelectorAll("[data-choice]"));
    expect(buttons.map((b) => b.getAttribute("data-choice"))).toEqual(CHOICES);
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(CHOICES);
    expect(
      (q(el, `[data-choice="${REAL_NUMBER}"]`) as import("@waitron/ui").WtButton).disabled,
    ).toBe(false);
  });

  it("accepts with the tapped number, then closes the dialog and reloads the queue and agents", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
    await flush(el);

    expect(api.acceptPrintAgentJoinRequest).toHaveBeenCalledWith("j1", { choice: REAL_NUMBER });
    expect(q(el, "[data-test=join-dialog]")).toBeNull();
    expect(api.listAgents).toHaveBeenCalledTimes(2);
    expect(api.joinRequests).toHaveBeenCalledTimes(3);
  });

  // A wrong tap has already denied the request server-side (design §1.2).
  it("treats a mismatch as terminal: the row goes, and the banner tells them to ask again", async () => {
    const api = stubApi({
      acceptPrintAgentJoinRequest: vi.fn().mockRejectedValue({ code: "device.join_mismatch" }),
      joinRequests: vi
        .fn()
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending)
        .mockResolvedValue([]),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    q(el, '[data-choice="12"]')!.click();
    await flush(el);

    expect(q(el, "[data-test=join-row-j1]")).toBeNull();
    expect(q(el, "[data-test=join-dialog]")).toBeNull();
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("device.join_mismatch", "es-ES"));
    expect(banner).not.toContain("device.join_mismatch");
  });

  it("keeps the dialog open on a recoverable accept fault", async () => {
    const api = stubApi({
      acceptPrintAgentJoinRequest: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
    await flush(el);

    expect(q(el, "[data-test=join-dialog]")).toBeTruthy();
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  it("reopens a row without re-fetching its numbers — the set is fixed server-side", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);
    q(el, "[data-test=join-cancel]")!.click();
    await el.updateComplete;
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    expect(api.joinChallenge).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelectorAll("[data-choice]")).toHaveLength(3);
  });

  it("shows an error banner when the challenge fetch is rejected", async () => {
    const api = stubApi({
      joinChallenge: vi.fn().mockRejectedValue({ code: "join_request.not_found" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("join_request.not_found");
  });

  it("shows none of the retired generate-code controls", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    expect(q(el, "[data-test=agent-label]")).toBeNull();
    expect(q(el, "[data-test=generate-code]")).toBeNull();
    expect(q(el, "[data-test=code-panel]")).toBeNull();
    expect(q(el, "[data-test=copy-code]")).toBeNull();
  });

  // ── Agents: revoke ───────────────────────────────────────────────────────────────────────────────

  it("does not show a revoke control for an already-revoked agent", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=revoke-agent-a1]")).toBeTruthy();
    expect(q(el, "[data-test=revoke-agent-a2]")).toBeNull();
  });

  it("revokes an agent only on the confirming second click, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=revoke-agent-a1]")!.click();
    await el.updateComplete;
    expect(api.revokeAgent).not.toHaveBeenCalled();
    expect(text(el, "[data-test=revoke-agent-a1]")).toBe(t("printers.delete_confirm", "es-ES"));

    q(el, "[data-test=revoke-agent-a1]")!.click();
    await flush(el);
    expect(api.revokeAgent).toHaveBeenCalledWith("a1");
    expect(api.listAgents).toHaveBeenCalledTimes(2);
  });

  it("shows an error and keeps the list when a revoke is rejected", async () => {
    const api = stubApi({ revokeAgent: vi.fn().mockRejectedValue({ code: "agent.not_found" }) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=revoke-agent-a1]")!.click();
    await el.updateComplete;
    q(el, "[data-test=revoke-agent-a1]")!.click();
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("agent.not_found", "es-ES"));
  });

  // ── Agents: provenance + allow-again ─────────────────────────────────────────────────────────────

  it("marks a self-enrolled agent (node id present) and not a manually-enrolled one", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    // a2 carries a node id → the "on this box" provenance marker shows.
    expect(q(el, "[data-test=agent-provenance-a2]")).toBeTruthy();
    expect(text(el, "[data-test=agent-provenance-a2]")).toBe(
      t("printers.provenance_self", "es-ES"),
    );
    // a1 has a null node id (manual enrolment) → no marker.
    expect(q(el, "[data-test=agent-provenance-a1]")).toBeNull();
  });

  it("re-allows a revoked agent only on the confirming second click, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=allow-agent-a2]")).toBeTruthy();
    expect(q(el, "[data-test=allow-agent-a1]")).toBeNull();

    q(el, "[data-test=allow-agent-a2]")!.click();
    await el.updateComplete;
    expect(api.allowAgent).not.toHaveBeenCalled();
    expect(text(el, "[data-test=allow-agent-a2]")).toBe(t("printers.allow_confirm", "es-ES"));

    q(el, "[data-test=allow-agent-a2]")!.click();
    await flush(el);
    expect(api.allowAgent).toHaveBeenCalledWith("a2");
    expect(api.listAgents).toHaveBeenCalledTimes(2);
  });

  it("shows an error and keeps the list when a re-allow is rejected", async () => {
    const api = stubApi({ allowAgent: vi.fn().mockRejectedValue({ code: "agent.not_found" }) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=allow-agent-a2]")!.click();
    await el.updateComplete;
    q(el, "[data-test=allow-agent-a2]")!.click();
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("agent.not_found", "es-ES"));
  });

  // ── Printers: discovered-device registration ───────────────────────────────────────────────────────

  it("Enter checks the address once while pending and allows retry after rejection", async () => {
    let reject!: (reason: unknown) => void;
    const probePrinterAddress = vi.fn().mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({ probePrinterAddress }),
    });
    await flush(el);
    q(el, "[data-test=open-add-printer]")!.click();
    await flush(el);
    const probePanel = q(el, "[data-test=probe-panel]") as HTMLDetailsElement;
    expect(probePanel.open).toBe(false);
    q(el, "[data-test=probe-panel] summary")!.click();
    await flush(el);
    const control = q(el, "[data-test=probe-host]") as import("@waitron/ui").WtInput;
    await control.updateComplete;
    const input = control.shadowRoot!.querySelector("input")!;
    input.value = "192.168.20.247";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(probePrinterAddress).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Enter}");
    q(el, "[data-test=probe-printer]")!.click();
    expect(probePrinterAddress).toHaveBeenCalledExactlyOnceWith({
      host: "192.168.20.247",
      port: 9100,
    });
    expect(q(el, "[data-test=probe-printer]")!.shadowRoot!.querySelector("button")!.disabled).toBe(
      true,
    );
    reject({ code: "printer.probe_busy" });
    await flush(el);
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(probePrinterAddress).toHaveBeenCalledTimes(2);
    reject({ code: "printer.probe_busy" });
    await flush(el);
  });

  it("checks an explicit printer address while automatic discovery is running, then offers Add", async () => {
    const requestedAt = Date.now();
    const device: DiscoveredPrinter = {
      agentId: "a1",
      agentName: "Kitchen agent",
      transport: "network_tcp",
      host: "192.168.20.247",
      port: 9200,
      alreadyRegistered: false,
      printerId: null,
      lastSeenAt: new Date(requestedAt).toISOString(),
    };
    const probePrinterAddress = vi.fn().mockResolvedValue({
      host: device.host,
      port: device.port,
      requestedAt,
      expiresAt: requestedAt + 30000,
    });
    const api = stubApi({ probePrinterAddress });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-printer]")!.click();
    await flush(el);
    const address = q(el, "[data-test=probe-host]");
    expect(address).not.toBeNull();
    address!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "192.168.20.247" },
        bubbles: true,
        composed: true,
      }),
    );
    q(el, "[data-test=probe-port]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "9200" }, bubbles: true, composed: true }),
    );
    (api.listDiscoveredPrinters as ReturnType<typeof vi.fn>).mockResolvedValue([device]);
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    expect(probePrinterAddress).toHaveBeenCalledWith({ host: "192.168.20.247", port: 9200 });
    expect(text(el, "[data-test=probe-status]")).toContain(t("printers.probe_found"));
    expect(api.createPrinter).not.toHaveBeenCalled();
    await addDiscovered(el, q(el, "[data-test='register-192.168.20.247:9200']")!);
    await flush(el);
    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "192.168.20.247",
      transport: "network_tcp",
      host: "192.168.20.247",
      port: 9200,
    });
    expect(text(el, "[data-test=probe-status]")).toContain(t("printers.probe_registered"));
  });

  it("explains that a checked address is an office printer instead of reporting it found", async () => {
    const requestedAt = Date.now();
    const device: DiscoveredPrinter = {
      agentId: "a1",
      agentName: "Kitchen agent",
      transport: "network_tcp",
      host: "192.168.20.56",
      port: 9100,
      name: "HP LaserJet",
      pagePrinter: true,
      alreadyRegistered: false,
      printerId: null,
      lastSeenAt: new Date(requestedAt).toISOString(),
    };
    const probePrinterAddress = vi.fn().mockResolvedValue({
      host: device.host,
      port: device.port,
      requestedAt,
      expiresAt: requestedAt + 30000,
    });
    const api = stubApi({ probePrinterAddress });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-printer]")!.click();
    await flush(el);
    typeField(el, "[data-test=probe-host]", "192.168.20.56");
    typeField(el, "[data-test=probe-port]", "9100");
    (api.listDiscoveredPrinters as ReturnType<typeof vi.fn>).mockResolvedValue([device]);
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    // Fails if #setDiscovered still maps an addable office printer to "found".
    const status = text(el, "[data-test=probe-status]");
    expect(status).toBe(t("printers.probe_page_printer"));
    expect(status).not.toContain(t("printers.probe_found"));
    expect(q(el, "[data-test='register-192.168.20.56:9100']")).toBeNull();
  });

  it("explains invalid address and port fields instead of disabling Check address", async () => {
    const probePrinterAddress = vi.fn();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({ probePrinterAddress }),
    });
    await flush(el);
    q(el, "[data-test=open-add-printer]")!.click();
    await flush(el);
    expect(q(el, "[data-test=probe-printer]")).not.toBeNull();
    q(el, "[data-test=probe-port]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "70000" }, bubbles: true, composed: true }),
    );
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    expect(probePrinterAddress).not.toHaveBeenCalled();
    expect((q(el, "[data-test=probe-host]") as unknown as { error: string }).error).toBe(
      t("printers.probe_host_invalid"),
    );
    expect((q(el, "[data-test=probe-port]") as unknown as { error: string }).error).toBe(
      t("printers.port_invalid"),
    );
    expect((q(el, "[data-test=probe-errors]") as unknown as { errors: string[] }).errors).toEqual([
      t("printers.probe_host_invalid"),
      t("printers.port_invalid"),
    ]);
  });

  it("ignores old inventory, times out, and accepts a fresh report on retry through passive polling", async () => {
    const requestedAt = Date.now() + 60_000; // The server's clock need not match the browser.
    const target = {
      host: "192.168.20.247",
      port: 9100,
      requestedAt,
      expiresAt: requestedAt + 30_000,
    };
    const device: DiscoveredPrinter = {
      ...discoveredNetwork[0]!,
      host: target.host,
      port: target.port,
      lastSeenAt: new Date(requestedAt - 1).toISOString(),
    };
    const list = vi.fn().mockResolvedValue([device]);
    const passive = vi.fn().mockResolvedValue([device]);
    const probe = vi.fn().mockResolvedValue(target);
    const api = stubApi({
      listDiscoveredPrinters: list,
      probePrinterAddress: probe,
      background: stubApi({ listDiscoveredPrinters: passive }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      q(el, "[data-test=probe-host]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: target.host } }),
      );
      q(el, "[data-test=probe-printer]")!.click();
      await flush(el);
      expect(text(el, "[data-test=probe-status]")).toContain(t("printers.probe_waiting"));
      await vi.advanceTimersByTimeAsync(30_000);
      await el.updateComplete;
      expect(text(el, "[data-test=probe-status]")).toContain(t("printers.probe_missing"));
      expect(passive).toHaveBeenCalled();
      passive.mockResolvedValue([{ ...device, lastSeenAt: new Date(requestedAt).toISOString() }]);
      q(el, "[data-test=probe-printer]")!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await el.updateComplete;
      expect(probe).toHaveBeenCalledTimes(2);
      expect(text(el, "[data-test=probe-status]")).toContain(t("printers.probe_found"));
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("maps a refused address to its field and ignores a late refusal after reopening", async () => {
    const probe = vi
      .fn()
      .mockRejectedValue({ code: "management.request_invalid", params: { field: "host" } });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({ probePrinterAddress: probe }),
    });
    await flush(el);
    await openDiscovery(el);
    const change = () =>
      q(el, "[data-test=probe-host]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "printer.local" } }),
      );
    change();
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    expect((q(el, "[data-test=probe-host]") as unknown as { error: string }).error).toBe(
      t("printers.probe_host_invalid"),
    );
    expect((q(el, "[data-test=probe-errors]") as unknown as { errors: string[] }).errors).toEqual([
      t("printers.probe_host_invalid"),
    ]);
    let reject!: (error: unknown) => void;
    probe.mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    q(el, "[data-test=cancel-new-printer]")!.click();
    await flush(el);
    await openDiscovery(el);
    reject({ code: "printer.probe_busy" });
    await flush(el);
    expect(q(el, "[data-test=new-printer-modal]")!.textContent).not.toContain(
      codeMessage("printer.probe_busy"),
    );
    expect(text(el, "[data-test=probe-status]")).toBe("");
  });

  it("starts new polling while an old discovery read is pending without releasing the new read's gate", async () => {
    const target = {
      host: "192.168.20.247",
      port: 9100,
      requestedAt: Date.now(),
      expiresAt: Date.now() + 30000,
    };
    let finishOld!: (rows: DiscoveredPrinter[]) => void;
    let finishNew!: (rows: DiscoveredPrinter[]) => void;
    const passive = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<DiscoveredPrinter[]>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<DiscoveredPrinter[]>((resolve) => {
            finishNew = resolve;
          }),
      )
      .mockResolvedValue([]);
    const api = stubApi({
      probePrinterAddress: vi.fn().mockResolvedValue(target),
      background: stubApi({ listDiscoveredPrinters: passive }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(passive).toHaveBeenCalledTimes(1);
      q(el, "[data-test=probe-host]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: target.host } }),
      );
      q(el, "[data-test=probe-printer]")!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(passive).toHaveBeenCalledTimes(2);
      finishOld(discoveredNetwork);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(passive).toHaveBeenCalledTimes(2);
      finishNew([]);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(passive).toHaveBeenCalledTimes(3);
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it.each([true, false])(
    "recognizes a registered address (active=%s) and preserves Add again",
    async (active) => {
      const row = { ...printers[0]!, active };
      const target = {
        host: row.host!,
        port: row.port!,
        requestedAt: Date.now(),
        expiresAt: Date.now() + 30000,
      };
      const device: DiscoveredPrinter = {
        ...discoveredNetwork[0]!,
        host: target.host,
        port: target.port,
        lastSeenAt: new Date(target.requestedAt).toISOString(),
        alreadyRegistered: true,
        printerId: row.id,
      };
      const api = stubApi({
        listPrinters: vi.fn().mockResolvedValue([row]),
        listDiscoveredPrinters: vi.fn().mockResolvedValue([device]),
        probePrinterAddress: vi.fn().mockResolvedValue(target),
      });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await flush(el);
      await openDiscovery(el);
      q(el, "[data-test=probe-host]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: target.host } }),
      );
      q(el, "[data-test=probe-printer]")!.click();
      await flush(el);
      expect(text(el, "[data-test=probe-status]")).toContain(
        t(active ? "printers.probe_registered" : "printers.probe_found"),
      );
      const add = q(el, `[data-test='register-${target.host}:${target.port}']`);
      if (active) expect(add).toBeNull();
      else {
        expect(add!.textContent).toContain(t("printers.add_again"));
        await addDiscovered(el, add!);
        await flush(el);
        expect(api.updatePrinter).toHaveBeenCalledWith(row.id, { active: true });
        expect(api.createPrinter).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps Add again for a disabled registration even when the agent marks it an office printer", async () => {
    const row = { ...printers[0]!, active: false };
    const target = {
      host: row.host!,
      port: row.port!,
      requestedAt: Date.now(),
      expiresAt: Date.now() + 30000,
    };
    const device: DiscoveredPrinter = {
      ...discoveredNetwork[0]!,
      host: target.host,
      port: target.port,
      pagePrinter: true,
      lastSeenAt: new Date(target.requestedAt).toISOString(),
      alreadyRegistered: true,
      printerId: row.id,
    };
    const api = stubApi({
      listPrinters: vi.fn().mockResolvedValue([row]),
      listDiscoveredPrinters: vi.fn().mockResolvedValue([device]),
      probePrinterAddress: vi.fn().mockResolvedValue(target),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    const key = `${target.host}:${target.port}`;
    // The retained registration stays re-addable (conventions-ui.md): no office-printer treatment.
    expect(q(el, `[data-test='page-printer-${key}']`)).toBeNull();
    expect(q(el, `[data-test='discovered-row-${key}']`)!.getAttribute("part")).toBe(
      "discovered-details",
    );
    expect(text(el, `[data-test='discovered-row-${key}']`)).toContain(t("printers.add_again_hint"));
    q(el, "[data-test=probe-host]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: target.host } }),
    );
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    expect(text(el, "[data-test=probe-status]")).toContain(t("printers.probe_found"));
    const add = q(el, `[data-test='register-${key}']`);
    expect(add!.textContent).toContain(t("printers.add_again"));
    await addDiscovered(el, add!);
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith(row.id, { active: true });
  });

  it("shows a refresh error without claiming the address failed to respond", async () => {
    const api = stubApi({
      probePrinterAddress: vi
        .fn()
        .mockResolvedValue({ host: "10.0.0.1", port: 9100, requestedAt: 0, expiresAt: 30000 }),
      background: stubApi({
        listDiscoveredPrinters: vi.fn().mockRejectedValue({ code: "management_session.expired" }),
      }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      q(el, "[data-test=probe-host]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "10.0.0.1" } }),
      );
      q(el, "[data-test=probe-printer]")!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await el.updateComplete;
      expect(q(el, "[data-test=new-printer-modal]")!.textContent).toContain(
        codeMessage("management_session.expired"),
      );
      expect(text(el, "[data-test=probe-status]")).not.toContain(t("printers.probe_missing"));
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("registers a discovered IP printer with its name, host and port only", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discoveredNetwork) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    expect(api.startPrinterDiscovery).not.toHaveBeenCalled();
    await openDiscovery(el);
    expect(api.startPrinterDiscovery).toHaveBeenCalledOnce();
    expect(q(el, "[data-test=new-transport]")).toBeNull();
    expect(q(el, "[data-test=new-host]")).toBeNull();
    await addDiscovered(el, q(el, '[data-test="register-10.0.0.77:9100"]')!);
    await flush(el);
    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "Kitchen IP",
      transport: "network_tcp",
      host: "10.0.0.77",
      port: 9100,
    });
    const arg = vi.mocked(api.createPrinter).mock.calls[0]![0];
    expect(arg).not.toHaveProperty("agentId");
    expect(arg).not.toHaveProperty("localKey");
    expect(arg).not.toHaveProperty("pollId");
    await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
  });

  it("Scan shows a busy button and keeps re-reading the discovered list for the listen period", async () => {
    // Agents see the open window on their next poll and post results on the one after, so a single
    // read right after opening it sees nothing.
    vi.useFakeTimers();
    try {
      const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discoveredNetwork) });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;

      vi.mocked(api.listDiscoveredPrinters).mockClear();
      const button = () => q(el, "[data-test=scan-printers]")!;
      q(el, "[data-test=open-add-printer]")!.click();
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      expect(api.startPrinterDiscovery).toHaveBeenCalledTimes(1);
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(1);
      expect(button().hasAttribute("loading")).toBe(true);
      expect(button().textContent?.trim()).toBe(t("printers.scan_loading"));

      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(2);

      // A second press while listening is ignored — one window, one listener.
      button().click();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.startPrinterDiscovery).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS);
      await el.updateComplete;
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(SCAN_LISTEN_MS / SCAN_POLL_MS + 1);
      expect(button().hasAttribute("loading")).toBe(false);
      expect(button().textContent?.trim()).toBe(t("printers.scan"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaving the page while Scan is listening stops the re-reads", async () => {
    vi.useFakeTimers();
    try {
      const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discoveredNetwork) });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(api.listDiscoveredPrinters).mockClear();
      q(el, "[data-test=open-add-printer]")!.click();
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(2);

      el.remove();
      await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS);
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a Scan whose window opens after the page was left reads nothing", async () => {
    vi.useFakeTimers();
    try {
      let open!: (v: { discoveryUntil: number }) => void;
      const api = stubApi({
        startPrinterDiscovery: vi.fn(
          () => new Promise<{ discoveryUntil: number }>((r) => (open = r)),
        ),
        listDiscoveredPrinters: vi.fn().mockResolvedValue(discoveredNetwork),
      });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(api.listDiscoveredPrinters).mockClear();
      q(el, "[data-test=open-add-printer]")!.click();
      el.remove();
      open({ discoveryUntil: Date.now() + 60_000 });
      await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS);
      expect(api.listDiscoveredPrinters).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaving the page while the first read is in flight starts no listen", async () => {
    vi.useFakeTimers();
    try {
      let deliver!: (v: DiscoveredPrinter[]) => void;
      const api = stubApi({
        listDiscoveredPrinters: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockImplementation(() => new Promise<DiscoveredPrinter[]>((r) => (deliver = r))),
      });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(api.listDiscoveredPrinters).mockClear();
      q(el, "[data-test=open-add-printer]")!.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(1);

      el.remove();
      deliver(discoveredNetwork);
      await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS);
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a slow read still outstanding at the next tick is not overlapped by another", async () => {
    vi.useFakeTimers();
    try {
      let deliver!: (v: DiscoveredPrinter[]) => void;
      const api = stubApi({
        listDiscoveredPrinters: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(discoveredNetwork)
          .mockImplementationOnce(() => new Promise<DiscoveredPrinter[]>((r) => (deliver = r)))
          .mockResolvedValue(discoveredNetwork),
      });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(api.listDiscoveredPrinters).mockClear();
      q(el, "[data-test=open-add-printer]")!.click();
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(2); // the slow one is outstanding

      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(2); // tick skipped, not overlapped
      deliver(discoveredNetwork);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Printers: register a discovered USB / Bluetooth device ─────────────────────────────────────────

  it("registers a discovered USB printer using its advertised name", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await openDiscovery(el);
    expect(api.listDiscoveredPrinters).toHaveBeenCalled();
    expect(q(el, "[data-test=discovered-row-SN-1]")).toBeTruthy();

    await el.updateComplete;
    await addDiscovered(el, q(el, "[data-test=register-SN-1]")!);
    await flush(el);

    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "EPSON TM-T20",
      transport: "usb",
      localKey: "SN-1",
    });
    const arg = vi.mocked(api.createPrinter).mock.calls[0]![0];
    expect(arg).not.toHaveProperty("agentId");
    expect(arg).not.toHaveProperty("host");
    await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
  });

  it("uses make and model when a discovered device has no name", async () => {
    const api = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue([{ ...discovered[0], name: null }]),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    await addDiscovered(el, q(el, "[data-test=register-SN-1]")!);
    await flush(el);
    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "Epson TM-T20",
      transport: "usb",
      localKey: "SN-1",
    });
  });

  it("greys out a discovered office printer with an explanation and no Add, beside a receipt printer that keeps its Add", async () => {
    const office: DiscoveredPrinter = {
      agentId: "a1",
      agentName: "Cocina agent",
      transport: "network_tcp",
      host: "10.0.0.56",
      port: 9100,
      make: "HP",
      model: "LaserJet Pro M404",
      name: "HP LaserJet",
      pagePrinter: true,
      alreadyRegistered: false,
      printerId: null,
      lastSeenAt: "2023-11-14T22:13:20.000Z",
    };
    const api = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue([...discoveredNetwork, office]),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);

    // Fails if the receipt-printer path learns to hide or disable ordinary devices.
    const receiptAdd = q(el, "[data-test='register-10.0.0.77:9100']");
    expect(receiptAdd).not.toBeNull();
    expect(receiptAdd!.hasAttribute("disabled")).toBe(false);
    expect(q(el, "[data-test='page-printer-10.0.0.77:9100']")).toBeNull();

    // Fails if #renderNewPrinter filters office printers out of the table instead of greying them.
    const officeRow = q(el, "[data-test='discovered-row-10.0.0.56:9100']");
    expect(officeRow).not.toBeNull();
    // Fails if the Add button is still rendered for a pagePrinter device.
    expect(q(el, "[data-test='register-10.0.0.56:9100']")).toBeNull();
    // Fails if the explanation is not rendered beside the device.
    expect(text(el, "[data-test='page-printer-10.0.0.56:9100']")).toBe(
      t("printers.page_printer_hint"),
    );
    // Fails if the muted styling is dropped or applied through a class a table cell cannot see.
    const muted = getComputedStyle(officeRow!).color;
    expect(muted).not.toBe(
      getComputedStyle(q(el, "[data-test='discovered-row-10.0.0.77:9100']")!).color,
    );
    const table = q(el, "[data-test=discovered-table]") as import("@waitron/ui").WtDataTable;
    expect((table.rows as DiscoveredPrinter[]).map((row) => row.host)).toEqual([
      "10.0.0.77",
      "10.0.0.56",
    ]);
  });

  it("hides active registered USB devices and shows their seen-status on the printer", async () => {
    const api = stubApi({
      listPrinters: vi
        .fn()
        .mockResolvedValue(printers.map((printer) => ({ ...printer, active: true }))),
      listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await openDiscovery(el);

    expect(q(el, "[data-test=discovered-row-SN-2]")).toBeNull();
    expect(q(el, "[data-test=register-SN-2]")).toBeNull();
    expect(text(el, "[data-test=printer-last-seen-p3]")).toBe(
      t("printers.seen_at")
        .replace("{agent}", "Cocina agent")
        .replace("{time}", "2023-11-14 22:13"),
    );
    expect(q(el, "[data-test=register-SN-1]")).toBeTruthy();
    expect(q(el, "[data-test=discovered-registered-SN-1]")).toBeNull();
  });

  it("shows the empty discovery message after scanning finishes", async () => {
    vi.useFakeTimers();
    try {
      const api = stubApi();
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(api.listDiscoveredPrinters).mockClear();
      q(el, "[data-test=open-add-printer]")!.click();
      await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS);
      await el.updateComplete;
      expect(
        (q(el, "[data-test=discovered-table]") as import("@waitron/ui").WtDataTable).emptyMessage,
      ).toBe(t("printers.no_discovered", "es-ES"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("registers Bluetooth devices from the same discovered table", async () => {
    const api = stubApi({
      listDiscoveredPrinters: vi
        .fn()
        .mockResolvedValue([
          { ...discovered[0], transport: "bluetooth", localKey: "AA:BB", name: "Bar printer" },
        ]),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    await addDiscovered(el, q(el, '[data-test="register-AA:BB"]')!);
    await flush(el);
    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "Bar printer",
      transport: "bluetooth",
      localKey: "AA:BB",
    });
  });

  it("shows an error banner when registering a discovered device is rejected", async () => {
    const api = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered),
      createPrinter: vi.fn().mockRejectedValue({ code: "printer.already_registered" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await openDiscovery(el);
    await el.updateComplete;
    await addDiscovered(el, q(el, "[data-test=register-SN-1]")!);
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("printer.already_registered", "es-ES"));
    expect(banner).not.toContain("printer.already_registered");
  });

  it("shows an error banner when reading the discovered list is rejected", async () => {
    const api = stubApi({
      listDiscoveredPrinters: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await openDiscovery(el);
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("server.internal", "es-ES"));
    expect(banner).not.toContain("server.internal");
  });

  it("shows an error banner when Scan (opening the discovery window) is rejected", async () => {
    const api = stubApi({
      startPrinterDiscovery: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=open-add-printer]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "authorization.not_permitted",
    );
  });

  // ── Printers: edit / deactivate / test-print ─────────────────────────────────────────────────────

  it("saves an edited network_tcp printer's host+port (never localKey/pollId) and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");

    typeField(el, "[data-test=printer-name-p1]", "Cocina 2");
    typeField(el, "[data-test=printer-host-p1]", "10.0.0.20");
    typeField(el, "[data-test=printer-port-p1]", "9300");
    expect(q(el, "[data-test=printer-local-key-p1]")).toBeNull();
    expect(q(el, "[data-test=printer-poll-id-p1]")).toBeNull();
    await el.updateComplete;
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
      name: "Cocina 2",
      host: "10.0.0.20",
      port: 9300,
      active: true,
    });
    const [, patch] = vi.mocked(api.updatePrinter).mock.calls[0]!;
    expect(patch).not.toHaveProperty("localKey");
    expect(patch).not.toHaveProperty("pollId");
    await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
  });

  it("rejects an emptied required network host", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");

    typeField(el, "[data-test=printer-host-p1]", "");
    typeField(el, "[data-test=printer-port-p1]", "");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);

    expect(api.updatePrinter).not.toHaveBeenCalled();
    expect((q(el, "[data-test=printer-host-p1]") as import("@waitron/ui").WtInput).invalid).toBe(
      true,
    );
  });

  it("saves a USB printer without changing its read-only identity", async () => {
    const usb: Printer = {
      id: "p3",
      name: "USB",
      transport: "usb",
      host: null,
      port: null,
      localKey: "SN-1",
      pollId: null,
      ticketScope: "station",
      paperWidth: "80mm",
      resolution: "180dpi",
      characterSet: "wpc1252",
      characterTable: 16,
      hasCashDrawer: false,
      pendingJobs: 0,
      lastPrintAt: null,
      lastPrintAgentId: null,
      active: true,
    };
    const api = stubApi({ listPrinters: vi.fn().mockResolvedValue([usb]) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p3");

    typeField(el, "[data-test=printer-local-key-p3]", "SN-9");
    expect(q(el, "[data-test=printer-host-p3]")).toBeNull();
    expect(q(el, "[data-test=printer-poll-id-p3]")).toBeNull();
    await el.updateComplete;
    q(el, "[data-test=save-printer-p3]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p3", {
      name: "USB",
      active: true,
    });
    const [, patch] = vi.mocked(api.updatePrinter).mock.calls[0]!;
    expect(patch).not.toHaveProperty("host");
    expect(patch).not.toHaveProperty("port");
    expect(patch).not.toHaveProperty("pollId");
  });

  it("does not accept changes to the displayed USB device ID", async () => {
    const usb: Printer = {
      id: "p3",
      name: "USB",
      transport: "usb",
      host: null,
      port: null,
      localKey: "SN-1",
      pollId: null,
      ticketScope: "station",
      paperWidth: "80mm",
      resolution: "180dpi",
      characterSet: "wpc1252",
      characterTable: 16,
      hasCashDrawer: false,
      pendingJobs: 0,
      lastPrintAt: null,
      lastPrintAgentId: null,
      active: true,
    };
    const api = stubApi({ listPrinters: vi.fn().mockResolvedValue([usb]) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p3");

    typeField(el, "[data-test=printer-local-key-p3]", "");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p3]")!.click();
    await flush(el);

    expect(q(el, "[data-test=printer-local-key-p3] input")).toBeNull();
    expect(api.updatePrinter).toHaveBeenCalledWith("p3", { name: "USB", active: true });
  });

  it("reactivates a cloud_poll printer without sending identity fields", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p2");

    // p2 is cloud_poll + inactive: host/port/localKey are empty, pollId is "poll-1".
    toggleSwitch(el, "[data-test=printer-active-p2]", true);
    await el.updateComplete;
    q(el, "[data-test=save-printer-p2]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p2", {
      name: "Nube",
      active: true,
    });
    const [, patch] = vi.mocked(api.updatePrinter).mock.calls[0]!;
    expect(patch).not.toHaveProperty("host");
    expect(patch).not.toHaveProperty("port");
    expect(patch).not.toHaveProperty("localKey");
  });

  it("does not accept changes to the displayed cloud poll ID", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p2");

    typeField(el, "[data-test=printer-poll-id-p2]", "");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p2]")!.click();
    await flush(el);

    expect(q(el, "[data-test=printer-poll-id-p2] input")).toBeNull();
    expect(api.updatePrinter).toHaveBeenCalledWith("p2", { name: "Nube", active: false });
  });

  it("shows an error banner when saving a printer edit is rejected", async () => {
    const api = stubApi({
      updatePrinter: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");

    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("printer.not_found", "es-ES"));
  });

  it("deactivates a printer immediately, reloads, and disables inactive deletion", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await filterPrinters(el, "all");
    expect(q(el, "[data-test=deactivate-printer-p2]")!.hasAttribute("disabled")).toBe(true);

    q(el, "[data-test=deactivate-printer-p1]")!.click();
    await flush(el);
    expect(api.deactivatePrinter).toHaveBeenCalledWith("p1");
    await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
  });

  it("shows an error banner when a deactivate is rejected", async () => {
    const api = stubApi({
      deactivatePrinter: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=deactivate-printer-p1]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("printer.not_found");
  });

  it("enqueues a test print for a printer and reloads the jobs", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await openPrinter(el);
    q(el, "[data-test=print-test-page-p1]")!.click();
    await flush(el);
    expect(api.testPrint).toHaveBeenCalledWith("p1");
    expect(api.listRecentJobs).toHaveBeenCalledTimes(2);
  });

  it("shows an error banner when a test print is rejected", async () => {
    const api = stubApi({ testPrint: vi.fn().mockRejectedValue({ code: "printer.not_found" }) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await openPrinter(el);
    q(el, "[data-test=print-test-page-p1]")!.click();
    await flush(el);
    expect((el as unknown as { testError: string | null }).testError).toBe("printer.not_found");
  });

  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-printers-screen")).toBe(PrintersScreen);
  });
});

it.each([
  {
    method: "updatePrinter",
    field: "[data-test=printer-name-p1]",
    button: "[data-test=save-printer-p1]",
    result: null,
  },
])(
  "Enter guards pending $method and allows retry after rejection",
  async ({ method, field, button, result }) => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    const request = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(result);
    const api = stubApi({ [method]: request });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el);

    const control = (q(el, field) as import("@waitron/ui").WtInput)!;
    await control.updateComplete;
    const input = control.shadowRoot!.querySelector("input")!;
    input.value = "Updated";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    q(el, button)!.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect(q(el, button)!.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    reject({ code: "management.request_invalid" });
    await flush(el);
    input.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect(q(el, "[data-test=edit-printer-modal]")).toBeNull();
  },
);

describe("printer settings table layout", () => {
  it("shows agents, printers and recent jobs in three named tables", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("wt-data-table")).toHaveLength(3);
    expect(q(el, "[data-test=open-add-agent]")).toBeTruthy();
    expect(q(el, "[data-test=open-add-printer]")).toBeTruthy();
    expect(q(el, "[data-test=new-printer-modal]")).toBeNull();
    expect(q(el, "[data-test=till-receipt-printer-t1]")).toBeNull();
    expect(q(el, "[data-test=station-toggle-p1-s1]")).toBeNull();
  });

  it("keeps the Printers tab available before an agent has registered", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({ listAgents: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    expect(q(el, "[data-test=printers-table]")).toBeTruthy();
    expect(q(el, "[data-test=open-add-printer]")).toBeTruthy();
    expect(q(el, "[data-test=jobs-table]")).toBeTruthy();
  });

  it("opens discovery in a modal and cancels it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    const modal = q(el, "[data-test=new-printer-modal]")!;
    expect(modal.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    expect(q(el, "[data-test=cancel-new-printer]")!.closest("wt-form-actions")?.slot).toBe(
      "footer",
    );
    q(el, "[data-test=cancel-new-printer]")!.click();
    await flush(el);
    expect(q(el, "[data-test=new-printer-modal]")).toBeNull();
    expect(api.createPrinter).not.toHaveBeenCalled();
  });
});

it("scans every printer type on opening Add printer and shows one discovery table", async () => {
  const api = stubApi({
    listDiscoveredPrinters: vi.fn().mockResolvedValue([...discovered, ...discoveredNetwork]),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=open-add-printer]")!.click();
  await flush(el);
  expect(api.startPrinterDiscovery).toHaveBeenCalledOnce();
  expect(q(el, "[data-test=new-transport]")).toBeNull();
  expect(q(el, "[data-test=discovered-table]")).toBeTruthy();
});

it("closing Add printer while its discovery window opens starts no reads", async () => {
  vi.useFakeTimers();
  try {
    let open!: (value: { discoveryUntil: number }) => void;
    const api = stubApi({
      startPrinterDiscovery: vi.fn(
        () =>
          new Promise<{ discoveryUntil: number }>((resolve) => {
            open = resolve;
          }),
      ),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    vi.mocked(api.listDiscoveredPrinters).mockClear();
    q(el, "[data-test=open-add-printer]")!.click();
    await el.updateComplete;
    q(el, "[data-test=cancel-new-printer]")!.click();
    await el.updateComplete;
    open({ discoveryUntil: Date.now() + 60_000 });
    await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS);
    expect(api.listDiscoveredPrinters).not.toHaveBeenCalled();
    expect(
      q(el, "[data-test=new-printer-modal]")?.shadowRoot!.querySelector("dialog")!.open ?? false,
    ).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a successfully added printer registered when refreshing discovery fails", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const api = stubApi({
      listDiscoveredPrinters: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(discoveredNetwork)
        .mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    await addDiscovered(el, q(el, '[data-test="register-10.0.0.77:9100"]')!);
    await flush(el);
    expect(api.createPrinter).toHaveBeenCalledOnce();
    expect(q(el, '[data-test="name-printer-modal"]')).toBeNull();
    await vi.waitFor(() =>
      expect(text(el, '[data-test="printer-refresh-error"]')).toContain(
        t("printers.refresh_failed"),
      ),
    );
    expect(q(el, "[data-test=calibration-step-1]")?.checkVisibility()).toBe(true);
    expect(q(el, '[data-test="register-10.0.0.77:9100"]')).toBeNull();
    expect(q(el, '[data-test="discovered-row-10.0.0.77:9100"]')).toBeNull();
    vi.mocked(api.listDiscoveredPrinters).mockResolvedValue(discoveredNetwork);
    vi.mocked(api.listDiscoveredPrinters).mockClear();
    await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
    await flush(el);
    expect(api.listDiscoveredPrinters).not.toHaveBeenCalled();
    expect(q(el, '[data-test="register-10.0.0.77:9100"]')).toBeNull();
    expect(q(el, '[data-test="discovered-row-10.0.0.77:9100"]')).toBeNull();
    expect(api.createPrinter).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it("cancel discards a printer edit and reopening restores saved values", async () => {
  const api = stubApi();
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  await openPrinter(el);
  typeField(el, "[data-test=printer-name-p1]", "Unsaved");
  typeField(el, "[data-test=printer-host-p1]", "10.0.0.100");
  q(el, "[data-test=cancel-edit-printer]")!.click();
  await flush(el);
  expect(api.updatePrinter).not.toHaveBeenCalled();
  await openPrinter(el);
  expect((q(el, "[data-test=printer-name-p1]") as import("@waitron/ui").WtInput).value).toBe(
    "Cocina",
  );
  expect((q(el, "[data-test=printer-host-p1]") as import("@waitron/ui").WtInput).value).toBe(
    "10.0.0.9",
  );
});

it("clears optional network port while preserving required host", async () => {
  const api = stubApi();
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  await openPrinter(el);
  typeField(el, "[data-test=printer-port-p1]", "");
  await el.updateComplete;
  q(el, "[data-test=save-printer-p1]")!.click();
  await flush(el);
  expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
    name: "Cocina",
    host: "10.0.0.9",
    port: null,
    active: true,
  });
});

it("validates an agent name then saves the renamed agent", async () => {
  const api = stubApi();
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=edit-agent-a1]")!.click();
  await flush(el);
  typeField(el, "[data-test=edit-agent-name]", " ");
  await el.updateComplete;
  q(el, "[data-test=save-agent]")!.click();
  await flush(el);
  expect(api.updateAgent).not.toHaveBeenCalled();
  expect((q(el, "[data-test=edit-agent-name]") as import("@waitron/ui").WtInput).invalid).toBe(
    true,
  );
  typeField(el, "[data-test=edit-agent-name]", "  Kitchen box  ");
  await el.updateComplete;
  q(el, "[data-test=save-agent]")!.click();
  await flush(el);
  expect(api.updateAgent).toHaveBeenCalledWith("a1", { name: "Kitchen box" });
  expect(q(el, "[data-test=edit-agent-modal]")).toBeNull();
});

it("shows a failed agent rename and lets Cancel discard the draft", async () => {
  const api = stubApi({ updateAgent: vi.fn().mockRejectedValue({ code: "agent.not_found" }) });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=edit-agent-a1]")!.click();
  await flush(el);
  typeField(el, "[data-test=edit-agent-name]", "Unsaved");
  await el.updateComplete;
  q(el, "[data-test=save-agent]")!.click();
  await flush(el);
  expect(text(el, "[role=alert]")).toContain(codeMessage("agent.not_found", "es-ES"));
  q(el, "[data-test=cancel-edit-agent]")!.click();
  await flush(el);
  q(el, "[data-test=edit-agent-a1]")!.click();
  await flush(el);
  expect((q(el, "[data-test=edit-agent-name]") as import("@waitron/ui").WtInput).value).toBe(
    "Cocina agent",
  );
});

it("opens the selected job preview and closes it", async () => {
  const api = stubApi();
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=view-job-j1]")!.click();
  await flush(el);
  expect(api.getPrintJobPreview).toHaveBeenCalledWith("j1");
  const preview = q(
    el,
    "dashboard-print-job-preview",
  ) as import("../widgets/print-job-preview.js").PrintJobPreviewDialog;
  expect(preview.open).toBe(true);
  expect(preview.preview?.text).toBe("Receipt");
  q(el, "[data-test=preview-close]")!.click();
  await flush(el);
  expect(preview.open).toBe(false);
});

it("reports a failed job preview request", async () => {
  const api = stubApi({
    getPrintJobPreview: vi.fn().mockRejectedValue({ code: "server.internal" }),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=view-job-j1]")!.click();
  await flush(el);
  expect(text(el, "[role=alert]")).toContain(codeMessage("server.internal", "es-ES"));
});

it("guards repeated Add presses while pending, allows Test Print, and permits retry after failure", async () => {
  let reject!: (reason: unknown) => void;
  const pending = new Promise<{ id: string }>((_, fail) => {
    reject = fail;
  });
  const createPrinter = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ id: "p9" });
  const api = stubApi({
    createPrinter,
    listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  await openDiscovery(el);
  await addDiscovered(el, q(el, "[data-test=register-SN-1]")!);
  await flush(el);
  await addDiscovered(el, q(el, "[data-test=register-SN-1]")!);
  expect(createPrinter).toHaveBeenCalledOnce();
  await openPrinter(el);
  q(el, "[data-test=print-test-page-p1]")!.click();
  await flush(el);
  expect(api.testPrint).toHaveBeenCalledExactlyOnceWith("p1");
  await addDiscovered(el, q(el, "[data-test=register-SN-1]")!);
  expect(createPrinter).toHaveBeenCalledOnce();
  expect(q(el, "[data-test=register-SN-1]")!.shadowRoot!.querySelector("button")!.disabled).toBe(
    true,
  );
  reject({ code: "management.request_invalid" });
  await flush(el);
  await addDiscovered(el, q(el, "[data-test=register-SN-1]")!);
  await flush(el);
  expect(createPrinter).toHaveBeenCalledTimes(2);
});

it.each([
  [1280, 900],
  [390, 844],
  [844, 390],
])(
  "keeps each discovered printer's Add button visible within the modal at %i × %i",
  async (width, height) => {
    await page.viewport(width, height);
    try {
      const api = stubApi({
        listDiscoveredPrinters: vi.fn().mockResolvedValue([...discovered, ...discoveredNetwork]),
      });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await flush(el);
      q(el, "[data-test=open-add-printer]")!.click();
      await flush(el);
      const modal = q(el, "[data-test=new-printer-modal]")!;
      const bounds = modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
      expect(
        getComputedStyle(q(el, '[data-test="discovered-row-10.0.0.77:9100"]')!).overflowWrap,
      ).toBe("anywhere");
      const add = q(el, '[data-test="register-10.0.0.77:9100"]')!.getBoundingClientRect();
      expect(add.right).toBeLessThan(bounds.right);
      expect(add.left).toBeGreaterThan(bounds.left);
    } finally {
      await page.viewport(1280, 900);
    }
  },
);

it("hides a scan result that is already registered and shows when it was seen against that printer", async () => {
  const api = stubApi({
    listDiscoveredPrinters: vi.fn().mockResolvedValue(discoveredRegisteredNetwork),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  expect(text(el, "[data-test=printer-last-seen-p1]")).toBe(
    t("printers.seen_at").replace("{agent}", "Cocina agent").replace("{time}", "2023-11-14 22:13"),
  );
  expect(q(el, "[data-test=printer-last-seen-p2]")).toBeNull();

  q(el, "[data-test=open-add-printer]")!.click();
  await flush(el);
  expect(q(el, '[data-test="discovered-row-10.0.0.5:9100"]')).toBeNull();
  expect(q(el, "[data-test=add-result-0]")).toBeNull();
});

it("shows no seen-status when the reporting agent's row is gone", async () => {
  const api = stubApi({
    listDiscoveredPrinters: vi
      .fn()
      .mockResolvedValue([{ ...discoveredRegisteredNetwork[0]!, agentName: null }]),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  expect(q(el, "[data-test=printer-last-seen-p1]")).toBeNull();
});

it.each([
  ["open-add-agent", "new-agent-modal", "cancel-new-agent"],
  ["open-add-printer", "new-printer-modal", "cancel-new-printer"],
  ["edit-agent-a1", "edit-agent-modal", "cancel-edit-agent"],
  ["edit-printer-p1", "edit-printer-modal", "cancel-edit-printer"],
])(
  "closing %s runs the dialog close event and restores keyboard focus",
  async (opener, modalId, closer) => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(),
    });
    await flush(el);
    const trigger = document.createElement("button");
    el.before(trigger);
    try {
      trigger.focus();
      q(el, `[data-test=${opener}]`)!.click();
      await flush(el);
      const modal = q(el, `[data-test=${modalId}]`)!;
      const closed = vi.fn();
      modal.addEventListener("wt-close", closed);
      (q(el, `[data-test=${closer}]`) ??
        modal.querySelector<HTMLElement>("wt-form-actions wt-button"))!.click();
      await flush(el);
      await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
      expect(document.activeElement).toBe(trigger);
    } finally {
      trigger.remove();
    }
  },
);

it("returns keyboard focus to the printer row trigger after editing through its menu", async () => {
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api: stubApi() });
  await flush(el);
  await selectTab(el, "printers");
  const edit = q(el, "[data-test=edit-printer-p1]")!;
  const menu = edit.closest("dashboard-row-actions")!;
  const trigger = menu.shadowRoot!.querySelector("button")!;
  await userEvent.click(trigger);
  await userEvent.keyboard("{Tab}{Enter}");
  await flush(el);
  q(el, "[data-test=cancel-edit-printer]")!.click();
  await flush(el);
  expect(menu.shadowRoot!.activeElement).toBe(trigger);
});

it("edits printer activation through a named shared switch", async () => {
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api: stubApi() });
  await flush(el);
  await openPrinter(el);
  const control = q(el, "[data-test=printer-active-p1]")!;
  expect(control.tagName).toBe("WT-SWITCH");
  expect(control.shadowRoot!.querySelector("input")!.name).toBe("printer-active");
});

it("closes the kebab after disabling a printer with one click", async () => {
  const api = stubApi();
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  await selectTab(el, "printers");
  const first = q(el, "[data-test=deactivate-printer-p1]")!;
  const menu = first.closest("dashboard-row-actions")!;
  menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  first.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  await flush(el);
  expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  expect(api.deactivatePrinter).toHaveBeenCalledExactlyOnceWith("p1");
});

it("defaults to active printers and filters disabled and all registrations", async () => {
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api: stubApi() });
  await flush(el);
  expect(q(el, "[data-test=printer-row-p1]")).not.toBeNull();
  expect(q(el, "[data-test=printer-row-p2]")).toBeNull();
  const select = q(el, '[name="status-filter"]') as HTMLSelectElement;
  expect(select.value).toBe("active");
  select.value = "disabled";
  select.dispatchEvent(new Event("change"));
  await flush(el);
  expect(q(el, "[data-test=printer-row-p1]")).toBeNull();
  expect(q(el, "[data-test=printer-row-p2]")).not.toBeNull();
  select.value = "";
  select.dispatchEvent(new Event("change"));
  await flush(el);
  for (const id of ["p1", "p2", "p3"])
    expect(q(el, `[data-test="printer-row-${id}"]`)).not.toBeNull();
});

it("keeps disabled printers under the disabled status filter", async () => {
  const onlyDisabled = [{ ...printers[1]!, active: false }];
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
    api: stubApi({ listPrinters: vi.fn().mockResolvedValue(onlyDisabled) }),
  });
  await flush(el);
  await selectTab(el, "printers");
  expect(q(el, '[name="status-filter"]')).not.toBeNull();
  expect(q(el, "[data-test=printer-row-p2]")).toBeNull();
  await filterPrinters(el, "disabled");
  expect(q(el, "[data-test=printer-row-p2]")).not.toBeNull();
});

it.each(["usb", "bluetooth", "network_tcp"] as const)(
  "adds a disabled %s printer again by restoring its existing registration",
  async (transport) => {
    let active = false;
    const stored = {
      ...printers[2]!,
      name: "Saved kitchen name",
      transport,
      host: transport === "network_tcp" ? "10.0.0.88" : null,
      port: 9100,
      localKey: transport === "network_tcp" ? null : "SN-2",
    };
    const device = {
      ...discovered[1]!,
      transport,
      host: stored.host,
      port: stored.port,
      localKey: stored.localKey ?? undefined,
    };
    const api = stubApi({
      listPrinters: vi.fn().mockImplementation(async () => [{ ...stored, active }]),
      listDiscoveredPrinters: vi.fn().mockResolvedValue([device]),
      updatePrinter: vi.fn().mockImplementation(async () => {
        active = true;
      }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    const key = stored.localKey ?? "10.0.0.88:9100";
    const add = q(el, `[data-test="register-${key}"]`)!;
    expect(add).not.toBeNull();
    expect(add.textContent).toContain(t("printers.add_again"));
    await addDiscovered(el, add);
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p3", { active: true });
    expect(api.createPrinter).not.toHaveBeenCalled();
    expect(q(el, `[data-test="register-${key}"]`)).toBeNull();
    await vi.waitFor(() =>
      expect(text(el, "[data-test=printer-row-p3]")).toContain("Saved kitchen name"),
    );
    expect(q(el, "[data-test=calibration-step-1]")?.checkVisibility()).toBe(true);
  },
);

it("keeps a disabled printer available when adding it again fails", async () => {
  const api = stubApi({
    listDiscoveredPrinters: vi.fn().mockResolvedValue([discovered[1]!]),
    updatePrinter: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  await openDiscovery(el);
  await addDiscovered(el, q(el, "[data-test=register-SN-2]")!);
  await flush(el);
  expect(api.createPrinter).not.toHaveBeenCalled();
  expect(q(el, "[data-test=register-SN-2]")).not.toBeNull();
  expect(text(el, "[role=alert]")).toContain(codeMessage("printer.not_found"));
});

it.each(["printer-row-p1", "job-printer-j1"])(
  "opens printer status then its editor from %s",
  async (selector) => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(),
    });
    await flush(el);
    await selectTab(el, selector.startsWith("printer-row") ? "printers" : "queue");
    q(el, `[data-test=${selector}]`)!.click();
    await flush(el);
    expect(q(el, "[data-test=printer-status]")?.checkVisibility()).toBe(true);
    expect(q(el, "[data-test=edit-printer-modal]")).toBeNull();
    expect(text(el, "[data-test=printer-status]")).toContain("10.0.0.9:9100");
    q(el, "[data-test=edit-printer-details]")!.click();
    await flush(el);
    expect(q(el, "[data-test=edit-printer-modal]")?.checkVisibility()).toBe(true);
    expect((q(el, "[data-test=printer-name-p1]") as import("@waitron/ui").WtInput)?.value).toBe(
      "Cocina",
    );
  },
);

it("shows the saved drawer independently of register assignment and the delivering agent without discovery", async () => {
  const api = stubApi({
    listPrinters: vi.fn().mockResolvedValue([
      {
        ...printers[0]!,
        hasCashDrawer: true,
        lastPrintAgentId: "a1",
        lastPrintAt: "2026-09-26T14:00:00.000Z",
      },
    ]),
    listTills: vi.fn().mockResolvedValue([]),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  await selectTab(el, "printers");
  expect(text(el, "[data-test=printer-agent-p1]")).toBe("Cocina agent");
  q(el, "[data-test=printer-row-p1]")!.click();
  await flush(el);
  expect(text(el, "[data-test=printer-drawer]")).toBe(t("printers.yes"));
  expect(text(el, "[data-test=printer-registers]")).toBe(t("printers.no"));
  expect(text(el, "[data-test=printer-status]")).toContain("2026-09-26 14:00");
});

it("reopens printer status from its URL and reflects a saved drawer choice", async () => {
  history.replaceState(null, "", "/manage/printers/view/printers/printer/p1?keep=yes");
  let stored = { ...printers[0]! };
  const api = stubApi({
    listPrinters: vi.fn().mockImplementation(async () => [stored]),
    updatePrinter: vi.fn().mockImplementation(async (_id, patch) => {
      stored = { ...stored, ...patch };
    }),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  expect(text(el, "[data-test=printer-drawer]")).toBe(t("printers.no"));
  q(el, "[data-test=edit-printer-details]")!.click();
  await flush(el);
  toggleSwitch(el, '[name="printer-cash-drawer"]', true);
  await flush(el);
  q(el, "[data-test=save-printer-p1]")!.click();
  await flush(el);
  expect(q(el, "[data-test=edit-printer-modal]")).toBeNull();
  expect(text(el, "[data-test=printer-drawer]")).toBe(t("printers.yes"));
  q(el, "[data-test=back-to-printers]")!.click();
  await flush(el);
  expect(location.pathname).toBe("/manage/printers/view/printers");
  expect(location.search).toBe("?keep=yes");
  expect(q(el, "[data-test=printers-table]")!.checkVisibility()).toBe(true);
  q(el, "[data-test=printer-row-p1]")!.click();
  await flush(el);
  expect(location.pathname).toBe("/manage/printers/view/printers/printer/p1");
  history.replaceState(null, "", "/manage/printers/view/printers");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await flush(el);
  expect(q(el, "[data-test=printer-status]")).toBeNull();
});

it("keeps printer status live without replacing an open editing draft", async () => {
  history.replaceState(null, "", "/manage/printers/view/printers/printer/p1");
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=edit-printer-details]")!.click();
  await flush(el);
  typeField(el, "[data-test=printer-name-p1]", "Unsaved name");
  vi.mocked(api.listPrinters).mockResolvedValue([
    {
      ...printers[0]!,
      name: "Updated printer",
      lastPrintAgentId: "a1",
      lastPrintAt: "2026-09-26T16:00:00.000Z",
    },
  ]);
  liveData.invalidate([{ type: "print_jobs", id: "j1" }]);
  await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
  await flush(el);
  expect(text(el, "[data-test=printer-status]")).toContain("Cocina agent");
  expect(text(el, "[data-test=printer-status]")).toContain("2026-09-26 16:00");
  expect((q(el, "[data-test=printer-name-p1]") as import("@waitron/ui").WtInput).value).toBe(
    "Unsaved name",
  );
});

it("explains an unknown printer URL and lets you return to the list", async () => {
  history.replaceState(null, "", "/manage/printers/view/printers/printer/missing");
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api: stubApi() });
  await flush(el);
  expect(text(el, '[role="status"]')).toContain(codeMessage("printer.not_found"));
  q(el, "[data-test=back-to-printers]")!.click();
  await flush(el);
  expect(q(el, "[data-test=printer-row-p1]")).not.toBeNull();
});

it("shows the newest observing agent even when discovery entries arrive out of order", async () => {
  const device = discovered[1]!;
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
    api: stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue([
        {
          ...device,
          agentId: "a2",
          agentName: "Barra agent",
          lastSeenAt: "2026-09-26T13:00:00.000Z",
        },
        device,
      ]),
    }),
  });
  await flush(el);
  await filterPrinters(el, "all");
  expect(text(el, "[data-test=printer-agent-p3]")).toBe("Barra agent");
  expect(text(el, "[data-test=printer-last-seen-p3]")).toContain("2026-09-26 13:00");
});

it("labels Reprint and separates it visibly from View printout", async () => {
  const { el, host } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
    api: stubApi(),
  });
  await flush(el);
  await selectTab(el, "queue");
  host.style.setProperty("--wt-space-2", "13px");
  await flush(el);
  const view = q(el, "[data-test=view-job-j2]")!;
  const reprint = q(el, "[data-test=resend-job-j2]")!;
  expect.soft(reprint.textContent?.trim()).toBe("Reimprimir");
  expect(reprint.getBoundingClientRect().left - view.getBoundingClientRect().right).toBeCloseTo(13);
});

it("offers resend for eligible jobs and enqueues the selected document only once while pending", async () => {
  let resolve!: (value: { jobId: string }) => void;
  const api = stubApi({
    resendPrintJob: vi.fn().mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    ),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  expect(q(el, "[data-test=resend-job-j1]")).toBeNull();
  const button = q(el, "[data-test=resend-job-j2]")!;
  expect(button).not.toBeNull();
  button.click();
  button.click();
  await flush(el);
  expect(api.resendPrintJob).toHaveBeenCalledExactlyOnceWith("j2");
  expect((q(el, "[data-test=resend-job-j2]") as import("@waitron/ui").WtButton).disabled).toBe(
    true,
  );
  resolve({ jobId: "resent" });
  await flush(el);
  expect(api.listRecentJobs).toHaveBeenCalledTimes(2);
  expect((q(el, "[data-test=resend-job-j2]") as import("@waitron/ui").WtButton).disabled).toBe(
    false,
  );
});

it("shows a localized resend failure and permits another attempt", async () => {
  const api = stubApi({
    resendPrintJob: vi.fn().mockRejectedValue({ code: "print_job.not_resendable" }),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=resend-job-j2]")!.click();
  await flush(el);
  expect(text(el, "[role=alert]")).toContain(codeMessage("print_job.not_resendable", "es-ES"));
  expect((q(el, "[data-test=resend-job-j2]") as import("@waitron/ui").WtButton).disabled).toBe(
    false,
  );
  expect(api.listRecentJobs).toHaveBeenCalledTimes(1);
});

it("keeps pairing open, polls passively, and makes Scan usable again after listening", async () => {
  const background = {
    joinRequests: vi.fn().mockResolvedValue(pending),
    openPairingMode: vi.fn().mockResolvedValue({ openUntil: OPEN.openUntil }),
    renewPairingMode: vi.fn().mockResolvedValue({ openUntil: OPEN.openUntil }),
  };
  const api = stubApi({ background: background as unknown as DashboardApi });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  vi.useFakeTimers();
  try {
    q(el, "[data-test=open-add-agent]")!.click();
    await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS);
    await el.updateComplete;
    await settleTree(el.shadowRoot!);
    expect(background.joinRequests).toHaveBeenCalledWith("print_agent");
    expect(q(el, "[data-test=scan-agents]")!.shadowRoot!.querySelector("button")!.disabled).toBe(
      false,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(background.renewPairingMode).toHaveBeenCalled();
    const scans = background.joinRequests.mock.calls.length;
    el.remove();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.closePairingMode).toHaveBeenCalledOnce();
    expect(background.joinRequests).toHaveBeenCalledTimes(scans);
  } finally {
    vi.useRealTimers();
  }
});

it("closes a pending pairing open after the modal is dismissed", async () => {
  let resolve!: (value: { openUntil: string | null }) => void;
  const api = stubApi({
    openPairingMode: vi.fn().mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    ),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=open-add-agent]")!.click();
  await flush(el);
  q(el, "[data-test=cancel-new-agent]")!.click();
  await flush(el);
  expect(api.closePairingMode).not.toHaveBeenCalled();
  resolve({ openUntil: OPEN.openUntil });
  await flush(el);
  expect(api.closePairingMode).toHaveBeenCalledOnce();
  expect(q(el, "[data-test=new-agent-modal]")).toBeNull();
});

it("reports a failed pairing close after dismissing the modal", async () => {
  const api = stubApi({ closePairingMode: vi.fn().mockRejectedValue({ code: "server.internal" }) });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=open-add-agent]")!.click();
  await flush(el);
  q(el, "[data-test=cancel-new-agent]")!.click();
  await flush(el);
  expect(text(el, "[role=alert]")).toContain(codeMessage("server.internal"));
});

it.each(["agent", "printer"])(
  "sizes the Add %s modal to the full dialog width on desktop",
  async (kind) => {
    await page.viewport(1280, 900);
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(),
    });
    await flush(el);
    q(el, `[data-test=open-add-${kind}]`)!.click();
    await flush(el);
    const dialog = q(el, `[data-test=new-${kind}-modal]`)!.shadowRoot!.querySelector("dialog")!;
    expect(dialog.getBoundingClientRect().width).toBeCloseTo(768, 0);
  },
);

it("distinguishes job statuses with coloured dots while preserving the status text", async () => {
  const allJobs = (["queued", "printing", "done", "failed"] as const).map((status) => ({
    ...jobs[0]!,
    id: status,
    status,
  }));
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
    api: stubApi({ listRecentJobs: vi.fn().mockResolvedValue(allJobs) }),
  });
  await flush(el);
  const colors = allJobs.map((job) => {
    const status = q(el, `[data-test=job-status-${job.id}]`)!;
    expect(status.textContent).toBe(jobStatusName(job.status));
    return getComputedStyle(status, "::before").backgroundColor;
  });
  expect(new Set(colors).size).toBe(4);
  expect(colors).not.toContain("rgba(0, 0, 0, 0)");
});

it("re-adds a printer after adding and disabling it in the same screen", async () => {
  let registered = false;
  let active = false;
  const device = discovered[0]!;
  const printer = { ...printers[2]!, id: "p9", localKey: "SN-1" };
  const api = stubApi({
    listPrinters: vi
      .fn()
      .mockImplementation(async () => (registered ? [{ ...printer, active }] : [])),
    listDiscoveredPrinters: vi
      .fn()
      .mockImplementation(async () => [
        { ...device, alreadyRegistered: registered, printerId: registered ? "p9" : null },
      ]),
    createPrinter: vi.fn().mockImplementation(async () => {
      registered = true;
      active = true;
      return { id: "p9" };
    }),
    deactivatePrinter: vi.fn().mockImplementation(async () => {
      active = false;
    }),
    updatePrinter: vi.fn().mockImplementation(async () => {
      active = true;
    }),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  await openDiscovery(el);
  await addDiscovered(el, q(el, "[data-test=register-SN-1]")!);
  await vi.waitFor(() => expect(q(el, "[data-test=calibration-step-1]")).not.toBeNull());
  q(el, "[data-test=cancel-edit-printer]")!.click();
  await flush(el);
  q(el, "[data-test=deactivate-printer-p9]")!.click();
  await flush(el);
  await openDiscovery(el);
  expect(text(el, "[data-test=register-SN-1]")).toBe(t("printers.add_again"));
  await addDiscovered(el, q(el, "[data-test=register-SN-1]")!);
  await flush(el);
  expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p9", { active: true });
  expect(api.createPrinter).toHaveBeenCalledOnce();
});

it("restores printer tabs from the URL and browser navigation", async () => {
  history.replaceState(null, "", "/manage/printers/view/agents?keep=yes");
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api: stubApi() });
  await flush(el);
  expect(
    q(el, "wt-tabs")!.shadowRoot!.querySelector("[aria-selected=true]")?.getAttribute("data-key"),
  ).toBe("agents");
  await selectTab(el, "printers");
  expect(location.pathname).toBe("/manage/printers/view/printers");
  expect(location.search).toBe("?keep=yes");
  history.back();
  await vi.waitFor(() => expect(location.pathname).toBe("/manage/printers/view/agents"));
  await flush(el);
  expect(
    q(el, "wt-tabs")!.shadowRoot!.querySelector("[aria-selected=true]")?.getAttribute("data-key"),
  ).toBe("agents");
});

it("ignores an old agent scan after closing and reopening the modal", async () => {
  let finishOld!: (rows: JoinRequestRow[]) => void;
  const oldRead = new Promise<JoinRequestRow[]>((resolve) => {
    finishOld = resolve;
  });
  const api = stubApi({
    joinRequests: vi
      .fn()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(oldRead)
      .mockResolvedValue([]),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=open-add-agent]")!.click();
  await flush(el);
  q(el, "[data-test=cancel-new-agent]")!.click();
  await flush(el);
  q(el, "[data-test=open-add-agent]")!.click();
  await flush(el);
  finishOld([{ ...pending[0]!, id: "old-request" }]);
  await flush(el);
  expect(q(el, "[data-test=join-row-old-request]")).toBeNull();
});

it("starts a fresh agent read immediately after reopening, without overlapping its new read", async () => {
  let finishOld!: (rows: JoinRequestRow[]) => void;
  let finishNew!: (rows: JoinRequestRow[]) => void;
  const oldRead = new Promise<JoinRequestRow[]>((resolve) => {
    finishOld = resolve;
  });
  const newRead = new Promise<JoinRequestRow[]>((resolve) => {
    finishNew = resolve;
  });
  const api = stubApi({
    joinRequests: vi
      .fn()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(oldRead)
      .mockReturnValueOnce(newRead)
      .mockResolvedValue([]),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    q(el, "[data-test=cancel-new-agent]")!.click();
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    expect(api.joinRequests).toHaveBeenCalledTimes(3);
    finishOld([{ ...pending[0]!, id: "old-request" }]);
    await flush(el);
    await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 2);
    expect(api.joinRequests).toHaveBeenCalledTimes(3);
    finishNew([{ ...pending[0]!, id: "new-request" }]);
    await flush(el);
    expect(q(el, "[data-test=join-row-new-request]")).not.toBeNull();
    expect(q(el, "[data-test=join-row-old-request]")).toBeNull();
  } finally {
    el.remove();
    vi.useRealTimers();
  }
});

it("does not open pairing when the screen leaves before the queued open starts", async () => {
  const api = stubApi();
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=open-add-agent]")!.click();
  el.remove();
  await vi.waitFor(() => expect(api.closePairingMode).toHaveBeenCalledOnce());
  expect(api.openPairingMode).not.toHaveBeenCalled();
});

it("retains the refused-request hint when pairing opens automatically", async () => {
  const api = stubApi({ pairingMode: vi.fn().mockResolvedValue({ ...SHUT, refusedRecently: 2 }) });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  q(el, "[data-test=open-add-agent]")!.click();
  await flush(el);
  expect(text(el, "[data-test=pairing-refused]")).toContain("2");
});

it("ignores a previous opening's pairing failure while the reopened dialog scans", async () => {
  let rejectOld!: (error: unknown) => void;
  const api = stubApi({
    openPairingMode: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject;
          }),
      )
      .mockImplementation(() => new Promise(() => {})),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  await selectTab(el, "agents");
  q(el, "[data-test=open-add-agent]")!.click();
  await flush(el);
  q(el, "[data-test=cancel-new-agent]")!.click();
  await flush(el);
  q(el, "[data-test=open-add-agent]")!.click();
  await flush(el);
  rejectOld({ code: "printer.not_found" });
  await flush(el);
  expect(q(el, "[role=alert]")).toBeNull();
  expect(q(el, "[data-test=scan-agents]")!.shadowRoot!.querySelector("button")!.disabled).toBe(
    true,
  );
});

it("does not show a previous pairing deadline after reopening before the next open completes", async () => {
  const api = stubApi({
    openPairingMode: vi
      .fn()
      .mockResolvedValueOnce({ openUntil: OPEN.openUntil })
      .mockImplementation(() => new Promise(() => {})),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  await selectTab(el, "agents");
  q(el, "[data-test=open-add-agent]")!.click();
  await flush(el);
  expect(q(el, "[data-test=pairing-until]")).not.toBeNull();
  q(el, "[data-test=cancel-new-agent]")!.click();
  await flush(el);
  q(el, "[data-test=open-add-agent]")!.click();
  await flush(el);
  expect(q(el, "[data-test=pairing-until]")).toBeNull();
});

describe("printer layout settings", () => {
  it("prints the finder even when an unfinished manual table field prevents saving", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");
    typeField(el, 'wt-input[name="printer-character-table"]', "");
    await flush(el);
    expect(
      (q(el, 'wt-input[name="printer-character-table"]') as import("@waitron/ui").WtInput).value,
    ).toBe("");
    q(el, '[data-test="print-character-tables-p1"]')!.click();
    await flush(el);
    expect(api.testCharacterTables).toHaveBeenCalledWith("p1", 0);
    q(el, '[data-test="save-printer-p1"]')!.click();
    await flush(el);
    expect(api.updatePrinter).not.toHaveBeenCalled();
  });

  it("keeps an operator-chosen code when reprinting the same range", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");
    q(el, '[data-test="print-character-tables-p1"]')!.click();
    await flush(el);
    await chooseOption(el, "printer-matching-code", "06-8");
    q(el, '[data-test="print-character-tables-p1"]')!.click();
    await flush(el);
    expect((q(el, 'select[name="printer-matching-code"]') as HTMLSelectElement).value).toBe("06-8");
    expect(api.testCharacterTables).toHaveBeenCalledTimes(2);
    await chooseOption(el, "printer-table-block", "16");
    await chooseOption(el, "printer-table-block", "0");
    expect((q(el, 'select[name="printer-matching-code"]') as HTMLSelectElement).value).toBe("06-8");
  });

  it("sets both saved text fields when switching from a matching code to plain letters", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");
    q(el, '[data-test="print-character-tables-p1"]')!.click();
    await flush(el);
    await chooseOption(el, "printer-matching-code", "06-8");
    await chooseOption(el, "printer-matching-code", "plain");
    expect((q(el, 'select[name="printer-matching-code"]') as HTMLSelectElement).value).toBe(
      "plain",
    );
    q(el, '[data-test="save-printer-p1"]')!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ characterSet: "plain", characterTable: 0 }),
    );
  });

  it("starts the finder at table zero and one printed code sets both text settings", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");
    const block = q(el, 'select[name="printer-table-block"]') as HTMLSelectElement;
    expect(block.value).toBe("0");
    expect(block.options[0]!.textContent).toContain("0–15");
    expect(
      q(el, 'wt-disclosure[data-test="advanced-character-settings"]')!.hasAttribute("open"),
    ).toBe(false);
    expect(q(el, '[data-test="finder-expected-W"]')).not.toBeNull();
    q(el, '[data-test="print-character-tables-p1"]')!.click();
    await flush(el);
    expect(api.testCharacterTables).toHaveBeenLastCalledWith("p1", 0);
    expect(q(el, '[data-test="finder-expected-W"]')!.textContent).toContain("áéíóú ÁÉÍÓÚ ñÑ üÜ");
    expect(q(el, '[data-test="finder-expected-W"]')!.textContent).toContain("¿¡ € £ çÇ “ ” ‘ ’");
    await chooseOption(el, "printer-table-block", "16");
    expect(q(el, 'select[name="printer-matching-code"] option[value="06-8"]')).toBeNull();
    expect(q(el, '[data-test="finder-expected-W"]')).not.toBeNull();
    q(el, '[data-test="print-character-tables-p1"]')!.click();
    await flush(el);
    expect(api.testCharacterTables).toHaveBeenLastCalledWith("p1", 16);
    expect(q(el, 'select[name="printer-matching-code"] option[value="16-8"]')).not.toBeNull();
    expect((q(el, 'select[name="printer-matching-code"]') as HTMLSelectElement).value).toBe("");
    await chooseOption(el, "printer-table-block", "0");
    q(el, '[data-test="print-character-tables-p1"]')!.click();
    await flush(el);
    await chooseOption(el, "printer-matching-code", "06-8");
    expect((q(el, 'select[name="printer-matching-code"]') as HTMLSelectElement).value).toBe("06-8");
    expect((q(el, 'select[name="printer-character-set"]') as HTMLSelectElement).value).toBe(
      "pc858",
    );
    expect(
      (q(el, 'wt-input[name="printer-character-table"]') as import("@waitron/ui").WtInput).value,
    ).toBe("6");
    q(el, '[data-test="save-printer-p1"]')!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        characterSet: "pc858",
        characterTable: 6,
      }),
    );
  });

  it("saves a changed paper width, resolution and character set with the connection fields", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");
    expect((q(el, 'select[name="printer-paper-width"]') as HTMLSelectElement).value).toBe("80mm");
    await chooseOption(el, "printer-paper-width", "58mm");
    await chooseOption(el, "printer-resolution", "203dpi");
    await chooseOption(el, "printer-character-set", "pc858");
    typeField(el, 'wt-input[name="printer-character-table"]', "19");
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
      name: "Cocina",
      host: "10.0.0.9",
      port: 9100,
      active: true,
      paperWidth: "58mm",
      resolution: "203dpi",
      characterSet: "pc858",
      characterTable: 19,
    });
  });

  it("refuses an empty printer table instead of silently saving table zero", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");
    typeField(el, 'wt-input[name="printer-character-table"]', "");
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).not.toHaveBeenCalled();
    const field = q(
      el,
      'wt-input[name="printer-character-table"]',
    ) as import("@waitron/ui").WtInput;
    expect(field.invalid).toBe(true);
    expect(field.error).toBe(t("printers.character_table_invalid"));
    expect(
      q(el, 'wt-disclosure[data-test="advanced-character-settings"]')!.hasAttribute("open"),
    ).toBe(true);
  });

  it("uses explicit width and resolution, and prints a sample from the calibration draft", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el);
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    expect(q(el, "[data-test=calibration-step-1]")!.checkVisibility()).toBe(true);
    await chooseOption(el, "printer-matching-code", "plain");
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    await chooseOption(el, "printer-paper-width", "58mm");
    await chooseOption(el, "printer-resolution", "203dpi");
    q(el, "[data-test=print-test-page-p1]")!.click();
    await flush(el);
    expect(api.testPrint).toHaveBeenCalledExactlyOnceWith("p1");
    expect(q(el, '[name="printer-test-line-fits"]')).toBeNull();
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=print-sample-receipt-p1]")!.click();
    await flush(el);
    expect(api.sampleReceipt).toHaveBeenCalledWith("p1", {
      paperWidth: "58mm",
      resolution: "203dpi",
      characterSet: "plain",
      characterTable: 0,
    });
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
      paperWidth: "58mm",
      resolution: "203dpi",
      characterSet: "plain",
      characterTable: 0,
    });
  });
});

describe("printer setup refinements", () => {
  it("keeps an empty printer filter and hides redundant tab headings", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({ listPrinters: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    expect(q(el, '[name="status-filter"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("wt-tabs h2").length).toBe(0);
  });

  it("puts the local agent marker in Host and removes row test printing", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(),
    });
    await flush(el);
    const marker = q(el, '[data-test="agent-provenance-a2"]')!;
    const cell = marker.closest("td")!;
    expect(cell.cellIndex).toBe(1);
    expect(q(el, '[data-test="test-print-p1"]')).toBeNull();
  });

  it("offers a prefilled name and validates it before adding", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    q(el, '[data-test="register-SN-1"]')!.click();
    await flush(el);
    expect(api.createPrinter).not.toHaveBeenCalled();
    expect(q(el, '[data-test="name-printer-modal"]')).not.toBeNull();
    const field = q(el, '[data-test="discovered-name-SN-1"]') as import("@waitron/ui").WtInput;
    expect(field.value).toBe("EPSON TM-T20");
    typeField(el, '[data-test="discovered-name-SN-1"]', "");
    q(el, '[data-test="confirm-add-printer"]')!.click();
    await flush(el);
    expect(api.createPrinter).not.toHaveBeenCalled();
    expect(field.invalid).toBe(true);
    typeField(el, '[data-test="discovered-name-SN-1"]', "  Kitchen  ");
    q(el, '[data-test="confirm-add-printer"]')!.click();
    await flush(el);
    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "Kitchen",
      transport: "usb",
      localKey: "SN-1",
    });
  });

  it("keeps device identity read-only and omits it from updates", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p3");
    expect(q(el, '[data-test="printer-local-key-p3"]')!.textContent).toContain("SN-2");
    expect(q(el, '[name="printer-localKey"]')).toBeNull();
    q(el, '[data-test="save-printer-p3"]')!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith("p3", { name: "Barra USB", active: false });
  });

  it("cancels calibration without saving its draft", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el);
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    await chooseOption(el, "printer-matching-code", "plain");
    q(el, "[data-test=cancel-edit-printer]")!.click();
    await flush(el);
    expect(api.updatePrinter).not.toHaveBeenCalled();
    await openPrinter(el);
    expect((q(el, '[name="printer-character-set"]') as HTMLSelectElement).value).toBe("wpc1252");
  });
});

it("keeps a reopened calibration independent of a pending earlier print", async () => {
  let rejectOld!: (reason: unknown) => void;
  const api = stubApi({
    testPrint: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOld = reject;
          }),
      )
      .mockResolvedValue({ jobId: "j-new", calibrationLocale: "es-ES" }),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  await openPrinter(el);
  q(el, '[data-test="print-test-page-p1"]')!.click();
  await flush(el);
  q(el, '[data-test="print-test-page-p1"]')!.click();
  expect(api.testPrint).toHaveBeenCalledOnce();
  q(el, '[data-test="cancel-edit-printer"]')!.click();
  await flush(el);
  await openPrinter(el);
  q(el, '[data-test="print-test-page-p1"]')!.click();
  await flush(el);
  expect(api.testPrint).toHaveBeenCalledTimes(2);
  rejectOld({ code: "printer.not_found" });
  await flush(el);
  expect(q(el, '[data-test="edit-printer-modal"]')!.textContent).not.toContain(
    codeMessage("printer.not_found"),
  );
});

describe("printers-screen agent joining edges", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
  });

  async function openAgentModal(api: DashboardApi): Promise<PrintersScreen> {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    return el;
  }

  async function openJoinDialog(api: DashboardApi): Promise<PrintersScreen> {
    const el = await openAgentModal(api);
    q(el, "[data-test=join-review-j1]")!.click();
    await vi.waitFor(() => expect(q(el, `[data-choice="${REAL_NUMBER}"]`)).not.toBeNull());
    return el;
  }

  const bodyRowTexts = (table: HTMLElement): string[] =>
    Array.from(table.shadowRoot!.querySelectorAll("tbody tr")).map((row) =>
      row.querySelector("td")!.textContent!.trim(),
    );

  it("closes the accept dialog when the dialog itself is dismissed", async () => {
    const el = await openJoinDialog(stubApi());

    q(el, "[data-test=join-dialog]")!.shadowRoot!.querySelector("dialog")!.close();

    await vi.waitFor(() => expect(q(el, "[data-test=join-dialog]")).toBeNull());
    expect(q(el, "[data-test=join-row-j1]")).not.toBeNull();
  });

  it("closes the open accept dialog when that same request is denied", async () => {
    const api = stubApi();
    const el = await openJoinDialog(api);

    q(el, "[data-test=join-deny-j1]")!.click();
    await el.updateComplete;
    q(el, "[data-test=join-deny-j1]")!.click();

    await vi.waitFor(() => expect(api.denyJoinRequest).toHaveBeenCalledWith("j1"));
    await vi.waitFor(() => expect(q(el, "[data-test=join-dialog]")).toBeNull());
    expect(q(el, "[data-test=join-row-j1]")).not.toBeNull();
  });

  it("shows a localized alert and keeps the request when a deny is rejected", async () => {
    const api = stubApi({
      denyJoinRequest: vi.fn().mockRejectedValue({ code: "join_request.not_found" }),
    });
    const el = await openAgentModal(api);
    const calls = vi.mocked(api.joinRequests).mock.calls.length;

    q(el, "[data-test=join-deny-j1]")!.click();
    await el.updateComplete;
    q(el, "[data-test=join-deny-j1]")!.click();

    await vi.waitFor(() =>
      expect(text(el, "[data-test=new-agent-modal] [role=alert]")).toBe(
        codeMessage("join_request.not_found"),
      ),
    );
    expect(q(el, "[data-test=join-row-j1]")).not.toBeNull();
    expect(api.joinRequests).toHaveBeenCalledTimes(calls);
  });

  it("sends one accept when a number is tapped twice before the first answer", async () => {
    let release!: () => void;
    const answer = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = stubApi({ acceptPrintAgentJoinRequest: vi.fn().mockReturnValueOnce(answer) });
    const el = await openJoinDialog(api);
    const number = q(el, `[data-choice="${REAL_NUMBER}"]`)!;

    number.click();
    number.click();
    release();

    await vi.waitFor(() => expect(q(el, "[data-test=join-dialog]")).toBeNull());
    expect(api.acceptPrintAgentJoinRequest).toHaveBeenCalledTimes(1);
  });

  it("reports the queue reload's own failure after a mismatch closes the dialog", async () => {
    const api = stubApi({
      acceptPrintAgentJoinRequest: vi.fn().mockRejectedValue({ code: "device.join_mismatch" }),
    });
    const el = await openJoinDialog(api);
    vi.mocked(api.joinRequests).mockRejectedValue({ code: "connection.failed" });

    q(el, '[data-choice="12"]')!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=join-dialog]")).toBeNull());
    await vi.waitFor(() =>
      expect(text(el, "[data-test=new-agent-modal] [role=alert]")).toBe(
        codeMessage("connection.failed"),
      ),
    );
  });

  it("opens pairing once when Add agent is pressed twice", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    const add = q(el, "[data-test=open-add-agent]")!;

    add.click();
    add.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pairing-until]")).not.toBeNull());
    expect(api.openPairingMode).toHaveBeenCalledOnce();
  });

  it("ignores Scan while an agent scan is still listening, and rescans once it has finished", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      q(el, "[data-test=open-add-agent]")!.click();
      await flush(el);
      expect(api.openPairingMode).toHaveBeenCalledOnce();

      q(el, "[data-test=scan-agents]")!.click();
      await flush(el);
      expect(api.openPairingMode).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS + SCAN_POLL_MS);
      await flush(el);
      q(el, "[data-test=scan-agents]")!.click();
      await flush(el);
      expect(api.openPairingMode).toHaveBeenCalledTimes(2);
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("reports a failed agent-queue read inside the modal and stops the busy scan", async () => {
    const api = stubApi({
      joinRequests: vi
        .fn()
        .mockResolvedValueOnce(pending)
        .mockRejectedValue({ code: "management_session.expired" }),
    });
    const el = await openAgentModal(api);

    await vi.waitFor(() =>
      expect(text(el, "[data-test=new-agent-modal] [data-test=printer-refresh-error]")).toContain(
        codeMessage("management_session.expired"),
      ),
    );
    expect(
      q(el, "[data-test=scan-agents]")!
        .shadowRoot!.querySelector("button")!
        .getAttribute("aria-busy"),
    ).not.toBe("true");
  });

  it("ignores an old agent-queue failure after the modal was closed and reopened", async () => {
    let failOld!: (reason: unknown) => void;
    const oldRead = new Promise<JoinRequestRow[]>((_, reject) => {
      failOld = reject;
    });
    const api = stubApi({
      joinRequests: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockReturnValueOnce(oldRead)
        .mockResolvedValue([]),
    });
    const el = await openAgentModal(api);
    q(el, "[data-test=cancel-new-agent]")!.click();
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    failOld({ code: "management_session.expired" });
    await flush(el);

    expect(q(el, "[data-test=printer-refresh-error]")).toBeNull();
  });

  it("opens the window before the first pairing read arrives, and a close before the open finishes leaves no deadline", async () => {
    let finishOpen!: (value: { openUntil: string | null }) => void;
    const api = stubApi({
      pairingMode: vi.fn().mockReturnValue(new Promise(() => {})),
      openPairingMode: vi
        .fn()
        .mockReturnValueOnce(
          new Promise((resolve) => {
            finishOpen = resolve;
          }),
        )
        .mockResolvedValue({ openUntil: OPEN.openUntil }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    expect(q(el, "[data-test=pairing-until]")).toBeNull();
    expect(q(el, "[data-test=pairing-refused]")).toBeNull();
    q(el, "[data-test=cancel-new-agent]")!.click();
    await flush(el);
    finishOpen({ openUntil: OPEN.openUntil });
    await flush(el);
    await vi.waitFor(() => expect(api.closePairingMode).toHaveBeenCalledOnce());

    q(el, "[data-test=open-add-agent]")!.click();
    await vi.waitFor(() =>
      expect(text(el, "[data-test=pairing-until]")).toBe(
        t("printers.pairing_open_until").replace("{time}", "2026-09-08 10:20"),
      ),
    );
    expect(q(el, "[data-test=pairing-refused]")).toBeNull();
  });

  it("saves a renamed agent when Enter is pressed in its name field", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=edit-agent-a1]")!.click();
    await flush(el);
    typeField(el, "[data-test=edit-agent-name]", "Kitchen Pi");
    await flush(el);

    q(el, "[data-test=edit-agent-name]")!
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );

    await vi.waitFor(() =>
      expect(api.updateAgent).toHaveBeenCalledWith("a1", { name: "Kitchen Pi" }),
    );
  });

  it("does nothing when a Save from a closed agent editor is pressed", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=edit-agent-a1]")!.click();
    await flush(el);
    const staleSave = q(el, "[data-test=save-agent]")!;
    q(el, "[data-test=cancel-edit-agent]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-agent-modal]")).toBeNull());

    staleSave.click();
    await flush(el);

    expect(api.updateAgent).not.toHaveBeenCalled();
    expect(q(el, "[role=alert]")).toBeNull();
  });

  it("sorts the agents by name and by last seen", async () => {
    const rows: PrintAgentRow[] = [
      { ...agents[0]!, id: "a-z", name: "Zeta", lastSeenAt: "2026-08-01T00:00:00.000Z" },
      { ...agents[0]!, id: "a-a", name: "Alpha", lastSeenAt: "2026-08-30T00:00:00.000Z" },
      { ...agents[0]!, id: "a-m", name: "Mid", lastSeenAt: "2026-08-15T00:00:00.000Z" },
    ];
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({ listAgents: vi.fn().mockResolvedValue(rows) }),
    });
    await flush(el);
    const table = q(el, "[data-test=agents-table]")!;
    const sortBy = async (key: string) => {
      table.shadowRoot!.querySelector<HTMLButtonElement>(`button[data-sort=${key}]`)!.click();
      await flush(el);
    };

    await sortBy("name");
    expect(bodyRowTexts(table)).toEqual(["Alpha", "Mid", "Zeta"]);
    await sortBy("lastSeen");
    expect(bodyRowTexts(table)).toEqual(["Zeta", "Mid", "Alpha"]);
  });
});

describe("printers-screen tabs, tables and refresh edges", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
  });

  const selectedTab = (el: PrintersScreen) =>
    q(el, "wt-tabs")!.shadowRoot!.querySelector("[aria-selected=true]")?.getAttribute("data-key");

  const bodyRowTexts = (table: HTMLElement): string[] =>
    Array.from(table.shadowRoot!.querySelectorAll("tbody tr")).map((row) =>
      row.querySelector("td")!.textContent!.trim(),
    );

  async function sortBy(el: PrintersScreen, table: HTMLElement, key: string): Promise<void> {
    table.shadowRoot!.querySelector<HTMLButtonElement>(`button[data-sort=${key}]`)!.click();
    await flush(el);
  }

  it("records the chosen first tab in the address when the printers page opened without one", async () => {
    history.replaceState(null, "", "/manage/printers");
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(),
    });
    await flush(el);

    expect(selectedTab(el)).toBe("queue");
    expect(location.pathname).toBe("/manage/printers/view/queue");
  });

  it("replaces an unknown tab in the address with the useful first tab, before and after loading", async () => {
    history.replaceState(null, "", "/manage/printers/view/bogus");
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({ listPrinters: vi.fn().mockResolvedValue([]) }),
    });
    await flush(el);
    expect(selectedTab(el)).toBe("printers");
    expect(location.pathname).toBe("/manage/printers/view/printers");

    await selectTab(el, "agents");
    history.pushState(null, "", "/manage/printers/view/other-bogus");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);

    expect(selectedTab(el)).toBe("printers");
    expect(location.pathname).toBe("/manage/printers/view/printers");
  });

  it("does not switch tabs for a change event raised by a control inside a tab", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(),
    });
    await flush(el);
    await selectTab(el, "printers");
    const path = location.pathname;

    q(el, "[data-test=printers-table]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "agents" }, bubbles: true, composed: true }),
    );
    await flush(el);

    expect(selectedTab(el)).toBe("printers");
    expect(location.pathname).toBe(path);
  });

  it("retries a failed list load from the refresh button", async () => {
    const api = stubApi({
      listPrinters: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue(printers),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    expect(text(el, "[data-test=printer-refresh-error]")).toContain(
      codeMessage("connection.failed"),
    );

    q(el, "[data-test=refresh-printer-lists]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=printer-refresh-error]")).toBeNull());
    await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
    expect(q(el, "[data-test=printer-row-p1]")).not.toBeNull();
  });

  it("shows a network printer with no port by its host alone", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({
        listPrinters: vi.fn().mockResolvedValue([{ ...printers[0]!, port: null }]),
      }),
    });
    await flush(el);
    await selectTab(el, "printers");

    q(el, "[data-test=printer-row-p1]")!.click();
    await flush(el);
    const cells = Array.from(q(el, "[data-test=printer-status]")!.querySelectorAll("dd")).map(
      (cell) => cell.textContent!.trim(),
    );
    expect(cells).toContain("10.0.0.9");
    expect(cells.some((cell) => cell.startsWith("10.0.0.9:"))).toBe(false);
  });

  it("sorts the printers by name, pending jobs and last print", async () => {
    const rows: Printer[] = [
      {
        ...printers[0]!,
        id: "p-b",
        name: "Bravo",
        pendingJobs: 3,
        lastPrintAt: "2026-08-01T00:00:00.000Z",
      },
      {
        ...printers[0]!,
        id: "p-c",
        name: "Charlie",
        pendingJobs: 1,
        lastPrintAt: "2026-08-20T00:00:00.000Z",
      },
      {
        ...printers[0]!,
        id: "p-a",
        name: "Alpha",
        pendingJobs: 2,
        lastPrintAt: "2026-08-10T00:00:00.000Z",
      },
    ];
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({ listPrinters: vi.fn().mockResolvedValue(rows) }),
    });
    await flush(el);
    await selectTab(el, "printers");
    const table = q(el, "[data-test=printers-table]")!;

    await sortBy(el, table, "name");
    expect(bodyRowTexts(table)).toEqual(["Alpha", "Bravo", "Charlie"]);
    await sortBy(el, table, "pending");
    expect(bodyRowTexts(table)).toEqual(["Charlie", "Alpha", "Bravo"]);
    await sortBy(el, table, "lastPrint");
    expect(bodyRowTexts(table)).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  it("sorts the recent jobs by attempts, queued time and delivered time", async () => {
    const rows: PrintJobRow[] = [
      {
        ...jobs[1]!,
        id: "jb",
        printerId: "p1",
        attempts: 3,
        createdAt: "2026-08-25T12:00:00.000Z",
        deliveredAt: "2026-08-25T12:30:00.000Z",
      },
      {
        ...jobs[1]!,
        id: "jc",
        printerId: "p2",
        attempts: 1,
        createdAt: "2026-08-25T14:00:00.000Z",
        deliveredAt: "2026-08-25T14:01:00.000Z",
      },
      {
        ...jobs[1]!,
        id: "ja",
        printerId: "p3",
        attempts: 2,
        createdAt: "2026-08-25T13:00:00.000Z",
        deliveredAt: "2026-08-25T15:00:00.000Z",
      },
    ];
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({ listRecentJobs: vi.fn().mockResolvedValue(rows) }),
    });
    await flush(el);
    const table = q(el, "[data-test=jobs-table]")!;

    await sortBy(el, table, "attempts");
    expect(bodyRowTexts(table)).toEqual(["Nube", "Barra USB", "Cocina"]);
    await sortBy(el, table, "queued");
    expect(bodyRowTexts(table)).toEqual(["Cocina", "Barra USB", "Nube"]);
    await sortBy(el, table, "delivered");
    expect(bodyRowTexts(table)).toEqual(["Cocina", "Nube", "Barra USB"]);
  });
});

describe("printers-screen discovery and add edges", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
  });

  async function mountWithDiscovered(
    devices: DiscoveredPrinter[],
    overrides: Partial<DashboardApi> = {},
  ) {
    const api = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue(devices),
      ...overrides,
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    return { el, api };
  }

  it("maps a refused port to the port field", async () => {
    const probe = vi
      .fn()
      .mockRejectedValue({ code: "management.request_invalid", params: { field: "port" } });
    const { el } = await mountWithDiscovered([], { probePrinterAddress: probe });
    typeField(el, "[data-test=probe-host]", "printer.local");
    typeField(el, "[data-test=probe-port]", "9100");

    q(el, "[data-test=probe-printer]")!.click();

    await vi.waitFor(() =>
      expect((q(el, "[data-test=probe-port]") as unknown as { error: string }).error).toBe(
        t("printers.port_invalid"),
      ),
    );
    expect((q(el, "[data-test=probe-host]") as unknown as { error: string }).error).toBe("");
    expect((q(el, "[data-test=probe-errors]") as unknown as { errors: string[] }).errors).toEqual([
      t("printers.port_invalid"),
    ]);
    expect(q(el, "[data-test=new-printer-modal] [role=alert]")).toBeNull();
  });

  it("ignores a listen re-read that fails after Add printer was closed", async () => {
    let failRead!: (reason: unknown) => void;
    const passive = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          failRead = reject;
        }),
    );
    const api = stubApi({ background: stubApi({ listDiscoveredPrinters: passive }) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(passive).toHaveBeenCalledOnce();
      q(el, "[data-test=cancel-new-printer]")!.click();
      await flush(el);

      failRead({ code: "management_session.expired" });
      await flush(el);

      expect(q(el, "[data-test=printer-refresh-error]")).toBeNull();
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("offers and registers a network printer that reported no port on the default port", async () => {
    const device: DiscoveredPrinter = { ...discoveredNetwork[0]!, port: null };
    const { el, api } = await mountWithDiscovered([device]);
    const key = "10.0.0.77:9100";
    expect(text(el, `[data-test='discovered-row-${key}']`)).toContain("10.0.0.77:9100");

    q(el, `[data-test='register-${key}']`)!.click();
    await flush(el);
    expect(text(el, "[data-test=name-printer-modal] .hint")).toBe("Kitchen IP · 10.0.0.77:9100");
    q(el, "[data-test=confirm-add-printer]")!.click();

    await vi.waitFor(() =>
      expect(api.createPrinter).toHaveBeenCalledWith({
        name: "Kitchen IP",
        transport: "network_tcp",
        host: "10.0.0.77",
        port: 9100,
      }),
    );
  });

  it("adds a disabled registration again under its existing id, sending a changed name", async () => {
    const device: DiscoveredPrinter = { ...discovered[1]! };
    const { el, api } = await mountWithDiscovered([device]);
    expect(text(el, "[data-test=register-SN-2]")).toBe(t("printers.add_again"));
    q(el, "[data-test=register-SN-2]")!.click();
    await flush(el);
    expect((q(el, "[data-test=discovered-name-SN-2]") as unknown as { value: string }).value).toBe(
      "Barra USB",
    );

    typeField(el, "[data-test=discovered-name-SN-2]", "Barra nueva");
    q(el, "[data-test=confirm-add-printer]")!.click();

    await vi.waitFor(() =>
      expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p3", {
        active: true,
        name: "Barra nueva",
      }),
    );
    expect(api.createPrinter).not.toHaveBeenCalled();
  });

  it("omits the seen-on line for a discovered device no agent name is known for", async () => {
    const { el } = await mountWithDiscovered([{ ...discovered[0]!, agentName: null }]);

    const row = text(el, "[data-test=discovered-row-SN-1]")!;
    expect(row).toContain("EPSON TM-T20");
    expect(row).not.toContain(t("printers.discovered_seen_on").replace("{agent}", "").trim());
  });

  it("adds the named printer when Enter is pressed in the name field", async () => {
    const { el, api } = await mountWithDiscovered(discovered);
    q(el, "[data-test=register-SN-1]")!.click();
    await flush(el);

    q(el, "[data-test=discovered-name-SN-1]")!
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );

    await vi.waitFor(() =>
      expect(api.createPrinter).toHaveBeenCalledWith({
        name: "EPSON TM-T20",
        transport: "usb",
        localKey: "SN-1",
      }),
    );
  });

  it("ignores another device's Add while a registration is in flight", async () => {
    let release!: () => void;
    const create = vi.fn().mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ id: "p9" });
      }),
    );
    const { el, api } = await mountWithDiscovered([...discovered, ...discoveredNetwork], {
      createPrinter: create,
    });
    q(el, "[data-test=register-SN-1]")!.click();
    await flush(el);
    q(el, "[data-test=confirm-add-printer]")!.click();
    await el.updateComplete;

    q(el, "[data-test='register-10.0.0.77:9100']")!.click();
    await el.updateComplete;

    expect(q(el, "[data-test=discovered-name-SN-1]")).not.toBeNull();
    expect(q(el, "[data-test='discovered-name-10.0.0.77:9100']")).toBeNull();
    release();
    await vi.waitFor(() => expect(q(el, "[data-test=name-printer-modal]")).toBeNull());
    expect(api.createPrinter).toHaveBeenCalledOnce();
  });

  it("still reloads without an error when the name dialog was cancelled while its add was in flight", async () => {
    let release!: () => void;
    const create = vi.fn().mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ id: "p9" });
      }),
    );
    const { el, api } = await mountWithDiscovered(discovered, { createPrinter: create });
    q(el, "[data-test=register-SN-1]")!.click();
    await flush(el);
    q(el, "[data-test=confirm-add-printer]")!.click();
    await el.updateComplete;
    q(el, "[data-test=cancel-printer-name]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=name-printer-modal]")).toBeNull());

    release();

    await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(q(el, "[data-test=calibration-step-1]")?.checkVisibility()).toBe(true);
    expect(q(el, "[data-test=new-printer-modal] [role=alert]")).toBeNull();
  });
});

describe("printers-screen printer editor edges", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
  });

  async function mountEditing(id = "p1", overrides: Partial<DashboardApi> = {}) {
    const api = stubApi(overrides);
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, id);
    return { el, api };
  }

  const summaryErrors = (el: PrintersScreen): string[] =>
    (
      q(el, "[data-test=edit-printer-modal] wt-form-error-summary") as unknown as {
        errors: string[];
      }
    ).errors;

  it("keeps a late change from a closed editor out of the next printer's draft", async () => {
    const { el, api } = await mountEditing("p1");
    const staleName = q(el, "[data-test=printer-name-p1]")!;
    q(el, "[data-test=cancel-edit-printer]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-printer-modal]")).toBeNull());
    await openPrinter(el, "p3");

    staleName.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Leaked" }, bubbles: true, composed: true }),
    );
    q(el, "[data-test=save-printer-p3]")!.click();

    await vi.waitFor(() =>
      expect(api.updatePrinter).toHaveBeenCalledWith("p3", { name: "Barra USB", active: false }),
    );
  });

  it("does nothing when a Save from a closed printer editor is pressed", async () => {
    const { el, api } = await mountEditing("p1");
    const staleSave = q(el, "[data-test=save-printer-p1]")!;
    q(el, "[data-test=cancel-edit-printer]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-printer-modal]")).toBeNull());

    staleSave.click();
    await flush(el);

    expect(api.updatePrinter).not.toHaveBeenCalled();
    expect(q(el, "[role=alert]")).toBeNull();
  });

  it("refuses a port outside 1 to 65535", async () => {
    const { el, api } = await mountEditing("p1");
    typeField(el, "[data-test=printer-port-p1]", "70000");
    await el.updateComplete;

    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);

    expect(api.updatePrinter).not.toHaveBeenCalled();
    expect((q(el, "[data-test=printer-port-p1]") as unknown as { error: string }).error).toBe(
      t("printers.port_invalid"),
    );
  });

  it.each([
    ["usb", { ...printers[2]!, localKey: null }, "printers.device_required"],
    [
      "bluetooth",
      { ...printers[2]!, transport: "bluetooth", localKey: "  " },
      "printers.device_required",
    ],
    ["cloud_poll", { ...printers[1]!, pollId: null }, "printers.poll_required"],
  ] as const)(
    "refuses to save a %s printer with no device identity",
    async (_transport, row, message) => {
      const { el, api } = await mountEditing(row.id, {
        listPrinters: vi.fn().mockResolvedValue([row as Printer]),
      });

      q(el, `[data-test=save-printer-${row.id}]`)!.click();
      await flush(el);

      expect(api.updatePrinter).not.toHaveBeenCalled();
      expect(summaryErrors(el)).toEqual([t(message)]);
    },
  );

  it("refuses a sample receipt while the printer has no name", async () => {
    const { el, api } = await mountEditing("p1");
    typeField(el, "[data-test=printer-name-p1]", "  ");
    await el.updateComplete;

    q(el, "[data-test=print-sample-receipt-p1]")!.click();
    await flush(el);

    expect(api.sampleReceipt).not.toHaveBeenCalled();
    expect((q(el, "[data-test=printer-name-p1]") as unknown as { error: string }).error).toBe(
      t("form.name_required"),
    );
  });

  it("prints one sample receipt when the button is pressed twice", async () => {
    let release!: () => void;
    const { el, api } = await mountEditing("p1", {
      sampleReceipt: vi.fn().mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve({ jobId: "j10" });
        }),
      ),
    });
    const sample = q(el, "[data-test=print-sample-receipt-p1]")!;

    sample.click();
    sample.click();
    release();

    await vi.waitFor(() => expect(api.listRecentJobs).toHaveBeenCalledTimes(2));
    expect(api.sampleReceipt).toHaveBeenCalledOnce();
  });

  it("shows a localized alert in the editor when a sample receipt is rejected", async () => {
    const { el } = await mountEditing("p1", {
      sampleReceipt: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });

    q(el, "[data-test=print-sample-receipt-p1]")!.click();

    await vi.waitFor(() =>
      expect(text(el, "[data-test=edit-printer-modal] [role=alert]")).toBe(
        codeMessage("printer.not_found"),
      ),
    );
  });

  it("prints one character-table page when the button is pressed twice", async () => {
    let release!: () => void;
    const { el, api } = await mountEditing("p1", {
      testCharacterTables: vi.fn().mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve({ jobId: "j11", calibrationLocale: "es-ES" });
        }),
      ),
    });
    const tables = q(el, "[data-test=print-character-tables-p1]")!;

    tables.click();
    tables.click();
    release();

    await vi.waitFor(() => expect(q(el, '[data-test="finder-expected-W"]')).not.toBeNull());
    expect(api.testCharacterTables).toHaveBeenCalledOnce();
  });

  it("shows a localized alert in the editor when the character-table page is rejected", async () => {
    const { el } = await mountEditing("p1", {
      testCharacterTables: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });

    q(el, "[data-test=print-character-tables-p1]")!.click();

    await vi.waitFor(() =>
      expect(text(el, "[data-test=edit-printer-modal] [role=alert]")).toBe(
        codeMessage("printer.not_found"),
      ),
    );
    expect(q(el, '[data-test="finder-expected-W"]')).not.toBeNull();
  });

  it("does not adopt a character-table page's result after the table range changed", async () => {
    let release!: () => void;
    const { el, api } = await mountEditing("p1", {
      testCharacterTables: vi.fn().mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve({ jobId: "j11", calibrationLocale: "es-ES" });
        }),
      ),
    });
    q(el, "[data-test=print-character-tables-p1]")!.click();
    await el.updateComplete;
    await chooseOption(el, "printer-table-block", "16");

    release();

    await vi.waitFor(() => expect(api.listRecentJobs).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(q(el, '[data-test="finder-expected-W"]')).not.toBeNull();
    expect(q(el, 'select[name="printer-matching-code"] option[value="16-8"]')).not.toBeNull();
    expect(q(el, 'select[name="printer-matching-code"] option[value="00-8"]')).toBeNull();
    expect((q(el, 'select[name="printer-matching-code"]') as HTMLSelectElement).value).toBe("");
  });

  it("does not adopt a test page's result after its dialog was cancelled", async () => {
    let release!: () => void;
    const { el, api } = await mountEditing("p1", {
      testPrinterDrawer: vi.fn().mockResolvedValue({ jobId: "drawer-test" }),
      testPrint: vi.fn().mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve({ jobId: "j9", calibrationLocale: "es-ES" });
        }),
      ),
    });
    q(el, "[data-test=print-test-page-p1]")!.click();
    await flush(el);
    q(el, "[data-test=cancel-edit-printer]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-printer-modal]")).toBeNull());

    release();
    await flush(el);

    expect(api.listRecentJobs).toHaveBeenCalledOnce();
  });

  it("saves only the changed character settings, leaving width and resolution alone", async () => {
    const { el, api } = await mountEditing("p1");
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    await chooseOption(el, "printer-matching-code", "plain");
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=save-printer-p1]")!.click();
    await vi.waitFor(() =>
      expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
        characterSet: "plain",
        characterTable: 0,
      }),
    );
  });
  it("clears the matching-code choice once the character set no longer matches plain letters", async () => {
    const { el } = await mountEditing("p1");
    await chooseOption(el, "printer-matching-code", "plain");
    expect((q(el, 'select[name="printer-matching-code"]') as HTMLSelectElement).value).toBe(
      "plain",
    );

    await chooseOption(el, "printer-character-set", "pc858");

    expect((q(el, 'select[name="printer-matching-code"]') as HTMLSelectElement).value).toBe("");
  });

  it("leaves the character settings alone when the matching code is set back to Choose", async () => {
    const { el, api } = await mountEditing("p1");
    q(el, "[data-test=print-character-tables-p1]")!.click();
    await vi.waitFor(() => expect(q(el, '[data-test="finder-expected-W"]')).not.toBeNull());
    await chooseOption(el, "printer-matching-code", "06-8");

    await chooseOption(el, "printer-matching-code", "");

    expect((q(el, 'select[name="printer-character-set"]') as HTMLSelectElement).value).toBe(
      "pc858",
    );
    q(el, "[data-test=save-printer-p1]")!.click();
    await vi.waitFor(() =>
      expect(api.updatePrinter).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ characterSet: "pc858", characterTable: 6 }),
      ),
    );
  });
});

describe("printers-screen pairing renewal and stale scan edges", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/");
  });

  it("renews pairing through the screen's own client when it has no background client", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers();
    try {
      q(el, "[data-test=open-add-agent]")!.click();
      await vi.advanceTimersByTimeAsync(60_000 + SCAN_POLL_MS);
      await el.updateComplete;

      expect(api.renewPairingMode).toHaveBeenCalled();
      expect(q(el, "[data-test=new-agent-modal] [role=alert]")).toBeNull();
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("opens the window and shows its lapse time before the first pairing read has arrived", async () => {
    const api = stubApi({ pairingMode: vi.fn().mockReturnValue(new Promise(() => {})) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=open-add-agent]")!.click();

    await vi.waitFor(() =>
      expect(text(el, "[data-test=pairing-until]")).toBe(
        t("printers.pairing_open_until").replace("{time}", "2026-09-08 10:20"),
      ),
    );
    expect(q(el, "[data-test=pairing-refused]")).toBeNull();
  });

  it("does not start listening when Scan is pressed on an Add printer dialog that has closed", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    const staleScan = q(el, "[data-test=scan-printers]")!;
    q(el, "[data-test=cancel-new-printer]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=new-printer-modal]")).toBeNull());
    const reads = vi.mocked(api.listDiscoveredPrinters).mock.calls.length;

    staleScan.click();
    await vi.waitFor(() => expect(api.startPrinterDiscovery).toHaveBeenCalledTimes(2));
    await flush(el);

    expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(reads);
  });
});
