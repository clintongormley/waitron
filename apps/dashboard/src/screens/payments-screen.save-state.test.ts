import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type {
  AvailableReader,
  BillRecoveryOutcome,
  DashboardApi,
  PaymentProviderRow,
  ReaderRow,
  ReaderStatusView,
} from "../api/client.js";
import "./payments-screen.js";
import type { PaymentsScreen } from "./payments-screen.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

const providers: PaymentProviderRow[] = [
  { providerId: "acme", state: "connected", canUnpair: true },
];
const readers: ReaderRow[] = [
  {
    id: "r-1",
    provider: "acme",
    name: "Front counter",
    active: true,
    canEnable: true,
    deviceCount: 1,
    deviceNames: ["Front till"],
  },
];
const available: AvailableReader[] = [
  { providerRef: "v-1", name: "My Reader", model: "solo", serial: "123", status: "available" },
  { providerRef: "v-2", name: "Terrace", model: "solo", serial: "456", status: "disabled" },
];
const PAYMENT = {
  billPaymentId: "bp-1",
  workingOrderId: "wo-1",
  orderNumber: 12,
  label: "Terrace 3",
  source: "device",
  deviceId: "device-1",
  deviceName: "Bar till",
  method: "card",
  applied: "12.50",
  tip: "1.00",
  startedAt: "2026-09-26T10:05:00.000Z",
  provider: "acme",
  providerState: "failed",
};

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listPaymentProviders: vi.fn().mockResolvedValue(providers),
    listReaders: vi.fn().mockResolvedValue(readers),
    listReaderHolders: vi.fn().mockResolvedValue([]),
    readerStatus: vi.fn().mockResolvedValue({ online: true } as ReaderStatusView),
    renameReader: vi.fn().mockResolvedValue(undefined),
    unpairReader: vi.fn().mockResolvedValue(undefined),
    availableReaders: vi.fn().mockResolvedValue(available),
    adoptReader: vi.fn().mockResolvedValue({ id: "r-2", status: "paired" }),
    listStuckPayments: vi.fn().mockResolvedValue([]),
    listStuckBillPayments: vi.fn().mockResolvedValue([PAYMENT]),
    listStuckBillRefunds: vi.fn().mockResolvedValue([]),
    attestStuckBillPayment: vi.fn().mockResolvedValue({ outcome: "received" }),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Table cells and row menus live in shadow roots below the screen's own. */
function deepQuery<T extends HTMLElement>(root: ShadowRoot, selector: string): T | null {
  const found = root.querySelector<T>(selector);
  if (found) return found;
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    const nested = node.shadowRoot ? deepQuery<T>(node.shadowRoot, selector) : null;
    if (nested) return nested;
  }
  return null;
}
const q = <T extends HTMLElement = HTMLElement>(el: PaymentsScreen, selector: string) =>
  deepQuery<T>(el.shadowRoot!, selector);
const action = (el: PaymentsScreen, test: string) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test=${test}]`)!;

async function state(el: PaymentsScreen, test: string) {
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
const settle = async (el: PaymentsScreen) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};

/** A real pointer press on the inner button, once the opening dialog has stopped moving it; `force`
 * presses a disabled one too. */
async function press(el: PaymentsScreen, test: string) {
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

async function type(el: PaymentsScreen, test: string, value: string) {
  const field = q<HTMLElementTagNameMap["wt-input"]>(el, `[data-test=${test}]`)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

/** The field is locked while a request runs, so an edit then arrives as the field reports one. */
function reported(el: PaymentsScreen, test: string, value: string) {
  q(el, `[data-test=${test}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true }),
  );
}

/** Nothing a press of an untouched action could have shown: no field error and no bottom message. */
async function noComplaint(el: PaymentsScreen, dialog: string) {
  for (const field of el.shadowRoot!.querySelectorAll<HTMLElement & { error?: string }>(
    `[data-test=${dialog}] wt-input, [data-test=${dialog}] wt-combobox`,
  ))
    expect(field.error ?? "").toBe("");
  const actions = q<HTMLElementTagNameMap["wt-form-actions"]>(
    el,
    `[data-test=${dialog}] wt-form-actions`,
  )!;
  expect((await formMessageOf(actions))?.textContent?.trim() ?? "").toBe("");
}

async function mount(api: DashboardApi = stubApi()) {
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api,
    request: vi.fn() as unknown as PaymentsScreen["request"],
    panels: [],
  });
  await vi.waitFor(() => expect(q(el, "[data-test=edit-r-1]")).not.toBeNull());
  return { el, api };
}

