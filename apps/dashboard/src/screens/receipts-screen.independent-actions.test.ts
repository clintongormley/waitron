import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, ReceiptPreview } from "../api/client.js";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./receipts-screen.js";

type Screen = HTMLElementTagNameMap["dashboard-receipts-screen"];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const paper: ReceiptPreview = {
  preview: {
    widthDots: 512,
    columns: 42,
    text: "Venue",
    blocks: [{ kind: "text", text: "Venue\n" }],
    qrData: [],
    omittedGraphics: false,
    truncated: false,
    unsupported: false,
  },
  marks: {
    logo: null,
    headerSubtitle: null,
    footerMessage: null,
    phone: null,
    email: null,
    address: null,
  },
  paperWidth: "80mm",
  paperWidths: ["80mm"],
};
function fixture() {
  return {
    getVenueReceiptSettings: vi.fn(async () => ({ settings: { headerSubtitle: "Restaurant" } })),
    putVenueReceiptSettings: vi.fn(async () => {}),
    getVenueDepartments: vi.fn(async () => []),
    getReceipt: vi.fn(async () => ({
      receipt: {
        headerSubtitle: "Restaurant",
        phone: "+34 912 345 678",
        email: "venue@example.com",
      },
      venueAddress: [],
    })),
    putReceipt: vi.fn(async () => {}),
    getLocationSettings: vi.fn(async () => ({
      name: "Venue",
      operationDescription: "Restaurant service",
    })),
    putLocationSettings: vi.fn<DashboardApi["putLocationSettings"]>(async () => {}),
    getReceiptLanguage: vi.fn<DashboardApi["getReceiptLanguage"]>(async () => ({
      language: "es-ES",
      choices: ["es-ES", "ca-ES", "gl-ES"],
      fixed: null,
    })),
    putReceiptLanguage: vi.fn<DashboardApi["putReceiptLanguage"]>(async () => {}),
    getContentLanguages: vi.fn(async () => ({
      defaultLanguage: "es",
      languages: ["es", "ca", "gl"],
    })),
    previewReceipt: vi.fn(async () => paper),
  };
}
async function mount(api = fixture(), theme: "light" | "dark" = "light") {
  const { el, host } = await mountWidget<Screen>(
    "dashboard-receipts-screen",
    { api: api as unknown as DashboardApi },
    theme,
  );
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("[data-test=description-save]")).toBeTruthy(),
  );
  return { el, host, api };
}
function action(el: Screen, part: "language" | "description") {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `[data-test=${part}-save]`,
  );
}
async function state(el: Screen, part: "language" | "description") {
  const button = action(el, part);
  expect(button).not.toBeNull();
  await button!.updateComplete;
  return {
    variant: button!.variant,
    disabled: button!.shadowRoot!.querySelector("button")!.disabled,
  };
}
async function press(el: Screen, part: "language" | "description") {
  const button = action(el, part);
  expect(button).not.toBeNull();
  await button!.updateComplete;
  await userEvent.click(page.elementLocator(button!.shadowRoot!.querySelector("button")!), {
    force: true,
  });
  await el.updateComplete;
}
function description(el: Screen) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[name=operationDescription]",
  )!;
}
async function editDescription(el: Screen, value: string) {
  const field = description(el);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function pick(el: Screen, language: string) {
  await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=receiptLanguage]")!, language);
  await el.updateComplete;
}
function bottom(el: Screen, part: "language" | "description") {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
    `[data-test=${part}-actions]`,
  )!.error;
}
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("independent location receipt actions", () => {
  it("opens each action quiet and guards unchanged native and host presses", async () => {
    const { el, api } = await mount();
    for (const part of ["language", "description"] as const) {
      expect(await state(el, part)).toEqual({ variant: "secondary", disabled: true });
      await press(el, part);
      action(el, part)!.click();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    expect(api.putReceipt).not.toHaveBeenCalled();
  });
  it("saves only the changed language even with an invalid description and a dirty global field", async () => {
    const { el, api } = await mount();
    await editDescription(el, " ");
    await pick(el, "ca-ES");
    el.shadowRoot!.querySelector("dashboard-venue-receipt-defaults-editor")!
      .shadowRoot!.querySelector("wt-input[name=headerSubtitle]")!
      .dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Unsaved venue" },
          bubbles: true,
          composed: true,
        }),
      );
    expect(await state(el, "language")).toEqual({ variant: "primary", disabled: false });
    await press(el, "language");
    await vi.waitFor(() => expect(api.putReceiptLanguage).toHaveBeenCalledExactlyOnceWith("ca-ES"));
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    expect(api.putReceipt).not.toHaveBeenCalled();
    expect(description(el).value).toBe(" ");
    await vi.waitFor(async () =>
      expect(await state(el, "language")).toEqual({ variant: "secondary", disabled: true }),
    );
    expect(await state(el, "description")).toEqual({ variant: "primary", disabled: false });
  });
  it("saves only description and does not submit a staged language or venue fields", async () => {
    const { el, api } = await mount();
    await pick(el, "gl-ES");
    await editDescription(el, "Dinner service");
    await press(el, "description");
    await vi.waitFor(() =>
      expect(api.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Dinner service"),
    );
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
    expect(api.putReceipt).not.toHaveBeenCalled();
    await vi.waitFor(async () =>
      expect(await state(el, "description")).toEqual({ variant: "secondary", disabled: true }),
    );
    expect(await state(el, "language")).toEqual({ variant: "primary", disabled: false });
  });
  it("reverting either field quiets only its action", async () => {
    const { el } = await mount();
    await pick(el, "ca-ES");
    await editDescription(el, "Dinner service");
    await pick(el, "es-ES");
    expect(await state(el, "language")).toEqual({ variant: "secondary", disabled: true });
    expect(await state(el, "description")).toEqual({ variant: "primary", disabled: false });
    await editDescription(el, "Restaurant service");
    expect(await state(el, "description")).toEqual({ variant: "secondary", disabled: true });
  });
  it("allows description to save while one language write is held, without resubmitting either", async () => {
    const held = deferred<void>();
    const api = fixture();
    api.putReceiptLanguage.mockImplementation(() => held.promise);
    const { el } = await mount(api);
    await pick(el, "ca-ES");
    await editDescription(el, "Dinner service");
    await press(el, "language");
    action(el, "language")!.click();
    try {
      expect(api.putReceiptLanguage).toHaveBeenCalledExactlyOnceWith("ca-ES");
      expect(await state(el, "description")).toEqual({ variant: "primary", disabled: false });
      await press(el, "description");
      await vi.waitFor(() =>
        expect(api.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Dinner service"),
      );
      expect(api.putReceipt).not.toHaveBeenCalled();
    } finally {
      held.resolve();
    }
    await vi.waitFor(async () =>
      expect(await state(el, "language")).toEqual({ variant: "secondary", disabled: true }),
    );
  });
  it("description checks stay beside that field and do not disable language", async () => {
    const { el, api } = await mount();
    await editDescription(el, " ");
    await pick(el, "ca-ES");
    await press(el, "description");
    expect(description(el).error).toBe(t("location_settings.required"));
    expect(bottom(el, "description")).toBe(t("form.fix_fields"));
    expect(await state(el, "description")).toEqual({ variant: "primary", disabled: true });
    expect(await state(el, "language")).toEqual({ variant: "primary", disabled: false });
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    await editDescription(el, "Dinner service");
    expect(description(el).error).toBe("");
    expect(bottom(el, "description")).toBe("");
    expect(await state(el, "description")).toEqual({ variant: "primary", disabled: false });
  });
  for (const locale of ["en-GB", "es-ES"])
    for (const theme of ["light", "dark"] as const) {
      it(`shows independent refused actions accessibly in ${locale}/${theme}`, async () => {
        setLocale(locale);
        const api = fixture();
        api.putReceiptLanguage.mockRejectedValue({
          code: "receipt.language_orders_open",
          params: { field: "receiptLanguage", count: 1 },
        });
        api.putLocationSettings.mockRejectedValue({
          code: "management.request_invalid",
          params: { field: "operationDescription" },
        });
        const { el, host } = await mount(api, theme);
        await pick(el, "ca-ES");
        await editDescription(el, "Dinner service");
        await press(el, "language");
        await vi.waitFor(() => expect(bottom(el, "language")).toBe(t("form.fix_fields")));
        expect(bottom(el, "description")).toBe("");
        await press(el, "description");
        await vi.waitFor(() => expect(bottom(el, "description")).toBe(t("form.fix_fields")));
        expect(bottom(el, "language")).toBe(t("form.fix_fields"));
        expect(description(el).error).toBe(t("location_settings.invalid"));
        expect(await state(el, "description")).toEqual({ variant: "primary", disabled: false });
        expect(await state(el, "language")).toEqual({ variant: "primary", disabled: false });
        expect(api.putReceipt).not.toHaveBeenCalled();
        await expectNoA11yViolations(host);
      });
    }
});

