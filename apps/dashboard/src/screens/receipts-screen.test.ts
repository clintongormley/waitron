import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type {
  DashboardApi,
  PrintPreviewBlock,
  ReceiptConfig,
  ReceiptPreview,
} from "../api/client.js";
import { RECEIPT_PREVIEW_QUIET_MS, ReceiptsScreen } from "./receipts-screen.js";
import type { WtInput } from "@waitron/ui";

/** A stand-in for the server's drawing: one text block a line, with the trim marked. */
function fakePreview(config: ReceiptConfig): ReceiptPreview {
  const lines = ["Deli Test SL"];
  const header = config.headerSubtitle === undefined ? null : lines.push(config.headerSubtitle) - 1;
  lines.push("NIF: B12345678", "1  Café y tostada   5,50 €", "VERI*FACTU");
  const footer = config.footerMessage === undefined ? null : lines.push(config.footerMessage) - 1;
  const blocks: PrintPreviewBlock[] = lines.map((text) => ({ kind: "text", text: `${text}\n` }));
  return {
    preview: {
      widthDots: 512,
      columns: 42,
      text: lines.join("\n"),
      blocks: [...blocks, { kind: "cut" }],
      qrData: [],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    },
    marks: {
      headerSubtitle: header === null ? null : { start: header, end: header + 1 },
      footerMessage: footer === null ? null : { start: footer, end: footer + 1 },
    },
    paperWidth: "80mm",
    paperWidths: ["80mm"],
  };
}

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  return {
    getReceipt: vi.fn().mockResolvedValue({ receipt: {} }),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta en establecimiento" }),
    putLocationSettings: vi.fn().mockResolvedValue(undefined),
    previewReceipt: vi.fn(async (config: ReceiptConfig) => fakePreview(config)),
    ...overrides,
  } as unknown as DashboardApi;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A read that stays open until `release` is called with what it answers. */
function heldRead<T>(): { read: () => Promise<T>; release: (value: T) => void } {
  let release!: (value: T) => void;
  const pending = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { read: () => pending, release };
}

