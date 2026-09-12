import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "./strings.js";
import { StripeAddReader } from "./stripe-add-reader.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
});

const READERS_PATH = "/management-api/payments/readers";

function q(el: StripeAddReader, sel: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(sel);
}

async function setInput(el: StripeAddReader, testId: string, value: string): Promise<void> {
  q(el, `[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

async function add(el: StripeAddReader): Promise<void> {
  q(el, "[data-test=add]")!.click();
  await el.updateComplete;
  await el.updateComplete;
}

describe("stripe-add-reader", () => {
  it("posts the reader reference and emits onAdded then closes", async () => {
    const request = vi.fn(async () => ({
      id: "row-1",
      status: "paired",
    })) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", {
      request,
      onAdded,
      onClose,
    });

    expect(q(el, "[data-test=reader-id]")).not.toBeNull();
    expect(q(el, "[data-test=reader-id-help]")).not.toBeNull();

    await setInput(el, "reader-name", "Bar terminal");
    await setInput(el, "reader-id", "tmr_ABC123");
    await add(el);

    expect(request).toHaveBeenCalledWith(READERS_PATH, "POST", {
      providerId: "stripe",
      name: "Bar terminal",
      reference: "tmr_ABC123",
    });
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks the add until the name and reference are filled", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await add(el);

    expect(request).not.toHaveBeenCalled();
    expect((q(el, "wt-form-error-summary") as unknown as { errors: string[] }).errors).toEqual([
      t("payments.stripe.reader_name_required"),
      t("payments.stripe.reader_id_required"),
    ]);
  });

  it("shows the not-accepted copy when the reference is rejected", async () => {
    const request = vi.fn(async () => {
      throw { code: "reader.not_found" };
    }) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request, onAdded });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_bad");
    await add(el);

    expect((q(el, "wt-form-error-summary") as unknown as { errors: string[] }).errors).toEqual([
      t("payments.stripe.add_failed"),
    ]);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("closes without adding when cancelled", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const onClose = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request, onClose });

    q(el, "[data-test=cancel]")!.click();
    await el.updateComplete;
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });
});
