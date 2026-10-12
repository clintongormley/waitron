import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  clickReceiptSave,
  editReceipt,
  mountReceiptDialog,
  receiptApi,
  receiptField,
  receiptModel,
  preview,
} from "../testing/department-receipt-dialog-fixture.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const cases = (["light", "dark"] as const).flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) => [390, 1280].map((width) => ({ theme, locale, width }))),
);
it.each(cases)(
  "department receipt states $locale $theme $width are accessible and fit",
  async ({ theme, locale, width }) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 900);
    try {
      for (const state of ["open", "dirty", "invalid", "refused"] as const) {
        setLocale(locale);
        const api = receiptApi();
        api.putDepartmentReceipt.mockRejectedValue({
          code: "receipt.invalid",
          params: { field: "email", reason: "invalid_email" },
        });
        const { el, host, dialog } = await mountReceiptDialog(api, theme);
        if (state !== "open")
          await editReceipt(el, "email", state === "invalid" ? "invalid" : "bar@example.com");
        if (state === "invalid" || state === "refused") {
          await clickReceiptSave(el);
          await expect.poll(() => receiptField(el, "email").error).not.toBe("");
          await receiptField(el, "email").updateComplete;
        }
        await expectNoA11yViolations(host);
        await expect.poll(() => el.shadowRoot!.querySelector(".paper")).toBeTruthy();
        const native = dialog.shadowRoot!.querySelector("dialog")!;
        expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        expect(native.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        const body = dialog.shadowRoot!.querySelector<HTMLElement>(".body")!;
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
        if (import.meta.env.VITE_A493_DIALOG_CAPTURE === "1") {
          body.scrollTop = 0;
          await page.screenshot({
            path: `__screenshots__/a493-dialog/${locale}-${theme}-${width}-${state}-top.png`,
          });
          body.scrollTop = body.scrollHeight;
          await page.screenshot({
            path: `__screenshots__/a493-dialog/${locale}-${theme}-${width}-${state}-bottom.png`,
          });
        }
        cleanupWidgets();
      }
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);

function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgba?\(/);
    const [r, g, blue] = rgb
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => Number(part) / 255)
      .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * blue!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

it.each(["light", "dark"] as const)(
  "the receipt footer placeholder stays readable in %s",
  async (theme) => {
    const { el } = await mountReceiptDialog(receiptApi(), theme);
    const footer = receiptField(el, "footerMessage-es-ES");
    await footer.updateComplete;
    const textarea = footer.shadowRoot!.querySelector("textarea")!;
    const placeholder = getComputedStyle(textarea, "::placeholder").color;
    const field = getComputedStyle(footer.shadowRoot!.querySelector(".field")!).backgroundColor;
    expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
  },
);

it.each(cases)(
  "filled receipt decoration and distinct refusals stay accessible in $locale $theme $width",
  async ({ theme, locale, width }) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 900);
    try {
      for (const state of [
        "address-on",
        "address-off",
        "no-address",
        "phone",
        "email",
        "logo",
        "printAddress",
        "footerMessage",
      ] as const) {
        setLocale(locale);
        const logo = `${"c".repeat(64)}.png`;
        const api = receiptApi({
          ...receiptModel,
          receipt: {
            ...receiptModel.receipt,
            phone: "+34 912 345 678",
            email: "hola@deli.es",
            logo,
            printAddress: state !== "address-off",
            footerMessage: { "es-ES": "Thanks" },
          },
          venueAddress: state === "no-address" ? [] : ["Calle Mayor 1", "28013 Madrid"],
        });
        api.previewReceiptDraft.mockResolvedValue({
          ...preview("Bar"),
          marks: { ...preview().marks, headerSubtitle: { start: 0, end: 1 } },
        });
        const refused = !["address-on", "address-off", "no-address"].includes(state);
        if (refused)
          api.putDepartmentReceipt.mockRejectedValue({
            code: "receipt.invalid",
            params: {
              field: state,
              reason:
                state === "phone"
                  ? "invalid_phone"
                  : state === "email"
                    ? "invalid_email"
                    : state === "logo"
                      ? "image_not_found"
                      : state === "printAddress"
                        ? "not_boolean"
                        : "too_long",
              ...(state === "footerMessage" ? { language: "es-ES", maxLength: 200 } : {}),
            },
          });
        const { el, host } = await mountReceiptDialog(api, theme);
        const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
        expect(upload.image).toBe(logo);
        expect(
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
            "wt-switch[name=printAddress]",
          )!.checked,
        ).toBe(state !== "address-off");
        if (state === "no-address")
          expect(el.shadowRoot!.querySelector("[data-test=venue-address]")!.textContent).toContain(
            t("receipts.no_address"),
          );
        if (refused) {
          await editReceipt(el, "email", "changed@deli.es");
          await clickReceiptSave(el);
          if (state === "logo") await expect.poll(() => upload.invalid).toBe(true);
          else if (state === "printAddress")
            await expect
              .poll(() => el.shadowRoot!.querySelector("[data-field-error=printAddress]"))
              .toBeTruthy();
          else
            await expect
              .poll(
                () =>
                  receiptField(el, state === "footerMessage" ? "footerMessage-es-ES" : state).error,
              )
              .not.toBe("");
          if (state === "footerMessage") {
            await expect
              .poll(() => el.shadowRoot!.querySelector("[data-mark=headerSubtitle]"))
              .toBeTruthy();
            receiptField(el, "headerSubtitle-es-ES").focus();
            await expect
              .poll(() =>
                el
                  .shadowRoot!.querySelector("[data-mark=headerSubtitle]")!
                  .hasAttribute("data-active"),
              )
              .toBe(true);
          }
        }
        await expectNoA11yViolations(host);
        cleanupWidgets();
      }
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);
