import { expect, afterEach, describe, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption as pickOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import "./printers-screen.js";
import type { PrintersScreen } from "./printers-screen.js";
import type {
  DashboardApi,
  DiscoveredPrinter,
  JoinRequestRow,
  PrintAgentRow,
  PrintJobRow,
  Printer,
  Till,
} from "../api/client.js";

const agents: PrintAgentRow[] = [
  {
    id: "a1",
    name: "Cocina agent",
    active: true,
    host: null,
    nodeId: null,
    lastSeenAt: "2026-08-25T14:30:00.000Z",
    setupUrl: null,
    enrolledAt: "2026-08-20T09:00:00.000Z",
  },
  {
    id: "a2",
    name: "Barra agent",
    active: false,
    host: null,
    nodeId: "n1", // self-enrolled + revoked: axe scans the provenance marker and the allow-again control
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
    ticketScope: "order",
    paperWidth: "80mm",
    resolution: "180dpi",
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
    hasCashDrawer: false,
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    active: false,
  },
];

const jobs: PrintJobRow[] = [
  {
    id: "j1",
    printerId: "p1",
    status: "failed",
    canResend: true,
    attempts: 2,
    lastError: "printer offline",
    createdAt: "2026-08-25T14:00:00.000Z",
    deliveredAt: null,
  },
];

const tills: Till[] = [
  { id: "t1", label: "Caja 1", locationId: "loc-1", receiptPrinterId: "p1", opensDrawer: true },
  { id: "t2", label: "Caja 2", locationId: "loc-1", receiptPrinterId: null, opensDrawer: true },
];

// An unregistered USB device, a disabled registration offered for adding again, and an office printer.
const discovered = [
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
    lastSeenAt: "2026-08-25T14:30:00.000Z",
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
    lastSeenAt: "2026-08-25T14:30:00.000Z",
  },
  {
    // An office printer: its muted row and explanation replace the Add action, so axe checks their contrast.
    agentId: "a1",
    agentName: "Cocina agent",
    transport: "network_tcp",
    host: "10.0.0.56",
    port: 9100,
    name: "HP LaserJet",
    pagePrinter: true,
    alreadyRegistered: false,
    printerId: null,
    lastSeenAt: "2026-08-25T14:30:00.000Z",
  },
];

const pending: JoinRequestRow[] = [
  { id: "j1", kind: "print_agent", label: "kitchen-pi", createdAt: "2026-09-08T10:02:00.000Z" },
];
const CHOICES = ["12", "47", "83"];

function stubApi(pairingOpen = false, overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listAgents: vi.fn().mockResolvedValue(agents),
    listPrinters: vi.fn().mockResolvedValue(printers),
    listRecentJobs: vi.fn().mockResolvedValue(jobs),
    revokeAgent: vi.fn().mockResolvedValue(undefined),
    pairingMode: vi.fn().mockResolvedValue({
      open: pairingOpen,
      openUntil: pairingOpen ? "2026-09-08T10:20:00.000Z" : null,
      refusedRecently: pairingOpen ? 0 : 2,
    }),
    openPairingMode: vi.fn().mockResolvedValue({ openUntil: "2026-09-08T10:20:00.000Z" }),
    renewPairingMode: vi.fn().mockResolvedValue({ openUntil: "2026-09-08T10:20:00.000Z" }),
    closePairingMode: vi.fn().mockResolvedValue(undefined),
    joinRequests: vi.fn().mockResolvedValue(pending),
    joinChallenge: vi.fn().mockResolvedValue({ choices: CHOICES }),
    denyJoinRequest: vi.fn().mockResolvedValue(undefined),
    acceptPrintAgentJoinRequest: vi.fn().mockResolvedValue(undefined),
    createPrinter: vi.fn().mockResolvedValue({ id: "p9" }),
    updatePrinter: vi.fn().mockResolvedValue(undefined),
    deactivatePrinter: vi.fn().mockResolvedValue(undefined),
    testPrinterDrawer: vi.fn().mockResolvedValue({ jobId: "drawer-test" }),
    testPrint: vi.fn().mockResolvedValue({ jobId: "j9", calibrationLocale: "es-ES" }),
    startPrinterDiscovery: vi.fn().mockResolvedValue({ discoveryUntil: Date.now() + 60_000 }),
    renewPrinterDiscovery: vi.fn().mockResolvedValue({ discoveryUntil: Date.now() + 180_000 }),
    listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered),
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
async function chooseOption(el: PrintersScreen, name: string, value: string): Promise<void> {
  await pickOption(q(el, `wt-combobox[name="${name}"]`)!, value);
  await flush(el);
}
async function openPrinter(el: PrintersScreen, id = "p1"): Promise<void> {
  q(el, `[data-test="edit-printer-${id}"]`)!.click();
  await flush(el);
}
async function openDiscovery(el: PrintersScreen): Promise<void> {
  q(el, "[data-test=open-add-printer]")!.click();
  await flush(el);
}

