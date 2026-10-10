import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, DepartmentReceiptSettings } from "../api/client.js";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { DepartmentReceiptEditor } from "./department-receipt-editor.js";
import "./department-receipt-editor.js";

const languages = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];
const settings: DepartmentReceiptSettings = {
  receiptLanguage: "es-ES",
  receipt: { headerSubtitle: { "ca-ES": "Bar català" } },
  venueDefaults: { headerSubtitle: "Venue subtitle", footerMessage: "Venue footer" },
  languages,
  warningLanguages: ["es-ES", "gl-ES", "eu-ES"],
  venueAddress: [],
};
async function mount(value = settings, theme: "light" | "dark" = "light") {
  let stored = structuredClone(value);
  const api = {
    liveData: new LiveData(),
    getDepartmentReceipt: vi.fn(async () => structuredClone(stored)),
    putDepartmentReceipt: vi.fn(
      async (_id: string, receipt: DepartmentReceiptSettings["receipt"]) => {
        stored = { ...stored, receipt: structuredClone(receipt) };
      },
    ),
    imageLibraryRequest: vi.fn(async () => ({ images: [], total: 0 })),
  };
  const { el, host } = await mountWidget<DepartmentReceiptEditor>(
    "dashboard-department-receipt-editor",
    {
      api: api as unknown as DashboardApi,
      departmentId: "bar",
      departmentName: "Bar",
      receiptLanguage: "es-ES",
    },
    theme,
  );
  await expect.poll(() => el.shadowRoot?.querySelector("[name=headerSubtitle-es-ES]")).toBeTruthy();
  return { el, host, api };
}
function field(el: DepartmentReceiptEditor, name: string) {
  return el.shadowRoot!.querySelector<
    HTMLElementTagNameMap["wt-input"] | HTMLElementTagNameMap["wt-textarea"]
  >(`[name="${name}"]`)!;
}
async function edit(el: DepartmentReceiptEditor, name: string, value: string) {
  const control = field(el, name);
  await control.updateComplete;
  await userEvent.fill(
    page.elementLocator(control.shadowRoot!.querySelector("input,textarea")!),
    value,
  );
  await el.updateComplete;
}
function save(el: DepartmentReceiptEditor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=department-save]",
  )!;
}
function warnings(el: DepartmentReceiptEditor) {
  return [...el.shadowRoot!.querySelectorAll("h3")]
    .filter((x) => x.textContent?.includes("⚠"))
    .map((x) => x.getAttribute("lang"));
}
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it("A11 labels every stacked language with receipts first and marks only missing authored texts", async () => {
  setLocale("en-GB");
  const { el } = await mount({ ...settings, languages: ["ca-ES", "eu-ES", "es-ES", "gl-ES"] });
  const headings = [...el.shadowRoot!.querySelectorAll("h3")];
  expect(headings.map((x) => x.getAttribute("lang"))).toEqual(["es-ES", "ca-ES", "eu-ES", "gl-ES"]);
  expect(headings[0]!.textContent!.replace(/\s+/g, " ")).toContain("Spanish (receipts)");
  expect(headings[1]!.textContent!.replace(/\s+/g, " ")).toContain("Catalan (copies)");
  expect(warnings(el)).toEqual(["es-ES", "eu-ES", "gl-ES"]);
  expect(el.shadowRoot!.querySelectorAll("[role=note]")).toHaveLength(1);
  expect(el.shadowRoot!.querySelectorAll("wt-tabs,[role=tab]")).toHaveLength(0);
  expect(
    languages.flatMap((language) => [
      field(el, `headerSubtitle-${language}`).name,
      field(el, `footerMessage-${language}`).name,
    ]),
  ).toEqual([
    "headerSubtitle-es-ES",
    "footerMessage-es-ES",
    "headerSubtitle-ca-ES",
    "footerMessage-ca-ES",
    "headerSubtitle-gl-ES",
    "footerMessage-gl-ES",
    "headerSubtitle-eu-ES",
    "footerMessage-eu-ES",
  ]);
});
it("A11 warnings follow the authored draft, including the current language, without using inherited hints", async () => {
  const { el } = await mount({ ...settings, receipt: {}, warningLanguages: [] });
  expect(warnings(el)).toEqual([]);
  expect(el.shadowRoot!.querySelectorAll("[role=note]")).toHaveLength(0);
  await edit(el, "footerMessage-eu-ES", "Eskerrik asko");
  expect(warnings(el)).toEqual(["es-ES", "ca-ES", "gl-ES"]);
  expect(el.shadowRoot!.querySelectorAll("[role=note]")).toHaveLength(1);
  expect(field(el, "footerMessage-es-ES").value).toBe("");
  expect(field(el, "footerMessage-es-ES").hint).toBe("Venue footer");
  await edit(el, "footerMessage-eu-ES", "   ");
  expect(warnings(el)).toEqual([]);
  expect(el.shadowRoot!.querySelectorAll("[role=note]")).toHaveLength(0);
});
it("A11 editing and clearing one locale preserves the other authored maps in the saved payload", async () => {
  const { el, api } = await mount({
    ...settings,
    receipt: {
      headerSubtitle: { "es-ES": "Bar", "ca-ES": "Bar català" },
      footerMessage: { "eu-ES": "Agur" },
    },
  });
  await edit(el, "headerSubtitle-ca-ES", "");
  await edit(el, "footerMessage-gl-ES", "Ata logo");
  save(el).click();
  await expect
    .poll(() => api.putDepartmentReceipt.mock.calls)
    .toEqual([
      [
        "bar",
        {
          headerSubtitle: { "es-ES": "Bar", "ca-ES": "" },
          footerMessage: { "eu-ES": "Agur", "gl-ES": "Ata logo" },
        },
      ],
    ]);
});
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const) {
    it(`A11 ${locale}/${theme} last stacked refusal scrolls and focuses its field, preserves unrelated edits and is accessible`, async () => {
      setLocale(locale);
      const { el, api, host } = await mount(settings, theme);
      await expectNoA11yViolations(host);
      api.putDepartmentReceipt.mockRejectedValue({
        code: "receipt.invalid",
        params: { field: "footerMessage", language: "eu-ES", maxLength: 500 },
      });
      await edit(el, "footerMessage-eu-ES", "Agur");
      const refused = field(el, "footerMessage-eu-ES");
      const scroll = vi.spyOn(refused, "scrollIntoView");
      save(el).click();
      await expect
        .poll(() => refused.error)
        .toBe(t("receipts.trim_too_long").replace("{max}", "500"));
      await expect.poll(() => scroll.mock.calls.length).toBe(1);
      await refused.updateComplete;
      expect(refused.shadowRoot!.activeElement).toBe(refused.shadowRoot!.querySelector("textarea"));
      expect(field(el, "footerMessage-es-ES").error).toBe("");
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
          .error,
      ).toBe(t("form.fix_fields"));
      expect(save(el).disabled).toBe(false);
      await expectNoA11yViolations(host);
      await edit(el, "headerSubtitle-ca-ES", "Unrelated edit");
      expect(refused.error).not.toBe("");
      await edit(el, "footerMessage-eu-ES", "Agur berriro");
      expect(refused.error).toBe("");
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
          .error,
      ).toBe("");
    });
  }

it("A11 an unknown refused language is summarized without marking a shown locale or creating markup", async () => {
  const { el, api } = await mount();
  const unknown = 'unknown-"><img src=x onerror=alert(1)>';
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "footerMessage", language: unknown, maxLength: 500 },
  });
  await edit(el, "footerMessage-eu-ES", "Agur");
  save(el).click();
  await expect.poll(() => save(el).loading).toBe(false);
  await expect
    .poll(
      () =>
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
          .error,
    )
    .toBe(t("receipts.trim_too_long").replace("{max}", "500"));
  for (const language of languages) {
    expect(field(el, `headerSubtitle-${language}`).error).toBe("");
    expect(field(el, `footerMessage-${language}`).error).toBe("");
  }
  expect(el.shadowRoot!.textContent).not.toContain(unknown);
  expect(el.shadowRoot!.querySelectorAll("wt-input,wt-textarea")).toHaveLength(10);
  expect(save(el).disabled).toBe(false);
});
