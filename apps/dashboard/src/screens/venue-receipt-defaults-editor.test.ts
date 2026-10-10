import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import type { VenueReceiptSettings } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./venue-receipt-defaults-editor.js";
type Editor = HTMLElementTagNameMap["dashboard-venue-receipt-defaults-editor"];
const initial: VenueReceiptSettings = {
  headerSubtitle: "Restaurant",
  footerMessage: "Gracias",
  printAddress: false,
};
function fixture() {
  let stored = structuredClone(initial);
  return {
    liveData: new LiveData(),
    getVenueReceiptSettings: vi.fn(async () => ({ settings: structuredClone(stored) })),
    putVenueReceiptSettings: vi.fn<(value: VenueReceiptSettings) => Promise<void>>(
      async (value) => {
        stored = structuredClone(value);
      },
    ),
    putReceipt: vi.fn(),
    putLocationSettings: vi.fn(),
    putReceiptLanguage: vi.fn(),
    imageLibraryRequest: vi.fn(async () => ({ images: [], total: 0 })),
  };
}
async function mount(api = fixture()) {
  const { el } = await mountWidget<Editor>("dashboard-venue-receipt-defaults-editor", {
    api: api as unknown as DashboardApi,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("wt-input[name=headerSubtitle]")).toBeTruthy(),
  );
  return { el, api };
}
function subtitle(el: Editor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[name=headerSubtitle]",
  )!;
}
async function edit(el: Editor, value: string) {
  const field = subtitle(el);
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
function save(el: Editor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=defaults-save]",
  )!;
}
async function state(el: Editor) {
  await el.updateComplete;
  const button = save(el);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it("keeps defaults pristine and leaves stored contact and other scopes outside its form", async () => {
  const { el, api } = await mount();
  expect(subtitle(el).value).toBe("Restaurant");
  expect(
    el.shadowRoot!.querySelector(
      "[name=phone], [name=email], [name=receiptLanguage], [name=operationDescription]",
    ),
  ).toBeNull();
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
  save(el).click();
  await el.updateComplete;
  expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
});
it("saves only defaults once and commits the submitted draft", async () => {
  const { el, api } = await mount();
  await edit(el, "New subtitle");
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
  save(el).click();
  save(el).click();
  await vi.waitFor(() =>
    expect(api.putVenueReceiptSettings).toHaveBeenCalledExactlyOnceWith({
      headerSubtitle: "New subtitle",
      footerMessage: "Gracias",
      printAddress: false,
    }),
  );
  await vi.waitFor(async () =>
    expect(await state(el)).toEqual({ variant: "secondary", disabled: true }),
  );
  expect(api.putReceipt).not.toHaveBeenCalled();
  expect(api.putLocationSettings).not.toHaveBeenCalled();
  expect(api.putReceiptLanguage).not.toHaveBeenCalled();
});
it("reverting the control restores quiet Save", async () => {
  const { el } = await mount();
  await edit(el, "New");
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
  await edit(el, "Restaurant");
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
});
it("clears an optional default without sending hidden contact fields", async () => {
  const { el, api } = await mount();
  await edit(el, "");
  save(el).click();
  await vi.waitFor(() =>
    expect(api.putVenueReceiptSettings).toHaveBeenCalledExactlyOnceWith({
      footerMessage: "Gracias",
      printAddress: false,
    }),
  );
});
it("retains a refused draft and its localized field and bottom summary through read recovery", async () => {
  setLocale("es-ES");
  const api = fixture();
  api.putVenueReceiptSettings.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "headerSubtitle", maxLength: 500 },
  });
  const { el } = await mount(api);
  await edit(el, "New");
  save(el).click();
  await vi.waitFor(() => expect(subtitle(el).error).not.toBe(""));
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe(t("form.fix_fields"));
  api.liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() => expect(api.getVenueReceiptSettings).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(subtitle(el).value).toBe("New");
  expect(subtitle(el).error).not.toBe("");
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
});
it("a successful write stays committed when refresh fails", async () => {
  const { el, api } = await mount();
  api.getVenueReceiptSettings.mockRejectedValue({ code: "server.internal_error" });
  await edit(el, "New");
  save(el).click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=defaults-load-error]")).not.toBeNull(),
  );
  expect(subtitle(el).value).toBe("New");
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
  save(el).click();
  expect(api.putVenueReceiptSettings).toHaveBeenCalledOnce();
});
it("adopts clean live defaults but preserves an authored dirty draft", async () => {
  const { el, api } = await mount();
  api.getVenueReceiptSettings.mockResolvedValue({
    settings: { headerSubtitle: "Changed remotely" },
  });
  api.liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() => expect(subtitle(el).value).toBe("Changed remotely"));
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
  await edit(el, "Typed");
  api.getVenueReceiptSettings.mockResolvedValue({
    settings: { headerSubtitle: "Another remote edit" },
  });
  api.liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() => expect(api.getVenueReceiptSettings).toHaveBeenCalledTimes(3));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(subtitle(el).value).toBe("Typed");
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
});
it("saves the real address switch and a cleared explicit logo", async () => {
  const api = fixture();
  const logo = `${"a".repeat(64)}.png`;
  api.getVenueReceiptSettings.mockResolvedValueOnce({ settings: { ...initial, logo } });
  const { el } = await mount(api);
  const toggle = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "wt-switch[name=printAddress]",
  )!;
  await toggle.updateComplete;
  await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("input")!));
  el.shadowRoot!.querySelector("dashboard-image-upload")!.dispatchEvent(
    new CustomEvent("image-changed", { detail: { image: null }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  save(el).click();
  await vi.waitFor(() =>
    expect(api.putVenueReceiptSettings).toHaveBeenCalledExactlyOnceWith({
      headerSubtitle: "Restaurant",
      footerMessage: "Gracias",
      printAddress: true,
    }),
  );
});
it("late writes after reconnect cannot clean a newer draft", async () => {
  const { el, api } = await mount();
  let finish!: () => void;
  api.putVenueReceiptSettings.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await edit(el, "Submitted");
  save(el).click();
  await vi.waitFor(() => expect(api.putVenueReceiptSettings).toHaveBeenCalledOnce());
  const parent = el.parentNode!;
  el.remove();
  await el.updateComplete;
  parent.appendChild(el);
  await el.updateComplete;
  await edit(el, "New draft");
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(subtitle(el).value).toBe("New draft");
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
});
it("publishes authored defaults to its parent without contact or unrelated scopes", async () => {
  const { el } = await mount();
  let detail: unknown;
  el.addEventListener("venue-receipt-draft-changed", (event) => {
    detail = (event as CustomEvent).detail;
  });
  await edit(el, "Draft preview");
  expect(detail).toEqual({
    active: true,
    settings: { headerSubtitle: "Draft preview", footerMessage: "Gracias", printAddress: false },
  });
});

it("keeps Save quiet for surrounding whitespace and sends no redundant write", async () => {
  const { el, api } = await mount();
  await edit(el, "  Restaurant  ");
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
  save(el).click();
  await el.updateComplete;
  expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
});

it("previews and saves trimmed defaults, omitting whitespace-only optional text", async () => {
  const { el, api } = await mount();
  let detail: unknown;
  el.addEventListener("venue-receipt-draft-changed", (event) => {
    detail = (event as CustomEvent).detail;
  });
  await edit(el, "  Dinner  ");
  const footer = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-textarea"]>(
    "wt-textarea[name=footerMessage]",
  )!;
  await footer.updateComplete;
  await userEvent.fill(page.elementLocator(footer.shadowRoot!.querySelector("textarea")!), " \n ");
  await el.updateComplete;
  expect(detail).toEqual({
    settings: { headerSubtitle: "Dinner", printAddress: false },
    active: true,
  });
  save(el).click();
  await vi.waitFor(() =>
    expect(api.putVenueReceiptSettings).toHaveBeenCalledExactlyOnceWith({
      headerSubtitle: "Dinner",
      printAddress: false,
    }),
  );
  await vi.waitFor(async () =>
    expect(await state(el)).toEqual({ variant: "secondary", disabled: true }),
  );
});

