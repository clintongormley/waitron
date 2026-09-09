import { expect, afterEach, describe, it, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import "./printers-screen.js";
import type { PrintersScreen } from "./printers-screen.js";
import type {
  DashboardApi,
  JoinRequestRow,
  LocationSummary,
  PrintAgentRow,
  PrintJobRow,
  Printer,
  Station,
  StationPrinter,
  Till,
} from "../api/client.js";

/**
 * The Impresoras screen scanned by axe in both themes, in three states: the default agents + printers +
 * jobs lists with their forms and a print agent waiting to join (the pairing window shut), the pairing
 * window OPEN, and the accept dialog with its three number buttons. Mounted by ASSIGNING the `api` STUB
 * as a property (never bare markup), exactly as the sibling screen a11y suites do: `connectedCallback`
 * fires `void this.#load()` → the list verbs plus `pairingMode()` + `joinRequests("print_agent")`, so
 * the stub must resolve them all or a stray rejection pollutes the run (a rejection is a finding).
 *
 * The last block is not about theme: it pins that each number button carries a real accessible NAME
 * ("Number 47", never a bare "47" — design §1.2 wants the comparison to be a deliberate act), and that
 * the dialog can be both reached and operated from the keyboard alone.
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

// Two live stations so the per-printer "stations this printer serves" section renders under axe (a
// group with a labelled toggle each). `p1` is attached to `s1`, so both a checked and an unchecked
// toggle sit in the a11y tree.
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

// Two tills (one with a printer set, one without) + a location, so the receipt-printer picker + the
// per-location print-mode toggle both render under axe (a labelled <select> each, a segmented control).
const tills: Till[] = [
  { id: "t1", label: "Caja 1", locationId: "loc-1", receiptPrinterId: "p1" },
  { id: "t2", label: "Caja 2", locationId: "loc-1", receiptPrinterId: null },
];
const locations: LocationSummary[] = [{ id: "loc-1", name: "Barra" }];

// Two discovered USB devices — one unregistered (its name field + Register action render) and one
// already-registered (its "Registered" marker renders) — so the usb/bluetooth create surface is in the
// a11y tree. Typed loosely (the stub is cast to DashboardApi), the shape matching DiscoveredPrinter.
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
    listStations: vi.fn().mockResolvedValue(stations),
    listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
      printerId === "p1" ? [{ stationId: "s1", printerId: "p1" }] : [],
    ),
    attachPrinterToStation: vi.fn().mockResolvedValue(undefined),
    detachPrinterFromStation: vi.fn().mockResolvedValue(undefined),
    listTills: vi.fn().mockResolvedValue(tills),
    getLocations: vi.fn().mockResolvedValue(locations),
    setTillReceiptPrinter: vi.fn().mockResolvedValue(undefined),
    setReceiptPrintMode: vi.fn().mockResolvedValue(undefined),
    setDrawerOpenPolicy: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

/** Settles the in-flight load and the follow-up render. */
async function flush(el: PrintersScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
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
    await expectNoA11yViolations(host);
  });

  it("renders the open pairing window accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi(true) },
      theme,
    );
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
    // Open the waiting row so the modal dialog and its three number buttons are in the a11y tree.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=join-review-j1]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the usb + bluetooth discovered-device create surfaces accessibly", async () => {
    const { el, host } = await mountWidget<PrintersScreen>(
      "dashboard-printers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);

    // USB: the discovered list is in the a11y tree — an unregistered row's name field + Register
    // button (a labelled control pair) and an already-registered row's "Registered" marker.
    const transport = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=new-transport]")!;
    transport.value = "usb";
    transport.dispatchEvent(new Event("change"));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=register-SN-1]")).toBeTruthy();
    expect(el.shadowRoot!.querySelector("[data-test=discovered-registered-SN-2]")).toBeTruthy();
    await expectNoA11yViolations(host);

    // Bluetooth: the pairing note + Refresh action + the (filtered-empty) discovered placeholder.
    transport.value = "bluetooth";
    transport.dispatchEvent(new Event("change"));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=bluetooth-pair-note]")).toBeTruthy();
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=join-review-j1]")!.click();
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

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=join-review-j1]")!.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=join-dialog]")).toBeTruthy();

    el.shadowRoot!.querySelector<HTMLElement>('[data-choice="47"]')!.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);

    expect(api.acceptPrintAgentJoinRequest).toHaveBeenCalledWith("j1", { choice: "47" });
  });
});
