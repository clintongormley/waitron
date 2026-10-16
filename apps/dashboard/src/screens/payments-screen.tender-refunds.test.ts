import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import type { StuckTenderRefundRow } from "../api/tender-refund-types.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import "./payments-screen.js";
import type { PaymentsScreen } from "./payments-screen.js";

const refund: StuckTenderRefundRow = {
  invoiceNumber: "A/17",
  reason: "Goodwill",
  provider: "fake",
  providerPaymentRef: "capture-1",
  id: "tr-1",
  saleId: "sale-1",
  tenderId: "tender-1",
  state: "pending",
  appliedAmount: "12.50",
  tipAmount: "1.00",
  createdAt: "2026-10-16T12:00:00.000Z",
  completedAt: null,
};
function stub(over: Partial<DashboardApi> = {}): DashboardApi {
  return {
    liveData: new LiveData(),
    listPaymentProviders: vi.fn().mockResolvedValue([]),
    listReaders: vi.fn().mockResolvedValue([]),
    listReaderHolders: vi.fn().mockResolvedValue([]),
    listStuckPayments: vi.fn().mockResolvedValue([]),
    listStuckBillPayments: vi.fn().mockResolvedValue([]),
    listStuckBillRefunds: vi.fn().mockResolvedValue([]),
    listStuckTenderRefunds: vi.fn().mockResolvedValue([refund]),
    resolveStuckTenderRefund: vi.fn().mockResolvedValue({ outcome: "completed" }),
    attestStuckTenderRefund: vi.fn().mockResolvedValue({ outcome: "failed" }),
    ...over,
  } as unknown as DashboardApi;
}
const q = (el: PaymentsScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;
async function mount(api = stub(), theme: "light" | "dark" = "light") {
  const result = await mountWidget<PaymentsScreen>(
    "dashboard-payments-screen",
    { api, panels: [] },
    theme,
  );
  await vi.waitFor(() => expect(q(result.el, "[data-test=tender-refund-tr-1]")).not.toBeNull());
  return { ...result, api };
}
async function open(el: PaymentsScreen, mode: "check" | "attest") {
  q(el, `[data-test=${mode}-tender-refund-tr-1]`).click();
  await el.updateComplete;
}
async function change(el: PaymentsScreen, name: string, value: string) {
  q(el, `[data-test=bill-attest-${name}]`).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}
async function fill(el: PaymentsScreen) {
  await chooseOption(q(el, "[data-test=bill-attest-outcome]"), "failed");
  await change(el, "note", "Provider confirmed no return");
  await change(el, "pin", "0123");
}
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("manager post-invoice refunds", () => {
  it("shows an unresolved refund with its original sale, attempt, exact total and date", async () => {
    const { el } = await mount();
    const row = q(el, "[data-test=tender-refund-tr-1]");
    expect(row.textContent).toContain("A/17");
    expect(row.textContent).toContain("capture-1");
    expect(row.textContent).toContain("Goodwill");
    expect(row.textContent).toContain("tr-1");
    expect(row.textContent).toContain("€13.50");
    expect(row.querySelector("time")!.dateTime).toBe("2026-10-16T12:00:00.000Z");
    expect(row.textContent).toContain("invoice");
  });

  it("checks only that attempt, keeps an unknown outcome as a refusal, and never attests it", async () => {
    const api = stub({
      resolveStuckTenderRefund: vi
        .fn()
        .mockRejectedValue({ code: "tender.refund_outcome_unconfirmed" }),
    });
    const { el } = await mount(api);
    await open(el, "check");
    expect(q(el, "[data-test=bill-check-dialog]").textContent).toContain(
      "original invoice stays unchanged",
    );
    expect(q(el, "[data-test=bill-check-dialog]").textContent).not.toContain("bill stays locked");
    q(el, "[data-test=confirm-bill-check]").click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=bill-action-result]")?.getAttribute("role")).toBe("alert"),
    );
    expect(api.resolveStuckTenderRefund).toHaveBeenCalledExactlyOnceWith("tr-1");
    expect(api.attestStuckTenderRefund).not.toHaveBeenCalled();
    expect(q(el, "[data-test=tender-refund-tr-1]")).not.toBeNull();
  });

  it("validates every attestation field before sending then clears its secret on success", async () => {
    const { el, api } = await mount();
    await open(el, "attest");
    expect(q(el, "[data-test=confirm-bill-attest]").hasAttribute("disabled")).toBe(true);
    await change(el, "note", "Provider confirmed no return");
    q(el, "[data-test=confirm-bill-attest]").click();
    await el.updateComplete;
    expect(api.attestStuckTenderRefund).not.toHaveBeenCalled();
    expect(
      (q(el, "[data-test=bill-attest-pin]") as HTMLElement & { error: string }).error,
    ).not.toBe("");
    expect(
      (q(el, "[data-test=bill-attest-outcome]") as HTMLElement & { error: string }).error,
    ).not.toBe("");
    expect(
      (
        await formMessageOf(
          q(
            el,
            "[data-test=bill-attest-dialog] wt-form-actions",
          ) as HTMLElementTagNameMap["wt-form-actions"],
        )
      )?.textContent,
    ).toContain("fields");
    await fill(el);
    q(el, "[data-test=confirm-bill-attest]").click();
    await vi.waitFor(() => expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull());
    expect(api.attestStuckTenderRefund).toHaveBeenCalledExactlyOnceWith("tr-1", {
      outcome: "failed",
      note: "Provider confirmed no return",
      pin: "0123",
    });
    expect(el.shadowRoot!.querySelector("[name=pin]")).toBeNull();
  });

  it("closes a successful attestation before a failed refresh and retains the success result", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([refund])
      .mockRejectedValue({ code: "connection.failed" });
    const { el, api } = await mount(stub({ listStuckTenderRefunds: list }));
    await open(el, "attest");
    await fill(el);
    q(el, "[data-test=confirm-bill-attest]").click();
    await vi.waitFor(() => expect(q(el, "[data-test=bill-load-error]")).not.toBeNull());
    expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull();
    expect(q(el, "[data-test=bill-action-result]").getAttribute("role")).toBe("status");
    expect(api.attestStuckTenderRefund).toHaveBeenCalledTimes(1);
  });

  it("refreshes from ledger changes without overwriting an open note or PIN", async () => {
    const { el, api } = await mount();
    await open(el, "attest");
    await change(el, "note", "Calling provider");
    await change(el, "pin", "0123");
    api.liveData.invalidate([{ type: "tender_refunds" }]);
    await vi.waitFor(() => expect(api.listStuckTenderRefunds).toHaveBeenCalledTimes(2));
    expect((q(el, "[name=note]") as HTMLElement & { value: string }).value).toBe(
      "Calling provider",
    );
    expect((q(el, "[name=pin]") as HTMLElement & { value: string }).value).toBe("0123");
  });

  it("closes a manager draft when the server says another resolver took this attempt", async () => {
    const { el, api } = await mount(
      stub({
        attestStuckTenderRefund: vi.fn().mockRejectedValue({ code: "tender.refund_not_stuck" }),
      }),
    );
    await open(el, "attest");
    await fill(el);
    q(el, "[data-test=confirm-bill-attest]").click();
    await vi.waitFor(() => expect(q(el, "[data-test=bill-action-result]")).not.toBeNull());
    expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull();
    expect(api.attestStuckTenderRefund).toHaveBeenCalledTimes(1);
  });

  it("does not send a second attestation while its first answer is delayed", async () => {
    let finish!: (value: { outcome: "completed" }) => void;
    const send = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { el } = await mount(stub({ attestStuckTenderRefund: send }));
    await open(el, "attest");
    await fill(el);
    const button = q(el, "[data-test=confirm-bill-attest]");
    button.click();
    button.click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(
      (q(el, "[data-test=bill-attest-dialog]") as HTMLElementTagNameMap["wt-dialog"]).dismissible,
    ).toBe(false);
    finish({ outcome: "completed" });
    await vi.waitFor(() => expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(["completed", "failed"] as const)(
    "explains a confirmed %s return without saying the bill changed",
    async (outcome) => {
      const api = stub({
        resolveStuckTenderRefund: vi.fn().mockResolvedValue({ outcome }),
        listStuckTenderRefunds: vi.fn().mockResolvedValueOnce([refund]).mockResolvedValue([]),
      });
      const { el } = await mount(api);
      await open(el, "check");
      q(el, "[data-test=confirm-bill-check]").click();
      await vi.waitFor(() => expect(q(el, "[data-test=bill-action-result]")).not.toBeNull());
      const result = q(el, "[data-test=bill-action-result]");
      expect(result.textContent).toContain(
        outcome === "completed" ? "Refund completed" : "Refund not made",
      );
      expect(result.textContent).toContain("The original invoice is unchanged.");
      expect(result.textContent).not.toContain("bill has been updated");
      await vi.waitFor(() => expect(q(el, "[data-test=tender-refund-tr-1]")).toBeNull());
    },
  );

  it.each(["success", "failure"])(
    "keeps a live snapshot delivered before an older manual refresh's %s",
    async (outcome) => {
      let release!: () => void;
      const reads = vi
        .fn()
        .mockResolvedValueOnce([refund])
        .mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          if (outcome === "failure") throw { code: "connection.failed" };
          return [refund];
        })
        .mockResolvedValue([]);
      const { el, api } = await mount(stub({ listStuckTenderRefunds: reads }));
      q(el, "[data-test=refresh-bill-recovery]").click();
      await vi.waitFor(() => expect(typeof release).toBe("function"));
      api.liveData.invalidate([{ type: "tender_refunds" }]);
      await vi.waitFor(() => expect(q(el, "[data-test=tender-refund-tr-1]")).toBeNull());
      release();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await el.updateComplete;
      expect(reads).toHaveBeenCalledTimes(3);
      expect(q(el, "[data-test=tender-refund-tr-1]")).toBeNull();
      expect(q(el, "[data-test=bill-load-error]")).toBeNull();
    },
  );

  it("does not let a departed provider check overwrite or release a replacement attestation", async () => {
    let finishCheck!: (value: { outcome: "completed" }) => void;
    let finishAttest!: (value: { outcome: "completed" }) => void;
    const { el, host } = await mount(
      stub({
        resolveStuckTenderRefund: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              finishCheck = resolve;
            }),
        ),
        attestStuckTenderRefund: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              finishAttest = resolve;
            }),
        ),
      }),
    );
    await open(el, "check");
    q(el, "[data-test=confirm-bill-check]").click();
    await vi.waitFor(() => expect(typeof finishCheck).toBe("function"));
    el.remove();
    host.append(el);
    await el.updateComplete;
    await open(el, "attest");
    await fill(el);
    q(el, "[data-test=confirm-bill-attest]").click();
    await vi.waitFor(() => expect(typeof finishAttest).toBe("function"));
    finishCheck({ outcome: "completed" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await el.updateComplete;
    expect(q(el, "[data-test=bill-action-result]")).toBeNull();
    expect(
      (q(el, "[data-test=bill-attest-dialog]") as HTMLElementTagNameMap["wt-dialog"]).dismissible,
    ).toBe(false);
    expect((q(el, "[name=note]") as HTMLElementTagNameMap["wt-input"]).value).toBe(
      "Provider confirmed no return",
    );
    finishAttest({ outcome: "completed" });
    await vi.waitFor(() => expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull());
  });

  for (const theme of ["light", "dark"] as const) {
    it(`has accessible pending and attestation states in ${theme}`, async () => {
      const { el, host } = await mount(stub(), theme);
      await expectNoA11yViolations(host);
      await open(el, "attest");
      await expectNoA11yViolations(host);
    });
  }
});
