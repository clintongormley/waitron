import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { expectRowMenusOnScreen } from "@waitron/ui/src/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
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
import {
  AGENT_SCAN_LISTEN_MS,
  PrintersScreen,
  SCAN_LISTEN_MS,
  SCAN_POLL_MS,
} from "./printers-screen.js";
import { LiveData } from "@waitron/dashboard-kit";

beforeEach(() => {
  localStorage.removeItem("printers:agents:columns");
  localStorage.removeItem("printers:table:columns");
  localStorage.removeItem("printers:jobs:columns");
  sessionStorage.removeItem("printers:agents");
  sessionStorage.removeItem("printers:table");
  sessionStorage.removeItem("printers:jobs");
});
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
    renewPrinterDiscovery: vi.fn().mockResolvedValue({ discoveryUntil: Date.now() + 180_000 }),
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
  const table = q(el, '[data-test="printers-table"]')!;
  const select = table.shadowRoot!.querySelector<HTMLSelectElement>('[name="status-filter"]')!;
  select.value = value === "all" ? "" : value;
  select.dispatchEvent(new Event("change"));
  await flush(el);
}
async function filterAgents(el: PrintersScreen, value: string): Promise<void> {
  const table = q(el, '[data-test="agents-table"]')!;
  const select = table.shadowRoot!.querySelector<HTMLSelectElement>('[name="status-filter"]')!;
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

async function bottomOf(el: PrintersScreen, actions: string): Promise<string> {
  const row = q(el, actions) as HTMLElement & { updateComplete: Promise<unknown> };
  await row.updateComplete;
  return row.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}
/** A dialog's own action row, in its footer; the address check keeps a second row in the body. */
const footerOf = (modal: string): string => `[data-test=${modal}] > wt-form-actions[slot=footer]`;
/** A refusal paragraph at the top of a dialog. */
const topAlertOf = (el: PrintersScreen, modal: string) =>
  q(el, `[data-test=${modal}] p[role=alert]`);
const errorOf = (el: PrintersScreen, sel: string): string =>
  (q(el, sel) as unknown as { error: string }).error;
const isDisabled = (el: PrintersScreen, sel: string): boolean =>
  q(el, sel)!.hasAttribute("disabled");
const inputFocused = (el: PrintersScreen, sel: string): boolean => {
  const field = q(el, sel)!;
  return field.shadowRoot!.activeElement === field.shadowRoot!.querySelector("input");
};

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

  it("clears the width answer when paper width is changed directly", async () => {
    const el = await openStepFour(stubApi());
    for (let step = 4; step > 2; step--) {
      q(el, "[data-test=calibration-back]")!.click();
      await flush(el);
    }
    await chooseOption(el, "printer-width-line", "A");
    const answer = q(el, '[name="printer-width-line"]') as HTMLSelectElement;
    expect(answer.value).toBe("A");
    expect((q(el, '[name="printer-paper-width"]') as HTMLSelectElement).value).toBe("58mm");
    await chooseOption(el, "printer-paper-width", "80mm");
    expect(answer.value).toBe("");
    expect(answer.selectedOptions[0]!.textContent!.trim()).toBe(t("printers.test_answer_choose"));
  });

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
    expect(q(el, '[name="printer-cash-drawer"]')!.shadowRoot!.querySelector("input")!.checked).toBe(
      true,
    );
    q(el, "[data-test=test-printer-drawer]")!.click();
    await flush(el);
    expect(await bottomOf(el, footerOf("edit-printer-modal"))).toBe(
      codeMessage("printer.not_found"),
    );
    expect(topAlertOf(el, "edit-printer-modal")).toBeNull();
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
      expect(await bottomOf(el, footerOf("edit-printer-modal"))).toBe("");
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
    const table = q(el, '[data-test="printers-table"]')!;
    const select = table.shadowRoot!.querySelector<HTMLSelectElement>('[name="status-filter"]')!;
    expect(select).not.toBeNull();
    expect(select.value).toBe("active");
    await filterPrinters(el, "disabled");
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

describe("the Printers tab at phone width", () => {
  // A long printer name, and a printer whose last print names its agent, widen the name and "last
  // seen by" columns. Each width and language also runs with larger text, in Verdana, and with both.
  const phonePrinters: Printer[] = [
    {
      ...printers[0]!,
      name: "Impresora de tickets de la cocina caliente",
      pendingJobs: 3,
      lastPrintAt: "2026-08-25T14:00:00.000Z",
      lastPrintAgentId: "a1",
    },
    ...printers.slice(1),
  ];
  it.each(
    [390, 360, 320].flatMap((phoneWidth) =>
      ["en-GB", "es-ES"].flatMap((locale) =>
        [false, true].flatMap((scaled) =>
          ["default", "Verdana"].map((font) => ({ phoneWidth, locale, scaled, font })),
        ),
      ),
    ),
  )(
    "keeps every printer row's menu on screen and uncovered while the other columns scroll sideways ($phoneWidth px, $locale, larger text: $scaled, font: $font)",
    async ({ phoneWidth, locale, scaled, font }) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(phoneWidth, 844);
        expect(window.innerWidth).toBe(phoneWidth);
        const { el, host } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
          api: stubApi({ listPrinters: vi.fn().mockResolvedValue(phonePrinters) }),
        });
        if (scaled) {
          host.style.setProperty("--wt-font-size-sm", "var(--wt-font-size-lg)");
          host.style.setProperty("--wt-font-size-md", "var(--wt-font-size-xl)");
        }
        if (font === "Verdana") {
          const family = getComputedStyle(host).getPropertyValue("--wt-font-family");
          expect(family).not.toBe("");
          host.style.setProperty("--wt-font-family", `Verdana, ${family}`);
        }
        await flush(el);
        await selectTab(el, "printers");
        await filterPrinters(el, "all");
        const table = q(el, '[data-test="printers-table"]')!;
        const scroll = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
        expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
        expect(scroll.scrollLeft).toBe(0);
        const box = scroll.getBoundingClientRect();
        const menus = [...table.shadowRoot!.querySelectorAll("dashboard-row-actions")];
        expect(menus).toHaveLength(phonePrinters.length);
        for (const [index, menu] of menus.entries()) {
          const button = menu.shadowRoot!.querySelector("button")!;
          const at = button.getBoundingClientRect();
          expect(at.right, `row ${index}`).toBeLessThanOrEqual(box.right);
          expect(at.left, `row ${index}`).toBeGreaterThanOrEqual(box.left);
          expect(at.right, `row ${index} against the screen`).toBeLessThanOrEqual(
            window.innerWidth,
          );
          // Anything painted over the button, such as a cell scrolling under the menu's column,
          // is what this hit test finds instead.
          const hit = menu.shadowRoot!.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
          expect(hit !== null && button.contains(hit), `row ${index} is covered`).toBe(true);
        }
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );
});

