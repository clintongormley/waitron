import { expect, afterEach, describe, it, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import "./printers-screen.js";
import type { PrintersScreen } from "./printers-screen.js";
import type {
  DashboardApi,
  JoinRequestRow,
  PrintAgentRow,
  PrintJobRow,
  Printer,
  Till,
} from "../api/client.js";

// Exercise the tables, add/edit dialogs, and numeric pairing in both themes.
const agents: PrintAgentRow[] = [
  {
    id: "a1",
    name: "Cocina agent",
    active: true,
    host: null,
    nodeId: null,
    lastSeenAt: "2026-08-25T14:30:00.000Z",
    enrolledAt: "2026-08-20T09:00:00.000Z",
  },
  {
    id: "a2",
    name: "Barra agent",
    active: false,
    host: null,
    nodeId: "n1", // self-enrolled + revoked: axe scans the provenance marker and the allow-again control
    lastSeenAt: null,
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
    pendingJobs: 0,
    lastPrintAt: null,
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
    pendingJobs: 0,
    lastPrintAt: null,
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
    pendingJobs: 0,
    lastPrintAt: null,
    active: false,
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
];

const tills: Till[] = [
  { id: "t1", label: "Caja 1", locationId: "loc-1", receiptPrinterId: "p1" },
  { id: "t2", label: "Caja 2", locationId: "loc-1", receiptPrinterId: null },
];

// Two discovered USB devices — one unregistered (its Add action render) and one
// disabled registration (offered for adding again) — so the
// usb/bluetooth create surface is in the a11y tree. Typed loosely (the stub is cast to DashboardApi), the shape matching DiscoveredPrinter.
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
];

// A print agent knocking to join, so the pending queue + accept dialog are in the a11y tree.
const pending: JoinRequestRow[] = [
  { id: "j1", kind: "print_agent", label: "kitchen-pi", createdAt: "2026-09-08T10:02:00.000Z" },
];
const CHOICES = ["12", "47", "83"];

function stubApi(pairingOpen = false): DashboardApi {
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
    testPrint: vi.fn().mockResolvedValue({ jobId: "j9" }),
    startPrinterDiscovery: vi.fn().mockResolvedValue({ discoveryUntil: Date.now() + 60_000 }),
    listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered),
    listTills: vi.fn().mockResolvedValue(tills),
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
async function openPrinter(el: PrintersScreen, id = "p1"): Promise<void> {
  q(el, `[data-test="edit-printer-${id}"]`)!.click();
  await flush(el);
}
async function openDiscovery(el: PrintersScreen): Promise<void> {
  q(el, "[data-test=open-add-printer]")!.click();
  await flush(el);
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("printers-screen a11y (%s theme)", (theme) => {
  it("renders the agents, printers and jobs lists plus the pending queue accessibly", async () => {
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
  });

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
  // A bare "47" is not a name a screen reader can act on — the number has to be announced as one.
  // Read off the INNER <button>, which is the element that carries the name (wt-button forwards
  // `aria-label` into its shadow root).
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

  // Reachable AND operable from the keyboard alone: Enter on the focused row control opens the dialog,
  // and Enter on a focused number accepts with it. Real key events, not synthetic clicks.
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