async function flush(el: ReceiptsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = <T extends HTMLElement = HTMLElement>(el: ReceiptsScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const paper = (el: ReceiptsScreen) => q(el, ".paper");
const paperLines = (el: ReceiptsScreen) =>
  [...paper(el)!.querySelectorAll("pre")].map((pre) => pre.textContent!.trim());
const previewCalls = (api: DashboardApi) =>
  vi.mocked(api.previewReceipt).mock.calls.map(([config]) => config);

function edit(el: ReceiptsScreen, name: string, value: string): void {
  q(el, `wt-input[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function typeFooter(el: ReceiptsScreen, value: string): void {
  const footer = q<HTMLTextAreaElement>(el, "textarea[name=footerMessage]")!;
  footer.value = value;
  footer.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mount(api: DashboardApi = stubApi()) {
  const mounted = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
  await flush(mounted.el);
  await vi.waitFor(() => expect(paper(mounted.el)).not.toBeNull());
  return mounted;
}

afterEach(cleanupWidgets);

describe("the Receipts page's fields", () => {
  it("shows the two receipt texts and the operation description, each with a hint saying where it appears", async () => {
    const { el } = await mount();
    const header = q<WtInput>(el, "wt-input[name=headerSubtitle]")!;
    const description = q<WtInput>(el, "wt-input[name=operationDescription]")!;
    const footer = q<HTMLTextAreaElement>(el, "textarea[name=footerMessage]")!;
    expect(header.label).toBe(t("receipt.header_subtitle"));
    expect(header.hint).toBe(t("receipts.header_subtitle_hint"));
    expect(footer.placeholder).toBe(t("receipts.footer_message_hint"));
    expect(footer.labels![0]!.textContent).toContain(t("receipt.footer_message"));
    expect(description.label).toBe(t("location_settings.description"));
    expect(description.hint).toBe(t("receipts.operation_description_hint"));
    expect(description.required).toBe(true);
  });

  it("puts the venue-wide texts and this location's description in separate sections, the second titled with the location's name, with no location picker", async () => {
    const { el } = await mount();
    const [venueWide, location] = [...el.shadowRoot!.querySelectorAll("section.settings")];
    expect(venueWide!.querySelector("h2")!.textContent).toBe(t("receipts.venue_wide"));
    expect(venueWide!.querySelector("[name=headerSubtitle]")).not.toBeNull();
    expect(venueWide!.querySelector("[name=footerMessage]")).not.toBeNull();
    expect(location!.querySelector("h2")!.textContent).toBe("Calle Mayor");
    expect(location!.querySelector("[name=operationDescription]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("select, wt-combobox")).toBeNull();
  });
});

describe("the Receipts page's live preview", () => {
  it("draws the saved texts as soon as the page opens", async () => {
    const api = stubApi({
      getReceipt: vi.fn().mockResolvedValue({
        receipt: { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias" },
      }),
    });
    const { el } = await mount(api);
    expect(previewCalls(api)).toEqual([
      { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias" },
    ]);
    expect(paperLines(el)).toContain("Calle Mayor 1");
  });

  it("shows typed header text on the line under the venue's name before anything is saved", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    expect(paperLines(el).slice(0, 2)).toEqual(["Deli Test SL", "NIF: B12345678"]);
    edit(el, "headerSubtitle", "Abierto todos los días");
    await vi.waitFor(() =>
      expect(paperLines(el).slice(0, 3)).toEqual([
        "Deli Test SL",
        "Abierto todos los días",
        "NIF: B12345678",
      ]),
    );
    expect(paper(el)!.querySelector("[data-mark=headerSubtitle]")!.textContent!.trim()).toBe(
      "Abierto todos los días",
    );
    expect(api.putReceipt).not.toHaveBeenCalled();
  });

  it("shows typed footer text at the bottom of the receipt before anything is saved", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    typeFooter(el, "Hasta pronto");
    await vi.waitFor(() => expect(paperLines(el).at(-1)).toBe("Hasta pronto"));
    expect(paper(el)!.querySelector("[data-mark=footerMessage]")!.textContent!.trim()).toBe(
      "Hasta pronto",
    );
    expect(api.putReceipt).not.toHaveBeenCalled();
  });

  it("previews the text a save would send: trimmed, and a blank field left out", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    edit(el, "headerSubtitle", "   ");
    typeFooter(el, "  Gracias  ");
    await vi.waitFor(() => expect(previewCalls(api)).toHaveLength(2));
    expect(previewCalls(api)[1]).toEqual({ footerMessage: "Gracias" });
  });

  it("never draws the operation description on the paper, and shows its unsaved text under it", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    edit(el, "operationDescription", "Venta de comidas para llevar");
    await el.updateComplete;
    const notPrinted = q(el, "[data-test=not-printed]")!;
    expect(notPrinted.querySelector("h3")!.textContent).toBe(t("receipts.not_printed"));
    expect(notPrinted.querySelector("p")!.textContent).toBe("Venta de comidas para llevar");
    expect(
      paper(el)!.compareDocumentPosition(notPrinted) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_PREVIEW_QUIET_MS + 100));
    expect(paper(el)!.textContent).not.toContain("Venta de comidas");
    for (const config of previewCalls(api))
      expect(Object.keys(config)).not.toContain("operationDescription");
  });

  it("outlines the header line while the header field has focus, and the footer line while the footer has", async () => {
    const api = stubApi({
      getReceipt: vi.fn().mockResolvedValue({
        receipt: { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias" },
      }),
    });
    const { el } = await mount(api);
    const mark = (name: string) => paper(el)!.querySelector<HTMLElement>(`[data-mark=${name}]`)!;
    expect(mark("headerSubtitle").hasAttribute("data-active")).toBe(false);
    const header = q<WtInput>(el, "wt-input[name=headerSubtitle]")!;
    header.shadowRoot!.querySelector("input")!.focus();
    await el.updateComplete;
    expect(mark("headerSubtitle").hasAttribute("data-active")).toBe(true);
    expect(getComputedStyle(mark("headerSubtitle")).outlineStyle).toBe("solid");
    expect(mark("footerMessage").hasAttribute("data-active")).toBe(false);
    q<HTMLTextAreaElement>(el, "textarea[name=footerMessage]")!.focus();
    await el.updateComplete;
    expect(mark("headerSubtitle").hasAttribute("data-active")).toBe(false);
    expect(mark("footerMessage").hasAttribute("data-active")).toBe(true);
    q<HTMLTextAreaElement>(el, "textarea[name=footerMessage]")!.blur();
    await el.updateComplete;
    expect(mark("footerMessage").hasAttribute("data-active")).toBe(false);
  });

  it("waits for a quiet moment after typing, then sends one preview with the latest text", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    for (const text of ["G", "Gr", "Gra", "Gracias"]) edit(el, "headerSubtitle", text);
    const typedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_PREVIEW_QUIET_MS / 2));
    expect(previewCalls(api)).toHaveLength(1);
    await vi.waitFor(() => expect(previewCalls(api)).toHaveLength(2));
    expect(performance.now() - typedAt).toBeGreaterThanOrEqual(RECEIPT_PREVIEW_QUIET_MS - 5);
    expect(previewCalls(api)[1]).toEqual({ headerSubtitle: "Gracias" });
  });

  it("keeps one preview in flight at a time, and sends only the latest text when it returns", async () => {
    let answer!: () => void;
    const previewReceipt = vi.fn(async (config: ReceiptConfig) => {
      if (previewReceipt.mock.calls.length === 2) {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
      }
      return fakePreview(config);
    });
    const api = stubApi({ previewReceipt });
    const { el } = await mount(api);
    edit(el, "headerSubtitle", "uno");
    await vi.waitFor(() => expect(previewReceipt).toHaveBeenCalledTimes(2));
    edit(el, "headerSubtitle", "dos");
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_PREVIEW_QUIET_MS + 100));
    edit(el, "headerSubtitle", "tres");
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_PREVIEW_QUIET_MS + 100));
    expect(previewReceipt).toHaveBeenCalledTimes(2);
    answer();
    await vi.waitFor(() => expect(previewReceipt).toHaveBeenCalledTimes(3));
    expect(previewReceipt.mock.calls[2]![0]).toEqual({ headerSubtitle: "tres" });
    await vi.waitFor(() => expect(paperLines(el)).toContain("tres"));
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_PREVIEW_QUIET_MS + 100));
    expect(previewReceipt).toHaveBeenCalledTimes(3);
  });

  it("sends the latest text once when a queued follow-up and a newer quiet timer both want it", async () => {
    let answer!: () => void;
    const previewReceipt = vi.fn(async (config: ReceiptConfig) => {
      if (previewReceipt.mock.calls.length === 2) {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
      }
      return fakePreview(config);
    });
    const api = stubApi({ previewReceipt });
    const { el } = await mount(api);
    edit(el, "headerSubtitle", "uno");
    await vi.waitFor(() => expect(previewReceipt).toHaveBeenCalledTimes(2));
    edit(el, "headerSubtitle", "dos");
    await sleep(RECEIPT_PREVIEW_QUIET_MS + 100);
    edit(el, "headerSubtitle", "tres");
    answer();
    await vi.waitFor(() => expect(previewReceipt).toHaveBeenCalledTimes(3));
    await sleep(RECEIPT_PREVIEW_QUIET_MS + 100);
    expect(previewCalls(api)).toEqual([{}, { headerSubtitle: "uno" }, { headerSubtitle: "tres" }]);
  });

  it("keeps the last preview and says it is out of date when a preview request fails", async () => {
    const previewReceipt = vi
      .fn()
      .mockImplementationOnce(async (config: ReceiptConfig) => fakePreview(config))
      .mockRejectedValue({ code: "receipt.invalid", params: { field: "headerSubtitle" } });
    const { el } = await mount(stubApi({ previewReceipt }));
    edit(el, "headerSubtitle", "x".repeat(201));
    await vi.waitFor(() => expect(q(el, "[data-test=preview-error]")).not.toBeNull());
    expect(q(el, "[data-test=preview-error]")!.textContent!.trim()).toBe(
      t("receipts.preview_error"),
    );
    expect(paperLines(el)[0]).toBe("Deli Test SL");
    expect(q<WtInput>(el, "wt-input[name=headerSubtitle]")!.error).toBe("");
    edit(el, "headerSubtitle", "ok");
    previewReceipt.mockImplementation(async (config: ReceiptConfig) => fakePreview(config));
    await vi.waitFor(() => expect(q(el, "[data-test=preview-error]")).toBeNull());
  });

  it("stops previewing once the page is closed", async () => {
    const api = stubApi();
    const { el, host } = await mount(api);
    edit(el, "headerSubtitle", "Adiós");
    host.remove();
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_PREVIEW_QUIET_MS + 100));
    expect(previewCalls(api)).toHaveLength(1);
  });
});

describe("the Receipts page's one Save", () => {
  it("saves both the receipt texts and the location's description", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    edit(el, "headerSubtitle", "Calle Mayor 1");
    edit(el, "operationDescription", "Venta de comidas");
    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(api.putReceipt).toHaveBeenCalledExactlyOnceWith({ headerSubtitle: "Calle Mayor 1" });
    expect(api.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Venta de comidas");
    expect(q(el, "[role=status]")!.textContent).toBe(t("receipts.saved"));
  });

  it("when only the receipt texts are refused, says so at the bottom and claims no success", async () => {
    const api = stubApi({ putReceipt: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mount(api);
    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(api.putLocationSettings).toHaveBeenCalledTimes(1);
    const actions = q(el, "wt-form-actions")! as HTMLElement & { error: string };
    expect(actions.error).toBe(
      `${t("receipts.trim_save_error")} ${codeMessage("server.internal")}`,
    );
    expect(q(el, "[role=status]")).toBeNull();
    expect(q<WtInput>(el, "wt-input[name=operationDescription]")!.error).toBe("");
  });

  it("when both saves fail, names both failures at the bottom", async () => {
    const api = stubApi({
      putReceipt: vi.fn().mockRejectedValue({ code: "server.internal" }),
      putLocationSettings: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mount(api);
    q(el, "[data-test=save]")!.click();
    await flush(el);
    const actions = q(el, "wt-form-actions")! as HTMLElement & { error: string };
    expect(actions.error).toBe(
      `${t("receipts.trim_save_error")} ${codeMessage("server.internal")} ${t("location_settings.save_error")}`,
    );
  });

  it.each(["headerSubtitle", "footerMessage"] as const)(
    "puts a refused %s's reason under that field, focuses it, and leaves Save working",
    async (field) => {
      const api = stubApi({
        putReceipt: vi.fn().mockRejectedValue({
          code: "receipt.invalid",
          params: { reason: "too_long", field, maxLength: 200 },
        }),
      });
      const { el } = await mount(api);
      q(el, "[data-test=save]")!.click();
      await flush(el);
      const expected = t("receipts.trim_too_long").replace("{max}", "200");
      if (field === "headerSubtitle") {
        const header = q<WtInput>(el, "wt-input[name=headerSubtitle]")!;
        expect(header.error).toBe(expected);
        await vi.waitFor(() =>
          expect(header.shadowRoot!.activeElement).toBe(header.shadowRoot!.querySelector("input")),
        );
      } else {
        const footer = q<HTMLTextAreaElement>(el, "textarea[name=footerMessage]")!;
        expect(footer.getAttribute("aria-invalid")).toBe("true");
        const descriptions = footer
          .getAttribute("aria-describedby")!
          .split(" ")
          .map((id) => el.shadowRoot!.getElementById(id)!.textContent);
        expect(descriptions).toEqual([t("receipts.footer_message_hint"), expected]);
        await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(footer));
      }
      const actions = q(el, "wt-form-actions")! as HTMLElement & { error: string };
      expect(actions.error).toBe(t("form.fix_fields"));
      expect(q(el, "[data-test=save]")!.hasAttribute("disabled")).toBe(false);
      if (field === "headerSubtitle") edit(el, "headerSubtitle", "short");
      else typeFooter(el, "short");
      await el.updateComplete;
      expect(actions.error).toBe("");
    },
  );

  it("names a refused receipt field without a stated limit by the refusal's own message", async () => {
    const api = stubApi({
      putReceipt: vi.fn().mockRejectedValue({
        code: "receipt.invalid",
        params: { reason: "not_string", field: "headerSubtitle" },
      }),
    });
    const { el } = await mount(api);
    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(q<WtInput>(el, "wt-input[name=headerSubtitle]")!.error).toBe(
      codeMessage("receipt.invalid"),
    );
  });

  it("follows a refreshed saved text into the preview when the field was not edited", async () => {
    const { LiveData } = await import("@waitron/dashboard-kit");
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mount(api);
    vi.mocked(api.getReceipt).mockResolvedValue({
      receipt: { headerSubtitle: "Desde otro sitio" },
    });
    liveData.invalidate([{ type: "tenant_receipts" }]);
    await vi.waitFor(() => expect(paperLines(el)).toContain("Desde otro sitio"));
  });

  it("keeps the saved description when a read that started before the Save answers after it", async () => {
    const { LiveData } = await import("@waitron/dashboard-kit");
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({
        getLocationSettings: vi
          .fn()
          .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Before" }),
      }),
      { liveData },
    );
    const { el } = await mount(api);
    const held = heldRead<{ name: string; operationDescription: string }>();
    vi.mocked(api.getLocationSettings).mockImplementation(held.read);
    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() => expect(api.getLocationSettings).toHaveBeenCalledTimes(2));
    edit(el, "operationDescription", "Saved new");
    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(q(el, "[role=status]")).not.toBeNull();
    held.release({ name: "Calle Mayor", operationDescription: "Before" });
    await flush(el);
    expect(q<WtInput>(el, "wt-input[name=operationDescription]")!.value).toBe("Saved new");
    edit(el, "headerSubtitle", "Solo la cabecera");
    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(vi.mocked(api.putLocationSettings).mock.calls).toEqual([["Saved new"], ["Saved new"]]);
  });

  it("still takes a description read that started after the Save", async () => {
    const { LiveData } = await import("@waitron/dashboard-kit");
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mount(api);
    edit(el, "operationDescription", "Saved new");
    q(el, "[data-test=save]")!.click();
    await flush(el);
    vi.mocked(api.getLocationSettings).mockResolvedValue({
      name: "Calle Mayor",
      operationDescription: "Changed elsewhere",
    });
    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() =>
      expect(q<WtInput>(el, "wt-input[name=operationDescription]")!.value).toBe(
        "Changed elsewhere",
      ),
    );
  });

  it("keeps the saved receipt texts when a read that started before the Save answers after it", async () => {
    const { LiveData } = await import("@waitron/dashboard-kit");
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({
        getReceipt: vi.fn().mockResolvedValue({ receipt: { headerSubtitle: "Before" } }),
      }),
      { liveData },
    );
    const { el } = await mount(api);
    const held = heldRead<{ receipt: ReceiptConfig }>();
    vi.mocked(api.getReceipt).mockImplementation(held.read);
    liveData.invalidate([{ type: "tenant_receipts" }]);
    await vi.waitFor(() => expect(api.getReceipt).toHaveBeenCalledTimes(2));
    edit(el, "headerSubtitle", "Saved new");
    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(q(el, "[role=status]")).not.toBeNull();
    held.release({ receipt: { headerSubtitle: "Before" } });
    await flush(el);
    expect(q<WtInput>(el, "wt-input[name=headerSubtitle]")!.value).toBe("Saved new");
    edit(el, "operationDescription", "Solo la descripción");
    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(vi.mocked(api.putReceipt).mock.calls).toEqual([
      [{ headerSubtitle: "Saved new" }],
      [{ headerSubtitle: "Saved new" }],
    ]);
  });
});

describe("the Receipts page's refreshes from elsewhere", () => {
  async function mountLive(receipt: ReceiptConfig = {}) {
    const { LiveData } = await import("@waitron/dashboard-kit");
    const liveData = new LiveData();
    const api = Object.assign(stubApi({ getReceipt: vi.fn().mockResolvedValue({ receipt }) }), {
      liveData,
    });
    const { el } = await mount(api);
    return { el, api, liveData };
  }

  it("sends no preview when a refresh leaves the shown receipt texts as they were", async () => {
    const { el, api, liveData } = await mountLive();
    edit(el, "headerSubtitle", "Mío");
    await vi.waitFor(() => expect(previewCalls(api)).toHaveLength(2));
    vi.mocked(api.getReceipt).mockResolvedValue({ receipt: { headerSubtitle: "Suyo" } });
    vi.mocked(api.getLocationSettings).mockResolvedValue({
      name: "Calle Mayor",
      operationDescription: "Otra descripción",
    });
    liveData.invalidate([{ type: "tenant_receipts" }, { type: "locations" }]);
    await vi.waitFor(() =>
      expect(q<WtInput>(el, "wt-input[name=operationDescription]")!.value).toBe("Otra descripción"),
    );
    await vi.waitFor(() => expect(api.getReceipt).toHaveBeenCalledTimes(2));
    await sleep(RECEIPT_PREVIEW_QUIET_MS + 100);
    expect(q<WtInput>(el, "wt-input[name=headerSubtitle]")!.value).toBe("Mío");
    expect(previewCalls(api)).toHaveLength(2);
  });

  it("sends no preview when a refresh changes the shown text only in what a save would trim off", async () => {
    const { el, api, liveData } = await mountLive({ headerSubtitle: "Hola" });
    expect(previewCalls(api)).toEqual([{ headerSubtitle: "Hola" }]);
    vi.mocked(api.getReceipt).mockResolvedValue({ receipt: { headerSubtitle: "Hola " } });
    liveData.invalidate([{ type: "tenant_receipts" }]);
    await vi.waitFor(() =>
      expect(q<WtInput>(el, "wt-input[name=headerSubtitle]")!.value).toBe("Hola "),
    );
    await sleep(RECEIPT_PREVIEW_QUIET_MS + 100);
    expect(previewCalls(api)).toHaveLength(1);
  });

  it("reads the location's description through the active client on opening, and through the passive background client on a refresh", async () => {
    const { LiveData } = await import("@waitron/dashboard-kit");
    const liveData = new LiveData();
    const background = stubApi({
      getLocationSettings: vi
        .fn()
        .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Changed elsewhere" }),
    });
    const api = Object.assign(stubApi(), { liveData, background });
    const { el } = await mount(api);
    expect(api.getLocationSettings).toHaveBeenCalledTimes(1);
    expect(background.getLocationSettings).not.toHaveBeenCalled();
    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() =>
      expect(q<WtInput>(el, "wt-input[name=operationDescription]")!.value).toBe(
        "Changed elsewhere",
      ),
    );
    expect(background.getLocationSettings).toHaveBeenCalledTimes(1);
    expect(api.getLocationSettings).toHaveBeenCalledTimes(1);
  });

  describe("which client a preview goes through", () => {
    async function mountWithBackground() {
      const { LiveData } = await import("@waitron/dashboard-kit");
      const liveData = new LiveData();
      const background = stubApi();
      const api = Object.assign(stubApi(), { liveData, background });
      const { el } = await mount(api);
      const savedElsewhere = (receipt: ReceiptConfig) => {
        vi.mocked(background.getReceipt).mockResolvedValue({ receipt });
        liveData.invalidate([{ type: "tenant_receipts" }]);
      };
      return { el, api, background, savedElsewhere };
    }

    it("sends a preview caused by another session's save through the passive background client", async () => {
      const { el, api, background, savedElsewhere } = await mountWithBackground();
      expect(previewCalls(api)).toEqual([{}]);
      savedElsewhere({ headerSubtitle: "Desde otro sitio" });
      await vi.waitFor(() =>
        expect(previewCalls(background)).toEqual([{ headerSubtitle: "Desde otro sitio" }]),
      );
      await vi.waitFor(() => expect(paperLines(el)).toContain("Desde otro sitio"));
      expect(previewCalls(api)).toEqual([{}]);
    });

    it("sends a preview caused by typing through the active client", async () => {
      const { el, api, background } = await mountWithBackground();
      edit(el, "headerSubtitle", "Mío");
      await vi.waitFor(() => expect(previewCalls(api)).toEqual([{}, { headerSubtitle: "Mío" }]));
      await sleep(RECEIPT_PREVIEW_QUIET_MS + 100);
      expect(background.previewReceipt).not.toHaveBeenCalled();
    });

    it("sends text typed while another session's preview is in flight through the active client", async () => {
      const { el, api, background, savedElsewhere } = await mountWithBackground();
      const held = heldRead<ReceiptPreview>();
      vi.mocked(background.previewReceipt).mockImplementation(held.read);
      savedElsewhere({ headerSubtitle: "Suyo" });
      await vi.waitFor(() => expect(previewCalls(background)).toHaveLength(1));
      typeFooter(el, "Gracias");
      await sleep(RECEIPT_PREVIEW_QUIET_MS + 100);
      expect(previewCalls(api)).toEqual([{}]);
      held.release(fakePreview({ headerSubtitle: "Suyo" }));
      await vi.waitFor(() =>
        expect(previewCalls(api)).toEqual([
          {},
          { headerSubtitle: "Suyo", footerMessage: "Gracias" },
        ]),
      );
      expect(previewCalls(background)).toEqual([{ headerSubtitle: "Suyo" }]);
    });

    it("sends typed text through the active client when another session's save arrives during the quiet moment", async () => {
      const { el, api, background, savedElsewhere } = await mountWithBackground();
      edit(el, "headerSubtitle", "Mío");
      savedElsewhere({ footerMessage: "Suyo" });
      await vi.waitFor(() =>
        expect(q<HTMLTextAreaElement>(el, "textarea[name=footerMessage]")!.value).toBe("Suyo"),
      );
      expect(previewCalls(api)).toEqual([{}]);
      await vi.waitFor(() =>
        expect(previewCalls(api)).toEqual([{}, { headerSubtitle: "Mío", footerMessage: "Suyo" }]),
      );
      await sleep(RECEIPT_PREVIEW_QUIET_MS + 100);
      expect(background.previewReceipt).not.toHaveBeenCalled();
    });
  });
});
