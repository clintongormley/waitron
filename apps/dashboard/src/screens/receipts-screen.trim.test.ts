import { LiveData } from "@waitron/dashboard-kit";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, ReceiptConfig } from "../api/client.js";
import { ReceiptsScreen } from "./receipts-screen.js";

const PREVIEW = {
  preview: {
    widthDots: 512,
    columns: 42,
    text: "Deli Test SL\n",
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

function stubApi(overrides: Partial<DashboardApi> = {}, receipt: ReceiptConfig = {}): DashboardApi {
  return {
    getReceipt: vi.fn().mockResolvedValue({ receipt: {}, venueAddress: [] }),
    getVenueDepartments: vi.fn().mockResolvedValue([]),
    getVenueReceiptSettings: vi
      .fn()
      .mockResolvedValue({ settings: { ...receipt }, venueAddress: [] }),
    putVenueReceiptSettings: vi.fn().mockResolvedValue(undefined),
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta en establecimiento" }),
    putLocationSettings: vi.fn().mockResolvedValue(undefined),
    getReceiptLanguage: vi.fn().mockResolvedValue({
      language: "es-ES",
      choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      fixed: null,
    }),
    putReceiptLanguage: vi.fn().mockResolvedValue(undefined),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    previewReceipt: vi.fn().mockResolvedValue(PREVIEW),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: ReceiptsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const root = (el: ReceiptsScreen) =>
  el.shadowRoot!.querySelector("dashboard-venue-receipt-defaults-editor")!.shadowRoot!;
const q = (el: ReceiptsScreen, sel: string) => root(el).querySelector<HTMLElement>(sel);

const qa = (el: ReceiptsScreen, sel: string) => Array.from(el.shadowRoot!.querySelectorAll(sel));
const errorKey = (el: ReceiptsScreen): string | null =>
  (root(el).querySelector("wt-form-actions") as HTMLElement & { error: string }).error;
const lastPut = (api: DashboardApi): ReceiptConfig =>
  (api.putVenueReceiptSettings as unknown as { mock: { calls: [ReceiptConfig][] } }).mock.calls.at(
    -1,
  )![0];

function typeHeader(el: ReceiptsScreen, value: string): void {
  q(el, "[name=headerSubtitle]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function typeFooter(el: ReceiptsScreen, value: string): void {
  q(el, "[name=footerMessage]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

afterEach(cleanupWidgets);

describe("receipts page: the receipt header and footer", () => {
  it("loads the two fields from getVenueReceiptSettings().settings on connect", async () => {
    const api = stubApi(
      {},
      { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias por su visita" },
    );
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    expect(api.getVenueReceiptSettings).toHaveBeenCalledTimes(1);
    const header = q(el, "[name=headerSubtitle]") as HTMLElement & { value: string };
    const footer = q(el, "[name=footerMessage]") as HTMLTextAreaElement;
    expect(header.value).toBe("Calle Mayor 1");
    expect(footer.value).toBe("Gracias por su visita");
  });

  it("renders no h1: the Venue settings page owns the page heading", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    expect(qa(el, "h1")).toHaveLength(0);
    expect(qa(el, "h2").length).toBeGreaterThan(0);
  });

  it("leaves both fields empty when the receipt config is empty", async () => {
    const api = stubApi(); // settings: {}
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    const header = q(el, "[name=headerSubtitle]") as HTMLElement & { value: string };
    const footer = q(el, "[name=footerMessage]") as HTMLTextAreaElement;
    expect(header.value).toBe("");
    expect(footer.value).toBe("");
  });

  it("Guardar composes the edited fields and calls putVenueReceiptSettings with them", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    typeHeader(el, "Av. de la Constitución 3");
    typeFooter(el, "Gracias por su visita");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    await flush(el);

    expect(api.putVenueReceiptSettings).toHaveBeenCalledTimes(1);
    expect(lastPut(api)).toEqual({
      headerSubtitle: "Av. de la Constitución 3",
      footerMessage: "Gracias por su visita",
    });
  });

  it("saves only the changed default and retains the other loaded field", async () => {
    const api = stubApi({}, { headerSubtitle: "Calle Mayor 1", footerMessage: "Hasta pronto" });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    typeHeader(el, "Changed then saved");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    await flush(el);
    expect(lastPut(api)).toEqual({
      headerSubtitle: "Changed then saved",
      footerMessage: "Hasta pronto",
    });
  });

  it("omits a blank field so it reaches putVenueReceiptSettings as an ABSENT key, not an empty string", async () => {
    const api = stubApi({}, { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias" });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    typeHeader(el, "   "); // whitespace-only is blank
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    await flush(el);

    const sent = lastPut(api);
    expect(sent).toEqual({ footerMessage: "Gracias" });
    expect("headerSubtitle" in sent).toBe(false);
  });

  it("sends an empty {} when both fields are blank (matches DEFAULT_RECEIPT)", async () => {
    const api = stubApi({}, { headerSubtitle: "Before" });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    typeHeader(el, "");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    await flush(el);
    expect(lastPut(api)).toEqual({});
  });

  it("trims surrounding whitespace off a saved field", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    typeFooter(el, "  Gracias por su visita  ");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    await flush(el);
    expect(lastPut(api)).toEqual({ footerMessage: "Gracias por su visita" });
  });

  it("surfaces a rejected putVenueReceiptSettings in the form's bottom message, without the raw code", async () => {
    const api = stubApi({
      putVenueReceiptSettings: vi.fn().mockRejectedValue({ code: "receipt.invalid" }),
    });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    typeHeader(el, "Calle Mayor 1");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    await flush(el);

    expect(errorKey(el)).toBe(codeMessage("receipt.invalid"));
    const message = (q(el, "wt-form-actions") as HTMLElement & { error: string }).error;
    expect(message).toContain(codeMessage("receipt.invalid", "es-ES"));
    expect(message).not.toContain("receipt.invalid");
  });

  it("falls back to server.internal when a rejected putVenueReceiptSettings carries no code", async () => {
    const api = stubApi({ putVenueReceiptSettings: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    typeHeader(el, "Calle Mayor 1");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe(codeMessage("server.internal"));
  });

  it("shows an error key when the initial load is rejected (and never rejects)", async () => {
    const api = stubApi({
      getVenueReceiptSettings: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("server.internal", "es-ES"));
    expect(banner).not.toContain("server.internal");
  });

  it("contains the field change events so they do not leak past the screen (stopPropagation)", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    const escapedChange = vi.fn();
    const escapedInput = vi.fn();
    host.addEventListener("wt-change", escapedChange);
    host.addEventListener("input", escapedInput);
    typeHeader(el, "Calle Mayor 1");
    typeFooter(el, "Gracias");
    await el.updateComplete;
    expect(escapedChange).not.toHaveBeenCalled();
    expect(escapedInput).not.toHaveBeenCalled();
  });
});

it.each([
  {
    method: "putVenueReceiptSettings",
    field: "[name=headerSubtitle]",
    button: "[data-test=defaults-save]",
    result: null,
  },
])(
  "Enter guards pending $method and allows retry after rejection",
  async ({ method, field, button, result }) => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    const request = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(result);
    const api = stubApi({ [method]: request });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);

    const control = root(el).querySelector<import("@waitron/ui").WtInput>(field)!;
    await control.updateComplete;
    const input = control.shadowRoot!.querySelector("input")!;
    input.value = "Updated";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    root(el).querySelector<HTMLElement>(button)!.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect((root(el).querySelector(button) as import("@waitron/ui").WtButton).disabled).toBe(true);
    reject({ code: "management.request_invalid" });
    await flush(el);
    input.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(request).toHaveBeenCalledTimes(2);
    // The retry saved the draft, so Save is quiet until the next edit, which it then follows.
    const action = root(el).querySelector(button) as import("@waitron/ui").WtButton;
    expect([action.variant, action.disabled]).toEqual(["secondary", true]);
    input.value = "Updated again";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(action.disabled).toBe(false);
  },
);

it("refreshes clean receipt fields while preserving an unsaved header", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi({}, { headerSubtitle: "Before", footerMessage: "Before" }), {
    liveData,
  });
  const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
  await flush(el);
  root(el)
    .querySelector("[name=headerSubtitle]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Unsaved" } }));
  vi.mocked(api.getVenueReceiptSettings).mockResolvedValue({
    settings: { headerSubtitle: "Elsewhere", footerMessage: "Updated" },
  });
  liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() =>
    expect((root(el).querySelector("[name=footerMessage]") as HTMLTextAreaElement).value).toBe(
      "Updated",
    ),
  );
  expect((root(el).querySelector("[name=headerSubtitle]") as HTMLInputElement).value).toBe(
    "Unsaved",
  );
});
