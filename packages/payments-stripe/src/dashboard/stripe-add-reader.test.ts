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

async function bottomOf(el: StripeAddReader): Promise<string> {
  const actions = q(el, "wt-form-actions") as HTMLElement & { updateComplete: Promise<unknown> };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

function fieldError(el: StripeAddReader, testId: string): string {
  return (q(el, `[data-test=${testId}]`) as unknown as { error: string }).error;
}

function addDisabled(el: StripeAddReader): boolean {
  return q(el, "[data-test=add]")!.hasAttribute("disabled");
}

function focused(el: StripeAddReader, testId: string): boolean {
  const field = q(el, `[data-test=${testId}]`)!;
  return field.shadowRoot!.activeElement === field.shadowRoot!.querySelector("input");
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
    expect(fieldError(el, "reader-name")).toBe(t("payments.stripe.reader_name_required"));
    expect(fieldError(el, "reader-id")).toBe(t("payments.stripe.reader_id_required"));
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

    expect(await bottomOf(el)).toBe(t("payments.stripe.add_failed"));
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
    expect(await bottomOf(el)).toBe("");
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
    // The browser reports a close a task after the dialog shuts, which can be after the key press
    // resolves; this listener runs after wt-dialog's own, so onClose has been called by then.
    const reported = new Promise<void>((resolve) => {
      native.addEventListener("close", () => resolve(), { once: true });
    });

    await userEvent.keyboard("{Escape}");

    expect(native.open).toBe(false);
    await reported;
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

  it("calls onClose once when Cancel is pressed while Add is pending, and still reports the added reader", async () => {
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
    q(el, "[data-test=add]")!.click();
    await el.updateComplete;
    q(el, "[data-test=cancel]")!.click();
    expect(onClose).toHaveBeenCalledTimes(1);

    pending.resolve({ id: "row-1", status: "paired" });
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when the dialog was detached while Add was pending", async () => {
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
    q(el, "[data-test=add]")!.click();
    await el.updateComplete;
    el.remove();

    pending.resolve({ id: "row-1", status: "paired" });
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
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

    expect(await bottomOf(el)).toBe(t("payments.stripe.add_failed"));
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

    expect(await bottomOf(el)).toBe("Stripe add-reader copy for this test");
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("says nothing about errors before the first press, and Add works", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-name", "");

    expect(fieldError(el, "reader-name")).toBe("");
    expect(fieldError(el, "reader-id")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(addDisabled(el)).toBe(false);
  });

  it("on an invalid press marks the fields, says so beside Add, focuses the first and disables Add", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-id", "tmr_ABC123");
    await add(el);

    expect(request).not.toHaveBeenCalled();
    expect(fieldError(el, "reader-name")).toBe(t("payments.stripe.reader_name_required"));
    expect(fieldError(el, "reader-id")).toBe("");
    expect(await bottomOf(el)).toBe(t("payments.stripe.fix_fields"));
    expect(addDisabled(el)).toBe(true);
    await vi.waitFor(() => expect(focused(el, "reader-name")).toBe(true));
    expect((q(el, "[data-test=reader-id]") as unknown as { value: string }).value).toBe(
      "tmr_ABC123",
    );
  });

  it("re-checks every change after a failed press, and Add works again once both are filled", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await add(el);
    await setInput(el, "reader-name", "Bar");
    expect(fieldError(el, "reader-name")).toBe("");
    expect(fieldError(el, "reader-id")).toBe(t("payments.stripe.reader_id_required"));
    expect(addDisabled(el)).toBe(true);

    await setInput(el, "reader-id", "tmr_ABC123");
    expect(fieldError(el, "reader-id")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(addDisabled(el)).toBe(false);

    await setInput(el, "reader-name", " ");
    expect(fieldError(el, "reader-name")).toBe(t("payments.stripe.reader_name_required"));
    expect(addDisabled(el)).toBe(true);
  });

  it("leaves Add working after a refusal that names no field, and drops it on the next press", async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw { code: "server.internal" };
      })
      .mockImplementationOnce(() => new Promise(() => {})) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_bad");
    await add(el);

    expect(await bottomOf(el)).toBe(t("payments.stripe.add_failed"));
    expect(fieldError(el, "reader-id")).toBe("");
    expect(addDisabled(el)).toBe(false);

    await add(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect(await bottomOf(el)).toBe("");
  });

  it("ends in one action row with Cancel on the left and Add as the primary action", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    const actions = q(el, "wt-form-actions")!;
    expect(actions.getAttribute("slot")).toBe("footer");
    expect(actions.querySelector("[data-test=cancel]")!.getAttribute("slot")).toBe("cancel");
    expect(actions.querySelector("[data-test=add]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "wt-form-error-summary")).toBeNull();
  });
});