async function openReader(el: PaymentsScreen, mode: "edit" | "unpair" = "edit") {
  q(el, `[data-test=${mode}-r-1]`)!.click();
  await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).not.toBeNull());
  await settle(el);
}

async function openRename(api: DashboardApi = stubApi()) {
  const mounted = await mount(api);
  await openReader(mounted.el);
  return mounted;
}

async function openAttest(api: DashboardApi = stubApi(), el?: PaymentsScreen) {
  const screen = el ?? (await mount(api)).el;
  await vi.waitFor(() => expect(q(screen, "[data-test=attest-bill-payment-bp-1]")).not.toBeNull());
  q(screen, "[data-test=attest-bill-payment-bp-1]")!.click();
  await vi.waitFor(() => expect(q(screen, "[data-test=confirm-bill-attest]")).not.toBeNull());
  await settle(screen);
  return { el: screen, api };
}

const value = (el: PaymentsScreen, test: string) =>
  q<HTMLElement & { value: string }>(el, `[data-test=${test}]`)!.value;

describe("the Rename reader dialog's Save", () => {
  it("opens with the stored name and Save quiet, and a press sends nothing and marks nothing", async () => {
    const { el, api } = await openRename();
    expect(value(el, "edit-reader-name")).toBe("Front counter");
    expect(await state(el, "save-reader")).toEqual(quiet);
    await press(el, "save-reader");
    await settle(el);
    expect(api.renameReader).not.toHaveBeenCalled();
    expect(q(el, "[data-test=reader-editor]")).not.toBeNull();
    await noComplaint(el, "reader-editor");
  });

  it("a press that reaches an untouched Save's handler sends nothing and marks nothing", async () => {
    const { el, api } = await openRename();
    // A host `.click()` reaches the listener even while the inner button is disabled.
    action(el, "save-reader").click();
    await settle(el);
    expect(api.renameReader).not.toHaveBeenCalled();
    await noComplaint(el, "reader-editor");
  });

  it("a name edit wakes Save, and typing it back quiets it, spaces and all", async () => {
    const { el } = await openRename();
    await type(el, "edit-reader-name", "Garden");
    expect(await state(el, "save-reader")).toEqual(ready);
    await type(el, "edit-reader-name", "Front counter");
    expect(await state(el, "save-reader")).toEqual(quiet);
    await type(el, "edit-reader-name", " Front counter ");
    expect(await state(el, "save-reader")).toEqual(quiet);
  });

  it("a press after an edit renames the reader and closes the dialog", async () => {
    const { el, api } = await openRename();
    await type(el, "edit-reader-name", "Garden");
    await press(el, "save-reader");
    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
    expect(api.renameReader).toHaveBeenCalledExactlyOnceWith("r-1", "Garden");
  });

  it("a name emptied by an edit keeps Save drawn as a change but unpressable once tried", async () => {
    const { el, api } = await openRename();
    await type(el, "edit-reader-name", "");
    expect(await state(el, "save-reader")).toEqual(ready);
    await press(el, "save-reader");
    expect(await state(el, "save-reader")).toEqual(blocked);
    expect(api.renameReader).not.toHaveBeenCalled();
  });

  it("an edit made while the save is in flight keeps the dialog open, measured from what was sent", async () => {
    let finish!: () => void;
    const api = stubApi({
      renameReader: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { el } = await openRename(api);
    await type(el, "edit-reader-name", "Garden");
    await press(el, "save-reader");
    await vi.waitFor(() => expect(typeof finish).toBe("function"));
    reported(el, "edit-reader-name", "Garden 2");
    finish();
    await vi.waitFor(async () => expect(await state(el, "save-reader")).toEqual(ready));
    expect(q(el, "[data-test=reader-editor]")).not.toBeNull();
    await type(el, "edit-reader-name", "Garden");
    expect(await state(el, "save-reader")).toEqual(quiet);
  });

  it("a refused rename keeps Save ready, and typing the stored name back quiets it", async () => {
    const { el, api } = await openRename(
      stubApi({ renameReader: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    );
    await type(el, "edit-reader-name", "Garden");
    await press(el, "save-reader");
    await vi.waitFor(() => expect(api.renameReader).toHaveBeenCalledTimes(1));
    await settle(el);
    expect(await state(el, "save-reader")).toEqual(ready);
    await type(el, "edit-reader-name", "Front counter");
    expect(await state(el, "save-reader")).toEqual(quiet);
  });

  it("Cancel after an edit closes the dialog with no leave coordinator", async () => {
    const { el, api } = await openRename();
    await type(el, "edit-reader-name", "Garden");
    await press(el, "close-reader-editor");
    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
    expect(api.renameReader).not.toHaveBeenCalled();
  });

  it("Escape after an edit closes the dialog with no leave coordinator", async () => {
    const { el } = await openRename();
    await type(el, "edit-reader-name", "Garden");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
  });

  it("the same dialog's Unpair is not a save: it opens pressable and unpairs at once", async () => {
    const { el, api } = await mount();
    await openReader(el, "unpair");
    const unpair = await state(el, "confirm-unpair");
    expect(unpair.disabled).toBe(false);
    expect(unpair.innerDisabled).toBe(false);
    await press(el, "confirm-unpair");
    await vi.waitFor(() => expect(api.unpairReader).toHaveBeenCalledExactlyOnceWith("r-1"));
  });
});

describe("the bill attestation's Record", () => {
  it("opens with every field empty and Record quiet, and a press sends nothing and marks nothing", async () => {
    const { el, api } = await openAttest();
    expect(value(el, "bill-attest-outcome")).toBe("");
    expect(value(el, "bill-attest-note")).toBe("");
    expect(value(el, "bill-attest-pin")).toBe("");
    expect(await state(el, "confirm-bill-attest")).toEqual(quiet);
    await press(el, "confirm-bill-attest");
    await settle(el);
    expect(api.attestStuckBillPayment).not.toHaveBeenCalled();
    expect(q(el, "[data-test=bill-attest-dialog]")).not.toBeNull();
    await noComplaint(el, "bill-attest-dialog");
  });

  it("a press that reaches an untouched Record's handler sends nothing and marks nothing", async () => {
    const { el, api } = await openAttest();
    action(el, "confirm-bill-attest").click();
    await settle(el);
    expect(api.attestStuckBillPayment).not.toHaveBeenCalled();
    await noComplaint(el, "bill-attest-dialog");
  });

  it("an outcome wakes Record", async () => {
    const { el } = await openAttest();
    await chooseOption(q(el, "[data-test=bill-attest-outcome]")!, "received");
    expect(await state(el, "confirm-bill-attest")).toEqual(ready);
  });

  it.each([
    ["the note", "bill-attest-note"],
    ["the PIN", "bill-attest-pin"],
  ])("%s wakes Record, and emptying it quiets it", async (_, test) => {
    const { el } = await openAttest();
    await type(el, test, "1234");
    expect(await state(el, "confirm-bill-attest")).toEqual(ready);
    await type(el, test, "");
    expect(await state(el, "confirm-bill-attest")).toEqual(quiet);
  });

  it("a note of spaces alone is no change", async () => {
    const { el } = await openAttest();
    await type(el, "bill-attest-note", "   ");
    expect(await state(el, "confirm-bill-attest")).toEqual(quiet);
  });

  it("one field filled keeps Record drawn as a change but unpressable once tried", async () => {
    const { el, api } = await openAttest();
    await type(el, "bill-attest-note", "Provider confirmed");
    expect(await state(el, "confirm-bill-attest")).toEqual(ready);
    await press(el, "confirm-bill-attest");
    expect(await state(el, "confirm-bill-attest")).toEqual(blocked);
    expect(api.attestStuckBillPayment).not.toHaveBeenCalled();
    expect(q<HTMLElement & { error: string }>(el, "[data-test=bill-attest-pin]")!.error).toBe(
      t("payments.bill.pin_required"),
    );
  });

  it("a press with every field filled records the outcome and closes the dialog", async () => {
    const { el, api } = await openAttest();
    await chooseOption(q(el, "[data-test=bill-attest-outcome]")!, "received");
    await type(el, "bill-attest-note", "Provider confirmed");
    await type(el, "bill-attest-pin", "1234");
    await press(el, "confirm-bill-attest");
    await vi.waitFor(() => expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull());
    expect(api.attestStuckBillPayment).toHaveBeenCalledExactlyOnceWith("bp-1", {
      outcome: "received",
      note: "Provider confirmed",
      pin: "1234",
    });
  });

  it("an edit made while the attestation is in flight keeps the dialog open, measured from what was sent", async () => {
    let finish!: (answer: BillRecoveryOutcome) => void;
    const api = stubApi({
      attestStuckBillPayment: vi.fn(
        () =>
          new Promise<BillRecoveryOutcome>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { el } = await openAttest(api);
    await chooseOption(q(el, "[data-test=bill-attest-outcome]")!, "received");
    await type(el, "bill-attest-note", "Provider confirmed");
    await type(el, "bill-attest-pin", "1234");
    await press(el, "confirm-bill-attest");
    await vi.waitFor(() => expect(typeof finish).toBe("function"));
    reported(el, "bill-attest-note", "Provider confirmed twice");
    finish({ outcome: "received" });
    await vi.waitFor(async () => expect(await state(el, "confirm-bill-attest")).toEqual(ready));
    expect(q(el, "[data-test=bill-attest-dialog]")).not.toBeNull();
    await type(el, "bill-attest-note", "Provider confirmed");
    expect(await state(el, "confirm-bill-attest")).toEqual(quiet);
  });

  it("Cancel after an edit closes the dialog with no leave coordinator", async () => {
    const { el, api } = await openAttest();
    await type(el, "bill-attest-note", "Provider confirmed");
    q(el, "[data-test=bill-attest-dialog] wt-button[slot=cancel]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull());
    expect(api.attestStuckBillPayment).not.toHaveBeenCalled();
  });

  it("Escape after an edit closes the dialog with no leave coordinator", async () => {
    const { el } = await openAttest();
    await type(el, "bill-attest-note", "Provider confirmed");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull());
  });

  it("reopens quiet after an attempt", async () => {
    const { el } = await openAttest();
    await type(el, "bill-attest-note", "Provider confirmed");
    await press(el, "confirm-bill-attest");
    q(el, "[data-test=bill-attest-dialog]")!.dispatchEvent(new CustomEvent("wt-close"));
    await vi.waitFor(() => expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull());
    await openAttest(undefined, el);
    expect(await state(el, "confirm-bill-attest")).toEqual(quiet);
    await noComplaint(el, "bill-attest-dialog");
  });
});

describe("the Add a reader rows", () => {
  it("open savable: each row holds the provider's name, and Add adopts the reader under it", async () => {
    const { el, api } = await mount();
    q(el, "[data-test=add-reader-acme]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=adopt-v-1]")).not.toBeNull());
    await settle(el);
    expect(value(el, "name-v-1")).toBe("My Reader");
    expect(await state(el, "adopt-v-1")).toEqual(ready);
    expect(await state(el, "adopt-v-2")).toEqual(ready);
    await press(el, "adopt-v-1");
    await vi.waitFor(() =>
      expect(api.adoptReader).toHaveBeenCalledExactlyOnceWith({
        providerId: "acme",
        providerRef: "v-1",
        name: "My Reader",
      }),
    );
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
customElements.define("payments-save-state-leave-fixture", SharedLeaveFixture);

async function mountUnderCoordinator() {
  const { el: app } = await mountWidget<SharedLeaveFixture>(
    "payments-save-state-leave-fixture",
    {},
  );
  const el = document.createElement("dashboard-payments-screen");
  el.api = stubApi();
  el.panels = [];
  app.append(el);
  await vi.waitFor(() => expect(q(el, "[data-test=edit-r-1]")).not.toBeNull());
  return el;
}

describe("under the dashboard's leave coordinator", () => {
  it("the Rename dialog opens quiet, wakes on an edit and quiets when it is typed back", async () => {
    const el = await mountUnderCoordinator();
    await openReader(el);
    expect(await state(el, "save-reader")).toEqual(quiet);
    await type(el, "edit-reader-name", "Garden");
    expect(await state(el, "save-reader")).toEqual(ready);
    await type(el, "edit-reader-name", "Front counter");
    expect(await state(el, "save-reader")).toEqual(quiet);
  });

  it("the attestation opens quiet, wakes on an edit and quiets when it is emptied", async () => {
    const el = await mountUnderCoordinator();
    await openAttest(undefined, el);
    expect(await state(el, "confirm-bill-attest")).toEqual(quiet);
    await type(el, "bill-attest-note", "Provider confirmed");
    expect(await state(el, "confirm-bill-attest")).toEqual(ready);
    await type(el, "bill-attest-note", "");
    expect(await state(el, "confirm-bill-attest")).toEqual(quiet);
  });
});
