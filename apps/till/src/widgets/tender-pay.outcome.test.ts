import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { WorkingOrderStore } from "../state/working-order.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillTenderPay, type CardOutcome } from "./tender-pay.js";

// A completed refusal must not offer a spinner that has no payment request behind it.
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe.each([
  { locale: "en-GB", retry: "Retry", cancel: "Cancel", declined: "Card declined" },
  { locale: "es-ES", retry: "Reintentar", cancel: "Cancelar", declined: "Tarjeta rechazada" },
])("a finished card request in $locale", ({ locale, retry, cancel, declined }) => {
  it("offers Retry and Cancel, with no way to wait on the completed request", async () => {
    setLocale(locale);
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", {
      store: new WorkingOrderStore(),
      cardOutcome: { outcome: "declined" },
    });
    expect(el.shadowRoot!.querySelector(".wait")).toBeNull();
    const buttons = [...el.shadowRoot!.querySelectorAll("wt-button")];
    expect(buttons.map((b) => b.textContent!.trim())).toEqual([retry, cancel]);
    expect(el.shadowRoot!.querySelector(".prompt")!.textContent).toBe(declined);
    const collect = vi.fn();
    el.addEventListener("collect-card", collect);
    await userEvent.click(page.getByRole("button", { name: cancel, exact: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".collecting")).toBeNull();
    expect(el.shadowRoot!.querySelector(".pay")).not.toBeNull();
    expect(collect).not.toHaveBeenCalled();
  });
});

const cases = [
  {
    outcome: "timeout",
    en: "The card reader did not answer",
    es: "El lector de tarjetas no ha respondido",
    retry: true,
  },
  {
    outcome: "network_unavailable",
    en: "The card reader did not answer",
    es: "El lector de tarjetas no ha respondido",
    retry: true,
  },
  {
    outcome: "declined",
    failureReason: "reader_unavailable",
    en: "The card reader did not answer",
    es: "El lector de tarjetas no ha respondido",
    retry: true,
  },
  {
    outcome: "declined",
    failureReason: "insufficient_funds",
    en: "Card declined: not enough funds",
    es: "Tarjeta rechazada: fondos insuficientes",
    retry: true,
  },
  {
    outcome: "declined",
    failureReason: "expired_card",
    en: "Card declined: card expired",
    es: "Tarjeta rechazada: tarjeta caducada",
    retry: true,
  },
  {
    outcome: "declined",
    failureReason: "incorrect_pin",
    en: "Card declined: wrong PIN",
    es: "Tarjeta rechazada: PIN incorrecto",
    retry: true,
  },
  ...["lost_card", "stolen_card", "pickup_card"].map((failureReason) => ({
    outcome: "declined" as const,
    failureReason,
    en: "Card declined: the bank asks you to keep this card. Do not retry.",
    es: "Tarjeta rechazada: el banco pide que retengas la tarjeta. No reintentes el pago.",
    retry: false,
  })),
  {
    outcome: "declined",
    failureReason: "provider_private_detail",
    en: "Card declined",
    es: "Tarjeta rechazada",
    retry: true,
  },
] as const;

describe.each(["en-GB", "es-ES"])("card failure messages in %s", (locale) => {
  it.each(cases)("$outcome / $failureReason is explained without an empty wait", async (row) => {
    setLocale(locale);
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", {
      store: new WorkingOrderStore(),
      cardOutcome: {
        outcome: row.outcome,
        ...("failureReason" in row ? { failureReason: row.failureReason } : {}),
      },
    });
    expect(el.shadowRoot!.querySelector(".prompt")!.textContent).toBe(
      locale === "es-ES" ? row.es : row.en,
    );
    const explanation = el.shadowRoot!.querySelector(".pending-check");
    if (row.outcome === "timeout") {
      expect(explanation?.textContent?.trim()).toBe(
        locale === "es-ES"
          ? "Waitron está comprobando el pago. El pedido sigue bloqueado hasta conocer el resultado. Si no se resuelve, pide a un encargado que lo consulte en Pagos con tarjeta."
          : "Waitron is checking the payment. This order stays locked until the result is known. If it stays unresolved, ask a manager to check Card payments.",
      );
    } else expect(explanation).toBeNull();
    expect(el.shadowRoot!.querySelector(".retry") !== null).toBe(row.retry);
    expect(el.shadowRoot!.querySelector(".wait")).toBeNull();
    expect(el.shadowRoot!.querySelector(".switch-tender")).not.toBeNull();
  });
});

it("cannot retry through a retained button after a keep-card refusal arrives", async () => {
  const { el } = await mountWidget<TillTenderPay>("till-tender-pay", {
    store: new WorkingOrderStore(),
    cardOutcome: { outcome: "declined" },
  });
  const retry = el.shadowRoot!.querySelector<HTMLElement>(".retry")!;
  const collect = vi.fn();
  el.addEventListener("collect-card", collect);
  el.cardOutcome = { outcome: "declined", failureReason: "lost_card" };
  retry.click();
  await el.updateComplete;
  expect(collect).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector(".retry")).toBeNull();
});

