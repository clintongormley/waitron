import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { registerCodeMessages, type DashboardRequest } from "@waitron/dashboard-kit";
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

function errorsOf(el: StripeAddReader): string[] {
  return (q(el, "wt-form-error-summary") as unknown as { errors: string[] }).errors;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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
    expect(errorsOf(el)).toEqual([
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

    expect(errorsOf(el)).toEqual([t("payments.stripe.add_failed")]);
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

  it("completes an add when the host sets neither onAdded nor onClose", async () => {
    const request = vi.fn(async () => ({
      id: "row-1",
      status: "paired",
    })) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-name", "Bar terminal");
    await setInput(el, "reader-id", "tmr_ABC123");
    await add(el);

    expect(request).toHaveBeenCalledWith(READERS_PATH, "POST", {
      providerId: "stripe",
      name: "Bar terminal",
      reference: "tmr_ABC123",
    });
    expect(errorsOf(el)).toEqual([]);
    expect((q(el, "[data-test=add]") as unknown as { loading: boolean }).loading).toBe(false);
  });

  it("calls onClose once when the dialog is dismissed with Escape", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", {
      request,
      onAdded,
      onClose,
    });
    const dialog = q(el, "wt-dialog") as HTMLElement & { updateComplete: Promise<unknown> };
    await dialog.updateComplete;
    const native = dialog.shadowRoot!.querySelector("dialog")!;
    expect(native.open).toBe(true);

    await userEvent.keyboard("{Escape}");

    expect(native.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdded).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("sends one add request when Add is pressed twice before the first answers", async () => {
    const pending = deferred<{ id: string; status: string }>();
    const request = vi.fn(() => pending.promise) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", {
      request,
      onAdded,
      onClose,
    });

    await setInput(el, "reader-name", "Bar terminal");
    await setInput(el, "reader-id", "tmr_ABC123");
    // `.click()` on the host reaches the handler even while the inner button is disabled, so only
    // the single-flight guard stops the second request.
    q(el, "[data-test=add]")!.click();
    await el.updateComplete;
    q(el, "[data-test=add]")!.click();
    await el.updateComplete;

    expect(request).toHaveBeenCalledTimes(1);
    expect((q(el, "[data-test=add]") as unknown as { loading: boolean }).loading).toBe(true);
    expect(onAdded).not.toHaveBeenCalled();

    pending.resolve({ id: "row-1", status: "paired" });
    await el.updateComplete;
    await el.updateComplete;

    expect(request).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect((q(el, "[data-test=add]") as unknown as { loading: boolean }).loading).toBe(false);
  });

  it("shows the not-accepted copy when the server fails internally", async () => {
    const request = vi.fn(async () => {
      throw { code: "server.internal" };
    }) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request, onAdded });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_bad");
    await add(el);

    expect(errorsOf(el)).toEqual([t("payments.stripe.add_failed")]);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("shows the shared code copy for any other rejection", async () => {
    registerCodeMessages({
      "payment.provider_unknown": {
        en: "Stripe add-reader copy for this test",
        es: "Stripe add-reader copy for this test",
      },
    });
    const request = vi.fn(async () => {
      throw { code: "payment.provider_unknown" };
    }) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request, onAdded });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_ABC123");
    await add(el);

    expect(errorsOf(el)).toEqual(["Stripe add-reader copy for this test"]);
    expect(onAdded).not.toHaveBeenCalled();
  });
});
