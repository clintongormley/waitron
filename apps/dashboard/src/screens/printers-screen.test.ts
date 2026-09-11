import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { jobStatusName, transportName } from "../i18n/domain.js";
import type {
  DashboardApi,
  DiscoveredPrinter,
  JoinRequestRow,
  LocationSummary,
  PrintAgentRow,
  PrintJobRow,
  Printer,
  Station,
  StationPrinter,
  Till,
} from "../api/client.js";
import { PrintersScreen, SCAN_LISTEN_MS, SCAN_POLL_MS } from "./printers-screen.js";

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

const agents: PrintAgentRow[] = [
  {
    id: "a1",
    name: "Cocina agent",
    active: true,
    nodeId: null, // manually enrolled — no provenance marker
    lastSeenAt: "2026-08-25T14:30:00.000Z",
    enrolledAt: "2026-08-20T09:00:00.000Z",
  },
  {
    id: "a2",
    name: "Barra agent",
    active: false,
    nodeId: "n1", // self-enrolled on a node, then revoked — marker + allow-again
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
    active: false,
  },
];

// The discovered inventory the create surface reads for usb/bluetooth: one unregistered USB device an
// agent currently sees, and one already-registered one (shown marked, no Register action).
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
  },
];

// A discovered network_tcp printer a Scan turns up — offered to pre-fill the IP form's host+port.
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
  },
];

const jobs: PrintJobRow[] = [
  {
    id: "j1",
    printerId: "p1",
    status: "failed",
    attempts: 2,
    lastError: "printer offline",
    createdAt: "2026-08-25T14:00:00.000Z",
    deliveredAt: null,
  },
  {
    id: "j2",
    printerId: "p1",
    status: "done",
    attempts: 1,
    lastError: null,
    createdAt: "2026-08-25T13:00:00.000Z",
    deliveredAt: "2026-08-25T13:00:05.000Z",
  },
];