const moreReasons = [
  {
    codes: ["authentication_required", "authentication_not_handled"],
    en: "Card declined: authentication required",
    es: "Tarjeta rechazada: autenticación necesaria",
  },
  {
    codes: ["card_velocity_exceeded", "withdrawal_count_limit_exceeded"],
    en: "Card declined: card limit reached",
    es: "Tarjeta rechazada: límite de la tarjeta alcanzado",
  },
  {
    codes: ["card_not_supported"],
    en: "Card declined: this purchase is not supported",
    es: "Tarjeta rechazada: esta compra no está permitida",
  },
  {
    codes: ["currency_not_supported"],
    en: "Card declined: currency not supported",
    es: "Tarjeta rechazada: moneda no admitida",
  },
  {
    codes: ["duplicate_transaction"],
    en: "Card declined: a matching payment was made recently",
    es: "Tarjeta rechazada: ya se ha realizado un pago igual recientemente",
  },
  {
    codes: ["incorrect_address", "incorrect_zip"],
    en: "Card declined: wrong billing address",
    es: "Tarjeta rechazada: dirección de facturación incorrecta",
  },
  {
    codes: ["incorrect_cvc", "invalid_cvc"],
    en: "Card declined: wrong security code",
    es: "Tarjeta rechazada: código de seguridad incorrecto",
  },
  {
    codes: ["incorrect_number", "invalid_number"],
    en: "Card declined: wrong card number",
    es: "Tarjeta rechazada: número de tarjeta incorrecto",
  },
  {
    codes: ["invalid_account", "new_account_information_available"],
    en: "Card declined: card account is invalid",
    es: "Tarjeta rechazada: cuenta de la tarjeta no válida",
  },
  {
    codes: ["invalid_amount"],
    en: "Card declined: amount not allowed",
    es: "Tarjeta rechazada: importe no permitido",
  },
  {
    codes: ["invalid_expiry_month", "invalid_expiry_year"],
    en: "Card declined: wrong expiry date",
    es: "Tarjeta rechazada: fecha de caducidad incorrecta",
  },
  {
    codes: ["invalid_pin"],
    en: "Card declined: wrong PIN",
    es: "Tarjeta rechazada: PIN incorrecto",
  },
  {
    codes: ["issuer_not_available"],
    en: "Card declined: the bank did not answer",
    es: "Tarjeta rechazada: el banco no ha respondido",
  },
  {
    codes: ["offline_pin_required", "online_or_offline_pin_required"],
    en: "Card declined: insert the card and enter its PIN",
    es: "Tarjeta rechazada: inserta la tarjeta e introduce el PIN",
  },
  {
    codes: ["pin_try_exceeded"],
    en: "Card declined: too many PIN attempts",
    es: "Tarjeta rechazada: demasiados intentos de PIN",
  },
  {
    codes: ["processing_error", "reenter_transaction"],
    en: "Card declined: the payment could not be processed",
    es: "Tarjeta rechazada: no se ha podido procesar el pago",
  },
  {
    codes: ["restricted_card", "not_permitted"],
    en: "Card declined: this payment is not permitted",
    es: "Tarjeta rechazada: este pago no está permitido",
  },
  {
    codes: ["testmode_decline"],
    en: "Card declined: a test card was used",
    es: "Tarjeta rechazada: se ha usado una tarjeta de prueba",
  },
  {
    codes: ["mobile_device_authentication_required"],
    en: "Card declined: authenticate on the phone and tap again",
    es: "Tarjeta rechazada: autentícate en el móvil y vuelve a acercarlo",
  },
  { codes: ["customer_canceled"], en: "Card payment cancelled", es: "Pago con tarjeta cancelado" },
];

describe.each(["en-GB", "es-ES"])("other documented card reasons in %s", (locale) => {
  it.each(moreReasons)("$codes are shown in plain words", async ({ codes, en, es }) => {
    setLocale(locale);
    for (const failureReason of codes) {
      const { el } = await mountWidget<TillTenderPay>("till-tender-pay", {
        store: new WorkingOrderStore(),
        cardOutcome: { outcome: "declined", failureReason },
      });
      expect(el.shadowRoot!.querySelector(".prompt")!.textContent).toBe(
        locale === "es-ES" ? es : en,
      );
    }
  });
});

describe.each(["light", "dark"] as const)("card outcome layout in %s", (theme) => {
  it.each([390, 1280])("fits at %i px in both languages", async (width) => {
    await page.viewport(width, 700);
    expect(window.innerWidth).toBe(width);
    try {
      for (const locale of ["en-GB", "es-ES"]) {
        setLocale(locale);
        const outcomes: CardOutcome[] = [
          { outcome: "declined" },
          { outcome: "timeout" },
          { outcome: "declined", failureReason: "insufficient_funds" },
          { outcome: "declined", failureReason: "lost_card" },
        ];
        for (const [index, cardOutcome] of outcomes.entries()) {
          const { el, host } = await mountWidget<TillTenderPay>(
            "till-tender-pay",
            {
              store: new WorkingOrderStore(),
              cardOutcome,
            },
            theme,
          );
          expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
          for (const button of el.shadowRoot!.querySelectorAll("wt-button")) {
            const box = button.getBoundingClientRect();
            expect(box.left).toBeGreaterThanOrEqual(0);
            expect(box.right).toBeLessThanOrEqual(width);
          }
          await page.screenshot({
            path: `__screenshots__/a739a/${theme}-${width}-${locale}-${index}.png`,
          });
          host.remove();
        }
      }
    } finally {
      await page.viewport(414, 896);
    }
  });
});
