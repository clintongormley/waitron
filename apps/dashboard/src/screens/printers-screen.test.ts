import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { jobStatusName, transportName } from "../i18n/domain.js";
import type {
  DashboardApi,
  LocationSummary,
  PrintAgentRow,
  PrintJobRow,
  Printer,
  Station,
  StationPrinter,
  Till,
} from "../api/client.js";
import { PrintersScreen } from "./printers-screen.js";

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

const agents: PrintAgentRow[] = [
  {
    id: "a1",
    name: "Cocina agent",
    active: true,
    lastSeenAt: "2026-08-25T14:30:00.000Z",
    enrolledAt: "2026-08-20T09:00:00.000Z",
  },
  {
    id: "a2",
    name: "Barra agent",
    active: false,
    lastSeenAt: null,
    enrolledAt: "2026-08-19T09:00:00.000Z",
  },
];

const printers: Printer[] = [
  {
    id: "p1",
    name: "Cocina",
    transport: "network_tcp",
    agentId: "a1",
    host: "10.0.0.9",
    port: 9100,
    usbPath: null,
    pollId: null,
    ticketScope: "station",
    active: true,
  },
  {
    id: "p2",
    name: "Nube",
    transport: "cloud_poll",
    agentId: null,
    host: null,
    port: null,
    usbPath: null,
    pollId: "poll-1",
    ticketScope: "station",
    active: false,
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

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listAgents: vi.fn().mockResolvedValue(agents),
    listPrinters: vi.fn().mockResolvedValue(printers),
    listRecentJobs: vi.fn().mockResolvedValue(jobs),
    createAgentCode: vi.fn().mockResolvedValue({ code: "ABCD2345" }),
    revokeAgent: vi.fn().mockResolvedValue(undefined),
    createPrinter: vi.fn().mockResolvedValue({ id: "p9" }),
    updatePrinter: vi.fn().mockResolvedValue(undefined),
    deactivatePrinter: vi.fn().mockResolvedValue(undefined),
    testPrint: vi.fn().mockResolvedValue({ jobId: "j9" }),
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

  it("renders printer transport, bound agent (and the no-agent placeholder) and connection", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=printer-transport-p1]")).toBe(
      transportName("network_tcp", "es-ES"),
    );
    expect(text(el, "[data-test=printer-agent-p1]")).toBe("Cocina agent");
    // A cloud_poll printer has no agent → the neutral placeholder.
    expect(text(el, "[data-test=printer-agent-p2]")).toBe(t("printers.no_agent", "es-ES"));
    expect(text(el, "[data-test=printer-transport-p2]")).toBe(transportName("cloud_poll", "es-ES"));
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

  // ── Agents: mint a pairing code (shown once) ─────────────────────────────────────────────────────

  it("generates an agent pairing code, shows it once, and reloads the agents", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=agent-label]", "Cocina agent");
    await el.updateComplete;
    q(el, "[data-test=generate-code]")!.click();
    await flush(el);

    expect(api.createAgentCode).toHaveBeenCalledWith("Cocina agent");
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();
    expect(text(el, "[data-test=code-value]")).toBe("ABCD2345");
    // Generating reloads so a newly-enrolled agent would appear.
    expect(api.listAgents).toHaveBeenCalledTimes(2);
  });

  it("does not generate a code when the label is blank", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=agent-label]", "   ");
    await el.updateComplete;
    q(el, "[data-test=generate-code]")!.click();
    await flush(el);

    expect(api.createAgentCode).not.toHaveBeenCalled();
    expect(q(el, "[data-test=code-panel]")).toBeNull();
  });

  it("clears the shown-once code on dismiss and never re-fetches it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=agent-label]", "Agente");
    await el.updateComplete;
    q(el, "[data-test=generate-code]")!.click();
    await flush(el);
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();

    q(el, "[data-test=dismiss-code]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=code-panel]")).toBeNull();
    expect(api.createAgentCode).toHaveBeenCalledTimes(1);
  });

  it("copies the shown code to the clipboard and confirms with a Copied status", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=agent-label]", "Agente");
    await el.updateComplete;
    q(el, "[data-test=generate-code]")!.click();
    await flush(el);
    q(el, "[data-test=copy-code]")!.click();
    await flush(el);

    expect(writeText).toHaveBeenCalledWith("ABCD2345");
    expect(text(el, "[data-test=copied]")).toBe(t("printers.copied", "es-ES"));
  });

  it("does not throw or confirm when the clipboard write is rejected", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=agent-label]", "Agente");
    await el.updateComplete;
    q(el, "[data-test=generate-code]")!.click();
    await flush(el);
    q(el, "[data-test=copy-code]")!.click();
    await flush(el);

    expect(q(el, "[data-test=copied]")).toBeNull();
    expect(q(el, "[data-test=code-panel]")).toBeTruthy();
  });

  it("shows an error and no code panel when generate is rejected", async () => {
    const api = stubApi({
      createAgentCode: vi.fn().mockRejectedValue({ code: "management.request_invalid" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=agent-label]", "Agente");
    await el.updateComplete;
    q(el, "[data-test=generate-code]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "management.request_invalid",
    );
    expect(q(el, "[data-test=code-panel]")).toBeNull();
    expect(api.listAgents).toHaveBeenCalledTimes(1); // NOT reloaded
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

  // ── Printers: create ─────────────────────────────────────────────────────────────────────────────

  it("creates a network_tcp printer with only host+port, never usbPath or pollId, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=new-printer-name]", "Barra");
    pickSelect(el, "[data-test=new-transport]", "network_tcp");
    await el.updateComplete;
    pickSelect(el, "[data-test=new-agent]", "a1");
    typeField(el, "[data-test=new-host]", "10.0.0.50");
    typeField(el, "[data-test=new-port]", "9200");
    // The form renders every transport's connection inputs. Type into the OTHER transports' fields
    // too: the fix must scope the payload to network_tcp and NOT forward a stray usb_path / poll_id
    // (the Copilot finding — the DB CHECK asserts required fields are present but does not forbid
    // extras, so a stray field would persist as meaningless config). Pre-fix these WOULD have been sent.
    typeField(el, "[data-test=new-usb-path]", "/dev/usb/lp0");
    typeField(el, "[data-test=new-poll-id]", "poll-stray");
    await el.updateComplete;
    q(el, "[data-test=add-printer]")!.click();
    await flush(el);

    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "Barra",
      transport: "network_tcp",
      agentId: "a1",
      host: "10.0.0.50",
      port: 9200,
    });
    const arg = vi.mocked(api.createPrinter).mock.calls[0]![0];
    expect(arg).not.toHaveProperty("usbPath");
    expect(arg).not.toHaveProperty("pollId");
    expect(api.listPrinters).toHaveBeenCalledTimes(2);
  });

  it("creates a usb printer with only usbPath, never host/port/pollId", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=new-printer-name]", "USB");
    pickSelect(el, "[data-test=new-transport]", "usb");
    await el.updateComplete;
    pickSelect(el, "[data-test=new-agent]", "a1");
    typeField(el, "[data-test=new-usb-path]", "/dev/usb/lp0");
    // Stray fields the form still renders — must NOT be forwarded onto a usb printer (see above).
    typeField(el, "[data-test=new-host]", "10.0.0.99");
    typeField(el, "[data-test=new-port]", "9100");
    typeField(el, "[data-test=new-poll-id]", "poll-stray");
    await el.updateComplete;
    q(el, "[data-test=add-printer]")!.click();
    await flush(el);

    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "USB",
      transport: "usb",
      agentId: "a1",
      usbPath: "/dev/usb/lp0",
    });
    const arg = vi.mocked(api.createPrinter).mock.calls[0]![0];
    expect(arg).not.toHaveProperty("host");
    expect(arg).not.toHaveProperty("port");
    expect(arg).not.toHaveProperty("pollId");
  });

  it("offers only network_tcp and usb in the create-form transport selector (no cloud_poll)", async () => {
    // cloud_poll has no delivery path in this slice (the agent router rejects it — a documented
    // fast-follow), so the CREATE form must not offer it: a cloud_poll printer created here would accept
    // undeliverable jobs. The enum/schema/display still forward-carry cloud_poll (see the p2 fixture
    // render above); only the create dropdown drops it.
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    const options = Array.from(q(el, "[data-test=new-transport]")!.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toEqual(["network_tcp", "usb"]);
    expect(options).not.toContain("cloud_poll");
  });

  it("does not create a printer when the name is blank", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=new-printer-name]", "   ");
    await el.updateComplete;
    q(el, "[data-test=add-printer]")!.click();
    await flush(el);

    expect(api.createPrinter).not.toHaveBeenCalled();
  });

  it("surfaces printer.invalid_config as an accessible error when a transport field is missing", async () => {
    // usb needs a device path; creating one without it is invalid config — the server rejects, the
    // screen shows the localised message in a role=alert banner (never the raw wire code).
    const api = stubApi({
      createPrinter: vi.fn().mockRejectedValue({ code: "printer.invalid_config" }),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=new-printer-name]", "Bad USB");
    pickSelect(el, "[data-test=new-transport]", "usb");
    await el.updateComplete;
    q(el, "[data-test=add-printer]")!.click();
    await flush(el);

    const banner = q(el, "[role=alert]");
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain(codeMessage("printer.invalid_config", "es-ES"));
    expect(banner!.textContent).not.toContain("printer.invalid_config");
  });

  // ── Printers: edit / deactivate / test-print ─────────────────────────────────────────────────────

  it("saves an edited network_tcp printer's host+port (never usbPath/pollId) and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    // p1 is network_tcp. Type into the usb-path and poll-id inputs the row still renders — the fix
    // must scope the PATCH to network_tcp and NOT forward them (the Copilot finding). Pre-fix both
    // usbPath and pollId WOULD have been included in the payload.
    typeField(el, "[data-test=printer-name-p1]", "Cocina 2");
    typeField(el, "[data-test=printer-host-p1]", "10.0.0.20");
    typeField(el, "[data-test=printer-port-p1]", "9300");
    typeField(el, "[data-test=printer-usb-path-p1]", "/dev/usb/lp1");
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
    expect(patch).not.toHaveProperty("usbPath");
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

  it("saves an edited usb printer's usbPath (never host/port/pollId)", async () => {
    const usb: Printer = {
      id: "p3",
      name: "USB",
      transport: "usb",
      agentId: "a1",
      host: null,
      port: null,
      usbPath: "/dev/usb/lp0",
      pollId: null,
      ticketScope: "station",
      active: true,
    };
    const api = stubApi({ listPrinters: vi.fn().mockResolvedValue([usb]) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=printer-usb-path-p3]", "/dev/usb/lp9");
    // Stray fields the row renders — must NOT be forwarded onto a usb printer's PATCH.
    typeField(el, "[data-test=printer-host-p3]", "10.0.0.1");
    typeField(el, "[data-test=printer-poll-id-p3]", "poll-y");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p3]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p3", {
      name: "USB",
      usbPath: "/dev/usb/lp9",
      ticketScope: "station",
      active: true,
    });
    const [, patch] = vi.mocked(api.updatePrinter).mock.calls[0]!;
    expect(patch).not.toHaveProperty("host");
    expect(patch).not.toHaveProperty("port");
    expect(patch).not.toHaveProperty("pollId");
  });

  it("clears an edited usb printer's emptied usbPath to null", async () => {
    const usb: Printer = {
      id: "p3",
      name: "USB",
      transport: "usb",
      agentId: "a1",
      host: null,
      port: null,
      usbPath: "/dev/usb/lp0",
      pollId: null,
      ticketScope: "station",
      active: true,
    };
    const api = stubApi({ listPrinters: vi.fn().mockResolvedValue([usb]) });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=printer-usb-path-p3]", "");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p3]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p3", {
      name: "USB",
      usbPath: null,
      ticketScope: "station",
      active: true,
    });
  });

  it("reactivates a cloud_poll printer sending only its pollId (never host/port/usbPath)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    // p2 is cloud_poll + inactive: host/port/usbPath are empty, pollId is "poll-1".
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
    expect(patch).not.toHaveProperty("usbPath");
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
