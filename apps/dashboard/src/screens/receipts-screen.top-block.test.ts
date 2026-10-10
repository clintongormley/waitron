import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
// Registers the media library picker the logo control opens, as the dashboard app does.
import "@waitron/dashboard-modules";
import type { WtInput, WtSwitch } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import type {
  DashboardApi,
  PrintPreviewBlock,
  ReceiptConfig,
  ReceiptPreview,
} from "../api/client.js";
import { RECEIPT_PREVIEW_QUIET_MS, ReceiptsScreen } from "./receipts-screen.js";
import type { ImageUpload } from "../widgets/image-upload.js";

const LOGO = `${"a".repeat(64)}.png`;
const ADDRESS = ["Calle Mayor 1", "28013 Madrid"];
const NO_MARKS: ReceiptPreview["marks"] = {
  headerSubtitle: null,
  footerMessage: null,
  phone: null,
  email: null,
  address: null,
  logo: null,
};

/** A stand-in for the server's drawing: one text block a line, each new part marked. */
function fakePreview(config: ReceiptConfig): ReceiptPreview {
  const lines = ["Deli Test SL"];
  const marks = { ...NO_MARKS };
  const add = (name: keyof ReceiptPreview["marks"], text: string) => {
    marks[name] = { start: lines.length, end: lines.length + 1 };
    lines.push(text);
  };
  if (config.logo !== undefined) add("logo", `[logo ${config.logo.slice(0, 4)}]`);
  if (config.printAddress !== false) add("address", ADDRESS.join(", "));
  if (config.phone !== undefined) add("phone", `Tel. ${config.phone}`);
  if (config.email !== undefined) add("email", config.email);
  lines.push("NIF: B12345678");
  const blocks: PrintPreviewBlock[] = lines.map((text) => ({ kind: "text", text: `${text}\n` }));
  return {
    preview: {
      widthDots: 512,
      columns: 42,
      text: lines.join("\n"),
      blocks,
      qrData: [],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    },
    marks,
    paperWidth: "80mm",
    paperWidths: ["80mm"],
  };
}

function stubApi(
  receipt: ReceiptConfig = {},
  overrides: Partial<Record<keyof DashboardApi, unknown>> = {},
): DashboardApi {
  const api = {
    getReceipt: vi.fn().mockResolvedValue({ receipt: { ...receipt }, venueAddress: ADDRESS }),
    putVenueReceiptSettings: vi.fn().mockResolvedValue(undefined),
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta en establecimiento" }),
    putLocationSettings: vi.fn().mockResolvedValue(undefined),
    getReceiptLanguage: vi
      .fn()
      .mockResolvedValue({ language: "es-ES", choices: ["es-ES", "ca-ES"], fixed: null }),
    putReceiptLanguage: vi.fn().mockResolvedValue(undefined),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    getVenueDepartments: vi
      .fn()
      .mockResolvedValue([{ id: "bar", name: "Bar", active: true, isDefault: true }]),
    imageLibraryRequest: vi.fn().mockResolvedValue({ images: [], total: 0 }),
    ...overrides,
  } as unknown as DashboardApi;
  api.getVenueReceiptSettings = vi.fn(async () => {
    const { receipt } = await api.getReceipt();
    const settings = { ...receipt };
    delete settings.phone;
    delete settings.email;
    return { settings };
  });
  api.getDepartmentReceipt = vi.fn(async () => {
    const { receipt, venueAddress } = await api.getReceipt();
    return {
      receipt: {
        ...(receipt.phone ? { phone: receipt.phone } : {}),
        ...(receipt.email ? { email: receipt.email } : {}),
      },
      venueDefaults: {},
      venueAddress,
      languages: ["es-ES"],
      warningLanguages: [],
    };
  });
  api.putDepartmentReceipt = (overrides.putDepartmentReceipt ??
    vi.fn().mockResolvedValue(undefined)) as DashboardApi["putDepartmentReceipt"];
  api.previewReceiptDraft = vi.fn(async (draft) =>
    fakePreview({ ...draft.settings, ...draft.receipt } as ReceiptConfig),
  );
  return api;
}

