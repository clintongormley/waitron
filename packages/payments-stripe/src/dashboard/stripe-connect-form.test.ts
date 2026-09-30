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

async function bottomOf(el: StripeConnectForm): Promise<string> {
  const actions = q(el, "wt-form-actions") as HTMLElement & { updateComplete: Promise<unknown> };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

function fieldError(el: StripeConnectForm, testId: string): string {
  return (q(el, `[data-test=${testId}]`) as unknown as { error: string }).error;
}

function connectDisabled(el: StripeConnectForm): boolean {
  return q(el, "[data-test=connect]")!.hasAttribute("disabled");
}

function focused(el: StripeConnectForm, testId: string): boolean {
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
    expect(fieldError(el, "secret-key")).toBe(t("payments.stripe.secret_key_required"));
  });

  // `payment.provider_credential_rejected` carries only `{ providerId }` and is also thrown when
  // the call to Stripe fails for any other reason, so it names no field.
  it("shows the not-accepted copy above Connect, not under the key, when the key is rejected", async () => {
    const request = vi.fn(async () => {
      throw { code: "payment.provider_credential_rejected" };
    }) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await setInput(el, "secret-key", "sk_bad");
    await connect(el);

    expect(await bottomOf(el)).toBe(t("payments.stripe.connect_failed"));
    expect(fieldError(el, "secret-key")).toBe("");
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
    // DOM; the component's own refusal state is the only place it would land.
    expect((el as unknown as { refusal: string }).refusal).toBe("");
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

    expect(await bottomOf(el)).toBe("Stripe connect copy for this test");
    expect(onConnected).not.toHaveBeenCalled();
    expect(q(el, "[data-test=connected]")).toBeNull();
  });

  it("says nothing about errors before the first press, and Connect works", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await setInput(el, "secret-key", "sk_test_1");
    await setInput(el, "secret-key", "  ");

    expect(fieldError(el, "secret-key")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(connectDisabled(el)).toBe(false);
  });

  it("on an invalid press marks the key, says so above Connect, focuses the key and disables Connect", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await setInput(el, "webhook-secret", "whsec_1");
    await connect(el);

    expect(request).not.toHaveBeenCalled();
    expect(fieldError(el, "secret-key")).toBe(t("payments.stripe.secret_key_required"));
    expect(await bottomOf(el)).toBe(t("payments.stripe.fix_fields"));
    expect(connectDisabled(el)).toBe(true);
    await vi.waitFor(() => expect(focused(el, "secret-key")).toBe(true));
    expect((q(el, "[data-test=webhook-secret]") as unknown as { value: string }).value).toBe(
      "whsec_1",
    );
  });

  it("re-checks every change after a failed press, and Connect works again once the key is filled", async () => {
    const request = vi.fn(async () => ({ merchantName: "Deli" })) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await connect(el);
    await setInput(el, "secret-key", "sk_test_1");

    expect(fieldError(el, "secret-key")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(connectDisabled(el)).toBe(false);

    await setInput(el, "secret-key", " ");
    expect(fieldError(el, "secret-key")).toBe(t("payments.stripe.secret_key_required"));
    expect(await bottomOf(el)).toBe(t("payments.stripe.fix_fields"));
    expect(connectDisabled(el)).toBe(true);
  });

  it("leaves Connect working after a credential refusal, so the same key can be retried, and drops the message on the next press", async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw { code: "payment.provider_credential_rejected" };
      })
      .mockImplementationOnce(() => new Promise(() => {})) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await setInput(el, "secret-key", "sk_test_1");
    await connect(el);

    expect(await bottomOf(el)).toBe(t("payments.stripe.connect_failed"));
    expect(connectDisabled(el)).toBe(false);

    await connect(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      CONNECT_PATH,
      "POST",
      expect.objectContaining({ secretKey: "sk_test_1" }),
    );
    expect(await bottomOf(el)).toBe("");
    expect(fieldError(el, "secret-key")).toBe("");
  });

  it("leaves Connect working after a refusal that names no field, and drops it on the next press", async () => {
    registerCodeMessages({
      "payment.provider_unknown": {
        en: "Stripe connect copy for this test",
        es: "Stripe connect copy for this test",
      },
    });
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw { code: "payment.provider_unknown" };
      })
      .mockImplementationOnce(() => new Promise(() => {})) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await setInput(el, "secret-key", "sk_test_1");
    await connect(el);

    expect(fieldError(el, "secret-key")).toBe("");
    expect(await bottomOf(el)).toBe("Stripe connect copy for this test");
    expect(connectDisabled(el)).toBe(false);

    await connect(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect(await bottomOf(el)).toBe("");
  });

  it("says a refusal and the generic sentence together when the key then breaks", async () => {
    registerCodeMessages({
      "payment.provider_unknown": {
        en: "Stripe connect copy for this test",
        es: "Stripe connect copy for this test",
      },
    });
    const request = vi.fn(async () => {
      throw { code: "payment.provider_unknown" };
    }) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await setInput(el, "secret-key", "sk_test_1");
    await connect(el);
    await setInput(el, "secret-key", "");

    expect(await bottomOf(el)).toBe(
      `Stripe connect copy for this test ${t("payments.stripe.fix_fields")}`,
    );
    expect(connectDisabled(el)).toBe(true);
  });

  it("has no error summary above the fields", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await connect(el);

    expect(q(el, "wt-form-error-summary")).toBeNull();
  });
});
