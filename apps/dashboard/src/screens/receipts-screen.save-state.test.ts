import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, ReceiptConfig, ReceiptPreview } from "../api/client.js";
import "./receipts-screen.js";
import type { ReceiptsScreen } from "./receipts-screen.js";

afterEach(cleanupWidgets);

const LOGO = `${"c".repeat(64)}.png`;
// Every field holds something, in the spellings a stored receipt comes back in, so a field that
// rewrites its value on first draw would show as a change.
const storedReceipt: ReceiptConfig = {
  headerSubtitle: "Calle Mayor 1",
  footerMessage: "Gracias por su visita",
  phone: "+34 912 345 678",
  email: "hola@deli.es",
  printAddress: false,
  logo: LOGO,
};
const storedDescription = "Venta en establecimiento";

function preview(): ReceiptPreview {
  return {
    preview: {
      widthDots: 512,
      columns: 42,
      text: "Deli Test SL",
      blocks: [{ kind: "text", text: "Deli Test SL\n" }],
      qrData: [],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    },
    marks: {
      headerSubtitle: null,
      footerMessage: null,
      phone: null,
      email: null,
      address: null,
      logo: null,
    },
    paperWidth: "80mm",
    paperWidths: ["80mm"],
  };
}

function stubApi() {
  let receipt = { ...storedReceipt };
  let description = storedDescription;
  let language = "es-ES";
  const api = {
    getReceipt: vi.fn(async () => ({ receipt: { ...receipt }, venueAddress: ["Calle Mayor 1"] })),
    putReceipt: vi.fn(async (next: ReceiptConfig) => {
      receipt = { ...next };
    }),
    getLocationSettings: vi.fn(async () => ({
      name: "Calle Mayor",
      operationDescription: description,
    })),
    putLocationSettings: vi.fn(async (next: string) => {
      description = next;
    }),
    getReceiptLanguage: vi.fn(async () => ({
      language,
      choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      fixed: null,
    })),
    putReceiptLanguage: vi.fn(async (next: string) => {
      language = next;
    }),
    getContentLanguages: vi.fn(async () => ({ defaultLanguage: "es", languages: ["es"] })),
    getVenueDepartments: vi.fn(async () => [{ id: "deli", name: "Deli", active: true }]),
    previewReceipt: vi.fn(async () => preview()),
  };
  return api;
}

const q = <T extends HTMLElement = HTMLElement>(el: ReceiptsScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);

async function mount() {
  const api = stubApi();
  const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
    api: api as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(q(el, "[data-test=save]")).not.toBeNull());
  return { el, api };
}

