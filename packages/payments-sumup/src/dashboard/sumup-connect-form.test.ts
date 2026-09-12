import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "./strings.js";
import { SumUpConnectForm } from "./sumup-connect-form.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
});

const CONNECT_PATH = "/management-api/payments/providers/sumup/connect";

function q(el: SumUpConnectForm, sel: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(sel);
}

function text(el: SumUpConnectForm, sel: string): string {
  return q(el, sel)?.textContent?.trim() ?? "";
}

async function setInput(el: SumUpConnectForm, testId: string, value: string): Promise<void> {
  q(el, `[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

async function connect(el: SumUpConnectForm): Promise<void> {
  q(el, "[data-test=connect]")!.click();
  await el.updateComplete;
  await el.updateComplete; // one more for the post-await state settle
}

describe("sumup-connect-form", () => {
  it("posts the API key and shows the merchant name for confirmation, then calls onConnected", async () => {
    const request = vi.fn(async () => ({
      merchantName: "Deli Gormley",
    })) as unknown as DashboardRequest;
    const onConnected = vi.fn();
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", {
      request,
      onConnected,
    });

    await setInput(el, "api-key", "sup_sk_live_key");
    await connect(el);

    expect(request).toHaveBeenCalledWith(CONNECT_PATH, "POST", { apiKey: "sup_sk_live_key" });
    expect(text(el, "[data-test=connected]")).toBe(
      t("payments.sumup.connected_as").replace("{name}", "Deli Gormley"),
    );
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("offers a merchant picker on an ambiguous key and re-submits with the chosen merchantCode", async () => {
    const merchants = [
      { code: "M1", name: "Deli One" },
      { code: "M2", name: "Deli Two" },
    ];
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw { code: "payment.provider_merchant_ambiguous", params: { merchants } };
      })
      .mockImplementationOnce(async () => ({
        merchantName: "Deli Two",
      })) as unknown as DashboardRequest;
    const onConnected = vi.fn();
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", {
      request,
      onConnected,
    });

    await setInput(el, "api-key", "spans_two_merchants");
    await connect(el);

    // The picker is shown, no error banner yet.
    const select = q(el, "[data-test=merchant]") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect((q(el, "wt-form-error-summary") as unknown as { errors: string[] }).errors).toEqual([]);

    // Choose the second merchant and connect again.
    select!.value = "M2";
    select!.dispatchEvent(new Event("change"));
    await el.updateComplete;
    await connect(el);

    expect(request).toHaveBeenLastCalledWith(CONNECT_PATH, "POST", {
      apiKey: "spans_two_merchants",
      merchantCode: "M2",
    });
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(text(el, "[data-test=connected]")).toBe(
      t("payments.sumup.connected_as").replace("{name}", "Deli Two"),
    );
  });

  it("requires the API key before it will post", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await connect(el);

    expect(request).not.toHaveBeenCalled();
    expect((q(el, "wt-form-error-summary") as unknown as { errors: string[] }).errors).toEqual([
      t("payments.sumup.api_key_required"),
    ]);
  });

  it("shows the SumUp not-accepted copy when the key is rejected", async () => {
    const request = vi.fn(async () => {
      throw { code: "payment.provider_credential_rejected" };
    }) as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "api-key", "bad_key");
    await connect(el);

    expect((q(el, "wt-form-error-summary") as unknown as { errors: string[] }).errors).toEqual([
      t("payments.sumup.connect_failed"),
    ]);
  });

  it("carries the optional affiliate fields through and reveals their help tooltip", async () => {
    const request = vi.fn(async () => ({ merchantName: "Deli" })) as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    expect(q(el, "[data-test=affiliate-help]")).not.toBeNull();
    await setInput(el, "api-key", "k");
    await setInput(el, "affiliate-app-id", "app-1");
    await setInput(el, "affiliate-key", "aff-key");
    await connect(el);

    expect(request).toHaveBeenCalledWith(CONNECT_PATH, "POST", {
      apiKey: "k",
      affiliateAppId: "app-1",
      affiliateKey: "aff-key",
    });
  });
});
