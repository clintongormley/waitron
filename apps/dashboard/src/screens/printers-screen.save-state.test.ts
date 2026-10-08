import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import type { DashboardApi, PrintAgentRow, Printer } from "../api/client.js";
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
});