afterEach(cleanupWidgets);
// The printers table remembers its status filter for the tab; each case starts from the default.
afterEach(() => sessionStorage.removeItem("printers:table"));

// A printer-like device waiting to be paired, a device that does not look like a printer, and a
// switched-off Bluetooth printer its agent reports paired.
const bluetooth: DiscoveredPrinter[] = [
  {
    agentId: "a1",
    agentName: "Cocina agent",
    transport: "bluetooth",
    localKey: "00:11:22:33:44:55",
    name: "Bar printer",
    printerLike: true,
    alreadyRegistered: false,
    printerId: null,
    lastSeenAt: "2026-08-25T14:30:00.000Z",
  },
  {
    agentId: "a1",
    agentName: "Cocina agent",
    transport: "bluetooth",
    localKey: "66:77:88:99:AA:BB",
    name: "Headphones",
    alreadyRegistered: false,
    printerId: null,
    lastSeenAt: "2026-08-25T14:30:00.000Z",
  },
  {
    agentId: "a1",
    agentName: "Cocina agent",
    transport: "bluetooth",
    localKey: "22:22:22:22:22:22",
    name: "Old bar printer",
    printerLike: true,
    paired: true,
    alreadyRegistered: true,
    printerId: "p4",
    lastSeenAt: "2026-08-25T14:30:00.000Z",
  },
];
const bluetoothPrinter: Printer = {
  ...printers[2]!,
  id: "p4",
  name: "Old bar printer",
  transport: "bluetooth",
  localKey: "22:22:22:22:22:22",
  active: false,
};
function bluetoothApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return stubApi(false, {
    listPrinters: vi.fn().mockResolvedValue([...printers, bluetoothPrinter]),
    listDiscoveredPrinters: vi.fn().mockResolvedValue(bluetooth),
    pairBluetooth: vi.fn().mockResolvedValue({
      command: {
        id: "c1",
        kind: "pair",
        address: "00:11:22:33:44:55",
        state: "pending",
        expiresInMs: 120_000,
      },
    }),
    forgetBluetoothPairing: vi.fn().mockResolvedValue({
      command: {
        id: "c2",
        kind: "forget",
        address: "22:22:22:22:22:22",
        state: "pending",
        expiresInMs: 120_000,
      },
    }),
    ...overrides,
  });
}

