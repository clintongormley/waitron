import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
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
    expect((q(el, "wt-form-error-summary") as unknown as { errors: string[] }).errors).toEqual([
      t("payments.stripe.secret_key_required"),
    ]);
  });

  it("shows the not-accepted copy when the key is rejected", async () => {
    const request = vi.fn(async () => {
      throw { code: "payment.provider_credential_rejected" };
    }) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeConnectForm>("stripe-connect-form", { request });

    await setInput(el, "secret-key", "sk_bad");
    await connect(el);

    expect((q(el, "wt-form-error-summary") as unknown as { errors: string[] }).errors).toEqual([
      t("payments.stripe.connect_failed"),
    ]);
  });
});
