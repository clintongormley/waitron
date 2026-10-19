import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, type WtDialog } from "@waitron/ui";
import type { DashboardApi, HeldPaymentRow } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PaymentsScreen } from "./payments-screen.js";

const HELD: HeldPaymentRow = {
  holdId: "h-1",
  paymentRef: "pi_57",
  provider: "stripe-terminal",
  orderNumber: 57,
  settledAt: "2026-07-01T19:40:00.000Z",
  amount: "10.00",
  providerAmount: "12.50",
};

class HeldOutcomeLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-payments-screen
        .api=${this.api}
        .panels=${[]}
      ></dashboard-payments-screen>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("held-outcome-leave-test-app", HeldOutcomeLeaveApp);
afterEach(cleanupWidgets);

function q(screen: PaymentsScreen, selector: string) {
  return screen.shadowRoot!.querySelector<HTMLElement>(selector);
}
function dialog(screen: PaymentsScreen) {
  return q(screen, "[data-test=held-outcome-dialog]") as WtDialog | null;
}
function change(screen: PaymentsScreen, field: string, value: string) {
  q(screen, `[data-test=held-outcome-${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
function value(screen: PaymentsScreen, field: string) {
  return (q(screen, `[data-test=held-outcome-${field}]`) as HTMLElement & { value: string }).value;
}
function cancel(screen: PaymentsScreen) {
  dialog(screen)!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
}
function unload() {
  return !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}
async function choose(app: HeldOutcomeLeaveApp, decision: "keep" | "discard") {
  const confirmation = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => confirmation.open).toBe(true);
  await confirmation.updateComplete;
  confirmation.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => confirmation.open).toBe(false);
}
async function open(screen: PaymentsScreen) {
  q(screen, "[data-test=record-held-h-1]")!.click();
  await screen.updateComplete;
  await dialog(screen)!.updateComplete;
}
async function mount(overrides: Partial<DashboardApi> = {}) {
  setLocale("en");
  const { el: app } = await mountWidget<HeldOutcomeLeaveApp>("held-outcome-leave-test-app", {
    api: {
      listPaymentProviders: async () => [],
      listReaders: async () => [],
      listStuckPayments: async () => [],
      listStuckBillPayments: async () => [],
      listStuckTenderRefunds: async () => [],
      listStuckBillRefunds: async () => [],
      listHeldPayments: async () => [HELD],
      recordHeldOutcome: async () => ({ outcome: "kept" }),
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-payments-screen")!;
  await expect.poll(() => q(screen, "[data-test=record-held-h-1]")).not.toBeNull();
  await open(screen);
  return { app, screen };
}
async function fill(screen: PaymentsScreen) {
  change(screen, "outcome", "kept");
  change(screen, "note", "  Owed by the guest  ");
  change(screen, "pin", "1234");
  await screen.updateComplete;
}

for (const [field, edited] of [
  ["outcome", "kept"],
  ["note", "Owed by the guest"],
  ["pin", "1234"],
]) {
  it(`a changed ${field} is protected through Cancel and native Escape`, async () => {
    const { app, screen } = await mount();
    change(screen, field!, edited!);
    expect(unload()).toBe(true);
    cancel(screen);
    await choose(app, "keep");
    expect(dialog(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(value(screen, field!)).toBe(edited);
    await userEvent.keyboard("{Escape}");
    await choose(app, "discard");
    await expect.poll(() => dialog(screen)).toBeNull();
    expect(unload()).toBe(false);
  });
}

it("a clean dialog, and one reverted to empty, close without asking", async () => {
  const { screen } = await mount();
  cancel(screen);
  await expect.poll(() => dialog(screen)).toBeNull();
  await open(screen);
  await fill(screen);
  expect(unload()).toBe(true);
  change(screen, "outcome", "");
  change(screen, "note", "   ");
  change(screen, "pin", "");
  expect(unload()).toBe(false);
  cancel(screen);
  await expect.poll(() => dialog(screen)).toBeNull();
});

it("a refused record keeps the draft and still asks before leaving", async () => {
  const { app, screen } = await mount({
    recordHeldOutcome: async () => {
      throw { code: "pin.invalid" };
    },
  });
  await fill(screen);
  q(screen, "[data-test=confirm-held-outcome]")!.click();
  await expect
    .poll(
      () => (q(screen, "[data-test=held-outcome-pin]") as HTMLElement & { error: string }).error,
    )
    .not.toBe("");
  expect(unload()).toBe(true);
  cancel(screen);
  await choose(app, "keep");
  expect(value(screen, "note")).toBe("  Owed by the guest  ");
  expect(value(screen, "pin")).toBe("1234");
});

it("a successful record leaves nothing unsaved", async () => {
  const { screen } = await mount();
  await fill(screen);
  q(screen, "[data-test=confirm-held-outcome]")!.click();
  await expect.poll(() => dialog(screen)).toBeNull();
  expect(unload()).toBe(false);
});

it("leaving the screen closes the dialog and clears the PIN without asking", async () => {
  const { app, screen } = await mount();
  change(screen, "pin", "1234");
  screen.remove();
  await screen.updateComplete;
  expect(dialog(screen)).toBeNull();
  expect(unload()).toBe(false);
  app.shadowRoot!.append(screen);
  await expect.poll(() => q(screen, "[data-test=record-held-h-1]")).not.toBeNull();
  await open(screen);
  expect(value(screen, "pin")).toBe("");
});
