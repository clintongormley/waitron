import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./printers-screen.js";
import type { PrintersScreen } from "./printers-screen.js";
import type { DashboardApi, PrintAgentRow, PrintJobRow, Printer } from "../api/client.js";

/**
 * The Impresoras screen scanned by axe in both themes, in two states: the default agents + printers +
 * jobs lists with their forms, and after a pairing code has been generated (the shown-once code panel).
 * Mounted by ASSIGNING the `api` STUB as a property (never bare markup), exactly as the sibling screen
 * a11y suites do: `connectedCallback` fires `void this.#load()` → `listAgents()` + `listPrinters()` +
 * `listRecentJobs()`, so the stub must resolve all three or a stray rejection pollutes the run (a
 * rejection is a finding).
 */
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
    ticketScope: "order",
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
];

function stubApi(): DashboardApi {
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
  } as unknown as DashboardApi;
}

/** Settles the in-flight load and the follow-up render. */
async function flush(el: PrintersScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("printers-screen a11y (%s theme)", (theme) => {
  it("renders the agents, printers and jobs lists with their forms accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the shown-once pairing-code panel accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    // Type a label and generate a code so the shown-once panel is in the a11y tree.
    el.shadowRoot!.querySelector("[data-test=agent-label]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Nuevo agente" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=generate-code]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
