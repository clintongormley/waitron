import { page, userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    enrolledAt: "2026-08-20T09:00:00.000Z",
  },
  {
    id: "a2",
    name: "Barra agent",
    active: false,
    host: null,
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
    ticketScope: "station",
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

// The discovered inventory the create surface reads for usb/bluetooth: one unregistered USB device an
// agent currently sees, and one already-registered one (hidden from the list; its seen-status shows on
// p3's row).
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

// A discovered network_tcp printer a Scan turns up — offered for a one-click Add.
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

// A Scan result that IS the registered printer p1 (matched by the server on host:port): hidden from the
// results, and reported as "seen" against p1's row in the registered list.
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
    resendPrintJob: vi.fn().mockResolvedValue({ jobId: "resent" }),
    updateAgent: vi.fn().mockResolvedValue(undefined),
    getPrintJobPreview: vi.fn().mockResolvedValue({
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
    testPrint: vi.fn().mockResolvedValue({ jobId: "j9" }),
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
  const select = q(el, '[name="printer-status-filter"]') as HTMLSelectElement;
  select.value = value;
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

/** Type into a wt-input by dispatching its composed `wt-change` (the wt-input contract). */
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

  it("renders each printer's transport, and no serving-agent column (eligibility is derived)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await filterPrinters(el, "all");
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

  // ── Agents: the shared pairing window (device-join-and-accept §1.1, reused by print agents) ───────

  it("loads the pairing window and the print-agent join queue on connect", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(api.pairingMode).toHaveBeenCalledTimes(1);
    // The queue is the print-agent surface, never the device one.
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

  // ── Agents: the print-agent join queue (design §1.2, kind "print_agent") ──────────────────────────

  it("lists a waiting agent by the name it asked for, and shows the setup-page hint with this origin", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-agent]")!.click();
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

  // ── Agents: the accept dialog's numeric match (no binding pickers — just the three numbers) ────────

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
    // No binding to choose first: an agent accept is only the number, so it is tappable at once.
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

  // Design §1.2: a wrong tap has ALREADY denied the request server-side (device.join_mismatch is the
  // surface-neutral terminal code). The dialog closes, the row is gone, and the copy sends the operator
  // back to the agent. Proven by deletion: drop the mismatch branch in #accept and this fails.
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

  // The counterpart that gives the mismatch branch its meaning: a fault the operator CAN retry leaves
  // the dialog open on the same request.
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

  // The generate-code panel and its verb are gone: an agent is enrolled by ACCEPTING its ask now.
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
    expect(text(el, "[data-test=revoke-agent-a1]")).toBe(t("printers.delete_confirm", "es-ES"));

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

  // ── Printers: discovered-device registration (central printer provisioning §10) ────────────────────────────

  it("registers a discovered IP printer with its name, host and port only", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discoveredNetwork) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    expect(api.startPrinterDiscovery).not.toHaveBeenCalled();
    await openDiscovery(el);
    expect(api.startPrinterDiscovery).toHaveBeenCalledOnce();
    expect(q(el, "[data-test=new-transport]")).toBeNull();
    expect(q(el, "[data-test=new-host]")).toBeNull();
    q(el, '[data-test="register-10.0.0.77:9100"]')!.click();
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
    expect(api.listPrinters).toHaveBeenCalledTimes(2);
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

  // ── Printers: register a discovered USB / Bluetooth device (design §10) ─────────────────────────────

  it("registers a discovered USB printer using its advertised name", async () => {
    const api = stubApi({ listDiscoveredPrinters: vi.fn().mockResolvedValue(discovered) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await openDiscovery(el);
    expect(api.listDiscoveredPrinters).toHaveBeenCalled();
    expect(q(el, "[data-test=discovered-row-SN-1]")).toBeTruthy();

    await el.updateComplete;
    q(el, "[data-test=register-SN-1]")!.click();
    await flush(el);

    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "EPSON TM-T20",
      transport: "usb",
      localKey: "SN-1",
    });
    const arg = vi.mocked(api.createPrinter).mock.calls[0]![0];
    expect(arg).not.toHaveProperty("agentId");
    expect(arg).not.toHaveProperty("host");
    expect(api.listPrinters).toHaveBeenCalledTimes(2); // reloaded after the register
  });

  it("uses make and model when a discovered device has no name", async () => {
    const api = stubApi({
      listDiscoveredPrinters: vi.fn().mockResolvedValue([{ ...discovered[0], name: null }]),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openDiscovery(el);
    q(el, "[data-test=register-SN-1]")!.click();
    await flush(el);
    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "Epson TM-T20",
      transport: "usb",
      localKey: "SN-1",
    });
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
    // The unregistered SN-1, by contrast, DOES offer the Register action.
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
    q(el, '[data-test="register-AA:BB"]')!.click();
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
    expect(api.listPrinters).toHaveBeenCalledTimes(2);
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
      pendingJobs: 0,
      lastPrintAt: null,
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
      localKey: "SN-9",
      active: true,
    });
    const [, patch] = vi.mocked(api.updatePrinter).mock.calls[0]!;
    expect(patch).not.toHaveProperty("host");
    expect(patch).not.toHaveProperty("port");
    expect(patch).not.toHaveProperty("pollId");
  });

  it("rejects an emptied required USB device ID", async () => {
    const usb: Printer = {
      id: "p3",
      name: "USB",
      transport: "usb",
      host: null,
      port: null,
      localKey: "SN-1",
      pollId: null,
      ticketScope: "station",
      pendingJobs: 0,
      lastPrintAt: null,
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

    expect(api.updatePrinter).not.toHaveBeenCalled();
    expect(
      (q(el, "[data-test=printer-local-key-p3]") as import("@waitron/ui").WtInput).invalid,
    ).toBe(true);
  });

  it("reactivates a cloud_poll printer sending only its pollId (never host/port/localKey)", async () => {
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
      pollId: "poll-1",
      active: true,
    });
    const [, patch] = vi.mocked(api.updatePrinter).mock.calls[0]!;
    expect(patch).not.toHaveProperty("host");
    expect(patch).not.toHaveProperty("port");
    expect(patch).not.toHaveProperty("localKey");
  });

  it("rejects an emptied required cloud poll ID", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p2");

    typeField(el, "[data-test=printer-poll-id-p2]", "");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p2]")!.click();
    await flush(el);

    expect(api.updatePrinter).not.toHaveBeenCalled();
    expect((q(el, "[data-test=printer-poll-id-p2]") as import("@waitron/ui").WtInput).invalid).toBe(
      true,
    );
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

  it("deactivates a printer only after confirmation, reloads, and disables inactive deletion", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    await filterPrinters(el, "all");
    expect(q(el, "[data-test=deactivate-printer-p2]")!.hasAttribute("disabled")).toBe(true);

    q(el, "[data-test=deactivate-printer-p1]")!.click();
    await flush(el);
    expect(api.deactivatePrinter).not.toHaveBeenCalled();
    expect(text(el, "[data-test=deactivate-printer-p1]")).toBe(t("printers.delete_confirm"));
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
    expect(api.deactivatePrinter).not.toHaveBeenCalled();
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
  q(el, '[data-test="register-10.0.0.77:9100"]')!.click();
  await flush(el);
  expect(api.createPrinter).toHaveBeenCalledOnce();
  expect(q(el, '[data-test="register-10.0.0.77:9100"]')).toBeNull();
  expect(q(el, '[data-test="discovered-row-10.0.0.77:9100"]')).toBeNull();
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
  q(el, "[data-test=register-SN-1]")!.click();
  await flush(el);
  q(el, "[data-test=register-SN-1]")!.click();
  expect(createPrinter).toHaveBeenCalledOnce();
  q(el, "[data-test=test-print-p1]")!.click();
  await flush(el);
  expect(api.testPrint).toHaveBeenCalledExactlyOnceWith("p1");
  q(el, "[data-test=register-SN-1]")!.click();
  expect(createPrinter).toHaveBeenCalledOnce();
  expect(q(el, "[data-test=register-SN-1]")!.shadowRoot!.querySelector("button")!.disabled).toBe(
    true,
  );
  reject({ code: "management.request_invalid" });
  await flush(el);
  q(el, "[data-test=register-SN-1]")!.click();
  await flush(el);
  expect(createPrinter).toHaveBeenCalledTimes(2);
});

it.each([
  [1280, 900],
  [390, 844],
  [844, 390],
])(
  "keeps each discovered printer's Add button visible within the portrait modal at %i × %i",
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
  // The registered list carries the status from the very first load, not only after a Scan — the
  // instant formatted to the minute (UTC) like every other last-seen on this screen.
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

it("keeps the delete confirmation menu open and disarms another printer", async () => {
  const api = stubApi({
    listPrinters: vi
      .fn()
      .mockResolvedValue(printers.map((printer) => ({ ...printer, active: true }))),
  });
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await flush(el);
  const first = q(el, "[data-test=deactivate-printer-p1]")!;
  const menu = first.closest("dashboard-row-actions")!;
  menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  first.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  await flush(el);
  expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  expect(api.deactivatePrinter).not.toHaveBeenCalled();
  q(el, "[data-test=deactivate-printer-p2]")!.click();
  await flush(el);
  expect(text(el, "[data-test=deactivate-printer-p1]")).toBe(t("printers.disable"));
  q(el, "[data-test=deactivate-printer-p1]")!.click();
  await flush(el);
  expect(api.deactivatePrinter).not.toHaveBeenCalled();
  q(el, "[data-test=test-print-p1]")!.click();
  await flush(el);
  expect(text(el, "[data-test=deactivate-printer-p1]")).toBe(t("printers.disable"));
});

it("defaults to active printers and filters disabled and all registrations", async () => {
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api: stubApi() });
  await flush(el);
  expect(q(el, "[data-test=printer-row-p1]")).not.toBeNull();
  expect(q(el, "[data-test=printer-row-p2]")).toBeNull();
  const select = q(el, '[name="printer-status-filter"]') as HTMLSelectElement;
  expect(select.value).toBe("active");
  select.value = "disabled";
  select.dispatchEvent(new Event("change"));
  await flush(el);
  expect(q(el, "[data-test=printer-row-p1]")).toBeNull();
  expect(q(el, "[data-test=printer-row-p2]")).not.toBeNull();
  select.value = "all";
  select.dispatchEvent(new Event("change"));
  await flush(el);
  for (const id of ["p1", "p2", "p3"])
    expect(q(el, `[data-test="printer-row-${id}"]`)).not.toBeNull();
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
    add.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p3", { active: true });
    expect(api.createPrinter).not.toHaveBeenCalled();
    expect(q(el, `[data-test="register-${key}"]`)).toBeNull();
    expect(text(el, "[data-test=printer-row-p3]")).toContain("Saved kitchen name");
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
  q(el, "[data-test=register-SN-2]")!.click();
  await flush(el);
  expect(api.createPrinter).not.toHaveBeenCalled();
  expect(q(el, "[data-test=register-SN-2]")).not.toBeNull();
  expect(text(el, "[role=alert]")).toContain(codeMessage("printer.not_found"));
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
  "makes the Add %s modal half again as wide on desktop",
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
  q(el, "[data-test=register-SN-1]")!.click();
  await flush(el);
  q(el, "[data-test=cancel-new-printer]")!.click();
  await flush(el);
  q(el, "[data-test=deactivate-printer-p9]")!.click();
  await flush(el);
  q(el, "[data-test=deactivate-printer-p9]")!.click();
  await flush(el);
  await openDiscovery(el);
  expect(text(el, "[data-test=register-SN-1]")).toBe(t("printers.add_again"));
  q(el, "[data-test=register-SN-1]")!.click();
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
