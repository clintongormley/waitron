import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { jobStatusName, transportName } from "../i18n/domain.js";
import type { DashboardApi, PrintAgentRow, PrintJobRow, Printer } from "../api/client.js";
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

  it("creates a network_tcp printer with the picked agent, host and port, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=new-printer-name]", "Barra");
    pickSelect(el, "[data-test=new-transport]", "network_tcp");
    await el.updateComplete;
    pickSelect(el, "[data-test=new-agent]", "a1");
    typeField(el, "[data-test=new-host]", "10.0.0.50");
    typeField(el, "[data-test=new-port]", "9200");
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
    expect(api.listPrinters).toHaveBeenCalledTimes(2);
  });

  it("creates a usb printer with an agent and a device path", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=new-printer-name]", "USB");
    pickSelect(el, "[data-test=new-transport]", "usb");
    await el.updateComplete;
    pickSelect(el, "[data-test=new-agent]", "a1");
    typeField(el, "[data-test=new-usb-path]", "/dev/usb/lp0");
    await el.updateComplete;
    q(el, "[data-test=add-printer]")!.click();
    await flush(el);

    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "USB",
      transport: "usb",
      agentId: "a1",
      usbPath: "/dev/usb/lp0",
    });
  });

  it("creates a cloud_poll printer with a poll id and no agent", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=new-printer-name]", "Nube 2");
    pickSelect(el, "[data-test=new-transport]", "cloud_poll");
    typeField(el, "[data-test=new-poll-id]", "poll-9");
    await el.updateComplete;
    q(el, "[data-test=add-printer]")!.click();
    await flush(el);

    expect(api.createPrinter).toHaveBeenCalledWith({
      name: "Nube 2",
      transport: "cloud_poll",
      pollId: "poll-9",
    });
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

  it("saves an edited printer's current field values and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=printer-name-p1]", "Cocina 2");
    typeField(el, "[data-test=printer-host-p1]", "10.0.0.20");
    typeField(el, "[data-test=printer-port-p1]", "9300");
    toggleSwitch(el, "[data-test=printer-ticket-scope-p1]", true); // → "order"
    await el.updateComplete;
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
      name: "Cocina 2",
      host: "10.0.0.20",
      port: 9300,
      usbPath: null,
      pollId: null,
      ticketScope: "order",
      active: true,
    });
    expect(api.listPrinters).toHaveBeenCalledTimes(2);
  });

  it("saves edited usb-path and poll-id connection fields as non-null values", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);

    typeField(el, "[data-test=printer-usb-path-p1]", "/dev/usb/lp1");
    typeField(el, "[data-test=printer-poll-id-p1]", "poll-x");
    await el.updateComplete;
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);

    expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
      name: "Cocina",
      host: "10.0.0.9",
      port: 9100,
      usbPath: "/dev/usb/lp1",
      pollId: "poll-x",
      ticketScope: "station",
      active: true,
    });
  });

  it("reactivates a deactivated printer and clears its empty connection fields to null", async () => {
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
      host: null,
      port: null,
      usbPath: null,
      pollId: "poll-1",
      ticketScope: "station",
      active: true,
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

  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-printers-screen")).toBe(PrintersScreen);
  });
});