async function flush(el: ReceiptsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const defaultsRoot = (el: ReceiptsScreen) =>
  el.shadowRoot!.querySelector("dashboard-venue-receipt-defaults-editor")!.shadowRoot!;
const departmentRoot = (el: ReceiptsScreen) =>
  el.shadowRoot!.querySelector("dashboard-department-receipt-editor")!.shadowRoot!;
const q = <T extends Element = HTMLElement>(el: ReceiptsScreen, selector: string) =>
  (selector.includes("name=phone") ||
  selector.includes("name=email") ||
  selector.includes("department-save")
    ? departmentRoot(el)
    : defaultsRoot(el)
  ).querySelector<T>(selector) ?? el.shadowRoot!.querySelector<T>(selector);
const paperLines = (el: ReceiptsScreen) =>
  [...el.shadowRoot!.querySelectorAll(".paper pre")].map((pre) => pre.textContent!.trim());
const previewCalls = (api: DashboardApi) =>
  vi
    .mocked(api.previewReceiptDraft)
    .mock.calls.map(([draft]) => ({ ...draft.settings, ...draft.receipt }));
const lastPut = (api: DashboardApi) => ({
  ...vi.mocked(api.putVenueReceiptSettings).mock.calls.at(-1)?.[0],
  ...vi.mocked(api.putDepartmentReceipt).mock.calls.at(-1)?.[1],
});
const bottom = (el: ReceiptsScreen) =>
  [defaultsRoot(el), departmentRoot(el)]
    .map((root) => root.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error)
    .filter(Boolean)
    .join(" ");
const logoControl = (el: ReceiptsScreen) => q<ImageUpload>(el, "dashboard-image-upload")!;
const addressSwitch = (el: ReceiptsScreen) => q<WtSwitch>(el, "wt-switch[name=printAddress]")!;

function edit(el: ReceiptsScreen, name: string, value: string): void {
  q(el, `wt-input[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function toggleAddress(el: ReceiptsScreen, checked: boolean): void {
  addressSwitch(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
}

function chooseLogo(el: ReceiptsScreen, image: string | null): void {
  logoControl(el).dispatchEvent(
    new CustomEvent("image-changed", { detail: { image }, bubbles: true, composed: true }),
  );
}

async function save(el: ReceiptsScreen): Promise<void> {
  q(el, "[data-test=defaults-save]")!.click();
  departmentRoot(el).querySelector<HTMLElement>("[data-test=department-save]")!.click();
  await flush(el);
}

async function mount(api: DashboardApi = stubApi()) {
  const mounted = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
  await flush(mounted.el);
  await vi.waitFor(() => expect(q(mounted.el, ".paper")).not.toBeNull());
  return mounted;
}

afterEach(cleanupWidgets);
afterEach(() => setLocale("es-ES"));

describe("the Receipts page's top-block fields", () => {
  it.each([
    ["en-GB", "Subtitle"],
    ["es-ES", "Subtítulo"],
  ] as const)("calls the subtitle in %s", async (locale, label) => {
    setLocale(locale);
    const { el } = await mount();
    const slogan = q<WtInput>(el, "wt-input[name=headerSubtitle]")!;
    expect(slogan.label).toBe(label);
    expect(slogan.hint).not.toMatch(/address|direcci/i);
  });

  it("offers a phone and an email field, each optional, with its hint and a semantic name", async () => {
    const { el } = await mount();
    const phone = q<WtInput>(el, "wt-input[name=phone]")!;
    const email = q<WtInput>(el, "wt-input[name=email]")!;
    expect(phone.label).toBe(t("receipts.phone"));
    expect(phone.hint).toBe(t("receipts.phone_hint"));
    expect(phone.type).toBe("tel");
    expect(phone.required).toBe(false);
    expect(email.label).toBe(t("receipts.email"));
    expect(email.hint).toBe(t("receipts.email_hint"));
    expect(email.type).toBe("email");
    expect(email.required).toBe(false);
  });

  it("fills the fields from the saved receipt", async () => {
    const { el } = await mount(
      stubApi({ phone: "912 345 678", email: "hola@deli.es", printAddress: false, logo: LOGO }),
    );
    expect(q<WtInput>(el, "wt-input[name=phone]")!.value).toBe("912 345 678");
    expect(q<WtInput>(el, "wt-input[name=email]")!.value).toBe("hola@deli.es");
    expect(addressSwitch(el).checked).toBe(false);
    expect(logoControl(el).image).toBe(LOGO);
  });

  it("has the address switch on when the saved receipt does not turn it off", async () => {
    const { el } = await mount();
    expect(addressSwitch(el).checked).toBe(true);
    expect(addressSwitch(el).label).toBe(t("receipts.print_address"));
    expect(logoControl(el).image).toBeNull();
  });

  it("shows the address the switch prints, one line each, under it", async () => {
    const { el } = await mount();
    const shown = q(el, "[data-test=venue-address]")!;
    expect(shown.innerText.trim()).toBe(ADDRESS.join("\n"));
    expect(q(el, "[data-test=no-address]")).toBeNull();
  });

  it.each([
    ["en-GB", "This location has no address saved. It is set during setup."],
    [
      "es-ES",
      "Este local no tiene ninguna dirección guardada. Se indica durante la configuración inicial.",
    ],
  ] as const)("says in %s when the location has no address to print", async (locale, sentence) => {
    setLocale(locale);
    const api = stubApi();
    vi.mocked(api.getReceipt).mockResolvedValue({ receipt: {}, venueAddress: [] });
    const { el } = await mount(api);
    expect(q(el, "[data-test=venue-address]")).toBeNull();
    expect(q(el, "[data-test=no-address]")!.textContent!.trim()).toBe(sentence);
    expect(q(el, "[data-test=no-address] a")).toBeNull();
  });

  it("labels the switch and the logo in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mount();
    expect(addressSwitch(el).label).toBe("Imprimir la dirección del local");
    expect(logoControl(el).label).toBe("Logotipo");
  });
});

describe("saving the top block", () => {
  it("sends the phone and email trimmed, the switch when off, and the chosen logo", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    edit(el, "phone", "  +34 912 345 678 ");
    edit(el, "email", " hola@deli.es ");
    toggleAddress(el, false);
    chooseLogo(el, LOGO);
    await flush(el);
    await save(el);
    expect(lastPut(api)).toEqual({
      phone: "+34 912 345 678",
      email: "hola@deli.es",
      printAddress: false,
      logo: LOGO,
    });
  });

  it("leaves out a blank phone and email, a switch left on and a removed logo", async () => {
    const api = stubApi({ phone: "912345678", email: "a@b.es", printAddress: false, logo: LOGO });
    const { el } = await mount(api);
    edit(el, "phone", "  ");
    edit(el, "email", "");
    toggleAddress(el, true);
    chooseLogo(el, null);
    await flush(el);
    await save(el);
    expect(lastPut(api)).toEqual({ printAddress: true });
  });

  it("previews what the fields hold, before they are saved", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    edit(el, "phone", "912 345 678");
    edit(el, "email", "hola@deli.es");
    toggleAddress(el, false);
    chooseLogo(el, LOGO);
    await vi.waitFor(() =>
      expect(previewCalls(api).at(-1)).toEqual({
        phone: "912 345 678",
        email: "hola@deli.es",
        printAddress: false,
        logo: LOGO,
      }),
    );
    await vi.waitFor(() => expect(paperLines(el)).toContain("Tel. 912 345 678"));
    expect(paperLines(el)).not.toContain(ADDRESS.join(", "));
  });

  it("previews the rest of the receipt while the phone is not yet a number it would print", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    edit(el, "phone", "91");
    edit(el, "email", "hola@deli.es");
    await vi.waitFor(() => expect(paperLines(el)).toContain("hola@deli.es"));
    expect(previewCalls(api).at(-1)).toEqual({ email: "hola@deli.es" });
    expect(previewCalls(api).filter((config) => "phone" in config)).toEqual([]);
    expect(q(el, "[data-test=preview-error]")).toBeNull();
    expect(q<WtInput>(el, "wt-input[name=phone]")!.error).toBe("");
  });

  it("asks for one preview per pause while the phone and email are half typed, leaving both out", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const before = previewCalls(api).length;
    edit(el, "phone", "91");
    edit(el, "email", "hola@");
    edit(el, "headerSubtitle", "Desde 1990");
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_PREVIEW_QUIET_MS + 100));
    await flush(el);
    expect(previewCalls(api).slice(before)).toEqual([{ headerSubtitle: "Desde 1990" }]);
    expect(q(el, "[data-test=preview-error]")).toBeNull();
    expect(q<WtInput>(el, "wt-input[name=phone]")!.error).toBe("");
    expect(q<WtInput>(el, "wt-input[name=email]")!.error).toBe("");
  });

  it("previews without a phone over 30 characters or an email over 254, as a save would refuse them", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const before = previewCalls(api).length;
    edit(el, "phone", `123${" ".repeat(25)}456`);
    edit(el, "email", `a@b.${"c".repeat(251)}`);
    edit(el, "headerSubtitle", "Desde 1990");
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_PREVIEW_QUIET_MS + 100));
    await flush(el);
    expect(previewCalls(api).slice(before)).toEqual([{ headerSubtitle: "Desde 1990" }]);
  });

  it("outlines the line a focused field adds to the preview", async () => {
    const { el } = await mount(stubApi({ phone: "912345678", email: "a@b.es", logo: LOGO }));
    for (const name of ["phone", "email", "address", "logo"]) {
      expect(q(el, `[data-mark=${name}]`)).not.toBeNull();
    }
    q(el, "wt-input[name=phone]")!.dispatchEvent(
      new FocusEvent("focusin", { bubbles: true, composed: true }),
    );
    await flush(el);
    expect(q(el, "[data-mark=phone]")!.hasAttribute("data-active")).toBe(true);
    addressSwitch(el).dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    await flush(el);
    expect(q(el, "[data-mark=address]")!.hasAttribute("data-active")).toBe(true);
    expect(q(el, "[data-mark=phone]")!.hasAttribute("data-active")).toBe(false);
    logoControl(el).dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    await flush(el);
    expect(q(el, "[data-mark=logo]")!.hasAttribute("data-active")).toBe(true);
  });
});

describe("the top block's keyboard and focus", () => {
  it.each([
    ["phone", "+34 912 345 678"],
    ["email", "hola@deli.es"],
  ])("saves on Enter in the %s field", async (field, value) => {
    const api = stubApi();
    const { el } = await mount(api);
    const input = q<WtInput>(el, `wt-input[name=${field}]`)!;
    await input.updateComplete;
    await userEvent.fill(input.shadowRoot!.querySelector("input")!, value);
    await el.updateComplete;
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith("bar", { [field]: value });
  });

  it("stops outlining the address once focus leaves the switch", async () => {
    const { el } = await mount();
    addressSwitch(el).dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    await flush(el);
    expect(q(el, "[data-mark=address]")!.hasAttribute("data-active")).toBe(true);
    addressSwitch(el).dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
    await flush(el);
    expect(q(el, "[data-mark=address]")!.hasAttribute("data-active")).toBe(false);
  });
});

describe("the phone and email checks before a save", () => {
  const saveButton = (el: ReceiptsScreen) =>
    departmentRoot(el).querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=department-save]",
    )!;

  it("says nothing about a half-typed phone until Save is pressed", async () => {
    const { el } = await mount();
    edit(el, "phone", "91");
    await flush(el);
    expect(q<WtInput>(el, "wt-input[name=phone]")!.error).toBe("");
    expect(saveButton(el).disabled).toBe(false);
  });

  it("refuses the save in the browser, under each field, until both are fixed", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    edit(el, "phone", "91");
    edit(el, "email", "hola@deli");
    await save(el);
    expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    const phone = q<WtInput>(el, "wt-input[name=phone]")!;
    const email = q<WtInput>(el, "wt-input[name=email]")!;
    expect(phone.error).toBe(t("receipts.invalid_phone"));
    expect(email.error).toBe(t("receipts.invalid_email"));
    expect(bottom(el)).toBe(t("form.fix_fields"));
    expect(saveButton(el).disabled).toBe(true);
    await vi.waitFor(() => expect(departmentRoot(el).activeElement).toBe(phone));
    edit(el, "phone", "912 345 678");
    await flush(el);
    expect(phone.error).toBe("");
    expect(saveButton(el).disabled).toBe(true);
    edit(el, "email", "");
    await flush(el);
    expect(email.error).toBe("");
    expect(bottom(el)).toBe("");
    expect(saveButton(el).disabled).toBe(false);
    await save(el);
    expect(lastPut(api)).toEqual({ phone: "912 345 678" });
  });

  it("holds the phone to 30 characters and the email to 254 after trimming", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    edit(el, "phone", `123${" ".repeat(25)}456`);
    edit(el, "email", `a@b.${"c".repeat(251)}`);
    await save(el);
    expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
    const tooLong = (max: number) => t("receipts.trim_too_long").replace("{max}", String(max));
    expect(q<WtInput>(el, "wt-input[name=phone]")!.error).toBe(tooLong(30));
    expect(q<WtInput>(el, "wt-input[name=email]")!.error).toBe(tooLong(254));
    edit(el, "phone", ` 123${" ".repeat(24)}456 `);
    edit(el, "email", ` a@b.${"c".repeat(250)} `);
    await flush(el);
    expect(saveButton(el).disabled).toBe(false);
    await save(el);
    expect(lastPut(api)).toEqual({
      phone: `123${" ".repeat(24)}456`,
      email: `a@b.${"c".repeat(250)}`,
    });
  });

  it.each([
    ["en-GB", "Enter a phone number of 6 to 15 digits, using only digits, spaces and + ( ) . -"],
    ["es-ES", "Escribe un teléfono de 6 a 15 cifras, usando solo cifras, espacios y + ( ) . -"],
  ] as const)("words the phone's check in %s as the check is", (locale, sentence) => {
    setLocale(locale);
    expect(t("receipts.invalid_phone")).toBe(sentence);
  });
});

describe("the top block while a save is in flight", () => {
  function delayedSave(api: DashboardApi): () => void {
    let finish!: () => void;
    vi.mocked(api.putVenueReceiptSettings).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    return () => finish();
  }
  const inner = (el: ReceiptsScreen, test: string) =>
    logoControl(el)
      .shadowRoot!.querySelector(`[data-test=${test}]`)!
      .shadowRoot!.querySelector("button")!;

  it("keeps the logo it is saving, so Saved is true of what is shown", async () => {
    const api = stubApi({ logo: LOGO });
    const finish = delayedSave(api);
    const { el } = await mount(api);
    edit(el, "headerSubtitle", "Calle Mayor 1");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    departmentRoot(el).querySelector<HTMLElement>("[data-test=department-save]")!.click();
    await flush(el);
    expect(inner(el, "remove-image").disabled).toBe(true);
    expect(inner(el, "choose-image").disabled).toBe(true);
    logoControl(el).shadowRoot!.querySelector<HTMLElement>("[data-test=remove-image]")!.click();
    logoControl(el).shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!.click();
    await flush(el);
    expect(logoControl(el).image).toBe(LOGO);
    expect(logoControl(el).shadowRoot!.querySelector("media-image-picker")).toBeNull();
    finish();
    await flush(el);
    expect(lastPut(api)).toEqual({ headerSubtitle: "Calle Mayor 1", logo: LOGO });
    expect(q(el, "p[role=status]")!.textContent!.trim()).toBe(t("receipts.saved"));
    expect(logoControl(el).image).toBe(LOGO);
    expect(inner(el, "remove-image").disabled).toBe(false);
  });

  it("closes a logo picker left open when a save starts", async () => {
    const api = stubApi({ logo: LOGO });
    const finish = delayedSave(api);
    const { el } = await mount(api);
    logoControl(el).shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!.click();
    await flush(el);
    expect(logoControl(el).shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
    edit(el, "headerSubtitle", "Calle Mayor 1");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    departmentRoot(el).querySelector<HTMLElement>("[data-test=department-save]")!.click();
    await flush(el);
    expect(logoControl(el).shadowRoot!.querySelector("media-image-picker")).toBeNull();
    finish();
    await flush(el);
    expect(logoControl(el).image).toBe(LOGO);
  });
});

describe("a refused save of the top block", () => {
  it.each([
    ["phone", "invalid_phone", "receipts.invalid_phone", "912 345 678", "933 333 333"],
    ["email", "invalid_email", "receipts.invalid_email", "hola@deli.es", "otro@deli.es"],
  ] as const)(
    "puts the %s refusal under its field and the form's sentence at the bottom, with Save still working",
    async (field, reason, key, refused, changed) => {
      const api = stubApi(
        {},
        {
          putDepartmentReceipt: vi
            .fn()
            .mockRejectedValue({ code: "receipt.invalid", params: { reason, field } }),
        },
      );
      const { el } = await mount(api);
      edit(el, field, refused);
      await save(el);
      const input = q<WtInput>(el, `wt-input[name=${field}]`)!;
      expect(input.error).toBe(t(key));
      expect(bottom(el)).toBe(t("form.fix_fields"));
      expect(
        q<HTMLElement & { disabled: boolean }>(el, "[data-test=department-save]")!.disabled,
      ).toBe(false);
      await vi.waitFor(() => expect(departmentRoot(el).activeElement).toBe(input));
      edit(el, field, changed);
      await el.updateComplete;
      expect(input.error).toBe("");
      expect(bottom(el)).toBe("");
    },
  );

  it.each([
    [
      { code: "receipt.invalid", params: { reason: "image_not_found", field: "logo" } },
      "receipts.logo_not_found",
    ],
    [
      { code: "receipt.invalid", params: { reason: "invalid_logo", field: "logo" } },
      "receipts.invalid_logo",
    ],
  ] as const)(
    "puts a refused logo's sentence under the logo until another is chosen",
    async (error, key) => {
      const api = stubApi({}, { putVenueReceiptSettings: vi.fn().mockRejectedValue(error) });
      const { el } = await mount(api);
      chooseLogo(el, LOGO);
      await save(el);
      expect(q(el, "[data-test=logo-error]")!.textContent!.trim()).toBe(t(key));
      expect(logoControl(el).invalid).toBe(true);
      expect(bottom(el)).toBe(t("form.fix_fields"));
      chooseLogo(el, null);
      await flush(el);
      expect(q(el, "[data-test=logo-error]")).toBeNull();
      expect(logoControl(el).invalid).toBe(false);
    },
  );

  it("puts an image the save could not read under the logo", async () => {
    const api = stubApi(
      {},
      {
        putVenueReceiptSettings: vi
          .fn()
          .mockRejectedValue({ code: "image.invalid_file", params: {} }),
      },
    );
    const { el } = await mount(api);
    chooseLogo(el, LOGO);
    await save(el);
    expect(q(el, "[data-test=logo-error]")!.textContent!.trim()).toBe(
      codeMessage("image.invalid_file"),
    );
    expect(bottom(el)).toBe(t("form.fix_fields"));
  });

  it("puts a refused address switch's sentence under the switch", async () => {
    const api = stubApi(
      {},
      {
        putVenueReceiptSettings: vi.fn().mockRejectedValue({
          code: "receipt.invalid",
          params: { reason: "not_boolean", field: "printAddress" },
        }),
      },
    );
    const { el } = await mount(api);
    edit(el, "headerSubtitle", "Calle Mayor 1");
    await save(el);
    expect(q(el, "[data-test=print-address-error]")!.textContent!.trim()).toBe(
      codeMessage("receipt.invalid"),
    );
    expect(bottom(el)).toBe(t("form.fix_fields"));
    toggleAddress(el, false);
    await flush(el);
    expect(q(el, "[data-test=print-address-error]")).toBeNull();
  });

  it.each(["en-GB", "es-ES"] as const)("words each refusal in %s", (locale) => {
    setLocale(locale);
    for (const key of [
      "receipts.invalid_phone",
      "receipts.invalid_email",
      "receipts.logo_not_found",
      "receipts.invalid_logo",
      "receipts.no_address",
      "receipts.print_address",
      "receipts.phone",
      "receipts.email",
      "receipts.logo",
    ] as const) {
      expect(t(key)).not.toBe(key);
    }
  });
});

describe("the logo's upload", () => {
  it("shows the library's refusal of a photo too large to upload", async () => {
    setLocale("en-GB");
    const request = vi.fn(async (_path: string, method: string) => {
      if (method === "POST") throw { code: "image.too_large", params: {}, status: 413 };
      return { images: [], total: 0 };
    });
    const { el } = await mount(stubApi({}, { imageLibraryRequest: request }));
    logoControl(el).shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!.click();
    const library = await vi.waitFor(() => {
      const found = logoControl(el)
        .shadowRoot!.querySelector("media-image-picker")
        ?.shadowRoot?.querySelector("dashboard-image-library");
      expect(found?.shadowRoot?.querySelector("[data-test=upload]")).toBeTruthy();
      return found!;
    });
    const root = library.shadowRoot!;
    root.querySelector<HTMLElement>("[data-test=upload]")!.click();
    await vi.waitFor(() => expect(root.querySelector("input[name=image-file]")).not.toBeNull());
    const transfer = new DataTransfer();
    transfer.items.add(new File(["big"], "logo.png", { type: "image/png" }));
    const file = root.querySelector<HTMLInputElement>("input[name=image-file]")!;
    file.files = transfer.files;
    file.dispatchEvent(new Event("change"));
    root
      .querySelector("[name=name-es]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "Logo" }, bubbles: true, composed: true }),
      );
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector<HTMLElement>("wt-modal [data-test=save]")!.click();
    await vi.waitFor(() =>
      expect(root.querySelector("#file-error")?.textContent?.trim()).toBe(
        codeMessage("image.too_large"),
      ),
    );
    expect(request).toHaveBeenCalledWith("/management-api/images", "POST", expect.any(FormData));
    expect(logoControl(el).image).toBeNull();
  });
});

describe("refreshes of the top block from elsewhere", () => {
  it("keeps an unsaved phone, email, switch and logo while taking the saved slogan", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi({ phone: "911111111", email: "old@deli.es", logo: LOGO }), {
      liveData,
    });
    const { el } = await mount(api);
    edit(el, "phone", "922222222");
    edit(el, "email", "new@deli.es");
    toggleAddress(el, false);
    chooseLogo(el, null);
    await flush(el);
    vi.mocked(api.getReceipt).mockResolvedValue({
      receipt: {
        headerSubtitle: "Desde otro sitio",
        phone: "933333333",
        email: "other@deli.es",
        logo: `${"b".repeat(64)}.png`,
      },
      venueAddress: ADDRESS,
    });
    liveData.invalidate([{ type: "tenant_receipts" }]);
    await vi.waitFor(() =>
      expect(q<WtInput>(el, "wt-input[name=headerSubtitle]")!.value).toBe("Desde otro sitio"),
    );
    expect(q<WtInput>(el, "wt-input[name=phone]")!.value).toBe("922222222");
    expect(q<WtInput>(el, "wt-input[name=email]")!.value).toBe("new@deli.es");
    expect(addressSwitch(el).checked).toBe(false);
    expect(logoControl(el).image).toBeNull();
  });

  it("takes a saved phone, switch and logo it was not editing", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mount(api);
    vi.mocked(api.getReceipt).mockResolvedValue({
      receipt: { phone: "933333333", printAddress: false, logo: LOGO },
      venueAddress: ADDRESS,
    });
    liveData.invalidate([{ type: "tenant_receipts" }]);
    await vi.waitFor(() => expect(q<WtInput>(el, "wt-input[name=phone]")!.value).toBe("933333333"));
    expect(addressSwitch(el).checked).toBe(false);
    expect(logoControl(el).image).toBe(LOGO);
  });

  it("shows and previews a location address changed elsewhere", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mount(api);
    const before = previewCalls(api).length;
    vi.mocked(api.getReceipt).mockResolvedValue({
      receipt: {},
      venueAddress: ["Plaza Nueva 2", "41001 Sevilla"],
    });
    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() =>
      expect(q(el, "[data-test=venue-address]")!.textContent).toContain("Plaza Nueva 2"),
    );
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_PREVIEW_QUIET_MS + 100));
    expect(previewCalls(api).length).toBe(before + 1);
  });
});