function save(el: ReceiptsScreen) {
  return q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: ReceiptsScreen) {
  await el.updateComplete;
  const action = save(el);
  await action.updateComplete;
  return {
    variant: action.variant,
    disabled: action.disabled,
    innerDisabled: action.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: ReceiptsScreen) {
  await userEvent.click(page.elementLocator(save(el).shadowRoot!.querySelector("button")!), {
    force: true,
  });
  await el.updateComplete;
}
function sent(api: ReturnType<typeof stubApi>) {
  return (
    api.putReceipt.mock.calls.length +
    api.putLocationSettings.mock.calls.length +
    api.putReceiptLanguage.mock.calls.length
  );
}

type Edit = (el: ReceiptsScreen) => Promise<void>;
function typeInto(name: string, value: string): Edit {
  return async (el) => {
    const field = q<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="${name}"]`)!;
    await field.updateComplete;
    await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
    await el.updateComplete;
  };
}
function typeFooter(value: string): Edit {
  return async (el) => {
    const field = q<HTMLElement & { updateComplete: Promise<unknown> }>(
      el,
      "wt-textarea[name=footerMessage]",
    )!;
    await field.updateComplete;
    await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("textarea")!), value);
    await el.updateComplete;
  };
}
const flipAddress: Edit = async (el) => {
  const field = q<HTMLElement & { updateComplete: Promise<unknown> }>(
    el,
    "wt-switch[name=printAddress]",
  )!;
  await field.updateComplete;
  await userEvent.click(page.elementLocator(field.shadowRoot!.querySelector("label")!));
  await el.updateComplete;
};
function setLogo(image: string | null): Edit {
  return async (el) => {
    q(el, "dashboard-image-upload")!.dispatchEvent(
      new CustomEvent("image-changed", { detail: { image }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
  };
}
function pickLanguage(language: string): Edit {
  return async (el) => {
    await chooseOption(q(el, "wt-combobox[name=receiptLanguage]")!, language);
    await el.updateComplete;
  };
}

describe("the receipts page's Save", () => {
  it("opens on the stored values with Save quiet, and a press sends nothing", async () => {
    const { el, api } = await mount();
    expect(q<HTMLElementTagNameMap["wt-input"]>(el, "wt-input[name=phone]")!.value).toBe(
      storedReceipt.phone,
    );
    expect(await state(el)).toEqual(quiet);
    await press(el);
    expect(sent(api)).toBe(0);
    expect(await state(el)).toEqual(quiet);
  });

  it.each<[string, Edit, Edit]>([
    [
      "headerSubtitle",
      typeInto("headerSubtitle", "Calle Mayor 2"),
      typeInto("headerSubtitle", "Calle Mayor 1"),
    ],
    ["phone", typeInto("phone", "+34 912 345 679"), typeInto("phone", "+34 912 345 678")],
    ["email", typeInto("email", "adios@deli.es"), typeInto("email", "hola@deli.es")],
    ["footerMessage", typeFooter("Vuelva pronto"), typeFooter("Gracias por su visita")],
    ["printAddress", flipAddress, flipAddress],
    ["logo", setLogo(null), setLogo(LOGO)],
    ["receiptLanguage", pickLanguage("ca-ES"), pickLanguage("es-ES")],
    [
      "operationDescription",
      typeInto("operationDescription", "Servicio de mesa"),
      typeInto("operationDescription", storedDescription),
    ],
  ])(
    "one %s edit wakes Save, and putting the stored value back quiets it",
    async (_, edit, revert) => {
      const { el } = await mount();
      await edit(el);
      expect(await state(el)).toEqual(ready);
      await revert(el);
      expect(await state(el)).toEqual(quiet);
    },
  );

  it("a changed page its own checks refuse stays drawn primary and disabled after a press", async () => {
    const { el, api } = await mount();
    await typeInto("phone", "not a phone")(el);
    expect(await state(el)).toEqual(ready);
    await press(el);
    expect(sent(api)).toBe(0);
    expect(await state(el)).toEqual(blocked);
  });

  it("after a save, the page stays open with the saved values and Save quiet", async () => {
    const { el, api } = await mount();
    await typeInto("headerSubtitle", "Calle Mayor 2")(el);
    await pickLanguage("ca-ES")(el);
    await typeInto("operationDescription", "Servicio de mesa")(el);
    await press(el);
    await vi.waitFor(() => expect(api.putLocationSettings).toHaveBeenCalledOnce());
    expect(api.putReceiptLanguage).toHaveBeenCalledExactlyOnceWith("ca-ES");
    expect(api.putReceipt).toHaveBeenCalledExactlyOnceWith({
      ...storedReceipt,
      headerSubtitle: "Calle Mayor 2",
    });
    expect(api.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Servicio de mesa");
    await vi.waitFor(() => expect(q(el, "[role=status]")).not.toBeNull());
    expect(await state(el)).toEqual(quiet);
  });

  // A host `.click()` reaches the listener even while the inner button is disabled, so this presses
  // the host: what it proves is that the handler itself sends nothing for an untouched page.
  it("a press that reaches an untouched Save's handler sends nothing", async () => {
    const { el, api } = await mount();
    save(el).click();
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent(api)).toBe(0);
    expect(q(el, "[role=status]")).toBeNull();
  });

  it("Enter in an untouched field sends nothing", async () => {
    const { el, api } = await mount();
    const field = q<HTMLElementTagNameMap["wt-input"]>(el, "wt-input[name=phone]")!;
    await field.updateComplete;
    field.shadowRoot!.querySelector("input")!.focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(sent(api)).toBe(0);
  });
});
