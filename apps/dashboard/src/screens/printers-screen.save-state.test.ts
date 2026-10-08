import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { chooseOption as pickOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import type { DashboardApi, DiscoveredPrinter, PrintAgentRow, Printer } from "../api/client.js";
import "./printers-screen.js";
import type { PrintersScreen } from "./printers-screen.js";

afterEach(cleanupWidgets);
beforeEach(() => {
  sessionStorage.removeItem("printers:agents");
  sessionStorage.removeItem("printers:table");
  history.replaceState(null, "", "/manage/printers");
});

const agent: PrintAgentRow = {
  id: "a1",
  name: "Cocina agent",
  active: true,
  host: "kitchen-pi",
  nodeId: null,
  lastSeenAt: "2026-08-25T14:30:00.000Z",
  setupUrl: null,
  enrolledAt: "2026-08-20T09:00:00.000Z",
};

// Every field the page's editors show holds something, in the shapes the printer list returns —
// the port as a number — so a field that rewrites its value on first draw would show as a change.
const printer: Printer = {
  id: "p1",
  name: "Cocina",
  transport: "network_tcp",
  host: "10.0.0.9",
  port: 9100,
  localKey: null,
  pollId: null,
  watcherId: null,
  paperWidth: "80mm",
  resolution: "180dpi",
  hasCashDrawer: false,
  portable: false,
  holder: null,
  pendingJobs: 0,
  lastPrintAt: null,
  lastPrintAgentId: null,
  active: true,
};

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listAgents: vi.fn().mockResolvedValue([agent]),
    listPrinters: vi.fn().mockResolvedValue([printer]),
    listRecentJobs: vi.fn().mockResolvedValue([]),
    listPrinterProfiles: vi.fn().mockResolvedValue([]),
    listDiscoveredPrinters: vi.fn().mockResolvedValue([]),
    pairingMode: vi.fn().mockResolvedValue({
      open: false,
      openUntil: null,
      deviceAddress: "https://waitron.local",
    }),
    joinRequests: vi.fn().mockResolvedValue([]),
    updateAgent: vi.fn().mockResolvedValue(undefined),
    updatePrinter: vi.fn().mockResolvedValue(undefined),
    createPrinter: vi.fn().mockResolvedValue({ id: "p5" }),
    deactivatePrinter: vi.fn().mockResolvedValue(undefined),
    startPrinterDiscovery: vi.fn().mockResolvedValue({ discoveryUntil: Date.now() + 60_000 }),
    renewPrinterDiscovery: vi.fn().mockResolvedValue({ discoveryUntil: Date.now() + 180_000 }),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Row menus draw inside the table's shadow root, so a lookup searches every shadow root below. */
function deepQuery<T extends HTMLElement>(root: ShadowRoot, selector: string): T | null {
  const found = root.querySelector<T>(selector);
  if (found) return found;
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    const nested = node.shadowRoot ? deepQuery<T>(node.shadowRoot, selector) : null;
    if (nested) return nested;
  }
  return null;
}
const q = <T extends HTMLElement = HTMLElement>(el: PrintersScreen, selector: string) =>
  deepQuery<T>(el.shadowRoot!, selector);