describe("the Agents tab at phone width", () => {
  const phoneAgents: PrintAgentRow[] = [
    {
      ...agents[0]!,
      name: "Agente de impresión de la cocina caliente",
      host: "cocina-caliente.local",
    },
    ...agents.slice(1),
  ];
  it.each(["en-GB", "es-ES"])(
    "keeps every agent row's menu on screen and uncovered while the other columns scroll sideways (390 px, %s)",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        expect(window.innerWidth).toBe(390);
        const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
          api: stubApi({ listAgents: vi.fn().mockResolvedValue(phoneAgents) }),
        });
        await flush(el);
        await selectTab(el, "agents");
        await filterAgents(el, "all");
        expectRowMenusOnScreen(
          q(el, '[data-test="agents-table"]')!,
          phoneAgents.length,
          "dashboard-row-actions",
        );
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );
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
    await filterAgents(el, "all");

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
    await filterAgents(el, "all");

    expect(text(el, "[data-test=agent-name-a1]")).toBe("Cocina agent");
    expect(text(el, "[data-test=agent-status-a1]")).toBe(t("printers.status_active", "es-ES"));
    expect(text(el, "[data-test=agent-last-seen-a1]")).toBe("2026-08-25 14:30");
    // A revoked, never-authenticated agent.
    expect(text(el, "[data-test=agent-status-a2]")).toBe(t("printers.status_revoked", "es-ES"));
    expect(text(el, "[data-test=agent-last-seen-a2]")).toBe(t("printers.last_seen_never", "es-ES"));
  });

  it("filters print agents by status and remembers the choice independently", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await selectTab(el, "agents");
    const table = q(el, "[data-test=agents-table]")!;
    const filter = table.shadowRoot!.querySelector<HTMLSelectElement>('[name="status-filter"]')!;
    expect(filter.value).toBe("active");
    expect(q(el, "[data-test=agent-row-a1]")).not.toBeNull();
    expect(q(el, "[data-test=agent-row-a2]")).toBeNull();

    await filterAgents(el, "disabled");

    expect(q(el, "[data-test=agent-row-a1]")).toBeNull();
    expect(q(el, "[data-test=agent-row-a2]")).not.toBeNull();
    expect(sessionStorage.getItem("printers:agents")).toContain("disabled");
    expect(sessionStorage.getItem("printers:table")).toBeNull();
  });

  it.each([
    {
      tab: "agents",
      table: "agents-table",
      viewKey: "printers:agents",
      choices: ["host", "status", "lastSeen"],
      hide: "host",
      label: () => t("printers.agent_host"),
    },
    {
      tab: "printers",
      table: "printers-table",
      viewKey: "printers:table",
      choices: ["agent", "pending", "status", "lastPrint"],
      hide: "pending",
      label: () => t("printers.pending_jobs"),
    },
    {
      tab: "queue",
      table: "jobs-table",
      viewKey: "printers:jobs",
      choices: ["status", "attempts", "queued", "delivered"],
      hide: "attempts",
      label: () => t("printers.job_attempts"),
    },
  ])(
    "offers the $tab table's columns but the name and the actions in a translated column chooser, and remembers a hidden one",
    async ({ tab, table: testId, viewKey, choices, hide, label }) => {
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
        api: stubApi(),
      });
      await flush(el);
      await selectTab(el, tab);
      const table = q(el, `[data-test="${testId}"]`) as HTMLElement & {
        updateComplete: Promise<unknown>;
      };
      const root = table.shadowRoot!;
      expect(root.querySelector(".columns-trigger")?.textContent?.trim()).toBe(t("table.columns"));
      expect(
        [...root.querySelectorAll<HTMLInputElement>("input[data-column]")].map((box) => [
          box.dataset.column,
          box.checked,
        ]),
      ).toEqual(choices.map((key) => [key, true]));
      const headerLabels = () =>
        [...root.querySelectorAll("thead th")].map((th) =>
          th.textContent!.replace(/[▲▼]/g, "").trim(),
        );
      const before = headerLabels();
      expect(before).toContain(label());
      const box = root.querySelector<HTMLInputElement>(`input[data-column="${hide}"]`)!;
      box.checked = false;
      box.dispatchEvent(new Event("change"));
      await table.updateComplete;
      expect(headerLabels()).toEqual(before.filter((text) => text !== label()));
      expect(JSON.parse(localStorage.getItem(`${viewKey}:columns`)!)).toEqual({ [hide]: false });
    },
  );

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

  it("ignores saved sort and filter settings for removed printer columns", async () => {
    sessionStorage.setItem(
      "printers:table",
      JSON.stringify({
        sortKey: "connection",
        sortDirection: "descending",
        filters: { address: "10.0.0.9", status: "" },
      }),
    );
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(),
    });
    await flush(el);
    await selectTab(el, "printers");
    for (const id of ["p1", "p2", "p3"])
      expect(q(el, `[data-test=printer-row-${id}]`)).not.toBeNull();
    expect((q(el, '[name="status-filter"]') as HTMLSelectElement).value).toBe("");
    expect(
      (q(el, "[data-test=printers-table]") as import("@waitron/ui").WtDataTable).sortKey,
    ).not.toBe("connection");
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
    expect(await bottomOf(el, footerOf("new-agent-modal"))).toBe(
      codeMessage("device.join_mismatch", "es-ES"),
    );
    expect(topAlertOf(el, "new-agent-modal")).toBeNull();
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
    await filterAgents(el, "all");

    // a2 carries a node id → the "on this box" provenance marker shows.
    expect(q(el, "[data-test=agent-provenance-a2]")).toBeTruthy();
    expect(text(el, "[data-test=agent-provenance-a2]")).toBe(
      t("printers.provenance_self", "es-ES"),
    );
    // a1 has a null node id (manual enrolment) → no marker.
    expect(q(el, "[data-test=agent-provenance-a1]")).toBeNull();
  });

  it("sizes the provenance marker from the small font token, inside the table's shadow root", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi({
        listAgents: vi.fn().mockResolvedValue([{ ...agents[1]!, host: "Kitchen box" }]),
      }),
    });
    await flush(el);
    await filterAgents(el, "all");
    const marker = q(el, "[data-test=agent-provenance-a2]")!;
    const hostCell = marker.parentElement!;
    expect(hostCell.textContent).toContain("Kitchen box");
    const probe = document.createElement("span");
    probe.style.fontSize = "var(--wt-font-size-sm)";
    el.shadowRoot!.append(probe);
    const small = getComputedStyle(probe).fontSize;
    probe.remove();
    expect(getComputedStyle(marker).fontSize).toBe(small);
    // The control: the host text in the marker's own cell is at the body size, so the marker's size is the part rule's doing.
    expect(getComputedStyle(hostCell).fontSize).not.toBe(small);
  });

  it("re-allows a revoked agent only on the confirming second click, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await filterAgents(el, "disabled");

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
    await filterAgents(el, "disabled");

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

  it("explains invalid address and port fields once Check address is pressed, not by disabling it beforehand", async () => {
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
    expect(await bottomOf(el, "[data-test=probe-actions]")).toBe(t("form.fix_fields"));
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(true);
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
    expect(await bottomOf(el, "[data-test=probe-actions]")).toBe(t("form.fix_fields"));
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

  it("does not direct Bluetooth pairing to the removed setup-page controls", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(),
    });
    await flush(el);
    q(el, "[data-test=open-add-printer]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=new-printer-modal]")!.textContent).not.toContain("9110");
  });

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

  it("leaves the empty discovered table without a message while Scan's spinner runs", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      expect(q(el, "[data-test=scan-printers]")!.hasAttribute("loading")).toBe(true);
      const table = q(el, "[data-test=discovered-table]") as import("@waitron/ui").WtDataTable;
      expect(table.emptyMessage).toBe("");
      expect(table.shadowRoot!.textContent).not.toContain(t("printers.scan_loading", "es-ES"));
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("keeps Scan's spinner on for 30 seconds, not less", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      const button = () => q(el, "[data-test=scan-printers]")!;
      await vi.advanceTimersByTimeAsync(29_000);
      await el.updateComplete;
      expect(button().hasAttribute("loading")).toBe(true);
      await vi.advanceTimersByTimeAsync(1_000);
      await el.updateComplete;
      expect(button().hasAttribute("loading")).toBe(false);
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("renews the discovery window in the background while Add a printer stays open, and stops once it closes", async () => {
    const background = stubApi();
    const api = stubApi({ background });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      expect(background.renewPrinterDiscovery).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS);
      // A second Scan opens the window again by hand and must not add a second renewal timer.
      q(el, "[data-test=scan-printers]")!.click();
      await flush(el);
      expect(api.startPrinterDiscovery).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(4 * 60_000 - SCAN_LISTEN_MS);
      expect(background.renewPrinterDiscovery).toHaveBeenCalledTimes(4);
      expect(api.renewPrinterDiscovery).not.toHaveBeenCalled();

      q(el, "[data-test=cancel-new-printer]")!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(background.renewPrinterDiscovery).toHaveBeenCalledTimes(4);
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("stops renewing the discovery window when the Printers screen goes away", async () => {
    const background = stubApi();
    const api = stubApi({ background });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(background.renewPrinterDiscovery).toHaveBeenCalledOnce();
      el.remove();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(background.renewPrinterDiscovery).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not renew a discovery window the server refused to open", async () => {
    const background = stubApi();
    const api = stubApi({
      background,
      startPrinterDiscovery: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(background.renewPrinterDiscovery).not.toHaveBeenCalled();
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("keeps renewing after one renewal fails, and shows no error for it", async () => {
    const background = stubApi({
      renewPrinterDiscovery: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue({ discoveryUntil: Date.now() + 180_000 }),
    });
    const api = stubApi({ background });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      await vi.advanceTimersByTimeAsync(60_000);
      await flush(el);
      expect(q(el, "[data-test=printer-refresh-error]")).toBeNull();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(background.renewPrinterDiscovery).toHaveBeenCalledTimes(2);
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("registers Bluetooth devices from the same discovered table", async () => {
    const api = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue([
        {
          ...discovered[0],
          transport: "bluetooth",
          localKey: "AA:BB",
          name: "Bar printer",
          printerLike: true,
          paired: true,
        },
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
    expect(await bottomOf(el, footerOf("name-printer-modal"))).toBe(
      codeMessage("printer.already_registered", "es-ES"),
    );
    expect(topAlertOf(el, "name-printer-modal")).toBeNull();
    expect(topAlertOf(el, "new-printer-modal")).toBeNull();
    expect(await bottomOf(el, footerOf("new-printer-modal"))).toBe("");
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
    expect(await bottomOf(el, footerOf("new-printer-modal"))).toBe(
      codeMessage("server.internal", "es-ES"),
    );
    expect(topAlertOf(el, "new-printer-modal")).toBeNull();
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
    expect(await bottomOf(el, footerOf("edit-printer-modal"))).toBe(
      codeMessage("printer.not_found", "es-ES"),
    );
    expect(topAlertOf(el, "edit-printer-modal")).toBeNull();
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
  expect(await bottomOf(el, footerOf("edit-agent-modal"))).toBe(
    codeMessage("agent.not_found", "es-ES"),
  );
  expect(topAlertOf(el, "edit-agent-modal")).toBeNull();
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
      ...(transport === "bluetooth" ? { printerLike: true as const, paired: true as const } : {}),
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
  expect(await bottomOf(el, footerOf("name-printer-modal"))).toBe(codeMessage("printer.not_found"));
  expect(topAlertOf(el, "name-printer-modal")).toBeNull();
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
    await vi.advanceTimersByTimeAsync(AGENT_SCAN_LISTEN_MS);
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
    expect(dialog.getBoundingClientRect().width).toBeCloseTo(1024, 0);
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

it("lines a job's status text up with the text beside it in its row", async () => {
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
    api: stubApi({
      listRecentJobs: vi.fn().mockResolvedValue([{ ...jobs[0]!, status: "failed" }]),
    }),
  });
  await flush(el);
  const job = jobs[0]!.id;
  const textBottom = (element: Element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().bottom;
  };
  const status = textBottom(q(el, `[data-test=job-status-${job}]`)!);
  const attempts = textBottom(q(el, `[data-test=job-attempts-${job}]`)!);
  expect(Math.abs(status - attempts)).toBeLessThanOrEqual(1);
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
  expect(await bottomOf(el, footerOf("new-agent-modal"))).toBe("");
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
    await filterAgents(el, "all");
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

    await vi.waitFor(async () =>
      expect(await bottomOf(el, footerOf("new-agent-modal"))).toBe(
        codeMessage("join_request.not_found"),
      ),
    );
    expect(topAlertOf(el, "new-agent-modal")).toBeNull();
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
    await vi.waitFor(async () =>
      expect(await bottomOf(el, footerOf("new-agent-modal"))).toBe(
        codeMessage("connection.failed"),
      ),
    );
    expect(topAlertOf(el, "new-agent-modal")).toBeNull();
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

      await vi.advanceTimersByTimeAsync(AGENT_SCAN_LISTEN_MS + SCAN_POLL_MS);
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
    expect(await bottomOf(el, "[data-test=probe-actions]")).toBe(t("form.fix_fields"));
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(false);
    expect(q(el, "[data-test=new-printer-modal] [role=alert]")).toBeNull();
    expect(await bottomOf(el, footerOf("new-printer-modal"))).toBe("");
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
    expect(await bottomOf(el, footerOf("edit-printer-modal"))).toBe("");
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
      expect(await bottomOf(el, "[data-test=edit-printer-modal] wt-form-actions")).toBe(t(message));
      expect(isDisabled(el, `[data-test=save-printer-${row.id}]`)).toBe(false);
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

    await vi.waitFor(async () =>
      expect(await bottomOf(el, footerOf("edit-printer-modal"))).toBe(
        codeMessage("printer.not_found"),
      ),
    );
    expect(topAlertOf(el, "edit-printer-modal")).toBeNull();
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

    await vi.waitFor(async () =>
      expect(await bottomOf(el, footerOf("edit-printer-modal"))).toBe(
        codeMessage("printer.not_found"),
      ),
    );
    expect(topAlertOf(el, "edit-printer-modal")).toBeNull();
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
      expect(await bottomOf(el, footerOf("new-agent-modal"))).toBe("");
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

describe("printers-screen forms say what is wrong beside the field and the action", () => {
  async function mounted(overrides: Partial<DashboardApi> = {}) {
    const api = stubApi(overrides);
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    return { el, api };
  }
  const agentActions = "[data-test=edit-agent-modal] wt-form-actions";
  const printerActions = "[data-test=edit-printer-modal] wt-form-actions";
  const nameActions = "[data-test=name-printer-modal] wt-form-actions";
  const probeActions = "[data-test=probe-actions]";

  it("says nothing about an agent name before the first Save, and Save works", async () => {
    const { el } = await mounted();
    q(el, "[data-test=edit-agent-a1]")!.click();
    await flush(el);
    typeField(el, "[data-test=edit-agent-name]", " ");
    await flush(el);
    expect(errorOf(el, "[data-test=edit-agent-name]")).toBe("");
    expect(await bottomOf(el, agentActions)).toBe("");
    expect(isDisabled(el, "[data-test=save-agent]")).toBe(false);
  });

  it("on an invalid agent Save focuses the name, disables Save and re-checks every change", async () => {
    const { el, api } = await mounted();
    q(el, "[data-test=edit-agent-a1]")!.click();
    await flush(el);
    typeField(el, "[data-test=edit-agent-name]", "");
    q(el, "[data-test=save-agent]")!.click();
    await flush(el);
    await vi.waitFor(() => expect(inputFocused(el, "[data-test=edit-agent-name]")).toBe(true));
    expect(errorOf(el, "[data-test=edit-agent-name]")).toBe(t("form.name_required"));
    expect(await bottomOf(el, agentActions)).toBe(t("form.fix_fields"));
    expect(isDisabled(el, "[data-test=save-agent]")).toBe(true);

    typeField(el, "[data-test=edit-agent-name]", "Kitchen box");
    await flush(el);
    expect(errorOf(el, "[data-test=edit-agent-name]")).toBe("");
    expect(await bottomOf(el, agentActions)).toBe("");
    expect(isDisabled(el, "[data-test=save-agent]")).toBe(false);

    typeField(el, "[data-test=edit-agent-name]", " ");
    await flush(el);
    expect(errorOf(el, "[data-test=edit-agent-name]")).toBe(t("form.name_required"));
    expect(isDisabled(el, "[data-test=save-agent]")).toBe(true);
    expect(api.updateAgent).not.toHaveBeenCalled();
  });

  it("leaves the agent's Save working after a refusal that names no field", async () => {
    const { el, api } = await mounted({
      updateAgent: vi.fn().mockRejectedValue({ code: "agent.not_found" }),
    });
    q(el, "[data-test=edit-agent-a1]")!.click();
    await flush(el);
    q(el, "[data-test=save-agent]")!.click();
    await flush(el);
    expect(isDisabled(el, "[data-test=save-agent]")).toBe(false);
    q(el, "[data-test=save-agent]")!.click();
    await flush(el);
    expect(api.updateAgent).toHaveBeenCalledTimes(2);
  });

  it("shows an agent refusal and the fields sentence one after the other when both apply", async () => {
    const { el } = await mounted({
      updateAgent: vi.fn().mockRejectedValue({ code: "agent.not_found" }),
    });
    q(el, "[data-test=edit-agent-a1]")!.click();
    await flush(el);
    q(el, "[data-test=save-agent]")!.click();
    await flush(el);
    expect(await bottomOf(el, agentActions)).toBe(codeMessage("agent.not_found"));
    typeField(el, "[data-test=edit-agent-name]", " ");
    await flush(el);
    expect(await bottomOf(el, agentActions)).toBe(
      `${codeMessage("agent.not_found")} ${t("form.fix_fields")}`,
    );
    expect(isDisabled(el, "[data-test=save-agent]")).toBe(true);
  });

  it("starts the agent form again when it is reopened", async () => {
    const { el } = await mounted();
    q(el, "[data-test=edit-agent-a1]")!.click();
    await flush(el);
    typeField(el, "[data-test=edit-agent-name]", "");
    q(el, "[data-test=save-agent]")!.click();
    await flush(el);
    q(el, "[data-test=cancel-edit-agent]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-agent-modal]")).toBeNull());
    q(el, "[data-test=edit-agent-a1]")!.click();
    await flush(el);
    typeField(el, "[data-test=edit-agent-name]", "");
    await flush(el);
    expect(errorOf(el, "[data-test=edit-agent-name]")).toBe("");
    expect(await bottomOf(el, agentActions)).toBe("");
    expect(isDisabled(el, "[data-test=save-agent]")).toBe(false);
  });

  it("says nothing about a printer's fields before the first Save, and Save works", async () => {
    const { el } = await mounted();
    await openPrinter(el, "p1");
    typeField(el, "[data-test=printer-name-p1]", "");
    typeField(el, "[data-test=printer-port-p1]", "70000");
    await flush(el);
    expect(errorOf(el, "[data-test=printer-name-p1]")).toBe("");
    expect(errorOf(el, "[data-test=printer-port-p1]")).toBe("");
    expect(await bottomOf(el, printerActions)).toBe("");
    expect(isDisabled(el, "[data-test=save-printer-p1]")).toBe(false);
  });

  it("on an invalid printer Save focuses the first invalid field, disables Save and re-checks every change", async () => {
    const { el, api } = await mounted();
    await openPrinter(el, "p1");
    typeField(el, "[data-test=printer-host-p1]", "");
    typeField(el, "[data-test=printer-port-p1]", "70000");
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    await vi.waitFor(() => expect(inputFocused(el, "[data-test=printer-host-p1]")).toBe(true));
    expect(errorOf(el, "[data-test=printer-host-p1]")).toBe(t("printers.host_required"));
    expect(await bottomOf(el, printerActions)).toBe(t("form.fix_fields"));
    expect(isDisabled(el, "[data-test=save-printer-p1]")).toBe(true);

    typeField(el, "[data-test=printer-host-p1]", "10.0.0.9");
    await flush(el);
    expect(errorOf(el, "[data-test=printer-host-p1]")).toBe("");
    expect(isDisabled(el, "[data-test=save-printer-p1]")).toBe(true);

    typeField(el, "[data-test=printer-port-p1]", "9100");
    await flush(el);
    expect(await bottomOf(el, printerActions)).toBe("");
    expect(isDisabled(el, "[data-test=save-printer-p1]")).toBe(false);

    typeField(el, "[data-test=printer-name-p1]", " ");
    await flush(el);
    expect(errorOf(el, "[data-test=printer-name-p1]")).toBe(t("form.name_required"));
    expect(isDisabled(el, "[data-test=save-printer-p1]")).toBe(true);
    expect(api.updatePrinter).not.toHaveBeenCalled();
  });

  it("leaves a printer's Save working after a refusal that names no field", async () => {
    const { el, api } = await mounted({
      updatePrinter: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });
    await openPrinter(el, "p1");
    typeField(el, "[data-test=printer-name-p1]", "Cocina 2");
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(isDisabled(el, "[data-test=save-printer-p1]")).toBe(false);
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledTimes(2);
  });

  it("starts the printer form again when it is reopened", async () => {
    const { el } = await mounted();
    await openPrinter(el, "p1");
    typeField(el, "[data-test=printer-name-p1]", "");
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    q(el, "[data-test=cancel-edit-printer]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-printer-modal]")).toBeNull());
    await openPrinter(el, "p1");
    typeField(el, "[data-test=printer-name-p1]", "");
    await flush(el);
    expect(errorOf(el, "[data-test=printer-name-p1]")).toBe("");
    expect(await bottomOf(el, printerActions)).toBe("");
    expect(isDisabled(el, "[data-test=save-printer-p1]")).toBe(false);
  });

  it("names a discovered printer: nothing before Add, then a focused message that each change re-checks", async () => {
    const { el } = await mounted({
      listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered),
    });
    await openDiscovery(el);
    q(el, '[data-test="register-SN-1"]')!.click();
    await flush(el);
    const name = '[data-test="discovered-name-SN-1"]';
    typeField(el, name, "");
    await flush(el);
    expect(errorOf(el, name)).toBe("");
    expect(await bottomOf(el, nameActions)).toBe("");
    expect(isDisabled(el, '[data-test="confirm-add-printer"]')).toBe(false);

    q(el, '[data-test="confirm-add-printer"]')!.click();
    await flush(el);
    await vi.waitFor(() => expect(inputFocused(el, name)).toBe(true));
    expect(errorOf(el, name)).toBe(t("form.name_required"));
    expect(await bottomOf(el, nameActions)).toBe(t("form.fix_fields"));
    expect(isDisabled(el, '[data-test="confirm-add-printer"]')).toBe(true);

    typeField(el, name, "Kitchen");
    await flush(el);
    expect(errorOf(el, name)).toBe("");
    expect(await bottomOf(el, nameActions)).toBe("");
    expect(isDisabled(el, '[data-test="confirm-add-printer"]')).toBe(false);
  });

  it("says nothing about the address check before it is pressed, and Check address works", async () => {
    const { el } = await mounted();
    await openDiscovery(el);
    typeField(el, "[data-test=probe-port]", "70000");
    await flush(el);
    expect(errorOf(el, "[data-test=probe-port]")).toBe("");
    expect(await bottomOf(el, probeActions)).toBe("");
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(false);
  });

  it("focuses the first invalid address field and re-checks every change until Check address works again", async () => {
    const { el } = await mounted();
    await openDiscovery(el);
    q(el, "[data-test=probe-panel] summary")!.click();
    typeField(el, "[data-test=probe-port]", "70000");
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    await vi.waitFor(() => expect(inputFocused(el, "[data-test=probe-host]")).toBe(true));

    typeField(el, "[data-test=probe-host]", "10.0.0.50");
    await flush(el);
    expect(errorOf(el, "[data-test=probe-host]")).toBe("");
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(true);

    typeField(el, "[data-test=probe-port]", "9100");
    await flush(el);
    expect(await bottomOf(el, probeActions)).toBe("");
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(false);

    typeField(el, "[data-test=probe-host]", " ");
    await flush(el);
    expect(errorOf(el, "[data-test=probe-host]")).toBe(t("printers.probe_host_invalid"));
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(true);
  });

  it("keeps a refused address, with Check address working, until that field changes, focusing it when the refusal arrives", async () => {
    const { el } = await mounted({
      probePrinterAddress: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", params: { field: "host" } }),
    });
    await openDiscovery(el);
    q(el, "[data-test=probe-panel] summary")!.click();
    typeField(el, "[data-test=probe-host]", "printer.local");
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    await vi.waitFor(() => expect(inputFocused(el, "[data-test=probe-host]")).toBe(true));
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(false);

    typeField(el, "[data-test=probe-port]", "9101");
    await flush(el);
    expect(errorOf(el, "[data-test=probe-host]")).toBe(t("printers.probe_host_invalid"));
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(false);

    typeField(el, "[data-test=probe-host]", "10.0.0.50");
    await flush(el);
    expect(errorOf(el, "[data-test=probe-host]")).toBe("");
    expect(await bottomOf(el, probeActions)).toBe("");
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(false);
  });

  it("leaves Check address working after a refusal that names no field", async () => {
    const probe = vi.fn().mockRejectedValue({ code: "printer.probe_busy" });
    const { el } = await mounted({ probePrinterAddress: probe });
    await openDiscovery(el);
    typeField(el, "[data-test=probe-host]", "10.0.0.50");
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    expect(errorOf(el, "[data-test=probe-host]")).toBe("");
    expect(await bottomOf(el, probeActions)).toBe(codeMessage("printer.probe_busy"));
    expect(await bottomOf(el, footerOf("new-printer-modal"))).toBe("");
    expect(topAlertOf(el, "new-printer-modal")).toBeNull();
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(false);
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("keeps the address check's refusal and button at the right when they wrap under the fields", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    await page.viewport(1280, 900);
    try {
      const { el } = await mounted({
        probePrinterAddress: vi.fn().mockRejectedValue({ code: "printer.probe_busy" }),
      });
      await openDiscovery(el);
      (q(el, "[data-test=probe-panel]") as HTMLDetailsElement).open = true;
      typeField(el, "[data-test=probe-host]", "10.0.0.50");
      q(el, "[data-test=probe-printer]")!.click();
      await flush(el);
      expect(await bottomOf(el, probeActions)).toBe(codeMessage("printer.probe_busy"));
      const host = q(el, "[data-test=probe-host]")!.getBoundingClientRect();
      const actions = q(el, probeActions)!.getBoundingClientRect();
      const row = q(el, probeActions)!.parentElement!.getBoundingClientRect();
      expect(actions.top).toBeGreaterThanOrEqual(host.bottom);
      expect(actions.right).toBeCloseTo(row.right, 0);
    } finally {
      setLocale(before);
    }
  });

  it("starts the address check again when Add printer is reopened", async () => {
    const { el } = await mounted();
    await openDiscovery(el);
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    q(el, "[data-test=cancel-new-printer]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=new-printer-modal]")).toBeNull());
    await openDiscovery(el);
    typeField(el, "[data-test=probe-host]", " ");
    await flush(el);
    expect(errorOf(el, "[data-test=probe-host]")).toBe("");
    expect(await bottomOf(el, probeActions)).toBe("");
    expect(isDisabled(el, "[data-test=probe-printer]")).toBe(false);
  });
});

describe("printers-screen Bluetooth pairing", () => {
  const ADDRESS = "00:11:22:33:44:55";
  const OTHER = "66:77:88:99:AA:BB";
  const PIN = "8472";
  const barPrinter: DiscoveredPrinter = {
    agentId: "a1",
    agentName: "Cocina agent",
    transport: "bluetooth",
    localKey: ADDRESS,
    name: "Bar printer",
    printerLike: true,
    alreadyRegistered: false,
    printerId: null,
    lastSeenAt: "2023-11-14T22:13:20.000Z",
  };
  const headphones: DiscoveredPrinter = {
    ...barPrinter,
    localKey: OTHER,
    name: "Headphones",
    printerLike: undefined,
  };
  const btPrinter = (id: string, localKey: string, active: boolean): Printer => ({
    ...printers[2]!,
    id,
    name: `BT ${id}`,
    transport: "bluetooth",
    localKey,
    active,
  });
  /** How long the server says it keeps a pending command, in the 202 and on discovered rows. */
  const EXPIRES_MS = 120_000;
  const pendingCommand = (kind: "pair" | "forget", address = ADDRESS) => ({
    id: `${kind}-1`,
    kind,
    address,
    state: "pending" as const,
    expiresInMs: EXPIRES_MS,
  });
  const finishedCommand = (
    kind: "pair" | "forget",
    state: "succeeded" | "failed",
    extra: { id?: string; error?: string } = {},
  ) => ({ id: `${kind}-1`, kind, address: ADDRESS, state, ...extra });
  const sel = (test: string) => `[data-test="${test}"]`;

  /** Ends a notice as its own timer would; `wt-notice.test.ts` holds the timing. */
  async function fadeNotice(el: PrintersScreen, test: string): Promise<void> {
    q(el, sel(test))!.dispatchEvent(
      new CustomEvent("wt-notice-gone", { bubbles: true, composed: true, detail: {} }),
    );
    await flush(el);
  }

  /** The data-test of every button in the table cell holding `test`, so a control added beside a
   * notice shows up whatever it is called. */
  const cellButtons = (el: PrintersScreen, test: string) =>
    [...q(el, sel(test))!.closest("td")!.querySelectorAll<HTMLElement>("wt-button")].map(
      (button) => button.dataset.test,
    );

  async function mountPairing(
    devices: DiscoveredPrinter[],
    overrides: Partial<DashboardApi> = {},
  ): Promise<{ el: PrintersScreen; api: DashboardApi }> {
    const api = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue(devices),
      pairBluetooth: vi.fn().mockResolvedValue({ command: pendingCommand("pair") }),
      forgetBluetoothPairing: vi.fn().mockResolvedValue({ command: pendingCommand("forget") }),
      ...overrides,
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    return { el, api };
  }

  async function openPair(el: PrintersScreen, address = ADDRESS): Promise<void> {
    q(el, sel(`pair-${address}`))!.click();
    await flush(el);
  }

  const pinField = (el: PrintersScreen) =>
    q(el, sel("bluetooth-pin")) as HTMLElement & {
      value: string;
      error: string;
      required: boolean;
    };

  it("offers Pair and add, not Add, for an unpaired printer-like device, and Add for a paired one", async () => {
    const paired: DiscoveredPrinter = { ...barPrinter, localKey: OTHER, paired: true };
    const { el } = await mountPairing([barPrinter, paired]);
    await openDiscovery(el);
    expect(text(el, sel(`pair-${ADDRESS}`))).toBe(t("printers.bluetooth_pair"));
    expect(q(el, sel(`register-${ADDRESS}`))).toBeNull();
    expect(text(el, sel(`register-${OTHER}`))).toBe(t("action.add"));
    expect(q(el, sel(`pair-${OTHER}`))).toBeNull();
    // Pressing Pair and add asks for the PIN first; no naming form until the pairing succeeds.
    expect(text(el, sel("bluetooth-note"))).toBe(t("printers.bluetooth_pair_note"));
    await openPair(el);
    expect(q(el, sel("name-printer-modal"))).toBeNull();
  });

  it("says nothing about Bluetooth when no Bluetooth device was found", async () => {
    const { el } = await mountPairing(discovered);
    await openDiscovery(el);
    expect(q(el, sel("bluetooth-note"))).toBeNull();
    expect(q(el, sel("show-all-bluetooth"))).toBeNull();
  });

  it("asks for the PIN, checks it beside the field and the action, then pairs through the named agent", async () => {
    const { el, api } = await mountPairing([barPrinter]);
    await openDiscovery(el);
    await openPair(el);
    const modal = sel("pair-printer-modal");
    expect(q(el, modal)).not.toBeNull();
    expect(pinField(el).getAttribute("name")).toBe("pin");
    expect(pinField(el).required).toBe(true);
    expect(text(el, `${modal} .hint`)).toContain("Bar printer");
    expect((pinField(el) as unknown as { hint: string }).hint).toBe(
      t("printers.bluetooth_pin_hint"),
    );
    // Silent until the first submission.
    expect(pinField(el).error).toBe("");
    expect(await bottomOf(el, footerOf("pair-printer-modal"))).toBe("");

    q(el, sel("confirm-pair"))!.click();
    await flush(el);
    expect(api.pairBluetooth).not.toHaveBeenCalled();
    expect(pinField(el).error).toBe(t("printers.bluetooth_pin_invalid"));
    expect(await bottomOf(el, footerOf("pair-printer-modal"))).toBe(t("form.fix_fields"));
    expect(isDisabled(el, sel("confirm-pair"))).toBe(true);
    expect(inputFocused(el, sel("bluetooth-pin"))).toBe(true);

    for (const bad of ["12 34", "12345678901234567", "ñ123"]) {
      typeField(el, sel("bluetooth-pin"), bad);
      await flush(el);
      expect(pinField(el).error).toBe(t("printers.bluetooth_pin_invalid"));
    }
    typeField(el, sel("bluetooth-pin"), PIN);
    await flush(el);
    expect(pinField(el).error).toBe("");
    expect(await bottomOf(el, footerOf("pair-printer-modal"))).toBe("");
    expect(isDisabled(el, sel("confirm-pair"))).toBe(false);

    pinField(el)
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await vi.waitFor(() => expect(q(el, modal)).toBeNull());
    expect(api.pairBluetooth).toHaveBeenCalledExactlyOnceWith("a1", ADDRESS, PIN);
    expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_pairing"));
    // Pending: a second Pair waits for the outcome.
    expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(true);
    expect(api.createPrinter).not.toHaveBeenCalled();
    expect(api.updatePrinter).not.toHaveBeenCalled();
  });

  it("shows a refusal naming the PIN under the field and one naming no field beside the action, never disabling Pair", async () => {
    const pair = vi
      .fn()
      .mockRejectedValueOnce({ code: "management.request_invalid", params: { field: "pin" } })
      .mockRejectedValueOnce({
        code: "printer.bluetooth_not_discovered",
        params: { address: ADDRESS },
      });
    const { el } = await mountPairing([barPrinter], { pairBluetooth: pair });
    await openDiscovery(el);
    await openPair(el);
    typeField(el, sel("bluetooth-pin"), PIN);
    await flush(el);
    q(el, sel("confirm-pair"))!.click();
    await flush(el);
    expect(pinField(el).error).toBe(t("printers.bluetooth_pin_invalid"));
    expect(await bottomOf(el, footerOf("pair-printer-modal"))).toBe(t("form.fix_fields"));
    expect(isDisabled(el, sel("confirm-pair"))).toBe(false);
    expect(inputFocused(el, sel("bluetooth-pin"))).toBe(true);

    typeField(el, sel("bluetooth-pin"), "0000");
    await flush(el);
    expect(pinField(el).error).toBe("");
    q(el, sel("confirm-pair"))!.click();
    await flush(el);
    expect(pinField(el).error).toBe("");
    expect(await bottomOf(el, footerOf("pair-printer-modal"))).toBe(
      codeMessage("printer.bluetooth_not_discovered"),
    );
    expect(isDisabled(el, sel("confirm-pair"))).toBe(false);
    expect(q(el, sel(`discovered-command-${ADDRESS}`))).toBeNull();
  });

  it("never keeps the PIN once the dialog closes", async () => {
    let answer!: (value: unknown) => void;
    const pair = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { el } = await mountPairing([barPrinter], { pairBluetooth: pair });
    await openDiscovery(el);
    await openPair(el);
    typeField(el, sel("bluetooth-pin"), PIN);
    await flush(el);
    q(el, sel("cancel-pair"))!.click();
    await vi.waitFor(() => expect(q(el, sel("pair-printer-modal"))).toBeNull());
    await openPair(el);
    expect(pinField(el).value).toBe("");
    expect(pinField(el).error).toBe("");

    // Cancelled while its request is out: the command was sent, so its status still shows.
    typeField(el, sel("bluetooth-pin"), PIN);
    await flush(el);
    q(el, sel("confirm-pair"))!.click();
    await flush(el);
    q(el, sel("confirm-pair"))!.click();
    await flush(el);
    expect(pair).toHaveBeenCalledOnce();
    q(el, sel("cancel-pair"))!.click();
    await vi.waitFor(() => expect(q(el, sel("pair-printer-modal"))).toBeNull());
    answer({ command: pendingCommand("pair") });
    await flush(el);
    expect(q(el, sel("pair-printer-modal"))).toBeNull();
    expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_pairing"));
    expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(true); // Pair waits while pending
  });

  it("ignores a refusal that arrives after its dialog closed", async () => {
    let refuse!: (error: unknown) => void;
    const pair = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    );
    const { el } = await mountPairing([barPrinter], { pairBluetooth: pair });
    await openDiscovery(el);
    await openPair(el);
    typeField(el, sel("bluetooth-pin"), PIN);
    await flush(el);
    q(el, sel("confirm-pair"))!.click();
    await flush(el);
    q(el, sel("cancel-pair"))!.click();
    await vi.waitFor(() => expect(q(el, sel("pair-printer-modal"))).toBeNull());
    await openPair(el);
    refuse({ code: "management.request_invalid", params: { field: "pin" } });
    await flush(el);
    expect(pinField(el).error).toBe("");
    expect(await bottomOf(el, footerOf("pair-printer-modal"))).toBe("");
    expect(isDisabled(el, sel("confirm-pair"))).toBe(false);
    expect(q(el, sel(`discovered-command-${ADDRESS}`))).toBeNull();
  });

  it("tracks no pairing whose Add printer dialog closed before the request answered", async () => {
    let answer!: (value: unknown) => void;
    const pair = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { el } = await mountPairing([barPrinter], { pairBluetooth: pair });
    await openDiscovery(el);
    await openPair(el);
    typeField(el, sel("bluetooth-pin"), PIN);
    await flush(el);
    q(el, sel("confirm-pair"))!.click();
    await flush(el);
    q(el, sel("cancel-pair"))!.click();
    await vi.waitFor(() => expect(q(el, sel("pair-printer-modal"))).toBeNull());
    q(el, "[data-test=cancel-new-printer]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=new-printer-modal]")).toBeNull());
    answer({ command: pendingCommand("pair") });
    await flush(el);
    await openDiscovery(el);
    expect(q(el, sel(`discovered-command-${ADDRESS}`))).toBeNull();
    expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(false);
  });

  it("shows no error for a status read that fails after Add printer closed", async () => {
    let fail!: (error: unknown) => void;
    const passive = vi
      .fn()
      .mockResolvedValueOnce([barPrinter])
      .mockImplementation(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      );
    const { el } = await mountPairing([barPrinter], {
      background: stubApi({ listDiscoveredPrinters: passive }),
    });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      // Let the scan's listen end, so only the status poll is reading.
      await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS + SCAN_POLL_MS);
      await openPair(el);
      typeField(el, sel("bluetooth-pin"), PIN);
      await flush(el);
      q(el, sel("confirm-pair"))!.click();
      await flush(el);
      const reads = passive.mock.calls.length;
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(passive).toHaveBeenCalledTimes(reads + 1);
      q(el, "[data-test=cancel-new-printer]")!.click();
      await flush(el);
      await flush(el);
      fail({ code: "connection.failed" });
      await flush(el);
      expect(q(el, "[data-test=printer-refresh-error]")).toBeNull();
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 3);
      expect(passive).toHaveBeenCalledTimes(reads + 1);
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("shows pairing success and offers Add on the now-paired device's row", async () => {
    const background = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue([
        {
          ...barPrinter,
          paired: true,
          bluetoothCommand: finishedCommand("pair", "succeeded"),
        },
      ]),
    });
    const { el } = await mountPairing([barPrinter], { background });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      await openPair(el);
      typeField(el, sel("bluetooth-pin"), PIN);
      await flush(el);
      q(el, sel("confirm-pair"))!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_paired"));
      expect(text(el, sel(`register-${ADDRESS}`))).toBe(t("action.add"));
      expect(q(el, sel(`pair-${ADDRESS}`))).toBeNull();
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("shows the reason the agent gave for a failed pairing, with no Dismiss, until the next pairing", async () => {
    const background = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue([
        {
          ...barPrinter,
          bluetoothCommand: finishedCommand("pair", "failed", { error: "Authentication Failed" }),
        },
      ]),
    });
    const { el } = await mountPairing([barPrinter], { background });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      await openPair(el);
      typeField(el, sel("bluetooth-pin"), PIN);
      await flush(el);
      q(el, sel("confirm-pair"))!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
        `${t("printers.bluetooth_pair_failed")}: Authentication Failed`,
      );
      expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(false);
      expect(cellButtons(el, `discovered-command-${ADDRESS}`)).toEqual([`pair-${ADDRESS}`]);
      const notice = q(el, sel(`discovered-command-${ADDRESS}`)) as HTMLElement & {
        duration: number;
      };
      expect(notice.tagName).toBe("WT-NOTICE");
      expect(notice.duration).toBe(0);
      await vi.advanceTimersByTimeAsync(EXPIRES_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
        `${t("printers.bluetooth_pair_failed")}: Authentication Failed`,
      );
      await submitPair(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_pairing"));
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("wraps a long failure reason beside Pair, keeping it in view on a phone-width list", async () => {
    // Under MAX_OUTCOME_ERROR_LENGTH (500), so the agent and server pass all of it through.
    const reason = "org.bluez.Error.AuthenticationFailed ".repeat(13).trim();
    const background = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue([
        {
          ...barPrinter,
          bluetoothCommand: finishedCommand("pair", "failed", { error: reason }),
        },
      ]),
    });
    const { el } = await mountPairing([barPrinter], { background });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      await openPair(el);
      typeField(el, sel("bluetooth-pin"), PIN);
      await flush(el);
      q(el, sel("confirm-pair"))!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      const status = q(el, sel(`discovered-command-${ADDRESS}`))!;
      expect(status.textContent).toContain(reason);
      const scroll = q(el, sel("discovered-table"))!.shadowRoot!.querySelector(".scroll")!;
      const view = scroll.getBoundingClientRect();
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
      expect(cellButtons(el, `discovered-command-${ADDRESS}`)).toEqual([`pair-${ADDRESS}`]);
      expect(status.getBoundingClientRect().right).toBeLessThanOrEqual(view.right);
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("drops a pairing's status when Add printer closes", async () => {
    const { el } = await mountPairing([barPrinter]);
    await openDiscovery(el);
    await openPair(el);
    typeField(el, sel("bluetooth-pin"), PIN);
    await flush(el);
    q(el, sel("confirm-pair"))!.click();
    await flush(el);
    expect(q(el, sel(`discovered-command-${ADDRESS}`))).not.toBeNull();
    q(el, "[data-test=cancel-new-printer]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=new-printer-modal]")).toBeNull());
    await openDiscovery(el);
    expect(q(el, sel(`discovered-command-${ADDRESS}`))).toBeNull();
    expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(false);
  });

  async function submitPair(el: PrintersScreen, address = ADDRESS): Promise<void> {
    await openPair(el, address);
    typeField(el, sel("bluetooth-pin"), PIN);
    await flush(el);
    q(el, sel("confirm-pair"))!.click();
    await flush(el);
  }

  it("keeps a pairing's status in view after its device drops out of the scan, a failure included", async () => {
    const background = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue([]) });
    const { el } = await mountPairing([barPrinter], { background });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      const row = sel(`discovered-row-${ADDRESS}`);
      expect(text(el, row)).toContain("Bar printer");
      expect(text(el, row)).toContain(ADDRESS);
      expect(text(el, row)).toContain(t("printers.bluetooth_not_seen"));
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_pairing"));
      // Pairing needs the device in range, so a device the scan lost offers no Pair.
      expect(q(el, sel(`pair-${ADDRESS}`))).toBeNull();
      await vi.advanceTimersByTimeAsync(EXPIRES_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
        t("printers.bluetooth_no_answer"),
      );
      expect(cellButtons(el, `discovered-command-${ADDRESS}`)).toEqual([]);
      await vi.advanceTimersByTimeAsync(EXPIRES_MS);
      await flush(el);
      expect(text(el, row)).toContain(t("printers.bluetooth_not_seen"));
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("returns a lost device's row to Pair when the scan finds it again", async () => {
    const passive = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { ...barPrinter, bluetoothCommand: finishedCommand("pair", "failed", { error: "Busy" }) },
      ]);
    const { el } = await mountPairing([barPrinter], {
      background: stubApi({ listDiscoveredPrinters: passive }),
    });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      // Let the scan's listen end, so only the status poll is reading.
      await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS + SCAN_POLL_MS);
      passive.mockClear();
      passive.mockResolvedValueOnce([]);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-row-${ADDRESS}`))).toContain(
        t("printers.bluetooth_not_seen"),
      );
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-row-${ADDRESS}`))).not.toContain(
        t("printers.bluetooth_not_seen"),
      );
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
        `${t("printers.bluetooth_pair_failed")}: Busy`,
      );
      expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(false);
    } finally {
      el.remove();
      vi.useRealTimers();
    }
  });

  it("keeps a lost device's pairing status in view on a phone-width list", async () => {
    await page.viewport(390, 844);
    const background = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue([]) });
    const { el } = await mountPairing([barPrinter], { background });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(EXPIRES_MS + SCAN_POLL_MS);
      await flush(el);
      const status = q(el, sel(`discovered-command-${ADDRESS}`))!;
      expect(status.textContent).toBe(t("printers.bluetooth_no_answer"));
      const scroll = q(el, sel("discovered-table"))!.shadowRoot!.querySelector(".scroll")!;
      const view = scroll.getBoundingClientRect();
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
      expect(status.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(status.getBoundingClientRect().right).toBeLessThanOrEqual(view.right);
    } finally {
      el.remove();
      vi.useRealTimers();
      await page.viewport(1280, 900);
    }
  });

  it("keeps showing a device with a pairing status after Hide other devices", async () => {
    const { el } = await mountPairing([barPrinter, headphones], {
      pairBluetooth: vi.fn().mockResolvedValue({ command: pendingCommand("pair", OTHER) }),
    });
    await openDiscovery(el);
    q(el, sel("show-all-bluetooth"))!.click();
    await flush(el);
    await submitPair(el, OTHER);
    await vi.waitFor(() => expect(q(el, sel("pair-printer-modal"))).toBeNull());
    q(el, sel("show-all-bluetooth"))!.click();
    await flush(el);
    expect(text(el, sel("show-all-bluetooth"))).toBe(t("printers.bluetooth_show_all"));
    expect(text(el, sel(`discovered-command-${OTHER}`))).toBe(t("printers.bluetooth_pairing"));
    // Its ordinary row, not a lost device's: Pair stays, waiting on the outcome.
    expect(isDisabled(el, sel(`pair-${OTHER}`))).toBe(true);
    expect(text(el, sel(`discovered-row-${OTHER}`))).not.toContain(
      t("printers.bluetooth_not_seen"),
    );
  });

  it("hides a device that does not look like a printer until Show all devices, and hides it again on reopening", async () => {
    const { el } = await mountPairing([barPrinter, headphones]);
    await openDiscovery(el);
    expect(q(el, sel(`discovered-row-${OTHER}`))).toBeNull();
    expect(text(el, sel("show-all-bluetooth"))).toBe(t("printers.bluetooth_show_all"));
    q(el, sel("show-all-bluetooth"))!.click();
    await flush(el);
    expect(q(el, sel(`discovered-row-${OTHER}`))).not.toBeNull();
    expect(text(el, sel(`pair-${OTHER}`))).toBe(t("printers.bluetooth_pair"));
    expect(text(el, sel("show-all-bluetooth"))).toBe(t("printers.bluetooth_hide_others"));
    q(el, "[data-test=cancel-new-printer]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=new-printer-modal]")).toBeNull());
    await openDiscovery(el);
    expect(q(el, sel(`discovered-row-${OTHER}`))).toBeNull();
    expect(text(el, sel("show-all-bluetooth"))).toBe(t("printers.bluetooth_show_all"));
  });

  it("keeps a wrongly-described registered printer reachable in its printer row and through Show all", async () => {
    const stored = btPrinter("p4", OTHER, false);
    const device: DiscoveredPrinter = {
      ...headphones,
      paired: true,
      alreadyRegistered: true,
      printerId: "p4",
    };
    const { el, api } = await mountPairing([device], {
      listPrinters: vi.fn().mockResolvedValue([...printers, stored]),
    });
    await selectTab(el, "printers");
    await filterPrinters(el, "all");
    expect(q(el, sel("printer-row-p4"))).not.toBeNull();
    expect(q(el, sel("forget-pairing-p4"))).not.toBeNull();
    await openDiscovery(el);
    expect(q(el, sel(`discovered-row-${OTHER}`))).toBeNull();
    q(el, sel("show-all-bluetooth"))!.click();
    await flush(el);
    expect(text(el, sel(`register-${OTHER}`))).toBe(t("printers.add_again"));
    await addDiscovered(el, q(el, sel(`register-${OTHER}`))!);
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p4", { active: true });
  });

  it("offers Unpair only on a Bluetooth printer its agent reports paired now, switched on or off", async () => {
    const rows = [
      btPrinter("p4", ADDRESS, false),
      btPrinter("p5", "11:11:11:11:11:11", false),
      btPrinter("p6", "22:22:22:22:22:22", true),
      btPrinter("p7", "33:33:33:33:33:33", false),
    ];
    const reported = (printerId: string, localKey: string, paired?: true): DiscoveredPrinter => ({
      ...barPrinter,
      localKey,
      paired,
      alreadyRegistered: true,
      printerId,
    });
    const { el } = await mountPairing(
      [
        reported("p4", ADDRESS, true),
        reported("p6", "22:22:22:22:22:22", true),
        reported("p7", "33:33:33:33:33:33"),
        { ...discovered[1]!, printerId: "p3" },
      ],
      { listPrinters: vi.fn().mockResolvedValue([...printers, ...rows]) },
    );
    await selectTab(el, "printers");
    await filterPrinters(el, "all");
    for (const id of ["p4", "p6"])
      expect(text(el, sel(`forget-pairing-${id}`)), id).toBe(t("printers.bluetooth_forget"));
    for (const id of ["p1", "p2", "p3", "p5", "p7"])
      expect(q(el, sel(`forget-pairing-${id}`)), id).toBeNull();
  });

  it("offers Pair and add for a switched-off added printer no agent reports paired, and its pairing opens the form", async () => {
    const stored = btPrinter("p9", ADDRESS, false);
    const device: DiscoveredPrinter = { ...barPrinter, alreadyRegistered: true, printerId: "p9" };
    const passive = vi
      .fn<() => Promise<DiscoveredPrinter[]>>()
      .mockResolvedValue([{ ...device, bluetoothCommand: finishedCommand("pair", "succeeded") }]);
    const { el } = await mountPairing([device], {
      listPrinters: vi.fn().mockResolvedValue([...printers, stored]),
      background: stubApi({ listDiscoveredPrinters: passive }),
    });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      expect(text(el, sel(`pair-${ADDRESS}`))).toBe(t("printers.bluetooth_pair"));
      await submitPair(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_pairing"));
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(q(el, sel("name-printer-modal"))).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("Unpair stands in for Disable, and Add again switches it off again unless calibration is saved", () => {
    const saved: Printer = {
      ...btPrinter("p9", ADDRESS, false),
      paperWidth: "58mm",
      resolution: "203dpi",
      hasCashDrawer: true,
    };
    const pairedAgain: DiscoveredPrinter = {
      ...barPrinter,
      paired: true,
      alreadyRegistered: true,
      printerId: "p9",
    };

    it("offers Unpair and no Disable on a Bluetooth printer its agent reports paired, and Disable on one it does not", async () => {
      const unreported = btPrinter("p5", OTHER, true);
      const { el } = await mountPairing([{ ...pairedAgain, printerId: "p8" }], {
        listPrinters: vi
          .fn()
          .mockResolvedValue([...printers, btPrinter("p8", ADDRESS, true), unreported]),
      });
      await selectTab(el, "printers");
      expect(text(el, sel("forget-pairing-p8"))).toBe(t("printers.bluetooth_forget"));
      expect(q(el, sel("deactivate-printer-p8"))).toBeNull();
      expect(q(el, sel("forget-pairing-p5"))).toBeNull();
      expect(text(el, sel("deactivate-printer-p5"))).toBe(t("printers.disable"));
      expect(text(el, sel("deactivate-printer-p1"))).toBe(t("printers.disable"));
    });

    async function addAgain() {
      const mounted = await mountPairing([pairedAgain], {
        listPrinters: vi.fn().mockResolvedValue([...printers, saved]),
      });
      await openDiscovery(mounted.el);
      expect(text(mounted.el, sel(`register-${ADDRESS}`))).toBe(t("printers.add_again"));
      await addDiscovered(mounted.el, q(mounted.el, sel(`register-${ADDRESS}`))!);
      await vi.waitFor(() => expect(q(mounted.el, sel("calibration-step-1"))).not.toBeNull());
      await flush(mounted.el);
      return mounted;
    }

    it("opens calibration for the same printer with its saved settings, and cancelling switches it off again", async () => {
      const { el, api } = await addAgain();
      expect(api.createPrinter).not.toHaveBeenCalled();
      expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p9", { active: true });
      expect((q(el, 'select[name="printer-paper-width"]') as HTMLSelectElement).value).toBe("58mm");
      expect((q(el, 'select[name="printer-resolution"]') as HTMLSelectElement).value).toBe(
        "203dpi",
      );
      expect(
        (q(el, '[name="printer-cash-drawer"]') as HTMLElement & { checked: boolean }).checked,
      ).toBe(true);
      expect(api.deactivatePrinter).not.toHaveBeenCalled();

      q(el, sel("cancel-edit-printer"))!.click();
      await flush(el);

      await vi.waitFor(() => expect(q(el, sel("edit-printer-modal"))).toBeNull());
      expect(api.deactivatePrinter).toHaveBeenCalledExactlyOnceWith("p9");
    });

    it("switches the printer off again when the screen is left during calibration", async () => {
      const { el, api } = await addAgain();
      expect(api.deactivatePrinter).not.toHaveBeenCalled();

      el.remove();

      await vi.waitFor(() => expect(api.deactivatePrinter).toHaveBeenCalledExactlyOnceWith("p9"));
    });

    it("leaves the printer switched on once its calibration is saved", async () => {
      const { el, api } = await addAgain();
      for (let step = 1; step < 4; step++) {
        q(el, sel("calibration-next"))!.click();
        await flush(el);
      }
      q(el, sel("save-printer-p9"))!.click();
      await flush(el);

      await vi.waitFor(() => expect(q(el, sel("edit-printer-modal"))).toBeNull());
      await flush(el);
      expect(api.deactivatePrinter).not.toHaveBeenCalled();
    });
  });

  describe("an added printer that is switched on", () => {
    const added = btPrinter("p8", ADDRESS, true);
    const reported: DiscoveredPrinter = {
      ...barPrinter,
      paired: true,
      alreadyRegistered: true,
      printerId: "p8",
    };
    const mountAdded = () =>
      mountPairing([reported], {
        listPrinters: vi.fn().mockResolvedValue([...printers, added]),
      });

    it("offers Unpair in its row menu and unpairs on one press through its agent and address", async () => {
      const { el, api } = await mountAdded();
      await selectTab(el, "printers");
      const forget = q(el, sel("forget-pairing-p8"))!;
      expect(forget).not.toBeNull();
      const menu = forget.closest("dashboard-row-actions")!;
      expect(q(el, sel("edit-printer-p8"))!.closest("dashboard-row-actions")).toBe(menu);
      await userEvent.click(menu.shadowRoot!.querySelector("button")!);
      expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
      expect(text(el, sel("forget-pairing-p8"))).toBe(t("printers.bluetooth_forget"));
      forget.shadowRoot!.querySelector("button")!.click();
      await flush(el);
      expect(api.forgetBluetoothPairing).toHaveBeenCalledExactlyOnceWith("a1", ADDRESS);
      expect(api.deactivatePrinter).not.toHaveBeenCalled();
      expect(api.updatePrinter).not.toHaveBeenCalled();
    });

    it("names Unpair Desvincular in Spanish and Unpair in English, its outcome Desvinculado and Unpaired", async () => {
      const before = currentLocale();
      try {
        setLocale("es-ES");
        const { el } = await mountAdded();
        await selectTab(el, "printers");
        expect(text(el, sel("forget-pairing-p8"))).toBe("Desvincular");
        expect(t("printers.bluetooth_forgetting")).toBe("Desvinculando…");
        expect(t("printers.bluetooth_forgotten")).toBe("Desvinculado");
        el.remove();
        setLocale("en");
        const english = await mountAdded();
        await selectTab(english.el, "printers");
        expect(text(english.el, sel("forget-pairing-p8"))).toBe("Unpair");
        expect(t("printers.bluetooth_forgetting")).toBe("Unpairing…");
        expect(t("printers.bluetooth_forgotten")).toBe("Unpaired");
        expect(t("printers.bluetooth_forget_failed")).toBe("Could not unpair");
      } finally {
        setLocale(before);
      }
    });

    describe("once its pairing is forgotten", () => {
      const unpaired: DiscoveredPrinter = {
        ...barPrinter,
        alreadyRegistered: true,
        printerId: "p8",
      };

      afterEach(() => {
        vi.useRealTimers();
      });

      it("offers Pair for it in Add a printer, which pairs it again without adding or changing it", async () => {
        const listed = vi.fn<() => Promise<DiscoveredPrinter[]>>().mockResolvedValue([reported]);
        const passive = vi
          .fn<() => Promise<DiscoveredPrinter[]>>()
          .mockResolvedValue([
            { ...unpaired, bluetoothCommand: finishedCommand("forget", "succeeded") },
          ]);
        const listPrinters = vi.fn().mockResolvedValue([...printers, added]);
        const { el, api } = await mountPairing([reported], {
          listPrinters,
          listDiscoveredPrinters: listed,
          background: stubApi({ listPrinters, listDiscoveredPrinters: passive }),
        });
        await selectTab(el, "printers");
        vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
        q(el, sel("forget-pairing-p8"))!.click();
        await flush(el);
        await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
        await flush(el);
        expect(text(el, sel("printer-command-p8"))).toBe(t("printers.bluetooth_forgotten"));
        expect(q(el, sel("forget-pairing-p8"))).toBeNull();

        listed.mockResolvedValue([unpaired]);
        passive.mockResolvedValue([unpaired]);
        await openDiscovery(el);
        expect(text(el, sel(`pair-${ADDRESS}`))).toBe(t("printers.bluetooth_pair_only"));
        expect(q(el, sel(`register-${ADDRESS}`))).toBeNull();
        await openPair(el);
        expect(text(el, sel("confirm-pair"))).toBe(t("printers.bluetooth_pair_only"));
        typeField(el, sel("bluetooth-pin"), PIN);
        await flush(el);
        q(el, sel("confirm-pair"))!.click();
        await flush(el);
        expect(api.pairBluetooth).toHaveBeenCalledExactlyOnceWith("a1", ADDRESS, PIN);
        expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
          t("printers.bluetooth_pairing"),
        );
        expect(q(el, sel(`progress-discovered-command-${ADDRESS}`))?.tagName).toBe("WT-SPINNER");
        expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(true);

        // The outcome can arrive before the agent's own paired report does.
        passive.mockResolvedValue([
          { ...unpaired, bluetoothCommand: finishedCommand("pair", "succeeded") },
        ]);
        await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
        await flush(el);
        expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_paired"));
        expect(q(el, sel("name-printer-modal"))).toBeNull();
        expect(q(el, sel(`register-${ADDRESS}`))).toBeNull();
        expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(false);
        passive.mockResolvedValue([reported]);
        await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
        await flush(el);
        expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_paired"));
        expect(q(el, sel(`register-${ADDRESS}`))).toBeNull();
        expect(q(el, sel(`pair-${ADDRESS}`))).toBeNull();
        q(el, sel("cancel-new-printer"))!.click();
        await vi.waitFor(() => expect(q(el, sel("new-printer-modal"))).toBeNull());
        expect(text(el, sel("forget-pairing-p8"))).toBe(t("printers.bluetooth_forget"));
        expect(api.createPrinter).not.toHaveBeenCalled();
        expect(api.updatePrinter).not.toHaveBeenCalled();
        expect(api.deactivatePrinter).not.toHaveBeenCalled();
      });

      it("names the button Emparejar in Spanish and Pair in English, and says only Emparejando… and Pairing… while it pairs", async () => {
        const before = currentLocale();
        const mountForgotten = () =>
          mountPairing([unpaired], {
            listPrinters: vi.fn().mockResolvedValue([...printers, added]),
          });
        try {
          setLocale("es-ES");
          const { el } = await mountForgotten();
          await openDiscovery(el);
          expect(text(el, sel(`pair-${ADDRESS}`))).toBe("Emparejar");
          await submitPair(el);
          expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe("Emparejando…");
          el.remove();
          setLocale("en");
          const english = await mountForgotten();
          await openDiscovery(english.el);
          expect(text(english.el, sel(`pair-${ADDRESS}`))).toBe("Pair");
          await submitPair(english.el);
          expect(text(english.el, sel(`discovered-command-${ADDRESS}`))).toBe("Pairing…");
        } finally {
          setLocale(before);
        }
      });

      it("keeps saying Pairing… and opens no form while its pairing is pending, once its agent reports it paired before the outcome", async () => {
        const passive = vi.fn<() => Promise<DiscoveredPrinter[]>>().mockResolvedValue([unpaired]);
        const { el } = await mountPairing([unpaired], {
          listPrinters: vi.fn().mockResolvedValue([...printers, added]),
          background: stubApi({ listDiscoveredPrinters: passive }),
        });
        vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
        await openDiscovery(el);
        await submitPair(el);
        expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
          t("printers.bluetooth_pairing"),
        );
        // The paired flag and the command's outcome are separate fields, so the paired report can
        // arrive while the command still reads pending.
        passive.mockResolvedValue([reported]);
        await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
        await flush(el);
        expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
          t("printers.bluetooth_pairing"),
        );
        expect(q(el, sel("name-printer-modal"))).toBeNull();
      });

      it("keeps Pair, to try again, when a pairing that succeeded has faded and its agent never reports it paired", async () => {
        const passive = vi
          .fn<() => Promise<DiscoveredPrinter[]>>()
          .mockResolvedValue([
            { ...unpaired, bluetoothCommand: finishedCommand("pair", "succeeded") },
          ]);
        const { el, api } = await mountPairing([unpaired], {
          listPrinters: vi.fn().mockResolvedValue([...printers, added]),
          background: stubApi({ listDiscoveredPrinters: passive }),
        });
        vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
        await openDiscovery(el);
        await submitPair(el);
        await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
        await flush(el);
        expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_paired"));
        await fadeNotice(el, `discovered-command-${ADDRESS}`);
        expect(q(el, sel(`discovered-command-${ADDRESS}`))).toBeNull();
        expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(false);
        await vi.advanceTimersByTimeAsync(EXPIRES_MS + SCAN_POLL_MS);
        await flush(el);
        expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(false);
        await submitPair(el);
        expect(api.pairBluetooth).toHaveBeenCalledTimes(2);
        expect(q(el, sel("name-printer-modal"))).toBeNull();
      });

      it("offers Pair for it without Show all devices, though its agent does not call it a printer", async () => {
        const { el } = await mountPairing([{ ...unpaired, printerLike: undefined }], {
          listPrinters: vi.fn().mockResolvedValue([...printers, added]),
        });
        await openDiscovery(el);
        expect(text(el, sel(`pair-${ADDRESS}`))).toBe(t("printers.bluetooth_pair_only"));
        expect(q(el, sel("show-all-bluetooth"))).toBeNull();
      });
    });

    it("offers no Pair for it in Add a printer while another agent reports it paired", async () => {
      const { el } = await mountPairing(
        [
          reported,
          {
            ...barPrinter,
            agentId: "a2",
            agentName: "Barra agent",
            alreadyRegistered: true,
            printerId: "p8",
          },
        ],
        { listPrinters: vi.fn().mockResolvedValue([...printers, added]) },
      );
      await openDiscovery(el);
      expect(q(el, sel(`pair-${ADDRESS}`))).toBeNull();
      expect(q(el, sel(`register-${ADDRESS}`))).toBeNull();
    });

    it("offers no Pair, nor Add, for it in Add a printer while its agent reports it paired", async () => {
      const { el } = await mountAdded();
      await openDiscovery(el);
      expect(q(el, sel(`discovered-row-${ADDRESS}`))).toBeNull();
      expect(q(el, sel(`pair-${ADDRESS}`))).toBeNull();
      expect(q(el, sel(`register-${ADDRESS}`))).toBeNull();
    });
  });

  describe("Pair and add", () => {
    const second: DiscoveredPrinter = { ...barPrinter, localKey: OTHER, name: "Kitchen printer" };
    const succeeded = (paired?: true): DiscoveredPrinter => ({
      ...barPrinter,
      ...(paired && { paired }),
      bluetoothCommand: finishedCommand("pair", "succeeded"),
    });
    const nameField = (el: PrintersScreen, address = ADDRESS) =>
      q(el, sel(`discovered-name-${address}`)) as (HTMLElement & { value: string }) | null;

    /** Mounts with the scan's listen already over, so only the status poll reads `passive`. */
    async function mountQuiet(listed: DiscoveredPrinter[], overrides: Partial<DashboardApi> = {}) {
      const passive = vi.fn<() => Promise<DiscoveredPrinter[]>>().mockResolvedValue(listed);
      const mounted = await mountPairing(listed, {
        background: stubApi({ listDiscoveredPrinters: passive }),
        ...overrides,
      });
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      await openDiscovery(mounted.el);
      await vi.advanceTimersByTimeAsync(SCAN_LISTEN_MS + SCAN_POLL_MS);
      passive.mockClear();
      return { ...mounted, passive };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("names the row's button Emparejar y añadir in Spanish and Pair and add in English", async () => {
      const before = currentLocale();
      try {
        setLocale("es-ES");
        const { el } = await mountPairing([barPrinter]);
        await openDiscovery(el);
        expect(text(el, sel(`pair-${ADDRESS}`))).toBe("Emparejar y añadir");
        el.remove();
        setLocale("en");
        const english = await mountPairing([barPrinter]);
        await openDiscovery(english.el);
        expect(text(english.el, sel(`pair-${ADDRESS}`))).toBe("Pair and add");
      } finally {
        setLocale(before);
      }
    });

    it("says only Pairing…, beside a spinner, until the outcome", async () => {
      const { el, passive } = await mountQuiet([barPrinter]);
      passive.mockResolvedValueOnce([{ ...barPrinter, bluetoothCommand: pendingCommand("pair") }]);
      passive.mockResolvedValue([succeeded(true)]);
      await submitPair(el);
      const status = text(el, sel(`discovered-command-${ADDRESS}`));
      expect(status).toBe(t("printers.bluetooth_pairing"));
      expect(status).toBe("Emparejando…");
      expect(t("printers.bluetooth_pairing", "en")).toBe("Pairing…");
      expect(q(el, sel(`progress-discovered-command-${ADDRESS}`))?.tagName).toBe("WT-SPINNER");
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_pairing"));
      expect(q(el, sel(`progress-discovered-command-${ADDRESS}`))).not.toBeNull();
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_paired"));
      expect(q(el, sel(`progress-discovered-command-${ADDRESS}`))).toBeNull();
    });

    it("pairs and then opens the form to add the device, which adds it with no second click on its row", async () => {
      const { el, api, passive } = await mountQuiet([barPrinter]);
      passive.mockResolvedValue([succeeded(true)]);
      await submitPair(el);
      expect(q(el, sel("name-printer-modal"))).toBeNull();
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(q(el, sel("name-printer-modal"))).not.toBeNull();
      expect(nameField(el)?.value).toBe("Bar printer");
      q(el, sel("confirm-add-printer"))!.click();
      await vi.waitFor(() => expect(q(el, sel("new-printer-modal"))).toBeNull());
      expect(api.createPrinter).toHaveBeenCalledExactlyOnceWith({
        name: "Bar printer",
        transport: "bluetooth",
        localKey: ADDRESS,
      });
      expect(q(el, sel("name-printer-modal"))).toBeNull();
    });

    it.each([
      [
        "failed",
        {
          ...barPrinter,
          bluetoothCommand: finishedCommand("pair", "failed", { error: "Authentication Failed" }),
        },
        "printers.bluetooth_pair_failed",
      ],
      ["went unanswered", barPrinter, "printers.bluetooth_no_answer"],
    ] as const)(
      "opens no form to add a device whose pairing %s, and keeps the reason in its row",
      async (_, report, key) => {
        const { el, passive } = await mountQuiet([barPrinter]);
        passive.mockResolvedValue([report]);
        await submitPair(el);
        await vi.advanceTimersByTimeAsync(EXPIRES_MS + SCAN_POLL_MS);
        await flush(el);
        expect(text(el, sel(`discovered-command-${ADDRESS}`))).toContain(t(key));
        expect(q(el, sel("name-printer-modal"))).toBeNull();
        expect(isDisabled(el, sel(`pair-${ADDRESS}`))).toBe(false);
      },
    );

    it("opens no form to add a device whose Add printer dialog closed before its pairing finished", async () => {
      const { el, passive } = await mountQuiet([barPrinter]);
      passive.mockResolvedValue([succeeded(true)]);
      await submitPair(el);
      q(el, "[data-test=cancel-new-printer]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=new-printer-modal]")).toBeNull());
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 2);
      await flush(el);
      expect(q(el, sel("name-printer-modal"))).toBeNull();
      q(el, "[data-test=open-add-printer]")!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 2);
      await flush(el);
      expect(q(el, sel("name-printer-modal"))).toBeNull();
    });

    it("leaves an open form to add another printer alone when a pairing finishes, offering Add in the paired row", async () => {
      const paired: DiscoveredPrinter = { ...second, paired: true };
      const { el, passive } = await mountQuiet([barPrinter, paired]);
      passive.mockResolvedValue([succeeded(), paired]);
      await submitPair(el);
      q(el, sel(`register-${OTHER}`))!.click();
      await flush(el);
      expect(nameField(el, OTHER)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_paired"));
      expect(nameField(el, OTHER)).not.toBeNull();
      expect(nameField(el)).toBeNull();
      expect(text(el, sel(`register-${ADDRESS}`))).toBe(t("action.add"));
    });

    it("leaves an open Pair and add dialog alone when another pairing finishes, offering Add in the paired row", async () => {
      const { el, passive } = await mountQuiet([barPrinter, second]);
      passive.mockResolvedValue([succeeded(), second]);
      await submitPair(el);
      await openPair(el, OTHER);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_paired"));
      expect(q(el, sel("pair-printer-modal"))).not.toBeNull();
      expect(q(el, sel("name-printer-modal"))).toBeNull();
      expect(text(el, sel(`register-${ADDRESS}`))).toBe(t("action.add"));
    });

    it("offers Add, not Pair and add, once a pairing succeeds, before the agent reports the device paired", async () => {
      const { el, passive } = await mountQuiet([barPrinter]);
      passive.mockResolvedValue([succeeded()]);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`register-${ADDRESS}`))).toBe(t("action.add"));
      expect(q(el, sel(`pair-${ADDRESS}`))).toBeNull();
    });

    it("leaves the device paired when its form is cancelled, offering Add and, once reported paired, Unpair", async () => {
      const { el, api, passive } = await mountQuiet([barPrinter]);
      passive
        .mockResolvedValueOnce([succeeded()])
        .mockResolvedValue([{ ...barPrinter, paired: true }]);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      q(el, sel("cancel-printer-name"))!.click();
      await vi.waitFor(() => expect(q(el, sel("name-printer-modal"))).toBeNull());
      expect(text(el, sel(`register-${ADDRESS}`))).toBe(t("action.add"));
      expect(q(el, sel(`pair-${ADDRESS}`))).toBeNull();
      expect(q(el, sel(`forget-device-${ADDRESS}`))).toBeNull();
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`register-${ADDRESS}`))).toBe(t("action.add"));
      expect(text(el, sel(`forget-device-${ADDRESS}`))).toBe(t("printers.bluetooth_forget"));
      q(el, sel(`forget-device-${ADDRESS}`))!.click();
      await flush(el);
      expect(api.forgetBluetoothPairing).toHaveBeenCalledExactlyOnceWith("a1", ADDRESS);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
        t("printers.bluetooth_forgetting"),
      );
      expect(isDisabled(el, sel(`forget-device-${ADDRESS}`))).toBe(true);
    });

    it("offers Unpair beside Add only for a paired device with no printer row", async () => {
      const retained: DiscoveredPrinter = {
        ...second,
        paired: true,
        alreadyRegistered: true,
        printerId: "p4",
      };
      const { el } = await mountQuiet([{ ...barPrinter, paired: true }, retained], {
        listPrinters: vi.fn().mockResolvedValue([...printers, btPrinter("p4", OTHER, false)]),
      });
      await flush(el);
      expect(text(el, sel(`forget-device-${ADDRESS}`))).toBe(t("printers.bluetooth_forget"));
      expect(text(el, sel(`register-${OTHER}`))).toBe(t("printers.add_again"));
      expect(q(el, sel(`forget-device-${OTHER}`))).toBeNull();
    });

    it("unpairs a listed device on one press of Unpair", async () => {
      const { el, api } = await mountQuiet([{ ...barPrinter, paired: true }]);
      q(el, sel(`forget-device-${ADDRESS}`))!.click();
      await flush(el);
      expect(api.forgetBluetoothPairing).toHaveBeenCalledExactlyOnceWith("a1", ADDRESS);
      expect(text(el, sel(`forget-device-${ADDRESS}`))).toBe(t("printers.bluetooth_forget"));
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
        t("printers.bluetooth_forgetting"),
      );
    });

    it("hides a listed device's Unpair once its unpairing succeeds, though the pairing report lingers, after its notice fades too", async () => {
      const { el, passive } = await mountQuiet([{ ...barPrinter, paired: true }]);
      passive.mockResolvedValue([
        { ...barPrinter, paired: true, bluetoothCommand: finishedCommand("forget", "succeeded") },
      ]);
      q(el, sel(`forget-device-${ADDRESS}`))!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
        t("printers.bluetooth_forgotten"),
      );
      expect(q(el, sel(`forget-device-${ADDRESS}`))).toBeNull();
      expect(text(el, sel(`register-${ADDRESS}`))).toBe(t("action.add"));
      await fadeNotice(el, `discovered-command-${ADDRESS}`);
      expect(q(el, sel(`discovered-command-${ADDRESS}`))).toBeNull();
      expect(q(el, sel(`forget-device-${ADDRESS}`))).toBeNull();
    });

    it("keeps Unpair hidden after its unpairing faded while the agent still lists the device paired, and offers it again once the agent has reported it unpaired and then paired", async () => {
      const device: DiscoveredPrinter = { ...barPrinter, paired: true };
      const { el, passive, api } = await mountQuiet([device]);
      passive.mockResolvedValue([
        { ...device, bluetoothCommand: finishedCommand("forget", "succeeded") },
      ]);
      q(el, sel(`forget-device-${ADDRESS}`))!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      await fadeNotice(el, `discovered-command-${ADDRESS}`);
      const reopenWith = async (report: DiscoveredPrinter) => {
        q(el, "[data-test=cancel-new-printer]")!.click();
        await vi.waitFor(() => expect(q(el, "[data-test=new-printer-modal]")).toBeNull());
        vi.mocked(api.listDiscoveredPrinters).mockResolvedValue([report]);
        passive.mockResolvedValue([report]);
        await openDiscovery(el);
      };
      await reopenWith(device);
      expect(q(el, sel(`forget-device-${ADDRESS}`))).toBeNull();
      await reopenWith(barPrinter);
      expect(q(el, sel(`pair-${ADDRESS}`))).not.toBeNull();
      await reopenWith({
        ...device,
        bluetoothCommand: finishedCommand("pair", "succeeded", { id: "pair-elsewhere" }),
      });
      expect(text(el, sel(`forget-device-${ADDRESS}`))).toBe(t("printers.bluetooth_forget"));
    });

    it("clears a failed unpairing's reason when Add a printer closes, though its agent still reports that outcome", async () => {
      const device: DiscoveredPrinter = { ...barPrinter, paired: true };
      const failed: DiscoveredPrinter = {
        ...device,
        bluetoothCommand: finishedCommand("forget", "failed", { error: "Device busy" }),
      };
      const { el, passive, api } = await mountQuiet([device]);
      passive.mockResolvedValue([failed]);
      q(el, sel(`forget-device-${ADDRESS}`))!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
        `${t("printers.bluetooth_forget_failed")}: Device busy`,
      );
      q(el, "[data-test=cancel-new-printer]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=new-printer-modal]")).toBeNull());
      vi.mocked(api.listDiscoveredPrinters).mockResolvedValue([failed]);
      await openDiscovery(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(q(el, sel(`discovered-command-${ADDRESS}`))).toBeNull();
      expect(isDisabled(el, sel(`forget-device-${ADDRESS}`))).toBe(false);
    });

    it("puts a row's buttons side by side, and Pairing… to their right", async () => {
      const { el, api } = await mountQuiet([{ ...barPrinter, paired: true }, second]);
      const add = q(el, sel(`register-${ADDRESS}`))!.getBoundingClientRect();
      const unpair = q(el, sel(`forget-device-${ADDRESS}`))!.getBoundingClientRect();
      expect(unpair.top).toBe(add.top);
      expect(unpair.left).toBeGreaterThan(add.right);
      vi.mocked(api.pairBluetooth).mockResolvedValue({ command: pendingCommand("pair", OTHER) });
      await submitPair(el, OTHER);
      const pair = q(el, sel(`pair-${OTHER}`))!.getBoundingClientRect();
      const status = q(el, sel(`discovered-command-${OTHER}`))!.getBoundingClientRect();
      expect(status.left).toBeGreaterThan(pair.right);
      expect(status.top).toBeGreaterThanOrEqual(pair.top);
      expect(status.bottom).toBeLessThanOrEqual(pair.bottom);
    });

    it("wraps a row's Spanish buttons, and Pairing…, onto lines of their own at phone width rather than scroll", async () => {
      const before = currentLocale();
      setLocale("es-ES");
      await page.viewport(390, 844);
      try {
        const { el, api } = await mountQuiet([{ ...barPrinter, paired: true }, second]);
        const add = q(el, sel(`register-${ADDRESS}`))!.getBoundingClientRect();
        const unpair = q(el, sel(`forget-device-${ADDRESS}`))!.getBoundingClientRect();
        expect(unpair.top).toBeGreaterThanOrEqual(add.bottom);
        vi.mocked(api.pairBluetooth).mockResolvedValue({ command: pendingCommand("pair", OTHER) });
        await submitPair(el, OTHER);
        const pair = q(el, sel(`pair-${OTHER}`))!.getBoundingClientRect();
        const status = q(el, sel(`discovered-command-${OTHER}`))!.getBoundingClientRect();
        expect(status.top).toBeGreaterThanOrEqual(pair.bottom);
        // "Emparejar y añadir" keeps its label on one line.
        expect(pair.height).toBe(add.height);
        const scroll = q(el, sel("discovered-table"))!.shadowRoot!.querySelector(".scroll")!;
        expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
      } finally {
        setLocale(before);
        await page.viewport(1280, 900);
      }
    });

    it("keeps reading after a pairing succeeds until the agent reports the device paired, then stops", async () => {
      const { el, passive } = await mountQuiet([barPrinter]);
      passive
        .mockResolvedValueOnce([succeeded()])
        .mockResolvedValueOnce([succeeded()])
        .mockResolvedValue([{ ...barPrinter, paired: true }]);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 3);
      await flush(el);
      expect(passive).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
      expect(passive).toHaveBeenCalledTimes(3);
    });

    it("stops reading for the paired report when the pairing's own deadline passes", async () => {
      const { el, passive } = await mountQuiet([barPrinter]);
      passive.mockResolvedValue([succeeded()]);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 3);
      expect(passive).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(EXPIRES_MS);
      await flush(el);
      const calls = passive.mock.calls.length;
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
      expect(passive).toHaveBeenCalledTimes(calls);
    });

    it("keeps Add and the reads for the paired report after a pairing's Paired status has faded", async () => {
      const { el, passive } = await mountQuiet([barPrinter]);
      passive.mockResolvedValue([succeeded()]);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      q(el, sel("cancel-printer-name"))!.click();
      await vi.waitFor(() => expect(q(el, sel("name-printer-modal"))).toBeNull());
      await fadeNotice(el, `discovered-command-${ADDRESS}`);
      expect(q(el, sel(`discovered-command-${ADDRESS}`))).toBeNull();
      expect(text(el, sel(`register-${ADDRESS}`))).toBe(t("action.add"));
      expect(q(el, sel(`pair-${ADDRESS}`))).toBeNull();
      passive
        .mockResolvedValueOnce([barPrinter])
        .mockResolvedValue([{ ...barPrinter, paired: true }]);
      const calls = passive.mock.calls.length;
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 2);
      await flush(el);
      expect(passive).toHaveBeenCalledTimes(calls + 2);
      expect(text(el, sel(`register-${ADDRESS}`))).toBe(t("action.add"));
      expect(text(el, sel(`forget-device-${ADDRESS}`))).toBe(t("printers.bluetooth_forget"));
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
      expect(passive).toHaveBeenCalledTimes(calls + 2);
    });

    it("offers Pair and add again once a device paired in this dialog is forgotten and reported unpaired", async () => {
      const { el, passive } = await mountQuiet([barPrinter]);
      passive
        .mockResolvedValueOnce([succeeded()])
        .mockResolvedValue([{ ...barPrinter, paired: true }]);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 2);
      await flush(el);
      q(el, sel("cancel-printer-name"))!.click();
      await vi.waitFor(() => expect(q(el, sel("name-printer-modal"))).toBeNull());
      q(el, sel(`forget-device-${ADDRESS}`))!.click();
      await flush(el);
      passive.mockResolvedValue([
        { ...barPrinter, bluetoothCommand: finishedCommand("forget", "succeeded") },
      ]);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(
        t("printers.bluetooth_forgotten"),
      );
      expect(text(el, sel(`pair-${ADDRESS}`))).toBe(t("printers.bluetooth_pair"));
      expect(q(el, sel(`register-${ADDRESS}`))).toBeNull();
    });

    it("opens the form for the next device whose pairing succeeded when the first can no longer be added", async () => {
      const { el, api, passive } = await mountQuiet([barPrinter, second]);
      vi.mocked(api.pairBluetooth).mockImplementation(async (_agent, address) => ({
        command: { ...pendingCommand("pair", address), id: address },
      }));
      await submitPair(el);
      await submitPair(el, OTHER);
      passive.mockResolvedValue([
        {
          ...succeeded(true),
          alreadyRegistered: true,
          printerId: "p9",
          bluetoothCommand: { ...finishedCommand("pair", "succeeded"), id: ADDRESS },
        },
        {
          ...second,
          paired: true,
          bluetoothCommand: {
            ...finishedCommand("pair", "succeeded"),
            id: OTHER,
            address: OTHER,
          },
        },
      ]);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(nameField(el, OTHER)).not.toBeNull();
      expect(nameField(el)).toBeNull();
    });

    it("opens no form when the device was registered elsewhere by the time its pairing succeeds", async () => {
      const { el, passive } = await mountQuiet([barPrinter]);
      passive.mockResolvedValue([{ ...succeeded(true), alreadyRegistered: true, printerId: "p9" }]);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel(`discovered-command-${ADDRESS}`))).toBe(t("printers.bluetooth_paired"));
      expect(q(el, sel("name-printer-modal"))).toBeNull();
    });

    it("starts no read for the paired report once the pairing's own deadline has passed", async () => {
      const { el, api, passive } = await mountQuiet([barPrinter]);
      vi.mocked(api.pairBluetooth).mockResolvedValue({
        command: { ...pendingCommand("pair"), expiresInMs: 5_000 },
      });
      const started = Date.now();
      const reads: number[] = [];
      passive.mockImplementation(async () => {
        reads.push(Date.now() - started);
        return [succeeded()];
      });
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
      expect(reads).toEqual([SCAN_POLL_MS, SCAN_POLL_MS * 2]);
    });

    it("keeps reading for another pending command after a succeeded pairing's deadline passes", async () => {
      const { el, api, passive } = await mountQuiet([barPrinter, second]);
      vi.mocked(api.pairBluetooth).mockImplementation(async (_agent, address) => ({
        command: {
          ...pendingCommand("pair", address),
          id: address,
          ...(address === ADDRESS && { expiresInMs: 5_000 }),
        },
      }));
      passive.mockResolvedValue([
        {
          ...succeeded(),
          bluetoothCommand: { ...finishedCommand("pair", "succeeded"), id: ADDRESS },
        },
        second,
      ]);
      await submitPair(el);
      await submitPair(el, OTHER);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
      expect(passive).toHaveBeenCalledTimes(5);
      expect(text(el, sel(`discovered-command-${OTHER}`))).toBe(t("printers.bluetooth_pairing"));
    });

    it("stops reading for a succeeded pairing's paired report when Add a printer closes, and offers Pair and add on reopening", async () => {
      const { el, passive } = await mountQuiet([barPrinter]);
      passive.mockResolvedValue([succeeded()]);
      await submitPair(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(passive).toHaveBeenCalledTimes(1);
      q(el, "[data-test=cancel-new-printer]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=new-printer-modal]")).toBeNull());
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
      expect(passive).toHaveBeenCalledTimes(1);
      passive.mockResolvedValue([barPrinter]);
      q(el, "[data-test=open-add-printer]")!.click();
      await flush(el);
      expect(text(el, sel(`pair-${ADDRESS}`))).toBe(t("printers.bluetooth_pair"));
      expect(q(el, sel(`register-${ADDRESS}`))).toBeNull();
    });
  });

  interface Settle {
    resolve: (rows: DiscoveredPrinter[]) => void;
    reject: (error: unknown) => void;
  }

  describe("forgetting", () => {
    const stored = btPrinter("p4", ADDRESS, false);
    const reported: DiscoveredPrinter = {
      ...barPrinter,
      paired: true,
      alreadyRegistered: true,
      printerId: "p4",
    };

    async function mountForget(
      background:
        DiscoveredPrinter[][] | ReturnType<typeof vi.fn<() => Promise<DiscoveredPrinter[]>>>,
      overrides: Partial<DashboardApi> = {},
    ) {
      const passive = Array.isArray(background)
        ? background.reduce(
            (fn, rows) => fn.mockResolvedValueOnce(rows),
            vi.fn<() => Promise<DiscoveredPrinter[]>>().mockResolvedValue(background.at(-1) ?? []),
          )
        : background;
      const listPrinters = vi.fn().mockResolvedValue([...printers, stored]);
      const mounted = await mountPairing([reported], {
        listPrinters,
        // A reload reads through the background client too.
        background: stubApi({ listPrinters, listDiscoveredPrinters: passive }),
        ...overrides,
      });
      await selectTab(mounted.el, "printers");
      await filterPrinters(mounted.el, "all");
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      return { ...mounted, passive };
    }

    async function forget(el: PrintersScreen): Promise<void> {
      q(el, sel("forget-pairing-p4"))!.click();
      await flush(el);
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("unpairs on one press, through the named agent and address", async () => {
      const { el, api } = await mountForget([[reported]]);
      q(el, sel("forget-pairing-p4"))!.click();
      await flush(el);
      expect(api.forgetBluetoothPairing).toHaveBeenCalledExactlyOnceWith("a1", ADDRESS);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgetting"));
      expect(isDisabled(el, sel("forget-pairing-p4"))).toBe(true);
      expect(api.deactivatePrinter).not.toHaveBeenCalled();
      expect(api.updatePrinter).not.toHaveBeenCalled();
    });

    it("keeps showing Unpaired after its row leaves the list, until it fades", async () => {
      const done = {
        ...reported,
        bluetoothCommand: finishedCommand("forget", "succeeded"),
      };
      const { el } = await mountForget([[done], []]);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgotten"));
      // Any reload reads the list again; the device has left it, taking its status with it.
      q(el, sel("deactivate-printer-p1"))!.click();
      await flush(el);
      await flush(el);
      expect(q(el, sel("forget-pairing-p4"))).toBeNull();
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgotten"));
      expect(cellButtons(el, "printer-command-p4")).toEqual([]);
      await fadeNotice(el, "printer-command-p4");
      expect(q(el, sel("printer-command-p4"))).toBeNull();
    });

    it("shows the reason a forget failed", async () => {
      const failed = {
        ...reported,
        bluetoothCommand: finishedCommand("forget", "failed", { error: "Device busy" }),
      };
      const { el } = await mountForget([[failed]]);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(
        `${t("printers.bluetooth_forget_failed")}: Device busy`,
      );
    });

    it("shows a refused forget on the page", async () => {
      const { el } = await mountForget([[reported]], {
        forgetBluetoothPairing: vi.fn().mockRejectedValue({
          code: "printer.bluetooth_not_paired",
          params: { address: ADDRESS },
        }),
      });
      await forget(el);
      expect(text(el, "[role=alert]")).toBe(codeMessage("printer.bluetooth_not_paired"));
      expect(q(el, sel("printer-command-p4"))).toBeNull();
      expect(isDisabled(el, sel("forget-pairing-p4"))).toBe(false);
    });

    it("polls passively without overlapping itself, and stops at the outcome", async () => {
      let answer!: (rows: DiscoveredPrinter[]) => void;
      const passive = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<DiscoveredPrinter[]>((resolve) => {
              answer = resolve;
            }),
        )
        .mockResolvedValue([
          { ...reported, bluetoothCommand: finishedCommand("forget", "succeeded") },
        ]);
      const { el, api } = await mountForget(passive);
      const foreground = vi.mocked(api.listDiscoveredPrinters).mock.calls.length;
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 3);
      expect(passive).toHaveBeenCalledOnce();
      answer([{ ...reported, bluetoothCommand: pendingCommand("forget") }]);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      expect(passive).toHaveBeenCalledTimes(2);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgotten"));
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
      expect(passive).toHaveBeenCalledTimes(2);
      expect(api.listDiscoveredPrinters).toHaveBeenCalledTimes(foreground);
    });

    it("calls a command whose status vanished past its expiry unanswered, never done, and stops polling", async () => {
      const { el, passive } = await mountForget([[]]);
      await forget(el);
      await vi.advanceTimersByTimeAsync(EXPIRES_MS - SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgetting"));
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 2);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_no_answer"));
      const calls = passive.mock.calls.length;
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
      expect(passive).toHaveBeenCalledTimes(calls);
    });

    it.each([
      [
        "answers",
        (settle: Settle) =>
          settle.resolve([
            { ...reported, bluetoothCommand: finishedCommand("forget", "succeeded") },
          ]),
      ],
      ["fails", (settle: Settle) => settle.reject({ code: "connection.failed" })],
    ] as const)(
      "gives up at the expiry while a status read hangs, and ignores that read when it later %s",
      async (_, late) => {
        const settle = {} as Settle;
        const passive = vi.fn().mockImplementation(
          () =>
            new Promise<DiscoveredPrinter[]>((resolve, reject) => {
              Object.assign(settle, { resolve, reject });
            }),
        );
        const { el } = await mountForget(passive);
        await forget(el);
        await vi.advanceTimersByTimeAsync(EXPIRES_MS);
        await flush(el);
        expect(passive).toHaveBeenCalledOnce();
        expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_no_answer"));
        late(settle);
        await flush(el);
        expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_no_answer"));
        expect(q(el, "[data-test=printer-refresh-error]")).toBeNull();
        await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
        expect(passive).toHaveBeenCalledOnce();
      },
    );

    it("leaves an expired forget unanswered when a hung read answers for it while another command waits", async () => {
      const second = btPrinter("p5", OTHER, false);
      const settle = {} as Settle;
      const passive = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<DiscoveredPrinter[]>((resolve, reject) => {
              Object.assign(settle, { resolve, reject });
            }),
        )
        .mockResolvedValue([]);
      const listPrinters = vi.fn().mockResolvedValue([...printers, stored, second]);
      const reports = [reported, { ...reported, localKey: OTHER, printerId: "p5" }];
      const { el } = await mountForget(passive, {
        listPrinters,
        listDiscoveredPrinters: vi.fn().mockResolvedValue(reports),
        background: stubApi({ listPrinters, listDiscoveredPrinters: passive }),
        forgetBluetoothPairing: vi
          .fn()
          .mockResolvedValueOnce({ command: { ...pendingCommand("forget"), expiresInMs: 10_000 } })
          .mockResolvedValueOnce({
            command: { ...pendingCommand("forget", OTHER), id: "forget-2" },
          }),
      });
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      q(el, sel("forget-pairing-p5"))!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(10_000);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_no_answer"));
      expect(text(el, sel("printer-command-p5"))).toBe(t("printers.bluetooth_forgetting"));
      settle.resolve([{ ...reported, bluetoothCommand: finishedCommand("forget", "succeeded") }]);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_no_answer"));
    });

    it("gives up when the server says the command expires, not at a fixed time", async () => {
      const { el } = await mountForget([[reported]], {
        forgetBluetoothPairing: vi
          .fn()
          .mockResolvedValue({ command: { ...pendingCommand("forget"), expiresInMs: 30_000 } }),
      });
      await forget(el);
      await vi.advanceTimersByTimeAsync(30_000 - SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgetting"));
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_no_answer"));
    });

    it("shows the outcome a read sent before the expiry brings back just after it", async () => {
      const settle = {} as Settle;
      const passive = vi
        .fn()
        .mockResolvedValueOnce([{ ...reported, bluetoothCommand: pendingCommand("forget") }])
        .mockResolvedValueOnce([{ ...reported, bluetoothCommand: pendingCommand("forget") }])
        .mockResolvedValueOnce([{ ...reported, bluetoothCommand: pendingCommand("forget") }])
        .mockImplementationOnce(
          () =>
            new Promise<DiscoveredPrinter[]>((resolve, reject) => {
              Object.assign(settle, { resolve, reject });
            }),
        );
      const { el } = await mountForget(passive, {
        forgetBluetoothPairing: vi
          .fn()
          .mockResolvedValue({ command: { ...pendingCommand("forget"), expiresInMs: 9_000 } }),
      });
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 4);
      expect(passive).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(1_500);
      settle.resolve([{ ...reported, bluetoothCommand: finishedCommand("forget", "succeeded") }]);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgotten"));
    });

    it("reads once more at the expiry when no read is waiting, and shows the outcome it brings", async () => {
      const passive = vi
        .fn()
        .mockResolvedValue([{ ...reported, bluetoothCommand: pendingCommand("forget") }]);
      const { el } = await mountForget(passive, {
        forgetBluetoothPairing: vi
          .fn()
          .mockResolvedValue({ command: { ...pendingCommand("forget"), expiresInMs: 10_000 } }),
      });
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 4);
      passive.mockResolvedValue([
        { ...reported, bluetoothCommand: finishedCommand("forget", "failed", { error: "Busy" }) },
      ]);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(passive).toHaveBeenCalledTimes(5);
      expect(text(el, sel("printer-command-p4"))).toBe(
        `${t("printers.bluetooth_forget_failed")}: Busy`,
      );
    });

    it("calls a pending command that names no expiry unanswered at the first poll", async () => {
      const undated = { ...pendingCommand("forget"), expiresInMs: undefined };
      const { el } = await mountForget([[reported]], {
        forgetBluetoothPairing: vi.fn().mockResolvedValue({ command: undated }),
      });
      await forget(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgetting"));
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_no_answer"));
    });

    it("keeps waiting through failed reads, and still gives up at the expiry", async () => {
      const passive = vi.fn().mockRejectedValue({ code: "connection.failed" });
      const { el } = await mountForget(passive);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgetting"));
      expect(q(el, "[data-test=printer-refresh-error]")).not.toBeNull();
      await vi.advanceTimersByTimeAsync(EXPIRES_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_no_answer"));
      const calls = passive.mock.calls.length;
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
      expect(passive).toHaveBeenCalledTimes(calls);
    });

    it("clears the refresh error its own failed read set once a read succeeds", async () => {
      const passive = vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue([{ ...reported, bluetoothCommand: pendingCommand("forget") }]);
      const { el } = await mountForget(passive);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(q(el, "[data-test=printer-refresh-error]")).not.toBeNull();
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(q(el, "[data-test=printer-refresh-error]")).toBeNull();
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgetting"));
    });

    it("leaves a refresh error another read set after its own read succeeds", async () => {
      const passive = vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue([{ ...reported, bluetoothCommand: pendingCommand("forget") }]);
      let finishLoad!: (error: unknown) => void;
      const listPrinters = vi.fn().mockResolvedValue([...printers, stored]);
      const { el } = await mountForget(passive, {
        background: stubApi({
          listPrinters,
          listDiscoveredPrinters: passive,
          listAgents: vi.fn().mockImplementation(
            () =>
              new Promise((_, reject) => {
                finishLoad = reject;
              }),
          ),
        }),
      });
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      q(el, "[data-test=refresh-printer-lists]")!.click();
      await flush(el);
      finishLoad({ code: "management_session.expired" });
      await flush(el);
      expect(text(el, "[data-test=printer-refresh-error]")).toContain(
        codeMessage("management_session.expired"),
      );
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, "[data-test=printer-refresh-error]")).toContain(
        codeMessage("management_session.expired"),
      );
    });

    it("forgets the error a finished poll showed, so a later poll leaves another read's same error", async () => {
      const passive = vi.fn().mockRejectedValue({ code: "connection.failed" });
      const listPrinters = vi.fn().mockResolvedValue([...printers, stored]);
      const listAgents = vi.fn().mockResolvedValue(agents);
      const { el } = await mountForget(passive, {
        background: stubApi({ listPrinters, listAgents, listDiscoveredPrinters: passive }),
      });
      await forget(el);
      await vi.advanceTimersByTimeAsync(EXPIRES_MS + SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_no_answer"));
      // A page reload now fails with the same code, then a second forget's reads succeed.
      listAgents.mockRejectedValue({ code: "connection.failed" });
      q(el, "[data-test=refresh-printer-lists]")!.click();
      await flush(el);
      expect(q(el, "[data-test=printer-refresh-error]")).not.toBeNull();
      passive.mockResolvedValue([{ ...reported, bluetoothCommand: pendingCommand("forget") }]);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgetting"));
      expect(q(el, "[data-test=printer-refresh-error]")).not.toBeNull();
    });

    it("hides Unpair while an unpairing it sent has succeeded, though the pairing report lingers", async () => {
      const done = {
        ...reported,
        bluetoothCommand: finishedCommand("forget", "succeeded"),
      };
      const { el } = await mountForget([[done]]);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgotten"));
      expect(q(el, sel("forget-pairing-p4"))).toBeNull();
      await fadeNotice(el, "printer-command-p4");
      expect(q(el, sel("printer-command-p4"))).toBeNull();
      expect(q(el, sel("forget-pairing-p4"))).toBeNull();
    });

    it("offers Disable in place of the hidden Unpair while the pairing report lingers, since the server may have kept the printer on", async () => {
      const done = { ...reported, bluetoothCommand: finishedCommand("forget", "succeeded") };
      const listPrinters = vi.fn().mockResolvedValue([...printers, btPrinter("p4", ADDRESS, true)]);
      const { el, api } = await mountForget([], {
        listPrinters,
        background: stubApi({
          listPrinters,
          listDiscoveredPrinters: vi.fn().mockResolvedValue([done]),
        }),
      });
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgotten"));
      expect(q(el, sel("forget-pairing-p4"))).toBeNull();
      expect(text(el, sel("deactivate-printer-p4"))).toBe(t("printers.disable"));
      expect(isDisabled(el, sel("deactivate-printer-p4"))).toBe(false);
      q(el, sel("deactivate-printer-p4"))!.click();
      await flush(el);
      expect(api.deactivatePrinter).toHaveBeenCalledExactlyOnceWith("p4");
    });

    it("offers Unpair again once the list, after an unpairing succeeded, leaves the device out and then reports it paired", async () => {
      const done = { ...reported, bluetoothCommand: finishedCommand("forget", "succeeded") };
      // Outside a scan an agent reports only its paired devices, so an unpaired one leaves the list.
      const { el } = await mountForget([[done], [reported], [], [reported]]);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      await fadeNotice(el, "printer-command-p4");
      // Any reload reads the list again.
      const reload = async () => {
        q(el, sel("deactivate-printer-p1"))!.click();
        await flush(el);
        await flush(el);
      };
      await reload();
      expect(q(el, sel("forget-pairing-p4"))).toBeNull();
      await reload();
      expect(q(el, sel("forget-pairing-p4"))).toBeNull();
      await reload();
      expect(text(el, sel("forget-pairing-p4"))).toBe(t("printers.bluetooth_forget"));
    });

    it("keeps Unpair hidden when a read sent before the unpairing succeeded answers after it without the device", async () => {
      const liveData = new LiveData();
      let answerEarly!: (rows: DiscoveredPrinter[]) => void;
      const passive = vi
        .fn<() => Promise<DiscoveredPrinter[]>>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              answerEarly = resolve;
            }),
        )
        .mockResolvedValueOnce([
          { ...reported, bluetoothCommand: finishedCommand("forget", "succeeded") },
        ])
        .mockResolvedValue([reported]);
      const { el } = await mountForget(passive, { liveData });
      await forget(el);
      const liveRead = async (calls: number) => {
        liveData.invalidate([{ type: "printer_discovery" }]);
        await flush(el);
        expect(passive).toHaveBeenCalledTimes(calls);
        await flush(el);
      };
      await liveRead(1);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgotten"));
      answerEarly([]);
      await flush(el);
      await liveRead(3);
      expect(q(el, sel("forget-pairing-p4"))).toBeNull();
      // Control: reads sent after the success do end the hold.
      passive.mockResolvedValueOnce([]);
      await liveRead(4);
      await liveRead(5);
      expect(text(el, sel("forget-pairing-p4"))).toBe(t("printers.bluetooth_forget"));
    });

    it("announces Unpaired, then takes it away by itself after about four seconds", async () => {
      const done = { ...reported, bluetoothCommand: finishedCommand("forget", "succeeded") };
      const { el } = await mountForget([[done]]);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      const started = performance.now();
      const notice = q(el, sel("printer-command-p4"))!;
      expect(notice.tagName).toBe("WT-NOTICE");
      expect(notice.getAttribute("role")).toBe("status");
      expect(notice.textContent!.trim()).toBe(t("printers.bluetooth_forgotten"));
      expect(cellButtons(el, "printer-command-p4")).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 3_500));
      expect(q(el, sel("printer-command-p4"))).not.toBeNull();
      await vi.waitFor(() => expect(q(el, sel("printer-command-p4"))).toBeNull(), {
        timeout: 4_000,
        interval: 50,
      });
      expect(performance.now() - started).toBeGreaterThanOrEqual(4_000);
    }, 15_000);

    it("keeps a failed unpairing's reason, with no Dismiss, until the next Unpair", async () => {
      const failed = {
        ...reported,
        bluetoothCommand: finishedCommand("forget", "failed", { error: "Device busy" }),
      };
      const { el, api } = await mountForget([[failed]]);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      const notice = q(el, sel("printer-command-p4")) as HTMLElement & { duration: number };
      expect(notice.duration).toBe(0);
      expect(cellButtons(el, "printer-command-p4")).toEqual([]);
      vi.mocked(api.forgetBluetoothPairing).mockResolvedValue({
        command: { ...pendingCommand("forget"), id: "forget-2" },
      });
      await forget(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgetting"));
    });

    it("keeps a failed unpairing's reason on its printer row after Add a printer opens and closes", async () => {
      const failed = {
        ...reported,
        bluetoothCommand: finishedCommand("forget", "failed", { error: "Device busy" }),
      };
      const { el } = await mountForget([[failed]]);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      const reason = `${t("printers.bluetooth_forget_failed")}: Device busy`;
      expect(text(el, sel("printer-command-p4"))).toBe(reason);
      await openDiscovery(el);
      q(el, "[data-test=cancel-new-printer]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=new-printer-modal]")).toBeNull());
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(reason);
    });

    it("offers Unpair again toward an agent still reporting the pairing another agent unpaired", async () => {
      const fromB: DiscoveredPrinter = { ...reported, agentId: "b2", agentName: "Barra agent" };
      const { el, api } = await mountForget(
        [
          [{ ...fromB, bluetoothCommand: finishedCommand("forget", "succeeded") }, reported],
          [reported],
        ],
        { listDiscoveredPrinters: vi.fn().mockResolvedValue([fromB, reported]) },
      );
      await forget(el);
      expect(api.forgetBluetoothPairing).toHaveBeenCalledExactlyOnceWith("b2", ADDRESS);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgotten"));
      expect(q(el, sel("forget-pairing-p4"))).toBeNull();
      // Any reload reads the list again: B's report has aged out, and A still has the printer paired.
      q(el, sel("deactivate-printer-p1"))!.click();
      await flush(el);
      await flush(el);
      expect(text(el, sel("forget-pairing-p4"))).toBe(t("printers.bluetooth_forget"));
      await forget(el);
      expect(api.forgetBluetoothPairing).toHaveBeenLastCalledWith("a1", ADDRESS);
    });

    it("starts no status poll for a forget answered after the screen went away", async () => {
      let answer!: (value: unknown) => void;
      const { el, passive } = await mountForget([[reported]], {
        forgetBluetoothPairing: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              answer = resolve;
            }),
        ),
      });
      await forget(el);
      el.remove();
      answer({ command: pendingCommand("forget") });
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 3);
      expect(passive).not.toHaveBeenCalled();
    });

    it("waits for this command's own outcome, not an earlier one still listed for the device", async () => {
      const earlier = {
        ...reported,
        bluetoothCommand: finishedCommand("forget", "failed", { id: "earlier" }),
      };
      const { el } = await mountForget([[earlier]]);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 2);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgetting"));
    });

    it("reads through the screen's own client when it has no background client", async () => {
      const { el } = await mountForget([[reported]], {
        background: undefined,
        listDiscoveredPrinters: vi
          .fn()
          .mockResolvedValueOnce([reported])
          .mockResolvedValue([
            { ...reported, bluetoothCommand: finishedCommand("forget", "succeeded") },
          ]),
      });
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      await flush(el);
      expect(text(el, sel("printer-command-p4"))).toBe(t("printers.bluetooth_forgotten"));
    });

    it("stops polling when the screen goes away", async () => {
      let answer!: (rows: DiscoveredPrinter[]) => void;
      const passive = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<DiscoveredPrinter[]>((resolve) => {
              answer = resolve;
            }),
        )
        .mockResolvedValue([reported]);
      const { el } = await mountForget(passive);
      await forget(el);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS);
      el.remove();
      answer([{ ...reported, bluetoothCommand: pendingCommand("forget") }]);
      await vi.advanceTimersByTimeAsync(SCAN_POLL_MS * 5);
      expect(passive).toHaveBeenCalledOnce();
    });
  });
});

