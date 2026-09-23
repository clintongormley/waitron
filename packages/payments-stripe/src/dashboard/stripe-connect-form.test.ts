import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCodeMessages, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "./strings.js";
import { StripeConnectForm } from "./stripe-connect-form.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
});

const CONNECT_PATH = "/management-api/payments/providers/stripe/connect";

function q(el: StripeConnectForm, sel: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(sel);
}

function textOf(el: StripeConnectForm, sel: string): string {
  return q(el, sel)?.textContent?.trim() ?? "";
}

async function setInput(el: StripeConnectForm, testId: string, value: string): Promise<void> {
  q(el, `[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

function errorsOf(el: StripeConnectForm): string[] {
  return (q(el, "wt-form-error-summary") as unknown as { errors: string[] }).errors;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function connect(el: StripeConnectForm): Promise<void> {
  q(el, "[data-test=connect]")!.click();
  await el.updateComplete;
  await el.updateComplete;
}

describe("stripe-connect-form", () => {
  it("posts the four fields and shows the merchant name, then calls onConnected", async () => {
    const request = vi.fn(async () => ({
      merchantName: "Deli Gormley",
    })) as unknown as DashboardRequest;
    const onConnected = vi.fn();
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", {
      request,
      onConnected,
    });

    await setInput(el, "secret-key", "sk_test_123");
    await setInput(el, "webhook-secret", "whsec_1");
    await setInput(el, "success-url", "https://ok");
    await setInput(el, "cancel-url", "https://no");
    await connect(el);

    expect(request).toHaveBeenCalledWith(CONNECT_PATH, "POST", {
      secretKey: "sk_test_123",
      webhookSecret: "whsec_1",
      successUrl: "https://ok",
      cancelUrl: "https://no",
    });
    expect(textOf(el, "[data-test=connected]")).toBe(
      t("payments.stripe.connected_as").replace("{name}", "Deli Gormley"),
    );
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("requires the secret key before it will post", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await connect(el);

    expect(request).not.toHaveBeenCalled();
    expect(errorsOf(el)).toEqual([t("payments.stripe.secret_key_required")]);
  });

  it("shows the not-accepted copy when the key is rejected", async () => {
    const request = vi.fn(async () => {
      throw { code: "payment.provider_credential_rejected" };
    }) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await setInput(el, "secret-key", "sk_bad");
    await connect(el);

    expect(errorsOf(el)).toEqual([t("payments.stripe.connect_failed")]);
  });

  it("shows the merchant name when the host sets no onConnected", async () => {
    const request = vi.fn(async () => ({
      merchantName: "Deli Gormley",
    })) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await setInput(el, "secret-key", "sk_test_123");
    await connect(el);

    expect(request).toHaveBeenCalledTimes(1);
    expect(textOf(el, "[data-test=connected]")).toBe(
      t("payments.stripe.connected_as").replace("{name}", "Deli Gormley"),
    );
    // The confirmation replaces the form, so a failure after the name is set would not show in the
    // DOM; the component's own error list is the only place it would land.
    expect((el as unknown as { errors: string[] }).errors).toEqual([]);
  });

  it("sends one connect request when Connect is pressed twice before the first answers", async () => {
    const pending = deferred<{ merchantName: string }>();
    const request = vi.fn(() => pending.promise) as unknown as DashboardRequest;
    const onConnected = vi.fn();
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", {
      request,
      onConnected,
    });

    await setInput(el, "secret-key", "sk_test_123");
    // `.click()` on the host reaches the handler even while the inner button is disabled, so only
    // the single-flight guard stops the second request.
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;
    q(el, "[data-test=connect]")!.click();
    await el.updateComplete;

    expect(request).toHaveBeenCalledTimes(1);
    expect((q(el, "[data-test=connect]") as unknown as { loading: boolean }).loading).toBe(true);
    expect(q(el, "[data-test=connected]")).toBeNull();

    pending.resolve({ merchantName: "Deli Gormley" });
    await el.updateComplete;
    await el.updateComplete;

    expect(request).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(textOf(el, "[data-test=connected]")).toBe(
      t("payments.stripe.connected_as").replace("{name}", "Deli Gormley"),
    );
  });

  it("shows the shared code copy for a rejection other than a refused key", async () => {
    registerCodeMessages({
      "payment.provider_unknown": {
        en: "Stripe connect copy for this test",
        es: "Stripe connect copy for this test",
      },
    });
    const request = vi.fn(async () => {
      throw { code: "payment.provider_unknown" };
    }) as unknown as DashboardRequest;
    const onConnected = vi.fn();
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", {
      request,
      onConnected,
    });

    await setInput(el, "secret-key", "sk_test_123");
    await connect(el);

    expect(errorsOf(el)).toEqual(["Stripe connect copy for this test"]);
    expect(onConnected).not.toHaveBeenCalled();
    expect(q(el, "[data-test=connected]")).toBeNull();
  });
});