const stations: Station[] = [
  {
    id: "s1",
    name: "Cocina",
    displayOrder: 0,
    isDefault: true,
    active: true,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
  {
    id: "s2",
    name: "Barra",
    displayOrder: 1,
    isDefault: false,
    active: true,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
];

// Counter receipt/drawer (§5): two tills (one with a printer set, one without) + one location, for the
// per-till receipt-printer picker + the per-location print-mode toggle.
const tills: Till[] = [
  { id: "t1", label: "Caja 1", locationId: "loc-1", receiptPrinterId: "p1" },
  { id: "t2", label: "Caja 2", locationId: "loc-1", receiptPrinterId: null },
];
const locations: LocationSummary[] = [{ id: "loc-1", name: "Barra" }];

// One print agent knocking to join (the shared join-and-accept queue, kind "print_agent"). The row
// carries NO verification number — that lives only in the challenge dialog's three buttons.
const pending: JoinRequestRow[] = [
  { id: "j1", kind: "print_agent", label: "kitchen-pi", createdAt: "2026-09-08T10:02:00.000Z" },
];

/** The three numbers the server offers for `j1`, shuffled, one of them real — and which one that is.
 * The dashboard is never told which, so the test knowing it is the only way to check the pending LIST
 * never carries it. */
const CHOICES = ["12", "47", "83"];
const REAL_NUMBER = "47";

const SHUT = { open: false, openUntil: null, refusedRecently: 0 };
const OPEN = { open: true, openUntil: "2026-09-08T10:20:00.000Z", refusedRecently: 0 };

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listAgents: vi.fn().mockResolvedValue(agents),
    listPrinters: vi.fn().mockResolvedValue(printers),
    listRecentJobs: vi.fn().mockResolvedValue(jobs),
    revokeAgent: vi.fn().mockResolvedValue(undefined),
    allowAgent: vi.fn().mockResolvedValue(undefined),
    pairingMode: vi.fn().mockResolvedValue(SHUT),
    openPairingMode: vi.fn().mockResolvedValue({ openUntil: OPEN.openUntil }),
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
    listDiscoveredPrinters: vi.fn().mockResolvedValue([] as DiscoveredPrinter[]),
    listStations: vi.fn().mockResolvedValue(stations),
    listPrinterStations: vi.fn().mockResolvedValue([] as StationPrinter[]),
    attachPrinterToStation: vi.fn().mockResolvedValue(undefined),
    detachPrinterFromStation: vi.fn().mockResolvedValue(undefined),
    listTills: vi.fn().mockResolvedValue(tills),
    getLocations: vi.fn().mockResolvedValue(locations),
    setTillReceiptPrinter: vi.fn().mockResolvedValue(undefined),
    setReceiptPrintMode: vi.fn().mockResolvedValue(undefined),
    setDrawerOpenPolicy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight load (listAgents + listPrinters + listRecentJobs) and the follow-up render. */
async function flush(el: PrintersScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: PrintersScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const text = (el: PrintersScreen, sel: string) => q(el, sel)?.textContent?.trim();

/** Type into a wt-input by dispatching its composed `wt-change` (the wt-input contract). */
function typeField(el: PrintersScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

/** Toggle a wt-switch by dispatching its composed `wt-change` (the wt-switch contract). */
function toggleSwitch(el: PrintersScreen, sel: string, checked: boolean): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
}

/** Pick a value in a native <select> and fire its `change`. */
function pickSelect(el: PrintersScreen, sel: string, value: string): void {
  const select = q(el, sel) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

/** Read a wt-switch's live `checked` property (set synchronously by the `.checked=` binding on commit,
 * so it is stable after the parent's `updateComplete` without waiting on the switch's own reflection). */
const switchChecked = (el: PrintersScreen, sel: string): boolean =>
  (q(el, sel) as unknown as { checked: boolean }).checked;

describe("printers-screen", () => {
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
    expect(q(el, "[data-test=printer-row-p2]")).toBeTruthy();
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

  it("renders each printer's transport, and no serving-agent column (eligibility is derived)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=printer-transport-p1]")).toBe(
      transportName("network_tcp", "es-ES"),
    );
    expect(text(el, "[data-test=printer-transport-p2]")).toBe(transportName("cloud_poll", "es-ES"));
    // There is no serving agent to show any more — the agent column is gone from the row.
    expect(q(el, "[data-test=printer-agent-p1]")).toBeNull();
    expect(q(el, "[data-test=printer-agent-p2]")).toBeNull();
  });

  it("renders each job's status, attempts, resolved printer and last error", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=job-status-j1]")).toBe(jobStatusName("failed", "es-ES"));
    expect(text(el, "[data-test=job-attempts-j1]")).toContain("2");
    expect(text(el, "[data-test=job-printer-j1]")).toBe("Cocina"); // resolved from the printer list
    expect(text(el, "[data-test=job-error-j1]")).toBe("printer offline");
    // A delivered job carries no error line.
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

    expect(text(el, "[data-test=no-agents]")).toBe(t("printers.no_agents", "es-ES"));
    expect(text(el, "[data-test=no-printers]")).toBe(t("printers.no_printers", "es-ES"));
    expect(text(el, "[data-test=no-jobs]")).toBe(t("printers.no_jobs", "es-ES"));
  });

  it("shows a localised error banner when the initial load is rejected (and never rejects)", async () => {
    const api = stubApi({ listPrinters: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("server.internal", "es-ES"));
    expect(banner).not.toContain("server.internal");
  });

  // ── Agents: the shared pairing window (device-join-and-accept §1.1, reused by print agents) ───────

  it("loads the pairing window and the print-agent join queue on connect", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(api.pairingMode).toHaveBeenCalledTimes(1);
    // The queue is the print-agent surface, never the device one.
    expect(api.joinRequests).toHaveBeenCalledWith("print_agent");
  });

  it("shows the shut window's Open control, with the refused-knock hint", async () => {
    const api = stubApi({
      pairingMode: vi.fn().mockResolvedValue({ ...SHUT, refusedRecently: 2 }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=pairing-open]")).toBeTruthy();
    expect(q(el, "[data-test=pairing-until]")).toBeNull();
    expect(text(el, "[data-test=pairing-refused]")).toBe(
      t("printers.pairing_refused", "es-ES").replace("{count}", "2"),
    );
  });

  it("opens the window and shows when it lapses", async () => {
    const pairingMode = vi.fn().mockResolvedValueOnce(SHUT).mockResolvedValue(OPEN);
    const api = stubApi({ pairingMode });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=pairing-open]")!.click();
    await flush(el);

    expect(api.openPairingMode).toHaveBeenCalledWith();
    expect(text(el, "[data-test=pairing-until]")).toBe(
      t("printers.pairing_open_until", "es-ES").replace("{time}", "2026-09-08 10:20"),
    );
    expect(q(el, "[data-test=pairing-open]")).toBeNull();
  });

  // Extend is the SAME call as Open — the route moves an open window's lapse rather than adding one.
  it("extends and closes an open window", async () => {
    const api = stubApi({ pairingMode: vi.fn().mockResolvedValue(OPEN) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=pairing-extend]")!.click();
    await flush(el);
    expect(api.openPairingMode).toHaveBeenCalledWith();

    q(el, "[data-test=pairing-close]")!.click();
    await flush(el);
    expect(api.closePairingMode).toHaveBeenCalledWith();
  });

  it("shows an error banner when opening the window is rejected", async () => {
    const api = stubApi({
      openPairingMode: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=pairing-open]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "authorization.not_permitted",
    );
  });

  // ── Agents: the print-agent join queue (design §1.2, kind "print_agent") ──────────────────────────

  it("lists a waiting agent by the name it asked for, and shows the setup-page hint with this origin", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=join-label-j1]")).toBe("kitchen-pi");
    expect(text(el, "[data-test=join-asked-j1]")).toBe("2026-09-08 10:02");
    // The operator hint carries the dashboard's own origin verbatim (the address to type into the agent).
    expect(text(el, "[data-test=join-origin]")).toBe(window.location.origin);
  });

  // Design §1.2 rule 1: the LIST must never show the answer beside the question. Asserted against the
  // SPECIFIC number this fake server holds, over the panel's rendered TEXT, plus the fact that nothing
  // fetched a challenge to render the list.
  it("never renders the request's verification number in the pending list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
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

    expect(text(el, "[data-test=no-join-requests]")).toBe(t("printers.join_none", "es-ES"));
  });

  it("denies only on the confirming second click, then reloads the queue", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=join-deny-j1]")!.click();
    await el.updateComplete;
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
    expect(text(el, "[data-test=join-deny-j1]")).toBe(t("printers.join_deny_confirm", "es-ES"));

    q(el, "[data-test=join-deny-j1]")!.click();
    await flush(el);
    expect(api.denyJoinRequest).toHaveBeenCalledWith("j1");
    expect(api.joinRequests).toHaveBeenCalledTimes(2);
  });

  // ── Agents: the accept dialog's numeric match (no binding pickers — just the three numbers) ────────

  it("opens a row and renders the three numbers as buttons, immediately tappable", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    expect(api.joinChallenge).toHaveBeenCalledWith("j1");
    const buttons = Array.from(el.shadowRoot!.querySelectorAll("[data-choice]"));
    expect(buttons.map((b) => b.getAttribute("data-choice"))).toEqual(CHOICES);
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(CHOICES);
    // No binding to choose first: an agent accept is only the number, so it is tappable at once.
    expect(
      (q(el, `[data-choice="${REAL_NUMBER}"]`) as import("@waitron/ui").WtButton).disabled,
    ).toBe(false);
  });

  it("accepts with the tapped number, then closes the dialog and reloads the queue and agents", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
    await flush(el);

    expect(api.acceptPrintAgentJoinRequest).toHaveBeenCalledWith("j1", { choice: REAL_NUMBER });
    expect(q(el, "[data-test=join-dialog]")).toBeNull();
    expect(api.listAgents).toHaveBeenCalledTimes(2);
    expect(api.joinRequests).toHaveBeenCalledTimes(2);
  });

  // Design §1.2: a wrong tap has ALREADY denied the request server-side (device.join_mismatch is the
  // surface-neutral terminal code). The dialog closes, the row is gone, and the copy sends the operator
  // back to the agent. Proven by deletion: drop the mismatch branch in #accept and this fails.
  it("treats a mismatch as terminal: the row goes, and the banner tells them to ask again", async () => {
    const api = stubApi({
      acceptPrintAgentJoinRequest: vi.fn().mockRejectedValue({ code: "device.join_mismatch" }),
      joinRequests: vi.fn().mockResolvedValueOnce(pending).mockResolvedValue([]),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
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

  // The counterpart that gives the mismatch branch its meaning: a fault the operator CAN retry leaves
  // the dialog open on the same request.
  it("keeps the dialog open on a recoverable accept fault", async () => {
    const api = stubApi({
      acceptPrintAgentJoinRequest: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
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

    q(el, "[data-test=join-review-j1]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("join_request.not_found");
  });

  // The generate-code panel and its verb are gone: an agent is enrolled by ACCEPTING its ask now.
  it("shows none of the retired generate-code controls", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
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

    expect(q(el, "[data-test=revoke-agent-a1]")).toBeTruthy(); // active
    expect(q(el, "[data-test=revoke-agent-a2]")).toBeNull(); // already revoked
  });

  it("revokes an agent only on the confirming second click, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=revoke-agent-a1]")!.click();
    await el.updateComplete;
    expect(api.revokeAgent).not.toHaveBeenCalled();
    expect(text(el, "[data-test=revoke-agent-a1]")).toBe(t("printers.revoke_confirm", "es-ES"));

    q(el, "[data-test=revoke-agent-a1]")!.click();
    await flush(el);
    expect(api.revokeAgent).toHaveBeenCalledWith("a1");
    expect(api.listAgents).toHaveBeenCalledTimes(2); // reloaded
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

  // ── Agents: provenance + allow-again (on-node self-enrolment) ───────────────────────────────────────

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

    // The allow-again control shows only on a revoked agent (a2), not an active one (a1).
    expect(q(el, "[data-test=allow-agent-a2]")).toBeTruthy();
    expect(q(el, "[data-test=allow-agent-a1]")).toBeNull();

    q(el, "[data-test=allow-agent-a2]")!.click();
    await el.updateComplete;
    expect(api.allowAgent).not.toHaveBeenCalled();
    expect(text(el, "[data-test=allow-agent-a2]")).toBe(t("printers.allow_confirm", "es-ES"));

    q(el, "[data-test=allow-agent-a2]")!.click();
    await flush(el);
    expect(api.allowAgent).toHaveBeenCalledWith("a2");
    expect(api.listAgents).toHaveBeenCalledTimes(2); // reloaded
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

  // ── Printers: transport-aware create (central printer provisioning §10) ────────────────────────────

  it("adds an IP printer with name + host + port — no agent picker, no localKey/pollId", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    // network_tcp is the default transport; its manual form is name + host + port. There is NO agent
    // picker any more (eligibility is derived at run time — central printer provisioning §3).
    expect(q(el, "[data-test=new-agent]")).toBeNull();
    typeField(el, "[data-test=new-printer-name]", "Barra");
    typeField(el, "[data-test=new-host]", "10.0.0.50");
    typeField(el, "[data-test=new-port]", "9200");
    await el.updateComplete;
    q(el, "[data-test=add-printer]")!.click();
    await flush(el);

    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "Barra",
      transport: "network_tcp",
      host: "10.0.0.50",
      port: 9200,
    });
    const arg = vi.mocked(api.createPrinter).mock.calls[0]![0];
    expect(arg).not.toHaveProperty("agentId");
    expect(arg).not.toHaveProperty("localKey");
    expect(arg).not.toHaveProperty("pollId");
    expect(api.listPrinters).toHaveBeenCalledTimes(2);
  });

  it("offers network_tcp, usb and bluetooth in the transport selector (never cloud_poll)", async () => {
    // cloud_poll has no create UI (it is provisioned by Waitron Cloud, not added here); the enum/schema
    // still forward-carry it (see the p2 fixture render above), only the dropdown drops it.
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    const options = Array.from(q(el, "[data-test=new-transport]")!.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toEqual(["network_tcp", "usb", "bluetooth"]);
    expect(options).not.toContain("cloud_poll");
  });

  it("does not add an IP printer when the name is blank", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=new-printer-name]", "   ");
    await el.updateComplete;
    q(el, "[data-test=add-printer]")!.click();
    await flush(el);

    expect(api.createPrinter).not.toHaveBeenCalled();
  });

  it("surfaces printer.invalid_config as an accessible error when adding an IP printer without a host", async () => {
    // network_tcp needs a host; adding one without it is invalid config — the server rejects, the screen
    // shows the localised message in a role=alert banner (never the raw wire code).
    const api = stubApi({
      createPrinter: vi.fn().mockRejectedValue({ code: "printer.invalid_config" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=new-printer-name]", "Bad IP");
    await el.updateComplete;
    q(el, "[data-test=add-printer]")!.click();
    await flush(el);

    const banner = q(el, "[role=alert]");
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain(codeMessage("printer.invalid_config", "es-ES"));
    expect(banner!.textContent).not.toContain("printer.invalid_config");
  });

  it("Scan opens a discovery window and offers a found IP printer to pre-fill host+port", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discoveredNetwork) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    // No discovery runs until the operator asks — the window is expensive (LAN sweep / BT inquiry).
    expect(api.startPrinterDiscovery).not.toHaveBeenCalled();
    q(el, "[data-test=scan-printers]")!.click();
    await flush(el);
    expect(api.startPrinterDiscovery).toHaveBeenCalledWith();
    expect(api.listDiscoveredPrinters).toHaveBeenCalled();

    // The found IP printer is offered as a pre-fill; using it stamps host+port into the form.
    q(el, "[data-test=use-result-0]")!.click();
    await el.updateComplete;
    expect((el as unknown as { newHost: string }).newHost).toBe("10.0.0.77");
    expect((el as unknown as { newPort: string }).newPort).toBe("9100");
  });

  it("Scan shows a busy button and keeps re-reading the discovered list for the listen period", async () => {
    // The agents learn the window is open on their next 2 s poll and post results on the pull after
    // that, so a single read right after opening the window sees nothing (the owner pressed Scan
    // several times before a result appeared, 2026-09-11). The screen must listen for a while.
    vi.useFakeTimers();
    try {
      const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discoveredNetwork) });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;

      const button = () => q(el, "[data-test=scan-printers]")!;
      button().click();
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
      q(el, "[data-test=scan-printers]")!.click();
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
      q(el, "[data-test=scan-printers]")!.click();
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
        listDiscoveredPrinters: vi.fn(() => new Promise<DiscoveredPrinter[]>((r) => (deliver = r))),
      });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      q(el, "[data-test=scan-printers]")!.click();
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
          .mockResolvedValueOnce(discoveredNetwork)
          .mockImplementationOnce(() => new Promise<DiscoveredPrinter[]>((r) => (deliver = r)))
          .mockResolvedValue(discoveredNetwork),
      });
      const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
      await vi.advanceTimersByTimeAsync(0);
      q(el, "[data-test=scan-printers]")!.click();
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

  // ── Printers: register a discovered USB / Bluetooth device (design §10) ─────────────────────────────

  it("registers a discovered USB printer by picking it and naming it", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    // Switching to USB loads the discovered inventory (there is no manual USB form — a USB printer is
    // keyed by its stable device id, which only the box can read).
    pickSelect(el, "[data-test=new-transport]", "usb");
    await flush(el);
    expect(api.listDiscoveredPrinters).toHaveBeenCalled();
    expect(q(el, "[data-test=discovered-row-SN-1]")).toBeTruthy();

    // Name the unregistered device and Register it → createPrinter with the transport + its localKey.
    typeField(el, "[data-test=register-name-SN-1]", "Cocina USB");
    await el.updateComplete;
    q(el, "[data-test=register-SN-1]")!.click();
    await flush(el);

    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "Cocina USB",
      transport: "usb",
      localKey: "SN-1",
    });
    const arg = vi.mocked(api.createPrinter).mock.calls[0]![0];
    expect(arg).not.toHaveProperty("agentId");
    expect(arg).not.toHaveProperty("host");
    expect(api.listPrinters).toHaveBeenCalledTimes(2); // reloaded after the register
  });

  it("does not register a discovered device when its name is blank", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    pickSelect(el, "[data-test=new-transport]", "usb");
    await flush(el);
    q(el, "[data-test=register-SN-1]")!.click();
    await flush(el);

    expect(api.createPrinter).not.toHaveBeenCalled();
  });

  it("shows already-registered discovered devices as registered, with no Register action", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    pickSelect(el, "[data-test=new-transport]", "usb");
    await flush(el);

    // SN-2 is already a registered printer: the row shows a "registered" marker and no Register button.
    expect(q(el, "[data-test=discovered-row-SN-2]")).toBeTruthy();
    expect(text(el, "[data-test=discovered-registered-SN-2]")).toBe(
      t("printers.registered", "es-ES"),
    );
    expect(q(el, "[data-test=register-SN-2]")).toBeNull();
    expect(q(el, "[data-test=register-name-SN-2]")).toBeNull();
    // The unregistered SN-1, by contrast, DOES offer the Register action.
    expect(q(el, "[data-test=register-SN-1]")).toBeTruthy();
    expect(q(el, "[data-test=discovered-registered-SN-1]")).toBeNull();
  });

  it("shows the empty placeholder when no USB/Bluetooth devices are discovered", async () => {
    const api = stubApi(); // listDiscoveredPrinters defaults to []
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    pickSelect(el, "[data-test=new-transport]", "usb");
    await flush(el);
    expect(text(el, "[data-test=no-discovered]")).toBe(t("printers.no_discovered", "es-ES"));
  });

  it("shows the Bluetooth pairing note (and the discovered list) for the bluetooth transport", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    pickSelect(el, "[data-test=new-transport]", "bluetooth");
    await flush(el);
    expect(text(el, "[data-test=bluetooth-pair-note]")).toBe(
      t("printers.bluetooth_pair_note", "es-ES"),
    );
    // The bluetooth branch reads the discovered list too (paired devices surface there once paired).
    expect(api.listDiscoveredPrinters).toHaveBeenCalled();
  });

  it("shows an error banner when registering a discovered device is rejected", async () => {
    const api = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered),
      createPrinter: vi.fn().mockRejectedValue({ code: "printer.already_registered" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    pickSelect(el, "[data-test=new-transport]", "usb");
    await flush(el);
    typeField(el, "[data-test=register-name-SN-1]", "Dup");
    await el.updateComplete;
    q(el, "[data-test=register-SN-1]")!.click();
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

    // Switching to USB triggers the discovered read, which rejects → the localised banner.
    pickSelect(el, "[data-test=new-transport]", "usb");
    await flush(el);
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

    q(el, "[data-test=scan-printers]")!.click();
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

    // p1 is network_tcp. Type into the device-id and poll-id inputs the row still renders — the save
    // must scope the PATCH to network_tcp and NOT forward them (the DB CHECK asserts required fields are
    // present but does not forbid extras, so a stray field would persist as meaningless config).
    typeField(el, "[data-test=printer-name-p1]", "Cocina 2");
    typeField(el, "[data-test=printer-host-p1]", "10.0.0.20");
    typeField(el, "[data-test=printer-port-p1]", "9300");
    typeField(el, "[data-test=printer-local-key-p1]", "SN-stray");
    typeField(el, "[data-test=printer-poll-id-p1]", "poll-x");
    toggleSwitch(el, "[data-test=printer-ticket-scope-p1]", true); // → "order"
    await el.updateComplete;
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
      name: "Cocina 2",
      host: "10.0.0.20",
      port: 9300,
      ticketScope: "order",
      active: true,
    });
    const [, patch] = vi.mocked(api.updatePrinter).mock.calls[0]!;
    expect(patch).not.toHaveProperty("localKey");
    expect(patch).not.toHaveProperty("pollId");
    expect(api.listPrinters).toHaveBeenCalledTimes(2);
  });

  it("clears an edited network_tcp printer's emptied host+port to null", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=printer-host-p1]", "");
    typeField(el, "[data-test=printer-port-p1]", "");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
      name: "Cocina",
      host: null,
      port: null,
      ticketScope: "station",
      active: true,
    });
  });

  it("saves an edited usb printer's localKey (never host/port/pollId)", async () => {
    const usb: Printer = {
      id: "p3",
      name: "USB",
      transport: "usb",
      host: null,
      port: null,
      localKey: "SN-1",
      pollId: null,
      ticketScope: "station",
      active: true,
    };
    const api = stubApi({ listPrinters: vi.fn().mockResolvedValue([usb]) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=printer-local-key-p3]", "SN-9");
    // Stray fields the row renders — must NOT be forwarded onto a usb printer's PATCH.
    typeField(el, "[data-test=printer-host-p3]", "10.0.0.1");
    typeField(el, "[data-test=printer-poll-id-p3]", "poll-y");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p3]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p3", {
      name: "USB",
      localKey: "SN-9",
      ticketScope: "station",
      active: true,
    });
    const [, patch] = vi.mocked(api.updatePrinter).mock.calls[0]!;
    expect(patch).not.toHaveProperty("host");
    expect(patch).not.toHaveProperty("port");
    expect(patch).not.toHaveProperty("pollId");
  });

  it("clears an edited usb printer's emptied localKey to null", async () => {
    const usb: Printer = {
      id: "p3",
      name: "USB",
      transport: "usb",
      host: null,
      port: null,
      localKey: "SN-1",
      pollId: null,
      ticketScope: "station",
      active: true,
    };
    const api = stubApi({ listPrinters: vi.fn().mockResolvedValue([usb]) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=printer-local-key-p3]", "");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p3]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p3", {
      name: "USB",
      localKey: null,
      ticketScope: "station",
      active: true,
    });
  });

  it("reactivates a cloud_poll printer sending only its pollId (never host/port/localKey)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    // p2 is cloud_poll + inactive: host/port/localKey are empty, pollId is "poll-1".
    toggleSwitch(el, "[data-test=printer-active-p2]", true);
    await el.updateComplete;
    q(el, "[data-test=save-printer-p2]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p2", {
      name: "Nube",
      pollId: "poll-1",
      ticketScope: "station",
      active: true,
    });
    const [, patch] = vi.mocked(api.updatePrinter).mock.calls[0]!;
    expect(patch).not.toHaveProperty("host");
    expect(patch).not.toHaveProperty("port");
    expect(patch).not.toHaveProperty("localKey");
  });

  it("clears an edited cloud_poll printer's emptied pollId to null", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=printer-poll-id-p2]", "");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p2]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p2", {
      name: "Nube",
      pollId: null,
      ticketScope: "station",
      active: false,
    });
  });

  it("shows an error banner when saving a printer edit is rejected", async () => {
    const api = stubApi({
      updatePrinter: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("printer.not_found", "es-ES"));
  });

  it("deactivates a printer, reloads, and disables the control for an already-inactive one", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=deactivate-printer-p2]")!.hasAttribute("disabled")).toBe(true);

    q(el, "[data-test=deactivate-printer-p1]")!.click();
    await flush(el);
    expect(api.deactivatePrinter).toHaveBeenCalledWith("p1");
    expect(api.listPrinters).toHaveBeenCalledTimes(2);
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

    q(el, "[data-test=test-print-p1]")!.click();
    await flush(el);
    expect(api.testPrint).toHaveBeenCalledWith("p1");
    expect(api.listRecentJobs).toHaveBeenCalledTimes(2); // reloaded so the queued job appears
  });

  it("shows an error banner when a test print is rejected", async () => {
    const api = stubApi({ testPrint: vi.fn().mockRejectedValue({ code: "printer.not_found" }) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    q(el, "[data-test=test-print-p1]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("printer.not_found");
  });

  // ── Printers: station mapping (which stations a printer serves) ────────────────────────────────────

  it("renders a station toggle per station, checked when this printer is attached", async () => {
    const api = stubApi({
      listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
        printerId === "p1" ? [{ stationId: "s1", printerId: "p1" }] : [],
      ),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    // p1 is attached to s1 only; p2 to nothing. Each station is a labelled toggle on each printer.
    expect(q(el, "[data-test=station-toggle-p1-s1]")).toBeTruthy();
    expect(q(el, "[data-test=station-toggle-p1-s2]")).toBeTruthy();
    expect(switchChecked(el, "[data-test=station-toggle-p1-s1]")).toBe(true);
    expect(switchChecked(el, "[data-test=station-toggle-p1-s2]")).toBe(false);
    expect(switchChecked(el, "[data-test=station-toggle-p2-s1]")).toBe(false);
    expect(switchChecked(el, "[data-test=station-toggle-p2-s2]")).toBe(false);
    // The toggle labels are the station names.
    expect(q(el, "[data-test=station-toggle-p1-s1]")!.getAttribute("label")).toBe("Cocina");
    // Each printer read its own mapping on load.
    expect(api.listPrinterStations).toHaveBeenCalledWith("p1");
    expect(api.listPrinterStations).toHaveBeenCalledWith("p2");
  });

  it("attaches a station when its toggle is switched on, and reflects the change after reload", async () => {
    const attached = new Set<string>();
    const api = stubApi({
      listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
        printerId === "p1"
          ? [...attached].map((stationId) => ({ stationId, printerId: "p1" }))
          : [],
      ),
      attachPrinterToStation: vi.fn(async (stationId: string) => {
        attached.add(stationId);
      }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(switchChecked(el, "[data-test=station-toggle-p1-s2]")).toBe(false);
    toggleSwitch(el, "[data-test=station-toggle-p1-s2]", true);
    await flush(el);

    // stationId then printerId, mirroring the server route /stations/:sid/printers/:pid.
    expect(api.attachPrinterToStation).toHaveBeenCalledWith("s2", "p1");
    expect(api.detachPrinterFromStation).not.toHaveBeenCalled();
    // #mutate reloaded, and the refreshed mapping now shows s2 attached to p1.
    expect(api.listPrinters).toHaveBeenCalledTimes(2);
    expect(switchChecked(el, "[data-test=station-toggle-p1-s2]")).toBe(true);
  });

  it("detaches a station when its toggle is switched off, and reflects the change after reload", async () => {
    const attached = new Set<string>(["s1"]);
    const api = stubApi({
      listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
        printerId === "p1"
          ? [...attached].map((stationId) => ({ stationId, printerId: "p1" }))
          : [],
      ),
      detachPrinterFromStation: vi.fn(async (stationId: string) => {
        attached.delete(stationId);
      }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(switchChecked(el, "[data-test=station-toggle-p1-s1]")).toBe(true);
    toggleSwitch(el, "[data-test=station-toggle-p1-s1]", false);
    await flush(el);

    expect(api.detachPrinterFromStation).toHaveBeenCalledWith("s1", "p1");
    expect(api.attachPrinterToStation).not.toHaveBeenCalled();
    expect(switchChecked(el, "[data-test=station-toggle-p1-s1]")).toBe(false);
  });

  it("shows an error banner when a station toggle is rejected", async () => {
    const api = stubApi({
      attachPrinterToStation: vi.fn().mockRejectedValue({ code: "station.not_found" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    toggleSwitch(el, "[data-test=station-toggle-p1-s1]", true);
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("station.not_found", "es-ES"));
    expect(banner).not.toContain("station.not_found");
  });

  it("shows the no-stations placeholder when the venue has no stations", async () => {
    const api = stubApi({ listStations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=no-stations-p1]")).toBe(t("printers.no_stations", "es-ES"));
    expect(q(el, "[data-test=station-toggle-p1-s1]")).toBeNull();
  });

  // ── Receipt printer picker + print-mode toggle (counter receipt/drawer §5) ───────────────────────

  it("renders a receipt-printer picker per till, offering the ACTIVE printers + a 'no printer' option", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    const select = q(el, "[data-test=till-receipt-printer-t1]") as HTMLSelectElement;
    expect(select).not.toBeNull();
    const values = [...select.options].map((o) => o.value);
    // The clear option ("") first, then only the ACTIVE printer p1 — the inactive p2 is not offered.
    expect(values).toEqual(["", "p1"]);
    expect(select.options[0]!.textContent).toContain(t("printers.receipt_no_printer", "es-ES"));
  });

  it("reflects each till's PERSISTED receipt printer in its select (set → the id, unset → the clear option)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    // t1 has p1 set; t2 has none — the selects are reconciled to those values in updated().
    expect((q(el, "[data-test=till-receipt-printer-t1]") as HTMLSelectElement).value).toBe("p1");
    expect((q(el, "[data-test=till-receipt-printer-t2]") as HTMLSelectElement).value).toBe("");
  });

  it("picking a printer calls setTillReceiptPrinter with the till + chosen printer id, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    (api.listTills as ReturnType<typeof vi.fn>).mockClear();

    pickSelect(el, "[data-test=till-receipt-printer-t2]", "p1");
    await flush(el);
    expect(api.setTillReceiptPrinter).toHaveBeenCalledWith("t2", "p1");
    expect(api.listTills).toHaveBeenCalledTimes(1); // optimistic reload after the mutation
  });

  it("clearing the picker ('no printer') calls setTillReceiptPrinter with null", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    pickSelect(el, "[data-test=till-receipt-printer-t1]", "");
    await flush(el);
    expect(api.setTillReceiptPrinter).toHaveBeenCalledWith("t1", null);
  });

  it("shows an error banner when setting a till's printer is rejected (printer.not_found)", async () => {
    const api = stubApi({
      setTillReceiptPrinter: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    pickSelect(el, "[data-test=till-receipt-printer-t2]", "p1");
    await flush(el);
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("printer.not_found", "es-ES"));
    expect(banner).not.toContain("printer.not_found");
  });

  it("renders a print-mode toggle per location and calls setReceiptPrintMode with the chosen mode", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    (api.listTills as ReturnType<typeof vi.fn>).mockClear();

    // The three-mode segmented control is present; pick "on_request".
    expect(q(el, "[data-test=print-mode-loc-1-auto]")).not.toBeNull();
    expect(q(el, "[data-test=print-mode-loc-1-never]")).not.toBeNull();
    q(el, "[data-test=print-mode-loc-1-on_request]")!.click();
    await flush(el);

    expect(api.setReceiptPrintMode).toHaveBeenCalledWith("loc-1", "on_request");
    expect(api.listTills).toHaveBeenCalledTimes(1); // reload after the mutation
  });

  it("reflects the picked print mode in the segmented control (primary variant), surviving the reload", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    // Default: auto is primary.
    expect(q(el, "[data-test=print-mode-loc-1-auto]")!.getAttribute("variant")).toBe("primary");

    q(el, "[data-test=print-mode-loc-1-never]")!.click();
    await flush(el);
    // The pick is reflected (the bump_mode precedent: local pick survives the reload, not reset to auto).
    expect(q(el, "[data-test=print-mode-loc-1-never]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=print-mode-loc-1-auto]")!.getAttribute("variant")).toBe("secondary");
  });

  it("leaves the print-mode toggle on the PRIOR mode (not the failed value) and shows the banner when setReceiptPrintMode is rejected", async () => {
    const api = stubApi({
      setReceiptPrintMode: vi.fn().mockRejectedValue({ code: "management.request_invalid" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    // Default: auto is primary.
    expect(q(el, "[data-test=print-mode-loc-1-auto]")!.getAttribute("variant")).toBe("primary");

    q(el, "[data-test=print-mode-loc-1-never]")!.click();
    await flush(el);

    // The write failed, so the local pick is NOT applied: the control still shows the prior mode
    // (auto), never the "never" that failed to save.
    expect(q(el, "[data-test=print-mode-loc-1-auto]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=print-mode-loc-1-never]")!.getAttribute("variant")).toBe("secondary");
    // ...and the failure is surfaced in the localised error banner (raw code never shown).
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("management.request_invalid", "es-ES"));
    expect(banner).not.toContain("management.request_invalid");
  });

  it("renders a drawer-policy toggle per location and calls setDrawerOpenPolicy with the chosen policy", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    (api.listTills as ReturnType<typeof vi.fn>).mockClear();

    // The two-policy segmented control is present; pick "open".
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")).not.toBeNull();
    expect(q(el, "[data-test=drawer-policy-loc-1-open]")).not.toBeNull();
    q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
    await flush(el);

    expect(api.setDrawerOpenPolicy).toHaveBeenCalledWith("loc-1", "open");
    expect(api.listTills).toHaveBeenCalledTimes(1); // reload after the mutation
  });

  it("reflects the picked drawer policy in the segmented control (primary variant), surviving the reload", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    // Default: gated is primary (the SECURE column default).
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe("primary");

    q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
    await flush(el);
    // The pick is reflected (no read route, so the local pick survives the reload, not reset to gated).
    expect(q(el, "[data-test=drawer-policy-loc-1-open]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe(
      "secondary",
    );
  });

  it("leaves the drawer-policy toggle on the PRIOR policy (not the failed value) and shows the banner when setDrawerOpenPolicy is rejected", async () => {
    const api = stubApi({
      setDrawerOpenPolicy: vi.fn().mockRejectedValue({ code: "management.request_invalid" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    // Default: gated is primary.
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe("primary");

    q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
    await flush(el);

    // The write failed, so the local pick is NOT applied: the control still shows the prior policy
    // (gated), never the "open" that failed to save.
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=drawer-policy-loc-1-open]")!.getAttribute("variant")).toBe(
      "secondary",
    );
    // ...and the failure is surfaced in the localised error banner (raw code never shown).
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("management.request_invalid", "es-ES"));
    expect(banner).not.toContain("management.request_invalid");
  });

  it("shows the no-tills / no-locations placeholders when the venue has neither", async () => {
    const api = stubApi({
      listTills: vi.fn().mockResolvedValue([]),
      getLocations: vi.fn().mockResolvedValue([]),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=no-tills]")).toBe(t("printers.no_tills", "es-ES"));
    expect(text(el, "[data-test=no-locations]")).toBe(t("printers.no_locations", "es-ES"));
  });

  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-printers-screen")).toBe(PrintersScreen);
  });
});

it.each([
  {
    method: "createPrinter",
    field: "[data-test=new-printer-name]",
    button: "[data-test=add-printer]",
    result: { id: "p9" },
  },
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

    const control = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(field)!;
    await control.updateComplete;
    const input = control.shadowRoot!.querySelector("input")!;
    input.value = "Updated";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    el.shadowRoot!.querySelector<HTMLElement>(button)!.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect((el.shadowRoot!.querySelector(button) as import("@waitron/ui").WtButton).disabled).toBe(
      true,
    );
    reject({ code: "management.request_invalid" });
    await flush(el);
    input.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect((el.shadowRoot!.querySelector(button) as import("@waitron/ui").WtButton).disabled).toBe(
      false,
    );
  },
);

it("keeps Test Print working while Add printer is pending without unlocking Add printer", async () => {
  let resolve!: (value: { id: string }) => void;
  const createPrinter = vi.fn(
    () =>
      new Promise<{ id: string }>((done) => {
        resolve = done;
      }),
  );
  const api = stubApi({ createPrinter });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  const field = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
    "[data-test=new-printer-name]",
  )!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = "Kitchen printer";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  input.focus();
  await userEvent.keyboard("{Enter}");
  expect(createPrinter).toHaveBeenCalledTimes(1);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=test-print-p1]")!.click();
  await flush(el);
  expect(api.testPrint).toHaveBeenCalledExactlyOnceWith("p1");
  input.focus();
  await userEvent.keyboard("{Enter}");
  expect(createPrinter).toHaveBeenCalledTimes(1);
  expect(
    (el.shadowRoot!.querySelector("[data-test=add-printer]") as import("@waitron/ui").WtButton)
      .disabled,
  ).toBe(true);
  resolve({ id: "p9" });
  await flush(el);
});