describe("A Bluetooth printer whose agent cannot print to it", () => {
  const UNAVAILABLE = "printer.bluetooth_printing_unavailable";
  const bluetoothPrinter: Printer = {
    ...printers[0]!,
    id: "p5",
    name: "Barra Bluetooth",
    transport: "bluetooth",
    host: null,
    port: null,
    localKey: "5A:4A:45:D4:FB:BB",
  };
  const job = (over: Partial<PrintJobRow>): PrintJobRow => ({
    id: "j11",
    printerId: "p5",
    status: "queued",
    canResend: false,
    attempts: 0,
    lastError: null,
    createdAt: "2026-09-29T17:00:00.000Z",
    deliveredAt: null,
    ...over,
  });
  const ended = job({ status: "failed", canResend: true, attempts: 5, lastError: UNAVAILABLE });

  async function mountWith(overrides: Partial<DashboardApi> = {}) {
    const api = stubApi({
      listPrinters: vi.fn().mockResolvedValue([...printers, bluetoothPrinter]),
      ...overrides,
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    return { el, api };
  }

  it("shows a calibration print that failed, with the reason in the dashboard's own words", async () => {
    const { el } = await mountWith({
      listRecentJobs: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([ended]),
    });
    await openPrinter(el, "p5");
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    expect(q(el, "[data-test=calibration-job-failed]")).toBeNull();

    q(el, "[data-test=print-character-tables-p5]")!.click();
    await flush(el);

    expect(text(el, "[data-test=calibration-job-failed]")).toBe(
      "No se ha impreso: El agente de impresión de esta impresora no puede imprimir en impresoras Bluetooth.",
    );
    expect(q(el, "[data-test=calibration-job-failed]")!.getAttribute("role")).toBe("alert");
  });

  it("shows the agent's own reason for a calibration print that failed for another cause", async () => {
    const offline = job({ id: "j9", printerId: "p1", status: "failed", lastError: "offline" });
    const { el } = await mountWith({
      listRecentJobs: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([offline]),
    });
    await openPrinter(el, "p1");
    q(el, "[data-test=print-test-page-p1]")!.click();
    await flush(el);

    expect(text(el, "[data-test=calibration-job-failed]")).toBe("No se ha impreso: offline");
  });

  it("says nothing about a calibration print while it waits or once it printed, nor about one another dialog sent", async () => {
    const rows = vi
      .fn()
      .mockResolvedValueOnce([ended])
      .mockResolvedValueOnce([job({ id: "j10", status: "queued" }), ended])
      .mockResolvedValueOnce([job({ id: "j10", status: "done" }), ended])
      .mockResolvedValue([job({ id: "j10", status: "failed", lastError: "paper out" }), ended]);
    const { el } = await mountWith({ listRecentJobs: rows });
    await openPrinter(el, "p5");
    // A failed job this dialog did not send is not its print.
    expect(q(el, "[data-test=calibration-job-failed]")).toBeNull();
    q(el, "[data-test=print-sample-receipt-p5]")!.click();
    await flush(el);
    expect(q(el, "[data-test=calibration-job-failed]")).toBeNull();
    q(el, "[data-test=print-sample-receipt-p5]")!.click();
    await flush(el);
    expect(q(el, "[data-test=calibration-job-failed]")).toBeNull();
    q(el, "[data-test=print-sample-receipt-p5]")!.click();
    await flush(el);
    expect(text(el, "[data-test=calibration-job-failed]")).toBe("No se ha impreso: paper out");
  });

  it("keeps the latest calibration print when an earlier one's reply arrives after it", async () => {
    let releaseFirst!: () => void;
    const { el } = await mountWith({
      testPrint: vi.fn().mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = () => resolve({ jobId: "j9" });
        }),
      ),
      sampleReceipt: vi.fn().mockResolvedValue({ jobId: "j10" }),
      listRecentJobs: vi
        .fn()
        .mockResolvedValue([
          job({ id: "j9", printerId: "p1", status: "failed", lastError: "FIRST" }),
          job({ id: "j10", printerId: "p1", status: "done" }),
        ]),
    });
    await openPrinter(el, "p1");
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=print-test-page-p1]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=print-sample-receipt-p1]")!.click();
    await flush(el);

    releaseFirst();
    await flush(el);

    expect(q(el, "[data-test=calibration-job-failed]")).toBeNull();
  });

  it("shows an earlier calibration print's reply when a later print was refused", async () => {
    let releaseSecond!: () => void;
    const { el } = await mountWith({
      testPrint: vi
        .fn()
        .mockResolvedValueOnce({ jobId: "j8" })
        .mockReturnValueOnce(
          new Promise((resolve) => {
            releaseSecond = () => resolve({ jobId: "j9" });
          }),
        ),
      sampleReceipt: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
      listRecentJobs: vi
        .fn()
        .mockResolvedValue([
          job({ id: "j8", printerId: "p1", status: "failed", lastError: "OLD" }),
          job({ id: "j9", printerId: "p1", status: "failed", lastError: "A-FAILED" }),
        ]),
    });
    await openPrinter(el, "p1");
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=print-test-page-p1]")!.click();
    await flush(el);
    expect(text(el, "[data-test=calibration-job-failed]")).toBe("No se ha impreso: OLD");
    q(el, "[data-test=print-test-page-p1]")!.click();
    await flush(el);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    q(el, "[data-test=print-sample-receipt-p1]")!.click();
    await flush(el);

    releaseSecond();
    await flush(el);

    expect(text(el, "[data-test=calibration-job-failed]")).toBe("No se ha impreso: A-FAILED");
  });

  it("shows an agent's reason verbatim, even one holding replacement patterns", async () => {
    const reason = "write failed: $& cost $$5 $' $`";
    const { el } = await mountWith({
      listRecentJobs: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValue([
          job({ id: "j9", printerId: "p1", status: "failed", lastError: reason }),
        ]),
    });
    await openPrinter(el, "p1");
    q(el, "[data-test=print-test-page-p1]")!.click();
    await flush(el);

    expect(text(el, "[data-test=calibration-job-failed]")).toBe(`No se ha impreso: ${reason}`);
  });

  it("forgets the calibration print when the dialog closes", async () => {
    const { el } = await mountWith({
      listRecentJobs: vi.fn().mockResolvedValue([job({ ...ended, id: "drawer-test" })]),
    });
    await openPrinter(el, "p5");
    q(el, "[data-test=cancel-edit-printer]")!.click();
    await flush(el);
    await openPrinter(el, "p5");
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    for (let step = 1; step < 4; step++) {
      q(el, "[data-test=calibration-next]")!.click();
      await flush(el);
    }
    (q(el, 'wt-switch[name="printer-cash-drawer"]') as HTMLElement).dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
    );
    await flush(el);
    q(el, "[data-test=test-printer-drawer]")!.click();
    await flush(el);
    expect(q(el, "[data-test=calibration-job-failed]")).not.toBeNull();

    q(el, "[data-test=cancel-edit-printer]")!.click();
    await flush(el);
    await openPrinter(el, "p5");
    expect(q(el, "[data-test=calibration-job-failed]")).toBeNull();
  });

  it("does not say in a Bluetooth printer's dialog, through calibration, that printing to it is unavailable", async () => {
    const { el } = await mountWith();
    await openPrinter(el, "p5");
    expect(q(el, "[data-test=save-printer-p5]")).not.toBeNull();
    expect(q(el, "[data-test=bluetooth-printing-unavailable]")).toBeNull();
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    expect(q(el, "[data-test=calibration-next]")).not.toBeNull();
    expect(q(el, "[data-test=bluetooth-printing-unavailable]")).toBeNull();
    q(el, "[data-test=cancel-edit-printer]")!.click();
    await flush(el);

    await openPrinter(el, "p1");
    expect(q(el, "[data-test=bluetooth-printing-unavailable]")).toBeNull();
  });

  it("does not say on a Bluetooth printer's row in the printers list that printing to it is unavailable", async () => {
    const before = currentLocale();
    setLocale("en");
    try {
      const { el } = await mountWith();
      await selectTab(el, "printers");
      expect(q(el, "[data-test=printer-row-p5]")).not.toBeNull();
      expect(q(el, "[data-test=printer-bluetooth-unavailable-p5]")).toBeNull();
      expect(q(el, "[data-test=printer-bluetooth-unavailable-p1]")).toBeNull();
    } finally {
      setLocale(before);
    }
  });

  it("words a job ended because Bluetooth printing is unavailable, and counts no attempts for it", async () => {
    const { el } = await mountWith({ listRecentJobs: vi.fn().mockResolvedValue([ended, jobs[0]]) });

    expect(text(el, "[data-test=job-error-j11]")).toBe(
      "El agente de impresión de esta impresora no puede imprimir en impresoras Bluetooth.",
    );
    expect(text(el, "[data-test=job-attempts-j11]")).toBe("—");
    expect(text(el, "[data-test=job-attempts-j1]")).toBe("2");
  });
});