const action = (el: PrintersScreen, test: string) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test=${test}]`)!;

/** What the action looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: PrintersScreen, test: string) {
  await el.updateComplete;
  const button = action(el, test);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.disabled,
    innerDisabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A real pointer press on the inner button; `force` presses a disabled one too. `force` also skips
 * the wait for the button to stop moving, and the connection section grows open with a transition,
 * so the press waits for two frames in which the button stays put. */
async function press(el: PrintersScreen, test: string) {
  const button = action(el, test).shadowRoot!.querySelector("button")!;
  let before = "";
  for (;;) {
    await frame();
    const now = JSON.stringify(button.getBoundingClientRect());
    if (now === before) break;
    before = now;
  }
  await userEvent.click(page.elementLocator(button), { force: true });
  await el.updateComplete;
}

async function typeInto(el: PrintersScreen, selector: string, value: string) {
  const field = q<HTMLElementTagNameMap["wt-input"]>(el, selector)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Nothing a press of an untouched Save could have shown: no field error and no alert. */
function noComplaint(el: PrintersScreen) {
  for (const field of el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>(
    "wt-input",
  ))
    expect(field.error ?? "").toBe("");
  expect(q(el, "[role=alert]")).toBeNull();
}

async function openAgent(api: DashboardApi = stubApi()) {
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await vi.waitFor(() => expect(q(el, "[data-test=edit-agent-a1]")).not.toBeNull());
  q(el, "[data-test=edit-agent-a1]")!.click();
  await vi.waitFor(() => expect(q(el, "[data-test=save-agent]")).not.toBeNull());
  return { el, api };
}

async function openDetail(owner: "name" | "connection", api: DashboardApi = stubApi()) {
  history.replaceState(null, "", "/manage/printers/view/printers/printer/p1");
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await vi.waitFor(() => expect(q(el, `[data-test=edit-printer-${owner}]`)).not.toBeNull());
  if (owner === "connection") {
    const disclosure = q<HTMLElementTagNameMap["wt-disclosure"]>(
      el,
      "[data-test=printer-section-connection]",
    )!;
    await disclosure.updateComplete;
    disclosure.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    await el.updateComplete;
  }
  q(el, `[data-test=edit-printer-${owner}]`)!.click();
  await vi.waitFor(() => expect(q(el, `[data-test=save-printer-${owner}]`)).not.toBeNull());
  return { el, api };
}

describe("the agent editor's Save", () => {
  it("opens on the agent's name with Save quiet, and a press sends nothing", async () => {
    const { el, api } = await openAgent();
    expect(q<HTMLElementTagNameMap["wt-input"]>(el, "[data-test=edit-agent-name]")!.value).toBe(
      "Cocina agent",
    );
    expect(await state(el, "save-agent")).toEqual(quiet);
    await press(el, "save-agent");
    await settle();
    expect(api.updateAgent).not.toHaveBeenCalled();
    expect(q(el, "[data-test=edit-agent-modal]")).not.toBeNull();
    noComplaint(el);
  });

  it("one edit wakes Save, and typing the name back quiets it", async () => {
    const { el } = await openAgent();
    await typeInto(el, "[data-test=edit-agent-name]", "Kitchen Pi");
    expect(await state(el, "save-agent")).toEqual(ready);
    await typeInto(el, "[data-test=edit-agent-name]", "Cocina agent");
    expect(await state(el, "save-agent")).toEqual(quiet);
    await typeInto(el, "[data-test=edit-agent-name]", " Cocina agent ");
    expect(await state(el, "save-agent")).toEqual(quiet);
  });

  it("a press that reaches an untouched Save's handler sends nothing and marks nothing", async () => {
    const { el, api } = await openAgent();
    // A host `.click()` reaches the listener even while the inner button is disabled.
    action(el, "save-agent").click();
    await el.updateComplete;
    await settle();
    expect(api.updateAgent).not.toHaveBeenCalled();
    noComplaint(el);
  });

  it("a press after one edit sends it", async () => {
    const { el, api } = await openAgent();
    await typeInto(el, "[data-test=edit-agent-name]", "Kitchen Pi");
    await press(el, "save-agent");
    await vi.waitFor(() =>
      expect(api.updateAgent).toHaveBeenCalledExactlyOnceWith("a1", { name: "Kitchen Pi" }),
    );
  });

  it("an edit made while the save is in flight keeps the editor open, measured from what was sent", async () => {
    let finish!: () => void;
    const api = stubApi({
      updateAgent: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { el } = await openAgent(api);
    await typeInto(el, "[data-test=edit-agent-name]", "Kitchen Pi");
    await press(el, "save-agent");
    await vi.waitFor(() => expect(typeof finish).toBe("function"));
    // The field is locked while the save runs, so the edit arrives as the field reports one.
    q(el, "[data-test=edit-agent-name]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Kitchen Pi 2" }, bubbles: true }),
    );
    finish();
    await vi.waitFor(async () => expect(await state(el, "save-agent")).toEqual(ready));
    expect(q(el, "[data-test=edit-agent-modal]")).not.toBeNull();
    await typeInto(el, "[data-test=edit-agent-name]", "Kitchen Pi");
    expect(await state(el, "save-agent")).toEqual(quiet);
  });

  it("a name emptied by an edit keeps Save drawn as a change but unpressable once tried", async () => {
    const { el } = await openAgent();
    await typeInto(el, "[data-test=edit-agent-name]", "");
    expect(await state(el, "save-agent")).toEqual(ready);
    await press(el, "save-agent");
    expect(await state(el, "save-agent")).toEqual(blocked);
  });
});

describe("the printer page's name editor Save", () => {
  it("opens on the printer's name with Save quiet, and a press sends nothing", async () => {
    const { el, api } = await openDetail("name");
    expect(q<HTMLElementTagNameMap["wt-input"]>(el, "[name=printer-detail-name]")!.value).toBe(
      "Cocina",
    );
    expect(await state(el, "save-printer-name")).toEqual(quiet);
    await press(el, "save-printer-name");
    await settle();
    expect(api.updatePrinter).not.toHaveBeenCalled();
    expect(q(el, "[data-test=save-printer-name]")).not.toBeNull();
    noComplaint(el);
  });

  it("one edit wakes Save, typing the name back quiets it, and an emptied name blocks it", async () => {
    const { el } = await openDetail("name");
    await typeInto(el, "[name=printer-detail-name]", "Cocina 2");
    expect(await state(el, "save-printer-name")).toEqual(ready);
    await typeInto(el, "[name=printer-detail-name]", " Cocina ");
    expect(await state(el, "save-printer-name")).toEqual(quiet);
    await typeInto(el, "[name=printer-detail-name]", "");
    expect(await state(el, "save-printer-name")).toEqual(blocked);
  });

  it("a press that reaches an untouched Save's handler sends nothing", async () => {
    const { el, api } = await openDetail("name");
    action(el, "save-printer-name").click();
    await el.updateComplete;
    await settle();
    expect(api.updatePrinter).not.toHaveBeenCalled();
    noComplaint(el);
  });

  it("a press after one edit sends it", async () => {
    const { el, api } = await openDetail("name");
    await typeInto(el, "[name=printer-detail-name]", "Cocina 2");
    await press(el, "save-printer-name");
    await vi.waitFor(() =>
      expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p1", { name: "Cocina 2" }),
    );
  });

  it("an edit made while the save is in flight keeps the editor open, measured from what was sent", async () => {
    let finish!: () => void;
    const api = stubApi({
      updatePrinter: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { el } = await openDetail("name", api);
    await typeInto(el, "[name=printer-detail-name]", "Cocina 2");
    await press(el, "save-printer-name");
    await vi.waitFor(() => expect(typeof finish).toBe("function"));
    q(el, "[name=printer-detail-name]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Cocina 3" }, bubbles: true }),
    );
    finish();
    await vi.waitFor(async () => expect(await state(el, "save-printer-name")).toEqual(ready));
    await typeInto(el, "[name=printer-detail-name]", "Cocina 2");
    expect(await state(el, "save-printer-name")).toEqual(quiet);
  });
});

describe("the printer page's connection editor Save", () => {
  it("opens on the printer's address with Save quiet, and a press sends nothing", async () => {
    const { el, api } = await openDetail("connection");
    expect(q<HTMLElementTagNameMap["wt-input"]>(el, "[name=printer-detail-host]")!.value).toBe(
      "10.0.0.9",
    );
    expect(q<HTMLElementTagNameMap["wt-input"]>(el, "[name=printer-detail-port]")!.value).toBe(
      "9100",
    );
    expect(await state(el, "save-printer-connection")).toEqual(quiet);
    await press(el, "save-printer-connection");
    await settle();
    expect(api.updatePrinter).not.toHaveBeenCalled();
    noComplaint(el);
  });

  it.each([
    ["the host", "[name=printer-detail-host]", "10.0.0.10", "10.0.0.9"],
    ["the port", "[name=printer-detail-port]", "9101", "9100"],
    ["the port, back in another spelling", "[name=printer-detail-port]", "9101", "09100"],
  ])(
    "one edit to %s wakes Save, and putting the stored value back quiets it",
    async (_, selector, edit, revert) => {
      const { el } = await openDetail("connection");
      await typeInto(el, selector, edit);
      expect(await state(el, "save-printer-connection")).toEqual(ready);
      await typeInto(el, selector, revert);
      expect(await state(el, "save-printer-connection")).toEqual(quiet);
    },
  );

  it("a port its own check refuses keeps Save drawn as a change but unpressable", async () => {
    const { el } = await openDetail("connection");
    await typeInto(el, "[name=printer-detail-port]", "70000");
    expect(await state(el, "save-printer-connection")).toEqual(blocked);
  });

  it("a press that reaches an untouched Save's handler sends nothing", async () => {
    const { el, api } = await openDetail("connection");
    action(el, "save-printer-connection").click();
    await el.updateComplete;
    await settle();
    expect(api.updatePrinter).not.toHaveBeenCalled();
    noComplaint(el);
  });

  it("a press after one edit sends the edit and the field as it was read", async () => {
    const { el, api } = await openDetail("connection");
    await typeInto(el, "[name=printer-detail-host]", "10.0.0.10");
    await press(el, "save-printer-connection");
    await vi.waitFor(() =>
      expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p1", {
        host: "10.0.0.10",
        port: 9100,
      }),
    );
  });

  it("an edit made while the save is in flight keeps the editor open, measured from what was sent", async () => {
    let finish!: () => void;
    const api = stubApi({
      updatePrinter: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { el } = await openDetail("connection", api);
    await typeInto(el, "[name=printer-detail-host]", "10.0.0.10");
    await press(el, "save-printer-connection");
    await vi.waitFor(() => expect(typeof finish).toBe("function"));
    q(el, "[name=printer-detail-host]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "10.0.0.11" }, bubbles: true }),
    );
    finish();
    await vi.waitFor(async () => expect(await state(el, "save-printer-connection")).toEqual(ready));
    await typeInto(el, "[name=printer-detail-host]", "10.0.0.10");
    expect(await state(el, "save-printer-connection")).toEqual(quiet);
  });
});

/** Stored settings unlike the defaults a fresh add fills in, so a field that rewrites its value on
 * first draw would show as a change. */
const calibrated: Printer = {
  ...printer,
  paperWidth: "58mm",
  resolution: "203dpi",
  hasCashDrawer: true,
  portable: true,
};

async function openWizard(api: DashboardApi = stubApi()) {
  history.replaceState(null, "", "/manage/printers/view/printers/printer/p1");
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await vi.waitFor(() => expect(q(el, "[data-test=printer-section-calibration]")).not.toBeNull());
  const disclosure = q<HTMLElementTagNameMap["wt-disclosure"]>(
    el,
    "[data-test=printer-section-calibration]",
  )!;
  await disclosure.updateComplete;
  disclosure.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  await el.updateComplete;
  q(el, "[data-test=calibrate-printer-details]")!.click();
  await vi.waitFor(() => expect(q(el, "[data-test=calibration-step-1]")).not.toBeNull());
  return { el, api };
}

async function go(el: PrintersScreen, test: "calibration-next" | "calibration-back", times = 2) {
  for (let i = 0; i < times; i++) {
    action(el, test).click();
    await el.updateComplete;
  }
}

async function choose(el: PrintersScreen, name: string, value: string) {
  await pickOption(q(el, `wt-combobox[name="${name}"]`)!, value);
  await el.updateComplete;
}

async function toggle(el: PrintersScreen, name: string, checked: boolean) {
  const input = q(el, `[name="${name}"]`)!.shadowRoot!.querySelector("input")!;
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
}

const checkedOf = (el: PrintersScreen, name: string) =>
  (q(el, `[name="${name}"]`) as HTMLElement & { checked: boolean }).checked;
const valueOf = (el: PrintersScreen, name: string) =>
  (q(el, `wt-combobox[name="${name}"]`) as HTMLElement & { value: string }).value;

function pending() {
  let finish!: () => void;
  const answer = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { answer, finish: () => finish() };
}

describe("the calibration wizard's Save, for a printer already set up", () => {
  const api = () => stubApi({ listPrinters: vi.fn().mockResolvedValue([calibrated]) });

  it("reaches the last step with Save quiet on the stored settings, and a press sends nothing", async () => {
    const { el, api: stub } = await openWizard(api());
    expect(valueOf(el, "printer-paper-width")).toBe("58mm");
    expect(valueOf(el, "printer-resolution")).toBe("203dpi");
    await go(el, "calibration-next");
    expect(checkedOf(el, "printer-cash-drawer")).toBe(true);
    expect(checkedOf(el, "printer-portable")).toBe(true);
    expect(await state(el, "save-printer-p1")).toEqual(quiet);
    await press(el, "save-printer-p1");
    await settle();
    expect(stub.updatePrinter).not.toHaveBeenCalled();
    expect(q(el, "[data-test=edit-printer-modal]")).not.toBeNull();
    noComplaint(el);
  });

  it("a paper width changed on the first step wakes Save on the last, and changing it back quiets it", async () => {
    const { el } = await openWizard(api());
    await choose(el, "printer-paper-width", "80mm");
    await go(el, "calibration-next");
    expect(await state(el, "save-printer-p1")).toEqual(ready);
    await go(el, "calibration-back");
    await choose(el, "printer-paper-width", "58mm");
    await go(el, "calibration-next");
    expect(await state(el, "save-printer-p1")).toEqual(quiet);
  });

  it("a press that reaches an untouched Save's handler sends nothing", async () => {
    const { el, api: stub } = await openWizard(api());
    await go(el, "calibration-next");
    action(el, "save-printer-p1").click();
    await el.updateComplete;
    await settle();
    expect(stub.updatePrinter).not.toHaveBeenCalled();
    expect(q(el, "[data-test=edit-printer-modal]")).not.toBeNull();
    noComplaint(el);
  });

  it("a press after one change sends only that setting and closes the wizard", async () => {
    const { el, api: stub } = await openWizard(api());
    await go(el, "calibration-next");
    await toggle(el, "printer-portable", false);
    expect(await state(el, "save-printer-p1")).toEqual(ready);
    await press(el, "save-printer-p1");
    await vi.waitFor(() => expect(q(el, "[data-test=edit-printer-modal]")).toBeNull());
    expect(stub.updatePrinter).toHaveBeenCalledExactlyOnceWith("p1", { portable: false });
  });

  it("a change made while the save is in flight keeps the wizard open, measured from what was sent", async () => {
    const save = pending();
    const stub = api();
    vi.mocked(stub.updatePrinter).mockReturnValueOnce(save.answer);
    const { el } = await openWizard(stub);
    await go(el, "calibration-next");
    await toggle(el, "printer-portable", false);
    await press(el, "save-printer-p1");
    expect(stub.updatePrinter).toHaveBeenCalledExactlyOnceWith("p1", { portable: false });
    await toggle(el, "printer-cash-drawer", false);
    save.finish();
    await vi.waitFor(async () => expect(await state(el, "save-printer-p1")).toEqual(ready));
    expect(q(el, "[data-test=edit-printer-modal]")).not.toBeNull();
    await toggle(el, "printer-cash-drawer", true);
    expect(await state(el, "save-printer-p1")).toEqual(quiet);
  });
});

describe("the calibration wizard's Save, when an add opened it", () => {
  const unregistered: DiscoveredPrinter = {
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
  };
  // A switched-off registration whose stored settings differ from a fresh add's defaults.
  const switchedOff: Printer = {
    ...calibrated,
    id: "p3",
    name: "Barra USB",
    transport: "usb",
    host: null,
    port: null,
    localKey: "SN-2",
    portable: false,
    active: false,
  };
  const seenAgain: DiscoveredPrinter = {
    ...unregistered,
    localKey: "SN-2",
    make: "Star",
    model: "TSP143",
    name: null,
    alreadyRegistered: true,
    printerId: "p3",
  };

  async function addFromDiscovery(device: DiscoveredPrinter) {
    history.replaceState(null, "", "/manage/printers/view/printers");
    const api = stubApi({
      listPrinters: vi.fn().mockResolvedValue([printer, switchedOff]),
      listDiscoveredPrinters: vi.fn().mockResolvedValue([device]),
    });
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await vi.waitFor(() => expect(q(el, "[data-test=open-add-printer]")).not.toBeNull());
    q(el, "[data-test=open-add-printer]")!.click();
    await vi.waitFor(() => expect(q(el, `[data-test=register-${device.localKey}]`)).not.toBeNull());
    q(el, `[data-test=register-${device.localKey}]`)!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=confirm-add-printer]")).not.toBeNull());
    q(el, "[data-test=confirm-add-printer]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=calibration-step-1]")).not.toBeNull());
    await el.updateComplete;
    return { el, api };
  }

  it("re-adding a switched-off printer opens its wizard with Save ready, and an untouched press keeps it on", async () => {
    const { el, api } = await addFromDiscovery(seenAgain);
    expect(api.updatePrinter).toHaveBeenCalledExactlyOnceWith("p3", { active: true });
    expect(valueOf(el, "printer-paper-width")).toBe("58mm");
    await go(el, "calibration-next");
    expect(await state(el, "save-printer-p3")).toEqual(ready);
    await press(el, "save-printer-p3");
    await vi.waitFor(() => expect(q(el, "[data-test=edit-printer-modal]")).toBeNull());
    await settle();
    expect(api.updatePrinter).toHaveBeenCalledTimes(1);
    expect(api.deactivatePrinter).not.toHaveBeenCalled();
  });

  it("a re-added printer's Save stays ready while its save is in flight, even with the change undone", async () => {
    const { el, api } = await addFromDiscovery(seenAgain);
    const save = pending();
    vi.mocked(api.updatePrinter).mockReturnValueOnce(save.answer);
    await go(el, "calibration-next");
    await toggle(el, "printer-portable", true);
    await press(el, "save-printer-p3");
    expect(api.updatePrinter).toHaveBeenLastCalledWith("p3", { portable: true });
    // Back to the stored settings: unchanged from what the wizard opened on, but still an add.
    await toggle(el, "printer-portable", false);
    // A loading button's inner button is disabled, so the look is read from the host alone.
    expect(await state(el, "save-printer-p3")).toMatchObject({
      variant: "primary",
      disabled: false,
    });
    expect(action(el, "save-printer-p3").loading).toBe(true);
    save.finish();
    await vi.waitFor(() => expect(action(el, "save-printer-p3").loading).toBe(false));
    expect(q(el, "[data-test=edit-printer-modal]")).not.toBeNull();
    expect(await state(el, "save-printer-p3")).toEqual(ready);
    expect(api.deactivatePrinter).not.toHaveBeenCalled();
  });

  it("a re-added printer's wizard that a newer change keeps open turns quiet when that change is undone", async () => {
    const { el, api } = await addFromDiscovery(seenAgain);
    const save = pending();
    vi.mocked(api.updatePrinter).mockReturnValueOnce(save.answer);
    await go(el, "calibration-next");
    await toggle(el, "printer-portable", true);
    await press(el, "save-printer-p3");
    expect(api.updatePrinter).toHaveBeenLastCalledWith("p3", { portable: true });
    await toggle(el, "printer-cash-drawer", false);
    save.finish();
    await vi.waitFor(async () => expect(await state(el, "save-printer-p3")).toEqual(ready));
    expect(q(el, "[data-test=edit-printer-modal]")).not.toBeNull();
    await toggle(el, "printer-cash-drawer", true);
    expect(await state(el, "save-printer-p3")).toEqual(quiet);
    expect(api.deactivatePrinter).not.toHaveBeenCalled();
  });

  it("a freshly added printer's wizard opens with Save ready, and an untouched press closes it sending nothing", async () => {
    const { el, api } = await addFromDiscovery(unregistered);
    expect(api.createPrinter).toHaveBeenCalledOnce();
    expect(valueOf(el, "printer-paper-width")).toBe("80mm");
    await go(el, "calibration-next");
    expect(await state(el, "save-printer-p5")).toEqual(ready);
    await press(el, "save-printer-p5");
    await vi.waitFor(() => expect(q(el, "[data-test=edit-printer-modal]")).toBeNull());
    await settle();
    expect(api.updatePrinter).not.toHaveBeenCalled();
    expect(api.deactivatePrinter).not.toHaveBeenCalled();
  });
});

class SharedLeaveFixture extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot>${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("printers-save-state-leave-fixture", SharedLeaveFixture);

describe("under the dashboard's leave coordinator", () => {
  async function mountShared() {
    const { el: app } = await mountWidget<SharedLeaveFixture>(
      "printers-save-state-leave-fixture",
      {},
    );
    const el = document.createElement("dashboard-printers-screen");
    el.api = stubApi();
    app.append(el);
    await el.updateComplete;
    return el;
  }

  it("the agent editor opens quiet and wakes on an edit", async () => {
    const el = await mountShared();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-agent-a1]")).not.toBeNull());
    q(el, "[data-test=edit-agent-a1]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-agent]")).not.toBeNull());
    expect(await state(el, "save-agent")).toEqual(quiet);
    await typeInto(el, "[data-test=edit-agent-name]", "Kitchen Pi");
    expect(await state(el, "save-agent")).toEqual(ready);
  });

  it("the name and connection editors open quiet and wake on an edit", async () => {
    history.replaceState(null, "", "/manage/printers/view/printers/printer/p1");
    const el = await mountShared();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-printer-name]")).not.toBeNull());
    q(el, "[data-test=edit-printer-name]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-printer-name]")).not.toBeNull());
    expect(await state(el, "save-printer-name")).toEqual(quiet);
    await typeInto(el, "[name=printer-detail-name]", "Cocina 2");
    expect(await state(el, "save-printer-name")).toEqual(ready);

    const disclosure = q<HTMLElementTagNameMap["wt-disclosure"]>(
      el,
      "[data-test=printer-section-connection]",
    )!;
    disclosure.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    await el.updateComplete;
    q(el, "[data-test=edit-printer-connection]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=save-printer-connection]")).not.toBeNull());
    expect(await state(el, "save-printer-connection")).toEqual(quiet);
    await typeInto(el, "[name=printer-detail-port]", "9101");
    expect(await state(el, "save-printer-connection")).toEqual(ready);
  });

  it("the calibration wizard opens quiet and wakes on a change", async () => {
    history.replaceState(null, "", "/manage/printers/view/printers/printer/p1");
    const el = await mountShared();
    await vi.waitFor(() => expect(q(el, "[data-test=calibrate-printer-details]")).not.toBeNull());
    q(el, "[data-test=calibrate-printer-details]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=calibration-step-1]")).not.toBeNull());
    await go(el, "calibration-next");
    expect(await state(el, "save-printer-p1")).toEqual(quiet);
    await toggle(el, "printer-portable", true);
    expect(await state(el, "save-printer-p1")).toEqual(ready);
  });
});