describe.each(["light", "dark"] as const)("printers-screen a11y (%s theme)", (theme) => {
  it.each([390, 1280])("renders printer status accessibly at %ipx", async (width) => {
    await page.viewport(width, 900);
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    q(el, "wt-tabs")!
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-key="printers"]')!
      .click();
    await flush(el);
    q(el, "[data-test=printer-row-p1]")!.click();
    await flush(el);
    expect(q(el, "[data-test=printer-status]")!.checkVisibility()).toBe(true);
    expect(el.scrollWidth).toBeLessThanOrEqual(width);
    await expectNoA11yViolations(host);
    await page.screenshot();
    await page.viewport(1280, 900);
  });
  it.each([390, 1280])(
    "renders the agents, printers and jobs lists accessibly at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const { el, host } = await mountWidget<PrintersScreen>(
        "dashboard-printers-screen",
        { api: stubApi() },
        theme,
      );
      await flush(el);
      for (const key of ["queue", "printers", "agents"]) {
        q(el, "wt-tabs")!
          .shadowRoot!.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!
          .click();
        await flush(el);
        await expectNoA11yViolations(host);
      }
      await page.viewport(1280, 900);
    },
  );

  it("renders the open pairing window accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi(true) },
      theme,
    );
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the accept dialog and its three numbers accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi(true) },
      theme,
    );
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    // Open the waiting row so the modal dialog and its three number buttons are in the a11y tree.
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders all discovered printers accessibly in the add modal", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await openDiscovery(el);
    expect(q(el, "[data-test=register-SN-1]")).toBeTruthy();
    expect(q(el, "[data-test=discovered-row-SN-2]")).not.toBeNull();
    expect(q(el, "[data-test=register-SN-2]")!.textContent).toContain(t("printers.add_again"));
    expect(q(el, "[data-test=printer-last-seen-p3]")).toBeNull();
    expect(q(el, "[data-test='page-printer-10.0.0.56:9100']")).not.toBeNull();
    expect(q(el, "[data-test=new-transport]")).toBeNull();
    await expectNoA11yViolations(host);
    q(el, "[data-test=probe-printer]")!.click();
    await flush(el);
    expect((q(el, "[data-test=probe-host]") as unknown as { invalid: boolean }).invalid).toBe(true);
    await expectNoA11yViolations(host);
  });
  it("renders printer editing accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await openPrinter(el);
    await expectNoA11yViolations(host);
  });
  it("renders each calibration step and the drawer result accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await openPrinter(el);
    q(el, "[data-test=calibrate-printer]")!.click();
    await flush(el);
    q(el, "[data-test=print-ruler-p1]")!.click();
    await flush(el);
    await chooseOption(el, "printer-ruler-number", "576");
    expect(q(el, "[data-test=ruler-disagrees]")).not.toBeNull();
    await expectNoA11yViolations(host);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
    q(el, "[data-test=calibration-next]")!.click();
    await flush(el);
    const drawer = q(el, '[name="printer-cash-drawer"]')!.shadowRoot!.querySelector("input")!;
    drawer.checked = true;
    drawer.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(el);
    q(el, "[data-test=test-printer-drawer]")!.click();
    await flush(el);
    q(el, '[name="printer-drawer-result"][value="closed"]')!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("keeps setup forms inside desktop and phone dialogs", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    try {
      for (const width of [1280, 390]) {
        await page.viewport(width, 844);
        expect(window.innerWidth).toBe(width);
        await openDiscovery(el);
        const address = q(el, '[data-test="probe-host"]')!.getBoundingClientRect();
        const port = q(el, '[data-test="probe-port"]')!.getBoundingClientRect();
        const connect = q(el, '[data-test="probe-printer"]')!.getBoundingClientRect();
        if (width === 1280) {
          expect(Math.abs(address.bottom - port.bottom)).toBeLessThan(2);
          expect(Math.abs(port.bottom - connect.bottom)).toBeLessThan(2);
        }
        await expectNoA11yViolations(host);
        q(el, '[data-test="register-SN-1"]')!.click();
        await flush(el);
        await expectNoA11yViolations(host);
        q(el, '[data-test="cancel-printer-name"]')!.click();
        await flush(el);
        await vi.waitFor(() => expect(q(el, '[data-test="name-printer-modal"]')).toBeNull());
        q(el, '[data-test="cancel-new-printer"]')!.click();
        await flush(el);
        await openPrinter(el);
        q(el, "[data-test=calibrate-printer]")!.click();
        await flush(el);
        const assertInsideDialog = (names: string[]) => {
          const dialog = q(el, '[data-test="edit-printer-modal"]')!
            .shadowRoot!.querySelector("dialog")!
            .getBoundingClientRect();
          for (const name of names) {
            const field = q(el, `[name="${name}"]`)!.getBoundingClientRect();
            expect(field.width).toBeGreaterThan(0);
            expect(field.right).toBeLessThan(dialog.right);
            expect(field.left).toBeGreaterThanOrEqual(dialog.left);
          }
        };
        assertInsideDialog(["printer-ruler-number", "printer-paper-width", "printer-resolution"]);
        if (width === 1280) {
          const fields = ["printer-paper-width", "printer-resolution"].map((name) =>
            q(el, `[name="${name}"]`)!.getBoundingClientRect(),
          );
          expect(new Set(fields.map((rect) => Math.round(rect.bottom))).size).toBe(1);
        }
        expect(
          (q(el, '[data-test="print-ruler-p1"]') as import("@waitron/ui").WtButton).variant,
        ).toBe("primary");
        await page.screenshot({
          path: `__screenshots__/calibration-width-${theme}-${width}.png`,
        });
        q(el, '[data-test="print-ruler-p1"]')!.click();
        await flush(el);
        await expectNoA11yViolations(host);
        q(el, "[data-test=calibration-next]")!.click();
        await flush(el);
        await expectNoA11yViolations(host);
        q(el, "[data-test=calibration-next]")!.click();
        await flush(el);
        assertInsideDialog(["printer-cash-drawer"]);
        await expectNoA11yViolations(host);
        q(el, '[data-test="cancel-edit-printer"]')!.click();
        await flush(el);
        q(el, '[data-test="open-add-agent"]')!.click();
        await flush(el);
        q(el, '[data-test="cancel-new-agent"]')!.click();
        await flush(el);
      }
    } finally {
      await page.viewport(1280, 900);
    }
  });

  it("renders Bluetooth devices, Show all and the Pair dialog accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: bluetoothApi() },
      theme,
    );
    await flush(el);
    await openDiscovery(el);
    expect(q(el, '[data-test="discovered-row-66:77:88:99:AA:BB"]')).toBeNull();
    expect(q(el, "[data-test=bluetooth-note]")).not.toBeNull();
    await expectNoA11yViolations(host);
    q(el, "[data-test=show-all-bluetooth]")!.click();
    await flush(el);
    expect(q(el, '[data-test="discovered-row-66:77:88:99:AA:BB"]')).not.toBeNull();
    await expectNoA11yViolations(host);
    q(el, '[data-test="pair-00:11:22:33:44:55"]')!.click();
    await flush(el);
    await expectNoA11yViolations(host);
    q(el, "[data-test=confirm-pair]")!.click();
    await flush(el);
    expect((q(el, "[data-test=bluetooth-pin]") as unknown as { error: string }).error).toBe(
      t("printers.bluetooth_pin_invalid"),
    );
    await expectNoA11yViolations(host);
  });

  it.each([
    ["pending", { expiresInMs: 120_000 }],
    ["failed", { error: "Authentication Failed" }],
  ] as const)("renders a Pair %s status accessibly", async (state, extra) => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      {
        api: bluetoothApi({
          pairBluetooth: vi.fn().mockResolvedValue({
            command: { id: "c1", kind: "pair", address: "00:11:22:33:44:55", state, ...extra },
          }),
        }),
      },
      theme,
    );
    await flush(el);
    await openDiscovery(el);
    q(el, '[data-test="pair-00:11:22:33:44:55"]')!.click();
    await flush(el);
    q(el, "[data-test=bluetooth-pin]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "0000" }, bubbles: true, composed: true }),
    );
    await flush(el);
    q(el, "[data-test=confirm-pair]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pair-printer-modal]")).toBeNull());
    await flush(el);
    expect(q(el, '[data-test="discovered-command-00:11:22:33:44:55"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders the form a finished pairing opens, then the paired row's Add and Unpair, accessibly", async () => {
    const paired = {
      ...bluetooth[0]!,
      paired: true as const,
      bluetoothCommand: {
        id: "c1",
        kind: "pair" as const,
        address: "00:11:22:33:44:55",
        state: "succeeded" as const,
      },
    };
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      {
        api: bluetoothApi({
          background: stubApi(false, {
            listDiscoveredPrinters: vi.fn().mockResolvedValue([paired, ...bluetooth.slice(1)]),
          }),
        }),
      },
      theme,
    );
    await flush(el);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      q(el, '[data-test="pair-00:11:22:33:44:55"]')!.click();
      await flush(el);
      q(el, "[data-test=bluetooth-pin]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "0000" }, bubbles: true, composed: true }),
      );
      await flush(el);
      q(el, "[data-test=confirm-pair]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=pair-printer-modal]")).toBeNull());
      await vi.advanceTimersByTimeAsync(2_000);
      await flush(el);
      expect(q(el, "[data-test=name-printer-modal]")).not.toBeNull();
      await expectNoA11yViolations(host);
      q(el, "[data-test=cancel-printer-name]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=name-printer-modal]")).toBeNull());
      await flush(el);
      expect(q(el, '[data-test="register-00:11:22:33:44:55"]')).not.toBeNull();
      expect(q(el, '[data-test="forget-device-00:11:22:33:44:55"]')).not.toBeNull();
      await expectNoA11yViolations(host);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the status row of a Pair whose device the scan lost accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      {
        api: bluetoothApi({
          background: stubApi(false, { listDiscoveredPrinters: vi.fn().mockResolvedValue([]) }),
        }),
      },
      theme,
    );
    await flush(el);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      await openDiscovery(el);
      q(el, '[data-test="pair-00:11:22:33:44:55"]')!.click();
      await flush(el);
      q(el, "[data-test=bluetooth-pin]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "0000" }, bubbles: true, composed: true }),
      );
      await flush(el);
      q(el, "[data-test=confirm-pair]")!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(120_000);
      await flush(el);
      expect(q(el, '[data-test="discovered-row-00:11:22:33:44:55"]')!.textContent).toContain(
        t("printers.bluetooth_not_seen"),
      );
      expect(q(el, '[data-test="discovered-command-00:11:22:33:44:55"]')!.textContent).toBe(
        t("printers.bluetooth_no_answer"),
      );
      await expectNoA11yViolations(host);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the Pair offered for a switched-on printer whose pairing was forgotten, and its dialog, accessibly", async () => {
    const forgotten: DiscoveredPrinter = {
      ...bluetooth[0]!,
      localKey: "22:22:22:22:22:22",
      name: "Old bar printer",
      alreadyRegistered: true,
      printerId: "p4",
    };
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      {
        api: bluetoothApi({
          listPrinters: vi
            .fn()
            .mockResolvedValue([...printers, { ...bluetoothPrinter, active: true }]),
          listDiscoveredPrinters: vi.fn().mockResolvedValue([forgotten]),
        }),
      },
      theme,
    );
    await flush(el);
    await openDiscovery(el);
    const pair = q(el, '[data-test="pair-22:22:22:22:22:22"]')!;
    expect(pair.textContent!.trim()).toBe(t("printers.bluetooth_pair_only"));
    await expectNoA11yViolations(host);
    pair.click();
    await flush(el);
    expect(q(el, "[data-test=pair-printer-modal]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders a switched-off Bluetooth printer's Unpair and its outcome accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      {
        api: bluetoothApi({
          forgetBluetoothPairing: vi.fn().mockResolvedValue({
            command: { id: "c2", kind: "forget", address: "22:22:22:22:22:22", state: "failed" },
          }),
        }),
      },
      theme,
    );
    await flush(el);
    q(el, "wt-tabs")!
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-key="printers"]')!
      .click();
    await flush(el);
    const filter = q(el, '[data-test="printers-table"]')!.shadowRoot!.querySelector<HTMLElement>(
      '[name="status-filter"]',
    )!;
    await pickOption(filter, "");
    await flush(el);
    const forget = q(el, "[data-test=forget-pairing-p4]")!;
    forget.closest("dashboard-row-actions")!.shadowRoot!.querySelector("button")!.click();
    await flush(el);
    expect(forget.checkVisibility()).toBe(true);
    await expectNoA11yViolations(host);
    forget.click();
    await flush(el);
    expect(q(el, "[data-test=printer-command-p4]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it.each([390, 1280])(
    "renders a printer's menu with Print test page, and the notice it leaves, accessibly at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const { el, host } = await mountWidget<PrintersScreen>(
        "dashboard-printers-screen",
        { api: stubApi(false, { printTestPage: vi.fn().mockResolvedValue({ jobId: "page-1" }) }) },
        theme,
      );
      await flush(el);
      q(el, "wt-tabs")!
        .shadowRoot!.querySelector<HTMLButtonElement>('[data-key="printers"]')!
        .click();
      await flush(el);
      const item = q(el, "[data-test=print-test-page-p1]")!;
      item.closest("dashboard-row-actions")!.shadowRoot!.querySelector("button")!.click();
      await flush(el);
      expect(item.checkVisibility()).toBe(true);
      await expectNoA11yViolations(host);
      item.click();
      await flush(el);
      expect(q(el, "[data-test=print-test-page-notice]")!.checkVisibility()).toBe(true);
      await expectNoA11yViolations(host);
      await page.viewport(1280, 900);
    },
  );

  it("renders agent editing accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    q(el, "[data-test=edit-agent-a1]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});

describe("printers-screen a11y — the numeric match", () => {
  // Read off the inner <button>: wt-button forwards `aria-label` into its shadow root.
  it("names every number button, not just labels it with the digits", async () => {
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", {
      api: stubApi(true),
    });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    const names = Array.from(el.shadowRoot!.querySelectorAll("[data-choice]")).map((b) =>
      b.shadowRoot!.querySelector("button")!.getAttribute("aria-label"),
    );
    expect(names).toEqual(
      CHOICES.map((n) => t("printers.join_choice_label", "es-ES").replace("{number}", n)),
    );
  });

  // Real key events, not synthetic clicks.
  it("opens the dialog and accepts a number from the keyboard alone", async () => {
    const api = stubApi(true);
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
    await flush(el);

    q(el, "[data-test=join-review-j1]")!.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=join-dialog]")).toBeTruthy();

    q(el, '[data-choice="47"]')!.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);

    expect(api.acceptPrintAgentJoinRequest).toHaveBeenCalledWith("j1", { choice: "47" });
  });
});
