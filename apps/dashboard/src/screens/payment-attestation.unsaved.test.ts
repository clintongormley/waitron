import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, type WtDialog } from "@waitron/ui";
import type { DashboardApi, StuckBillPaymentRow, StuckBillRefundRow } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PaymentsScreen } from "./payments-screen.js";
const PAYMENT: StuckBillPaymentRow = {
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
  provider: "stripe-terminal",
  providerState: "failed",
};
const REFUND: StuckBillRefundRow = {
  refundId: "br-1",
  billPaymentId: "bp-2",
  workingOrderId: "wo-2",
  orderNumber: 13,
  label: null,
  source: "device",
  deviceId: "device-1",
  deviceName: "Bar till",
  appliedAmount: "4.00",
  tipAmount: "0.50",
  reason: "Guest left",
  requestedAt: "2026-09-26T10:07:00.000Z",
  sentAt: "2026-09-26T10:08:00.000Z",
  sendCount: 1,
  provider: "sumup",
};

class AttestationLeaveApp extends LitElement {
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
customElements.define("attestation-leave-test-app", AttestationLeaveApp);
afterEach(cleanupWidgets);
function q(screen: PaymentsScreen, selector: string) {
  return screen.shadowRoot!.querySelector<HTMLElement>(selector);
}
function dialog(screen: PaymentsScreen) {
  return q(screen, "[data-test=bill-attest-dialog]") as WtDialog | null;
}
function change(screen: PaymentsScreen, field: string, value: string) {
  q(screen, `[data-test=bill-attest-${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
function value(screen: PaymentsScreen, field: string) {
  return (q(screen, `[data-test=bill-attest-${field}]`) as HTMLElement & { value: string }).value;
}
function cancel(screen: PaymentsScreen) {
  dialog(screen)!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
}
function unload() {
  return !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}
async function choose(app: AttestationLeaveApp, decision: "keep" | "discard") {
  const confirmation = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => confirmation.open).toBe(true);
  await confirmation.updateComplete;
  confirmation.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => confirmation.open).toBe(false);
}
async function open(screen: PaymentsScreen, kind: string) {
  q(screen, `[data-test=attest-bill-${kind}-${kind === "payment" ? "bp-1" : "br-1"}]`)!.click();
  await screen.updateComplete;
  await dialog(screen)!.updateComplete;
}
async function mount(kind: string, overrides: Partial<DashboardApi> = {}) {
  setLocale("en");
  const { el: app } = await mountWidget<AttestationLeaveApp>("attestation-leave-test-app", {
    api: {
      listPaymentProviders: async () => [],
      listReaders: async () => [],
      listStuckPayments: async () => [],
      listStuckBillPayments: async () => [PAYMENT],
      listStuckBillRefunds: async () => [REFUND],
      attestStuckBillPayment: async () => ({ outcome: "received" }),
      attestStuckBillRefund: async () => ({ outcome: "completed" }),
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-payments-screen")!;
  await expect.poll(() => q(screen, "[data-test=attest-bill-payment-bp-1]")).not.toBeNull();
  await open(screen, kind);
  return { app, screen };
}
async function fill(screen: PaymentsScreen, kind: string) {
  change(screen, "outcome", kind === "payment" ? "received" : "completed");
  change(screen, "note", "  Provider confirmed  ");
  change(screen, "pin", "1234");
  await screen.updateComplete;
}
for (const kind of ["payment", "refund"]) {
  for (const [field, edited] of [
    ["outcome", "failed"],
    ["note", "Provider confirmed"],
    ["pin", "1234"],
  ]) {
    it(`${kind} ${field} is protected through Cancel and native Escape`, async () => {
      const { app, screen } = await mount(kind);
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
  it(`${kind} clean and normalized reverted inputs close directly`, async () => {
    const { screen } = await mount(kind);
    cancel(screen);
    await expect.poll(() => dialog(screen)).toBeNull();
    await open(screen, kind);
    await fill(screen, kind);
    expect(unload()).toBe(true);
    change(screen, "outcome", "");
    change(screen, "note", "   ");
    change(screen, "pin", "");
    expect(unload()).toBe(false);
    cancel(screen);
    await expect.poll(() => dialog(screen)).toBeNull();
  });
  it(`${kind} rejected attestation retains the submitted draft`, async () => {
    const fail = async () => {
      throw { code: "pin.invalid" };
    };
    const { app, screen } = await mount(kind, {
      attestStuckBillPayment: fail,
      attestStuckBillRefund: fail,
    });
    await fill(screen, kind);
    q(screen, "[data-test=confirm-bill-attest]")!.click();
    await expect
      .poll(
        () => (q(screen, "[data-test=bill-attest-pin]") as HTMLElement & { error: string }).error,
      )
      .not.toBe("");
    expect(unload()).toBe(true);
    cancel(screen);
    await choose(app, "keep");
    expect(value(screen, "note")).toBe("  Provider confirmed  ");
    expect(value(screen, "pin")).toBe("1234");
  });
  it(`${kind} acceptance commits the exact submitted body before failed refresh`, async () => {
    let reads = 0;
    let finish!: () => void;
    const sent: unknown[] = [];
    const attest = async (id: string, body: unknown) => {
      sent.push([id, body]);
      return { outcome: kind === "payment" ? ("received" as const) : ("completed" as const) };
    };
    const { screen } = await mount(kind, {
      attestStuckBillPayment: attest,
      attestStuckBillRefund: attest,
      listStuckBillPayments: async () => {
        if (reads++) {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          throw { code: "connection.failed" };
        }
        return [PAYMENT];
      },
    });
    await fill(screen, kind);
    q(screen, "[data-test=confirm-bill-attest]")!.click();
    await expect.poll(() => typeof finish).toBe("function");
    expect(dialog(screen)).toBeNull();
    expect(unload()).toBe(false);
    expect(sent).toEqual([
      [
        kind === "payment" ? "bp-1" : "br-1",
        {
          outcome: kind === "payment" ? "received" : "completed",
          note: "Provider confirmed",
          pin: "1234",
        },
      ],
    ]);
    finish();
    await expect.poll(() => q(screen, "[data-test=bill-load-error]")).not.toBeNull();
    expect(unload()).toBe(false);
  });
  it(`${kind} newer input survives acceptance and remains unsaved`, async () => {
    let finish!: () => void;
    const attest = async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { outcome: "failed" as const };
    };
    const { app, screen } = await mount(kind, {
      attestStuckBillPayment: attest,
      attestStuckBillRefund: attest,
    });
    await fill(screen, kind);
    q(screen, "[data-test=confirm-bill-attest]")!.click();
    await expect.poll(() => typeof finish).toBe("function");
    await screen.updateComplete;
    expect(dialog(screen)!.dismissible).toBe(false);
    await userEvent.keyboard("{Escape}");
    expect(dialog(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    change(screen, "note", "A newer note");
    finish();
    await expect.poll(() => q(screen, "[data-test=bill-action-result]")).not.toBeNull();
    await screen.updateComplete;
    expect(dialog(screen)).not.toBeNull();
    expect(value(screen, "note")).toBe("A newer note");
    expect(unload()).toBe(true);
    cancel(screen);
    await choose(app, "keep");
  });
}
it("disconnect clears sensitive values and a late acceptance cannot close a new opening", async () => {
  let finish!: () => void;
  const { app, screen } = await mount("payment", {
    attestStuckBillPayment: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { outcome: "received" };
    },
  });
  await fill(screen, "payment");
  q(screen, "[data-test=confirm-bill-attest]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  screen.remove();
  await screen.updateComplete;
  expect(dialog(screen)).toBeNull();
  expect(unload()).toBe(false);
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  await open(screen, "refund");
  change(screen, "note", "Replacement");
  finish();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await screen.updateComplete;
  expect(value(screen, "note")).toBe("Replacement");
  expect(q(screen, "[data-test=bill-action-result]")).toBeNull();
  cancel(screen);
  await choose(app, "keep");
});

it("departed attestation controls and native close reports leave a replacement alone", async () => {
  const { app, screen } = await mount("payment");
  const departed = dialog(screen)!;
  const oldNote = q(screen, "[data-test=bill-attest-note]")!;
  const oldPin = q(screen, "[data-test=bill-attest-pin]")!;
  const oldOutcome = q(screen, "[data-test=bill-attest-outcome]")!;
  await open(screen, "refund");
  change(screen, "note", "Replacement");
  for (const field of [oldNote, oldPin, oldOutcome])
    field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "departed" } }));
  departed.shadowRoot!.querySelector("dialog")!.dispatchEvent(new Event("close"));
  await screen.updateComplete;
  expect(value(screen, "note")).toBe("Replacement");
  expect(value(screen, "pin")).toBe("");
  expect(value(screen, "outcome")).toBe("");
  expect(dialog(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  cancel(screen);
  await choose(app, "keep");
});
it("successful submission invalidates an outstanding discard question", async () => {
  const { app, screen } = await mount("payment");
  await fill(screen, "payment");
  cancel(screen);
  const confirmation = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => confirmation.open).toBe(true);
  q(screen, "[data-test=confirm-bill-attest]")!.click();
  await expect.poll(() => dialog(screen)).toBeNull();
  await expect.poll(() => confirmation.open).toBe(false);
  expect(unload()).toBe(false);
  await open(screen, "refund");
  change(screen, "note", "New draft");
  confirmation.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", { detail: { decision: "discard" } }),
  );
  await screen.updateComplete;
  expect(value(screen, "note")).toBe("New draft");
  expect(dialog(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
});
it("disconnect cancels a pending question and clears the PIN without asking", async () => {
  const { app, screen } = await mount("payment");
  change(screen, "pin", "1234");
  cancel(screen);
  const confirmation = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => confirmation.open).toBe(true);
  screen.remove();
  await screen.updateComplete;
  await expect.poll(() => confirmation.open).toBe(false);
  expect(dialog(screen)).toBeNull();
  expect(unload()).toBe(false);
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  await open(screen, "refund");
  expect(value(screen, "pin")).toBe("");
});
it("a departed refusal cannot mark a replacement form or release its pending write", async () => {
  let reject!: (error: unknown) => void;
  let finish!: () => void;
  const { app, screen } = await mount("payment", {
    attestStuckBillPayment: async () => {
      await new Promise<void>((_resolve, fail) => {
        reject = fail;
      });
      return { outcome: "received" };
    },
    attestStuckBillRefund: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { outcome: "completed" };
    },
  });
  await fill(screen, "payment");
  q(screen, "[data-test=confirm-bill-attest]")!.click();
  await expect.poll(() => typeof reject).toBe("function");
  screen.remove();
  await screen.updateComplete;
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  await open(screen, "refund");
  await fill(screen, "refund");
  q(screen, "[data-test=confirm-bill-attest]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  reject({ code: "pin.invalid" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await screen.updateComplete;
  expect(dialog(screen)!.dismissible).toBe(false);
  expect((q(screen, "[data-test=bill-attest-pin]") as HTMLElement & { error: string }).error).toBe(
    "",
  );
  finish();
  await expect.poll(() => dialog(screen)).toBeNull();
});
it("provider-check confirmation remains a direct-close exemption", async () => {
  const { app, screen } = await mount("payment");
  cancel(screen);
  await expect.poll(() => dialog(screen)).toBeNull();
  q(screen, "[data-test=check-bill-payment-bp-1]")!.click();
  await screen.updateComplete;
  const check = q(screen, "[data-test=bill-check-dialog]") as WtDialog;
  await check.updateComplete;
  check.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await expect.poll(() => q(screen, "[data-test=bill-check-dialog]")).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
});