it("commits the submitted description while newer native input remains savable", async () => {
  const held = deferred<void>();
  const api = fixture();
  api.putLocationSettings.mockImplementationOnce(() => held.promise);
  const { el } = await mount(api);
  await editDescription(el, "Submitted");
  await press(el, "description");
  description(el).dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Later edit" },
      bubbles: true,
      composed: true,
    }),
  );
  held.resolve();
  await vi.waitFor(async () =>
    expect(await state(el, "description")).toEqual({ variant: "primary", disabled: false }),
  );
  expect(description(el).value).toBe("Later edit");
  expect(api.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Submitted");
  await editDescription(el, "Submitted");
  expect(await state(el, "description")).toEqual({ variant: "secondary", disabled: true });
});
it("commits the submitted language while a later selection stays savable", async () => {
  const held = deferred<void>();
  const api = fixture();
  api.putReceiptLanguage.mockImplementationOnce(() => held.promise);
  const { el } = await mount(api);
  await pick(el, "ca-ES");
  await press(el, "language");
  el.shadowRoot!.querySelector("wt-combobox[name=receiptLanguage]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "gl-ES" }, bubbles: true, composed: true }),
  );
  held.resolve();
  await vi.waitFor(async () =>
    expect(await state(el, "language")).toEqual({ variant: "primary", disabled: false }),
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "wt-combobox[name=receiptLanguage]",
    )!.value,
  ).toBe("gl-ES");
  expect(api.putReceiptLanguage).toHaveBeenCalledExactlyOnceWith("ca-ES");
  await pick(el, "ca-ES");
  expect(await state(el, "language")).toEqual({ variant: "secondary", disabled: true });
});
for (const part of ["language", "description"] as const)
  for (const accepted of [true, false]) {
    it(`ignores a disconnected ${part} write's late ${accepted ? "success" : "refusal"}`, async () => {
      const held = deferred<void>();
      const api = fixture();
      (part === "language"
        ? api.putReceiptLanguage
        : api.putLocationSettings
      ).mockImplementationOnce(() => held.promise);
      const { el } = await mount(api);
      if (part === "language") await pick(el, "ca-ES");
      else await editDescription(el, "Submitted");
      await press(el, part);
      const parent = el.parentElement!;
      el.remove();
      await el.updateComplete;
      parent.append(el);
      await vi.waitFor(async () =>
        expect(await state(el, part)).toEqual({ variant: "primary", disabled: false }),
      );
      if (accepted) held.resolve();
      else held.reject({ code: "connection.failed" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(await state(el, part)).toEqual({ variant: "primary", disabled: false });
      expect(bottom(el, part)).toBe("");
      expect(el.shadowRoot!.querySelector(`[data-test=${part}-section] [role=status]`)).toBeNull();
      expect(description(el).value).toBe(
        part === "description" ? "Submitted" : "Restaurant service",
      );
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
          "wt-combobox[name=receiptLanguage]",
        )!.value,
      ).toBe(part === "language" ? "ca-ES" : "es-ES");
    });
  }