it("adopts untouched live fields while keeping the typed field and its original baseline", async () => {
  const { el, api } = await mount();
  await edit(el, "Typed");
  const logo = `${"b".repeat(64)}.png`;
  api.getVenueReceiptSettings.mockResolvedValue({
    settings: {
      headerSubtitle: "Remote subtitle",
      footerMessage: "Remote footer",
      printAddress: true,
      logo,
    },
  });
  api.liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-textarea"]>(
        "wt-textarea[name=footerMessage]",
      )!.value,
    ).toBe("Remote footer"),
  );
  expect(subtitle(el).value).toBe("Typed");
  expect(
    el
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>("wt-switch")!
      .shadowRoot!.querySelector("input")!.checked,
  ).toBe(true);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["dashboard-image-upload"]>(
      "dashboard-image-upload",
    )!.image,
  ).toBe(logo);
  await edit(el, "Restaurant");
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
  await edit(el, "Typed again");
  save(el).click();
  await vi.waitFor(() =>
    expect(api.putVenueReceiptSettings).toHaveBeenCalledExactlyOnceWith({
      headerSubtitle: "Typed again",
      footerMessage: "Remote footer",
      printAddress: true,
      logo,
    }),
  );
});

it("keeps an unassigned save failure when a field is edited", async () => {
  const api = fixture();
  api.putVenueReceiptSettings.mockRejectedValue({ code: "connection.failed" });
  const { el } = await mount(api);
  await edit(el, "New");
  save(el).click();
  const bottom = () =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error;
  await vi.waitFor(() => expect(bottom()).not.toBe(""));
  const refusal = bottom();
  await edit(el, "Corrected");
  expect(bottom()).toBe(refusal);
});
