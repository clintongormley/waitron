import { afterEach, describe, expect, it, vi } from "vitest";
import {
  codeMessage,
  currentLocale,
  registerCodeMessages,
  setLocale,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
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

async function bottomOf(el: SumUpConnectForm): Promise<string> {
  const actions = q(el, "wt-form-actions") as HTMLElement & { updateComplete: Promise<unknown> };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

function fieldError(el: SumUpConnectForm, testId: string): string {
  return (q(el, `[data-test=${testId}]`) as unknown as { error: string }).error;
}

function connectDisabled(el: SumUpConnectForm): boolean {
  return q(el, "[data-test=connect]")!.hasAttribute("disabled");
}

function focused(el: SumUpConnectForm, testId: string): boolean {
  const field = q(el, `[data-test=${testId}]`)!;
  return field.shadowRoot!.activeElement === field.shadowRoot!.querySelector("input");
}

async function chooseMerchant(el: SumUpConnectForm, code: string): Promise<void> {
  await chooseOption(q(el, "[data-test=merchant]")!, code);
  await el.updateComplete;
}

/** The shared dropdown's own button, which carries its invalid mark and description. */
function merchantTrigger(el: SumUpConnectForm): HTMLButtonElement {
  return q(el, "[data-test=merchant]")!.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
}

type MerchantField = HTMLElement & {
  name: string;
  label: string;
  value: string;
  required: boolean;
  placeholder: string;
  search: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  options: { value: string; label: string }[];
};

function ambiguousThenPending(merchants: { code: string; name: string }[]): DashboardRequest {
  return vi
    .fn()
    .mockImplementationOnce(async () => {
      throw { code: "payment.provider_merchant_ambiguous", params: { merchants } };
    })
    .mockImplementation(() => new Promise(() => {})) as unknown as DashboardRequest;
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

    // The picker is shown, no error message yet.
    const select = q(el, "[data-test=merchant]") as MerchantField | null;
    expect(select).not.toBeNull();
    expect(await bottomOf(el)).toBe("");
    expect(fieldError(el, "merchant")).toBe("");

    // Choose the second merchant and connect again.
    await chooseOption(select!, "M2");
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
    expect(fieldError(el, "api-key")).toBe(t("payments.sumup.api_key_required"));
  });

  // `payment.provider_credential_rejected` carries only `{ providerId }` and is also thrown when
  // the call to SumUp fails for any other reason, so it names no field.
  it("shows the SumUp not-accepted copy above Connect, not under the key, when the key is rejected", async () => {
    const request = vi.fn(async () => {
      throw { code: "payment.provider_credential_rejected" };
    }) as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "api-key", "bad_key");
    await connect(el);

    expect(await bottomOf(el)).toBe(t("payments.sumup.connect_failed"));
    expect(fieldError(el, "api-key")).toBe("");
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

  it("refuses to re-submit an ambiguous key until a merchant is picked", async () => {
    const request = vi.fn(async () => {
      throw {
        code: "payment.provider_merchant_ambiguous",
        params: { merchants: [{ code: "M1", name: "Deli One" }] },
      };
    }) as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "api-key", "spans_two_merchants");
    await connect(el);
    expect(q(el, "[data-test=merchant]")).not.toBeNull();

    await connect(el);

    expect(request).toHaveBeenCalledTimes(1);
    expect(fieldError(el, "merchant")).toBe(t("payments.sumup.merchant_required"));
  });

  it("sends one connect request when Connect is pressed again while the first is in flight", async () => {
    let respond!: (value: { merchantName: string }) => void;
    const request = vi.fn(
      () =>
        new Promise<{ merchantName: string }>((r) => {
          respond = r;
        }),
    ) as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "api-key", "sup_sk_live_key");
    await connect(el);
    await connect(el);
    expect(request).toHaveBeenCalledTimes(1);

    respond({ merchantName: "Deli Gormley" });
    await el.updateComplete;
    await el.updateComplete;
    expect(text(el, "[data-test=connected]")).toBe(
      t("payments.sumup.connected_as").replace("{name}", "Deli Gormley"),
    );
  });

  it("shows the shared code copy for a rejection other than a refused key", async () => {
    registerCodeMessages({
      "payment.provider_unknown": {
        en: "Provider copy for this test",
        es: "Provider copy for this test (es)",
      },
    });
    const request = vi.fn(async () => {
      throw { code: "payment.provider_unknown" };
    }) as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "api-key", "k");
    await connect(el);

    expect(await bottomOf(el)).toBe(codeMessage("payment.provider_unknown"));
    expect(codeMessage("payment.provider_unknown")).not.toBe(t("payments.sumup.connect_failed"));
    expect(codeMessage("payment.provider_unknown")).not.toBe(codeMessage("server.internal"));
  });

  it("says nothing about errors before the first press, and Connect works", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "api-key", "k");
    await setInput(el, "api-key", "  ");

    expect(fieldError(el, "api-key")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(connectDisabled(el)).toBe(false);
  });

  it("on an invalid press marks the key, says so above Connect, focuses the key and disables Connect", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "affiliate-app-id", "app-1");
    await connect(el);

    expect(request).not.toHaveBeenCalled();
    expect(fieldError(el, "api-key")).toBe(t("payments.sumup.api_key_required"));
    expect(await bottomOf(el)).toBe(t("payments.sumup.fix_fields"));
    expect(connectDisabled(el)).toBe(true);
    await vi.waitFor(() => expect(focused(el, "api-key")).toBe(true));
    expect((q(el, "[data-test=affiliate-app-id]") as unknown as { value: string }).value).toBe(
      "app-1",
    );
  });

  it("re-checks every change after a failed press, and Connect works again once the key is filled", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await connect(el);
    await setInput(el, "api-key", "k");

    expect(fieldError(el, "api-key")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(connectDisabled(el)).toBe(false);

    await setInput(el, "api-key", "");
    expect(fieldError(el, "api-key")).toBe(t("payments.sumup.api_key_required"));
    expect(connectDisabled(el)).toBe(true);
  });

  it("leaves Connect working after a credential refusal, so the same key can be retried, and drops the message on the next press", async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw { code: "payment.provider_credential_rejected" };
      })
      .mockImplementationOnce(() => new Promise(() => {})) as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "api-key", "k");
    await connect(el);

    expect(await bottomOf(el)).toBe(t("payments.sumup.connect_failed"));
    expect(connectDisabled(el)).toBe(false);

    await connect(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(CONNECT_PATH, "POST", { apiKey: "k" });
    expect(await bottomOf(el)).toBe("");
    expect(fieldError(el, "api-key")).toBe("");
  });

  it("leaves Connect working after a refusal that names no field, and drops it on the next press", async () => {
    registerCodeMessages({
      "payment.provider_unknown": {
        en: "Provider copy for this test",
        es: "Provider copy for this test (es)",
      },
    });
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw { code: "payment.provider_unknown" };
      })
      .mockImplementationOnce(() => new Promise(() => {})) as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "api-key", "k");
    await connect(el);

    expect(fieldError(el, "api-key")).toBe("");
    expect(await bottomOf(el)).toBe(codeMessage("payment.provider_unknown"));
    expect(connectDisabled(el)).toBe(false);

    await connect(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect(await bottomOf(el)).toBe("");
  });

  it("says a refusal and the generic sentence together when the key then breaks", async () => {
    registerCodeMessages({
      "payment.provider_unknown": {
        en: "Provider copy for this test",
        es: "Provider copy for this test (es)",
      },
    });
    const request = vi.fn(async () => {
      throw { code: "payment.provider_unknown" };
    }) as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "api-key", "k");
    await connect(el);
    await setInput(el, "api-key", "");

    expect(await bottomOf(el)).toBe(
      `${codeMessage("payment.provider_unknown")} ${t("payments.sumup.fix_fields")}`,
    );
    expect(connectDisabled(el)).toBe(true);
  });

  it("marks an unpicked merchant on a press, focuses the picker, and clears once one is chosen", async () => {
    const request = ambiguousThenPending([
      { code: "M1", name: "Deli One" },
      { code: "M2", name: "Deli Two" },
    ]);
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await setInput(el, "api-key", "spans_two_merchants");
    await connect(el);
    const select = q(el, "[data-test=merchant]") as MerchantField;
    expect(select.required).toBe(true);
    expect(merchantTrigger(el).getAttribute("aria-invalid")).toBe("false");

    await connect(el);

    expect(merchantTrigger(el).getAttribute("aria-invalid")).toBe("true");
    expect(
      select.shadowRoot!.getElementById(merchantTrigger(el).getAttribute("aria-describedby")!)!
        .textContent,
    ).toBe(t("payments.sumup.merchant_required"));
    expect(fieldError(el, "merchant")).toBe(t("payments.sumup.merchant_required"));
    expect(await bottomOf(el)).toBe(t("payments.sumup.fix_fields"));
    expect(connectDisabled(el)).toBe(true);
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(select));

    await chooseMerchant(el, "M1");

    expect(merchantTrigger(el).getAttribute("aria-invalid")).toBe("false");
    expect(fieldError(el, "merchant")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(connectDisabled(el)).toBe(false);
  });

  it.each([
    [
      "en",
      "Merchant",
      "This key covers more than one merchant. Choose which one to connect.",
      "Search",
      "No results",
    ],
    [
      "es",
      "Comercio",
      "Esta clave abarca más de un comercio. Elige cuál conectar.",
      "Buscar",
      "Sin resultados",
    ],
  ] as const)(
    "asks for the merchant in the shared dropdown, with the reason it is asked above it (%s)",
    async (locale, label, prompt, search, noResults) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const request = ambiguousThenPending([
          { code: "M1", name: "Deli One" },
          { code: "M2", name: "Deli Two" },
        ]);
        const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });
        await setInput(el, "api-key", "spans_two_merchants");
        await connect(el);
        const merchant = q(el, "wt-combobox[name=merchantCode]") as MerchantField | null;
        expect(merchant).not.toBeNull();
        expect(merchant!.label).toBe(label);
        expect(text(el, "[data-test=merchant-prompt]")).toBe(prompt);
        expect(merchant!.required).toBe(true);
        expect(merchant!.options).toEqual([
          { value: "M1", label: "Deli One" },
          { value: "M2", label: "Deli Two" },
        ]);
        expect(merchant!.value).toBe("");
        expect(merchant!.search).toBe("auto");
        expect(merchant!.searchPlaceholder).toBe(search);
        expect(merchant!.noResultsLabel).toBe(noResults);
      } finally {
        setLocale(before);
      }
    },
  );

  it("keeps a merchant's change inside the form", async () => {
    const request = ambiguousThenPending([{ code: "M1", name: "Deli One" }]);
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });
    await setInput(el, "api-key", "spans_two_merchants");
    await connect(el);
    const heard = vi.fn();
    document.addEventListener("wt-change", heard);
    try {
      await chooseMerchant(el, "M1");
    } finally {
      document.removeEventListener("wt-change", heard);
    }
    expect(heard).not.toHaveBeenCalled();
  });

  it("has no error summary above the fields", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<SumUpConnectForm>("sumup-connect-form", { request });

    await connect(el);

    expect(q(el, "wt-form-error-summary")).toBeNull();
  });
});
