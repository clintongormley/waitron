import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
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
import { NavigationGuard, type WtInput } from "@waitron/ui";

/** A stand-in for the server's drawing: one text block a line, with the trim marked. */
function fakePreview(config: ReceiptConfig): ReceiptPreview {
  const lines = ["VERI*FACTU", "Deli Test SL"];
  const header = config.headerSubtitle === undefined ? null : lines.push(config.headerSubtitle) - 1;
  lines.push("NIF: B12345678", "1  Café y tostada   5,50 €");
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
      phone: null,
      email: null,
      address: null,
      logo: null,
    },
    paperWidth: "80mm",
    paperWidths: ["80mm"],
  };
}

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  const api = {
    getReceipt: vi.fn().mockResolvedValue({ receipt: {}, venueAddress: [] }),
    getVenueReceiptSettings: vi.fn().mockResolvedValue({ settings: {} }),
    putVenueReceiptSettings: vi.fn().mockResolvedValue(undefined),
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta en establecimiento" }),
    putLocationSettings: vi.fn().mockResolvedValue(undefined),
    getReceiptLanguage: vi.fn().mockResolvedValue({
      language: "ca-ES",
      choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      fixed: { locale: "ca-ES", reason: { en: "Fixed.", es: "Fijado." } },
    }),
    putReceiptLanguage: vi.fn().mockResolvedValue(undefined),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "ca", languages: ["ca", "es"] }),
    getVenueDepartments: vi.fn().mockResolvedValue([]),
    getDepartmentReceipt: vi.fn(async () => ({
      receipt: {},
      venueAddress: [],
      venueDefaults: {},
      languages: ["es-ES"],
      warningLanguages: [],
    })),
    previewReceiptDraft: vi.fn(
      async (draft: Parameters<DashboardApi["previewReceiptDraft"]>[0]) => {
        const result = fakePreview(draft.settings);
        result.preview.blocks.unshift({ kind: "text", text: `${draft.departmentId}\n` });
        return result;
      },
    ),
    previewReceipt: vi.fn(async (config: ReceiptConfig) => fakePreview(config)),
    ...overrides,
  } as unknown as DashboardApi;
  const departmentPreview = api.previewReceiptDraft;
  api.previewReceiptDraft = vi.fn(async (draft, options) => {
    if (draft.departmentId !== null)
      return options === undefined ? departmentPreview(draft) : departmentPreview(draft, options);
    return draft.language !== undefined
      ? api.previewReceipt(draft.settings, draft.paperWidth, draft.language)
      : draft.paperWidth !== undefined
        ? api.previewReceipt(draft.settings, draft.paperWidth)
        : api.previewReceipt(draft.settings);
  });
  return api;
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

const defaultsRoot = (el: ReceiptsScreen) =>
  el.shadowRoot!.querySelector("dashboard-venue-receipt-defaults-editor")!.shadowRoot!;
const q = <T extends HTMLElement = HTMLElement>(el: ReceiptsScreen, selector: string) =>
  defaultsRoot(el).querySelector<T>(selector) ?? el.shadowRoot!.querySelector<T>(selector);
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
  q(el, "wt-textarea[name=footerMessage]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

async function mount(api: DashboardApi = stubApi()) {
  const mounted = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
  await flush(mounted.el);
  await vi.waitFor(() => expect(paper(mounted.el)).not.toBeNull());
  return mounted;
}

afterEach(cleanupWidgets);

describe("the Receipts page's fields", () => {
  it("points staff to Departments and zones to edit the trading name", async () => {
    const { el } = await mount();
    const link = q<HTMLAnchorElement>(el, 'a[href="/manage/venue-operations"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toMatch(/^(Departments and zones|Departamentos y zonas)$/);
  });

  it("shows the two receipt texts and the operation description, each with a hint saying where it appears", async () => {
    const { el } = await mount();
    const header = q<WtInput>(el, "wt-input[name=headerSubtitle]")!;
    const description = q<WtInput>(el, "wt-input[name=operationDescription]")!;
    const footer = q<HTMLElement & { hint: string; label: string }>(
      el,
      "wt-textarea[name=footerMessage]",
    )!;
    expect(header.label).toBe(t("receipts.subtitle"));
    expect(header.hint).toBe(t("receipts.header_subtitle_hint"));
    expect(footer.hint).toBe(t("receipts.footer_message_hint"));
    expect(footer.label).toContain(t("receipt.footer_message"));
    expect(description.label).toBe(t("location_settings.description"));
    expect(description.hint).toBe(t("receipts.operation_description_hint"));
    expect(description.required).toBe(true);
  });

  it("writes the footer in the shared multi-line field, labelled, whose typing reaches the preview", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    const footer = q(el, "wt-textarea[name=footerMessage]") as HTMLElement & {
      label: string;
      hint: string;
      rows: number;
    };
    expect(footer.label).toBe(t("receipt.footer_message"));
    expect(footer.hint).toBe(t("receipts.footer_message_hint"));
    expect(footer.rows).toBe(3);
    footer.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Hasta pronto" },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() => expect(paperLines(el).at(-1)).toBe("Hasta pronto"));
  });

  it("puts the venue-wide texts and this location's description in separate sections, the second titled with the location's name, with no location picker", async () => {
    const { el } = await mount();
    const venueWide = defaultsRoot(el);
    const location = el.shadowRoot!.querySelector("section.settings")!;
    expect(venueWide!.querySelector("h2")!.textContent).toBe(t("receipts.venue_defaults"));
    expect(venueWide!.querySelector("[name=headerSubtitle]")).not.toBeNull();
    expect(venueWide!.querySelector("[name=footerMessage]")).not.toBeNull();
    expect(location!.querySelector("h2")!.textContent).toBe("Calle Mayor");
    expect(location!.querySelector("[name=operationDescription]")).not.toBeNull();
    expect(location!.querySelector("select, wt-combobox")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-combobox[name=previewLanguage]")).not.toBeNull();
  });
});

describe("the Receipts page's live preview", () => {
  it("offers active departments when there are two and previews the one selected in the address", async () => {
    const originalUrl = location.href;
    const url = new URL(location.href);
    url.pathname = "/manage/venue-settings/view/receipts";
    url.searchParams.set("departmentId", "bar");
    history.replaceState(null, "", url);
    try {
      const previewReceiptDraft = vi.fn(
        async (draft: Parameters<DashboardApi["previewReceiptDraft"]>[0]) => {
          const result = fakePreview(draft.settings);
          result.preview.text = `${draft.departmentId}\n${result.preview.text}`;
          result.preview.blocks.unshift({ kind: "text", text: `${draft.departmentId}\n` });
          return result;
        },
      );
      const api = stubApi({
        getVenueDepartments: vi.fn().mockResolvedValue([
          { id: "deli", name: "Deli", active: true },
          { id: "bar", name: "Bar", active: true },
          { id: "closed", name: "Closed", active: false },
        ]),
        previewReceiptDraft,
      });
      const { el } = await mount(api);
      const selector = q<HTMLElement & { value: string }>(el, "wt-combobox[name=departmentId]");
      expect(selector).not.toBeNull();
      expect(selector!.value).toBe("bar");
      expect(paperLines(el)).toContain("bar");
      expect(previewReceiptDraft).toHaveBeenCalledWith({
        departmentId: "bar",
        receipt: {},
        settings: {},
      });
      expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
    } finally {
      history.replaceState(null, "", originalUrl);
    }
  });

  it("repairs an invalid department address without changing the unsaved receipt text", async () => {
    const originalUrl = location.href;
    const url = new URL(location.href);
    url.pathname = "/manage/venue-settings/view/receipts";
    url.searchParams.set("departmentId", "removed");
    history.replaceState(null, "", url);
    try {
      const api = stubApi({
        getVenueDepartments: vi.fn().mockResolvedValue([
          { id: "deli", name: "Deli", active: true },
          { id: "bar", name: "Bar", active: true },
        ]),
      });
      const { el } = await mount(api);
      expect(q<HTMLElement & { value: string }>(el, "wt-combobox[name=departmentId]")!.value).toBe(
        "deli",
      );
      expect(new URL(location.href).searchParams.get("departmentId")).toBe("deli");
      edit(el, "headerSubtitle", "Today only");
      await el.updateComplete;
      await chooseOption(q(el, "wt-combobox[name=departmentId]")!, "bar");
      expect(new URL(location.href).searchParams.get("departmentId")).toBe("bar");
      expect(q<WtInput>(el, "wt-input[name=headerSubtitle]")!.value).toBe("Today only");
      expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
    } finally {
      history.replaceState(null, "", originalUrl);
    }
  });

  it("does not add a preview department to another Venue settings tab's address", async () => {
    const originalUrl = location.href;
    const url = new URL(location.href);
    url.pathname = "/manage/venue-settings/view/receipts";
    url.searchParams.set("departmentId", "bar");
    history.replaceState(null, "", url);
    try {
      const api = stubApi({
        getVenueDepartments: vi.fn().mockResolvedValue([
          { id: "deli", name: "Deli", active: true },
          { id: "bar", name: "Bar", active: true },
        ]),
      });
      await mount(api);
      url.pathname = "/manage/venue-settings/view/tables";
      url.searchParams.delete("departmentId");
      history.replaceState(null, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(new URL(location.href).searchParams.has("departmentId")).toBe(false);
    } finally {
      history.replaceState(null, "", originalUrl);
    }
  });

  it("restores the preview department with Back", async () => {
    const originalUrl = location.href;
    const url = new URL(location.href);
    url.pathname = "/manage/venue-settings/view/receipts";
    url.searchParams.set("departmentId", "deli");
    history.replaceState(null, "", url);
    try {
      const api = stubApi({
        getVenueDepartments: vi.fn().mockResolvedValue([
          { id: "deli", name: "Deli", active: true },
          { id: "bar", name: "Bar", active: true },
        ]),
      });
      const { el } = await mount(api);
      const selector = q<HTMLElement & { value: string }>(el, "wt-combobox[name=departmentId]")!;
      await chooseOption(selector, "bar");
      expect(location.search).toContain("departmentId=bar");
      const popped = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      history.back();
      await popped;
      await el.updateComplete;
      expect(selector.value).toBe("deli");
      expect(new URL(location.href).searchParams.get("departmentId")).toBe("deli");
      await vi.waitFor(() =>
        expect(vi.mocked(api.previewReceiptDraft).mock.lastCall?.[0].departmentId).toBe("deli"),
      );
    } finally {
      history.replaceState(null, "", originalUrl);
    }
  });

  it("waits for saved receipt text when departments load first", async () => {
    const originalUrl = location.href;
    const url = new URL(location.href);
    url.pathname = "/manage/venue-settings/view/receipts";
    url.searchParams.set("departmentId", "bar");
    history.replaceState(null, "", url);
    try {
      const receipt = heldRead<{ settings: ReceiptConfig }>();
      const api = stubApi({
        getVenueReceiptSettings: vi.fn(receipt.read),
        getVenueDepartments: vi.fn().mockResolvedValue([
          { id: "deli", name: "Deli", active: true },
          { id: "bar", name: "Bar", active: true },
        ]),
      });
      const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
      await flush(el);
      expect(api.previewReceiptDraft).not.toHaveBeenCalled();
      receipt.release({ settings: { headerSubtitle: "Saved header" } });
      await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.previewReceiptDraft).mock.calls[0]).toEqual([
        {
          departmentId: "bar",
          receipt: {},
          settings: { headerSubtitle: "Saved header" },
        },
      ]);
    } finally {
      history.replaceState(null, "", originalUrl);
    }
  });

  it("draws the saved texts as soon as the page opens", async () => {
    const api = stubApi({
      getVenueReceiptSettings: vi.fn().mockResolvedValue({
        settings: { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias" },
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
    expect(paperLines(el).slice(1, 3)).toEqual(["Deli Test SL", "NIF: B12345678"]);
    edit(el, "headerSubtitle", "Abierto todos los días");
    await vi.waitFor(() =>
      expect(paperLines(el).slice(1, 4)).toEqual([
        "Deli Test SL",
        "Abierto todos los días",
        "NIF: B12345678",
      ]),
    );
    expect(paper(el)!.querySelector("[data-mark=headerSubtitle]")!.textContent!.trim()).toBe(
      "Abierto todos los días",
    );
    expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
  });

  it("shows typed footer text at the bottom of the receipt before anything is saved", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    typeFooter(el, "Hasta pronto");
    await vi.waitFor(() => expect(paperLines(el).at(-1)).toBe("Hasta pronto"));
    expect(paper(el)!.querySelector("[data-mark=footerMessage]")!.textContent!.trim()).toBe(
      "Hasta pronto",
    );
    expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
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
      getVenueReceiptSettings: vi.fn().mockResolvedValue({
        settings: { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias" },
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
    q(el, "wt-textarea[name=footerMessage]")!.shadowRoot!.querySelector("textarea")!.focus();
    await el.updateComplete;
    expect(mark("headerSubtitle").hasAttribute("data-active")).toBe(false);
    expect(mark("footerMessage").hasAttribute("data-active")).toBe(true);
    q(el, "wt-textarea[name=footerMessage]")!.shadowRoot!.querySelector("textarea")!.blur();
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
    expect(paperLines(el)[1]).toBe("Deli Test SL");
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

describe("the Receipts page's independent Save actions", () => {
  it("saves both the receipt texts and the location's description", async () => {
    const api = stubApi();
    const { el } = await mount(api);
    edit(el, "headerSubtitle", "Calle Mayor 1");
    edit(el, "operationDescription", "Venta de comidas");
    q(el, "[data-test=defaults-save]")!.click();
    q(el, "[data-test=description-save]")!.click();
    await flush(el);
    expect(api.putVenueReceiptSettings).toHaveBeenCalledExactlyOnceWith({
      headerSubtitle: "Calle Mayor 1",
    });
    expect(api.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Venta de comidas");
    expect(q(el, "[role=status]")!.textContent).toBe(t("receipts.saved"));
  });

  it("when only the receipt texts are refused, says so at the bottom and claims no success", async () => {
    const api = stubApi({
      putVenueReceiptSettings: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mount(api);
    edit(el, "headerSubtitle", "Calle Mayor 1");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    await flush(el);
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    const actions = q(el, "wt-form-actions")! as HTMLElement & { error: string };
    expect(actions.error).toBe(codeMessage("server.internal"));
    expect(q(el, "[role=status]")).toBeNull();
    expect(q<WtInput>(el, "wt-input[name=operationDescription]")!.error).toBe("");
  });

  it("when both saves fail, names both failures at the bottom", async () => {
    const api = stubApi({
      putVenueReceiptSettings: vi.fn().mockRejectedValue({ code: "server.internal" }),
      putLocationSettings: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mount(api);
    edit(el, "headerSubtitle", "Calle Mayor 1");
    edit(el, "operationDescription", "Changed description");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
    q(el, "[data-test=description-save]")!.click();
    await flush(el);
    const actions = q(el, "wt-form-actions")! as HTMLElement & { error: string };
    expect(actions.error).toBe(codeMessage("server.internal"));
    expect(
      (
        el.shadowRoot!.querySelector("[data-test=description-actions]") as HTMLElement & {
          error: string;
        }
      ).error,
    ).toBe(t("location_settings.save_error"));
  });

  it.each(["headerSubtitle", "footerMessage"] as const)(
    "puts a refused %s's reason under that field, focuses it, and leaves Save working",
    async (field) => {
      const api = stubApi({
        putVenueReceiptSettings: vi.fn().mockRejectedValue({
          code: "receipt.invalid",
          params: { reason: "too_long", field, maxLength: 200 },
        }),
      });
      const { el } = await mount(api);
      if (field === "headerSubtitle") edit(el, "headerSubtitle", "Calle Mayor 1");
      else typeFooter(el, "Gracias por su visita");
      await el.updateComplete;
      q(el, "[data-test=defaults-save]")!.click();
      await flush(el);
      const expected = t("receipts.trim_too_long").replace("{max}", "200");
      if (field === "headerSubtitle") {
        const header = q<WtInput>(el, "wt-input[name=headerSubtitle]")!;
        expect(header.error).toBe(expected);
        await vi.waitFor(() =>
          expect(header.shadowRoot!.activeElement).toBe(header.shadowRoot!.querySelector("input")),
        );
      } else {
        const footer = q(el, "wt-textarea[name=footerMessage]")!;
        const control = footer.shadowRoot!.querySelector("textarea")!;
        expect(control.getAttribute("aria-invalid")).toBe("true");
        const descriptions = control
          .getAttribute("aria-describedby")!
          .split(" ")
          .map((id) => footer.shadowRoot!.getElementById(id)!.textContent);
        expect(descriptions).toEqual([t("receipts.footer_message_hint"), expected]);
        await vi.waitFor(() => expect(defaultsRoot(el).activeElement).toBe(footer));
      }
      const actions = q(el, "wt-form-actions")! as HTMLElement & { error: string };
      expect(actions.error).toBe(t("form.fix_fields"));
      expect(q(el, "[data-test=defaults-save]")!.hasAttribute("disabled")).toBe(false);
      if (field === "headerSubtitle") edit(el, "headerSubtitle", "short");
      else typeFooter(el, "short");
      await el.updateComplete;
      expect(actions.error).toBe("");
    },
  );

  it("names a refused receipt field without a stated limit by the refusal's own message", async () => {
    const api = stubApi({
      putVenueReceiptSettings: vi.fn().mockRejectedValue({
        code: "receipt.invalid",
        params: { reason: "not_string", field: "headerSubtitle" },
      }),
    });
    const { el } = await mount(api);
    edit(el, "headerSubtitle", "Calle Mayor 1");
    await el.updateComplete;
    q(el, "[data-test=defaults-save]")!.click();
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
    vi.mocked(api.getVenueReceiptSettings).mockResolvedValue({
      settings: { headerSubtitle: "Desde otro sitio" },
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
    q(el, "[data-test=description-save]")!.click();
    await flush(el);
    expect(q(el, "[role=status]")).not.toBeNull();
    held.release({ name: "Calle Mayor", operationDescription: "Before" });
    await flush(el);
    expect(q<WtInput>(el, "wt-input[name=operationDescription]")!.value).toBe("Saved new");
    edit(el, "headerSubtitle", "Solo la cabecera");
    q(el, "[data-test=description-save]")!.click();
    await flush(el);
    expect(vi.mocked(api.putLocationSettings).mock.calls).toEqual([["Saved new"]]);
  });

  it("still takes a description read that started after the Save", async () => {
    const { LiveData } = await import("@waitron/dashboard-kit");
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mount(api);
    edit(el, "operationDescription", "Saved new");
    q(el, "[data-test=description-save]")!.click();
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
        getVenueReceiptSettings: vi
          .fn()
          .mockResolvedValue({ settings: { headerSubtitle: "Before" } }),
      }),
      { liveData },
    );
    const { el } = await mount(api);
    const held = heldRead<{ settings: ReceiptConfig }>();
    vi.mocked(api.getVenueReceiptSettings)
      .mockImplementationOnce(held.read)
      .mockResolvedValue({ settings: { headerSubtitle: "Saved new" } });
    liveData.invalidate([{ type: "tenant_receipts" }]);
    await vi.waitFor(() => expect(api.getVenueReceiptSettings).toHaveBeenCalledTimes(2));
    edit(el, "headerSubtitle", "Saved new");
    q(el, "[data-test=defaults-save]")!.click();
    await flush(el);
    expect(q(el, "[role=status]")).not.toBeNull();
    held.release({ settings: { headerSubtitle: "Before" } });
    await flush(el);
    expect(q<WtInput>(el, "wt-input[name=headerSubtitle]")!.value).toBe("Saved new");
    edit(el, "operationDescription", "Solo la descripción");
    q(el, "[data-test=defaults-save]")!.click();
    await flush(el);
    expect(vi.mocked(api.putVenueReceiptSettings).mock.calls).toEqual([
      [{ headerSubtitle: "Saved new" }],
    ]);
  });
});

describe("the Receipts page's refreshes from elsewhere", () => {
  async function mountLive(receipt: ReceiptConfig = {}) {
    const { LiveData } = await import("@waitron/dashboard-kit");
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({ getVenueReceiptSettings: vi.fn().mockResolvedValue({ settings: receipt }) }),
      {
        liveData,
      },
    );
    const { el } = await mount(api);
    return { el, api, liveData };
  }

  it("sends no preview when a refresh leaves the shown receipt texts as they were", async () => {
    const { el, api, liveData } = await mountLive();
    edit(el, "headerSubtitle", "Mío");
    await vi.waitFor(() => expect(previewCalls(api)).toHaveLength(2));
    vi.mocked(api.getVenueReceiptSettings).mockResolvedValue({
      settings: { headerSubtitle: "Suyo" },
    });
    vi.mocked(api.getLocationSettings).mockResolvedValue({
      name: "Calle Mayor",
      operationDescription: "Otra descripción",
    });
    liveData.invalidate([{ type: "tenant_receipts" }, { type: "locations" }]);
    await vi.waitFor(() =>
      expect(q<WtInput>(el, "wt-input[name=operationDescription]")!.value).toBe("Otra descripción"),
    );
    await vi.waitFor(() => expect(api.getVenueReceiptSettings).toHaveBeenCalledTimes(2));
    await sleep(RECEIPT_PREVIEW_QUIET_MS + 100);
    expect(q<WtInput>(el, "wt-input[name=headerSubtitle]")!.value).toBe("Mío");
    expect(previewCalls(api)).toHaveLength(2);
  });

  it("sends no preview when a refresh changes the shown text only in what a save would trim off", async () => {
    const { el, api, liveData } = await mountLive({ headerSubtitle: "Hola" });
    expect(previewCalls(api)).toEqual([{ headerSubtitle: "Hola" }]);
    vi.mocked(api.getVenueReceiptSettings).mockResolvedValue({
      settings: { headerSubtitle: "Hola " },
    });
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
        vi.mocked(background.getVenueReceiptSettings).mockResolvedValue({ settings: receipt });
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
        expect(
          q<HTMLElement & { value: string }>(el, "wt-textarea[name=footerMessage]")!.value,
        ).toBe("Suyo"),
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

describe("the Receipts page's paper width", () => {
  type Width = ReceiptPreview["paperWidth"];

  /** Two widths offered; 58 mm drawn 30 columns wide and 80 mm 42, as the server draws them. */
  function twoWidths(config: ReceiptConfig, paperWidth: Width = "80mm"): ReceiptPreview {
    const drawn = fakePreview(config);
    const columns = paperWidth === "58mm" ? 30 : 42;
    return {
      ...drawn,
      preview: { ...drawn.preview, columns, widthDots: columns * 12 },
      paperWidth,
      paperWidths: ["58mm", "80mm"],
    };
  }

  async function mountTwoWidths() {
    const { LiveData } = await import("@waitron/dashboard-kit");
    const liveData = new LiveData();
    const drawer = () =>
      vi.fn(async (config: ReceiptConfig, width?: Width) => twoWidths(config, width));
    const background = stubApi({ previewReceipt: drawer() });
    const api = Object.assign(stubApi({ previewReceipt: drawer() }), { liveData, background });
    const { el } = await mount(api);
    const savedElsewhere = (receipt: ReceiptConfig) => {
      vi.mocked(background.getVenueReceiptSettings).mockResolvedValue({ settings: receipt });
      liveData.invalidate([{ type: "tenant_receipts" }]);
    };
    return { el, api, background, savedElsewhere };
  }

  const widthSelect = (el: ReceiptsScreen) =>
    q<
      HTMLElement & {
        value: string;
        label: string;
        options: { value: string; label: string }[];
        updateComplete: Promise<unknown>;
      }
    >(el, "wt-combobox[name=paperWidth]");

  /** The label the closed dropdown shows, which is what the operator reads. */
  async function shownWidth(el: ReceiptsScreen): Promise<string | undefined> {
    const select = widthSelect(el)!;
    await select.updateComplete;
    return select.shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
  }

  function choose(el: ReceiptsScreen, width: Width): void {
    void chooseOption(widthSelect(el)!, width);
  }

  it("offers the location's widths in a labelled dropdown between the Preview heading and the paper, with the drawn width chosen", async () => {
    const { el } = await mountTwoWidths();
    const select = widthSelect(el)!;
    expect(select).not.toBeNull();
    expect(select.options.map((option) => [option.value, option.label])).toEqual([
      ["58mm", t("printers.paper_width_58")],
      ["80mm", t("printers.paper_width_80")],
    ]);
    expect(select.value).toBe("80mm");
    expect(await shownWidth(el)).toBe(t("printers.paper_width_80"));
    expect(select.label).toContain(t("printers.paper_width"));
    const heading = q(el, ".preview h2")!;
    expect(heading.textContent).toBe(t("receipts.preview"));
    expect(heading.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      select.compareDocumentPosition(paper(el)!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("picks the paper width from the shared dropdown", async () => {
    const { el, api } = await mountTwoWidths();
    const width = q(el, "wt-combobox[name=paperWidth]") as HTMLElement & {
      options: { value: string; label: string }[];
      value: string;
      label: string;
    };
    expect(width.label).toBe(t("printers.paper_width"));
    expect(width.options).toEqual([
      { value: "58mm", label: t("printers.paper_width_58") },
      { value: "80mm", label: t("printers.paper_width_80") },
    ]);
    expect(width.value).toBe("80mm");
    await chooseOption(width, "58mm");
    expect(vi.mocked(api.previewReceipt).mock.calls).toEqual([[{}], [{}, "58mm"]]);
  });

  it("redraws the preview at a chosen width at once, through the active client, saving nothing", async () => {
    const { el, api, background } = await mountTwoWidths();
    expect(paper(el)!.style.width).toBe("42ch");
    choose(el, "58mm");
    expect(vi.mocked(api.previewReceipt).mock.calls).toEqual([[{}], [{}, "58mm"]]);
    await vi.waitFor(() => expect(paper(el)!.style.width).toBe("30ch"));
    expect(widthSelect(el)!.value).toBe("58mm");
    expect(background.previewReceipt).not.toHaveBeenCalled();
    expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
  });

  it("keeps a chosen width when another session's save redraws the preview through the passive client", async () => {
    const { el, background, savedElsewhere } = await mountTwoWidths();
    choose(el, "58mm");
    await vi.waitFor(() => expect(paper(el)!.style.width).toBe("30ch"));
    savedElsewhere({ headerSubtitle: "Suyo" });
    await vi.waitFor(() =>
      expect(vi.mocked(background.previewReceipt).mock.calls).toEqual([
        [{ headerSubtitle: "Suyo" }, "58mm"],
      ]),
    );
    await vi.waitFor(() => expect(paperLines(el)).toContain("Suyo"));
    expect(paper(el)!.style.width).toBe("30ch");
  });

  it("sends one preview when a width is chosen while typed text waits for its quiet moment", async () => {
    const { el, api, background } = await mountTwoWidths();
    edit(el, "headerSubtitle", "Mío");
    choose(el, "58mm");
    expect(vi.mocked(api.previewReceipt).mock.calls).toEqual([
      [{}],
      [{ headerSubtitle: "Mío" }, "58mm"],
    ]);
    await sleep(RECEIPT_PREVIEW_QUIET_MS + 100);
    expect(api.previewReceipt).toHaveBeenCalledTimes(2);
    expect(background.previewReceipt).not.toHaveBeenCalled();
  });

  it("keeps the chosen width, and says the preview is out of date under it, when the redraw fails", async () => {
    const { el, api } = await mountTwoWidths();
    vi.mocked(api.previewReceipt).mockRejectedValue({ code: "server.internal" });
    choose(el, "58mm");
    await vi.waitFor(() => expect(q(el, "[data-test=preview-error]")).not.toBeNull());
    const select = widthSelect(el)!;
    expect(select.value).toBe("58mm");
    expect(await shownWidth(el)).toBe(t("printers.paper_width_58"));
    expect(
      select.compareDocumentPosition(q(el, "[data-test=preview-error]")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(paper(el)!.style.width).toBe("42ch");
  });

  it("keeps the latest chosen width when an earlier choice's drawing arrives and the latest one's redraw fails", async () => {
    const { el, api } = await mountTwoWidths();
    const held = heldRead<ReceiptPreview>();
    vi.mocked(api.previewReceipt)
      .mockImplementationOnce(held.read)
      .mockRejectedValueOnce({ code: "server.internal" });
    choose(el, "58mm");
    choose(el, "80mm");
    held.release(twoWidths({}, "58mm"));
    await vi.waitFor(() => expect(q(el, "[data-test=preview-error]")).not.toBeNull());
    expect(vi.mocked(api.previewReceipt).mock.calls).toEqual([[{}], [{}, "58mm"], [{}, "80mm"]]);
    expect(paper(el)!.style.width).toBe("30ch");
    const select = widthSelect(el)!;
    expect(select.value).toBe("80mm");
    expect(await shownWidth(el)).toBe(t("printers.paper_width_80"));
  });

  it.each([
    ["one width", ["80mm"]],
    ["no width", []],
  ] as [string, Width[]][])(
    "shows no width dropdown when the printers offer %s",
    async (_, widths) => {
      const api = stubApi({
        previewReceipt: vi.fn(async (config: ReceiptConfig) => ({
          ...fakePreview(config),
          paperWidths: widths,
        })),
      });
      const { el } = await mount(api);
      expect(paper(el)).not.toBeNull();
      expect(widthSelect(el)).toBeNull();
    },
  );
});

describe("receipt preview accepted history", () => {
  it("indexes preview choices so Back returns through the accepted adapter", async () => {
    const original = location.href;
    history.replaceState(
      { marker: "retained" },
      "",
      "/manage/venue-settings/view/receipts?departmentId=deli&dev=1",
    );
    const guard = new NavigationGuard(window, {
      isDirty: () => false,
      request: async (proceed) => {
        await proceed();
        return "proceeded";
      },
    });
    try {
      const { el } = await mount(
        stubApi({
          getVenueDepartments: async () => [
            { id: "deli", name: "Deli", active: true },
            { id: "bar", name: "Bar", active: true },
          ],
        }),
      );
      const selector = q<HTMLElement & { value: string }>(el, "wt-combobox[name=departmentId]")!;
      await chooseOption(selector, "bar");
      expect(new URL(guard.href).searchParams.get("departmentId")).toBe("bar");
      expect(history.state).toMatchObject({ marker: "retained", __wtNavigation: { index: 1 } });
      expect(location.search).toContain("dev=1");
      history.back();
      await expect.poll(() => selector.value).toBe("deli");
      expect(new URL(guard.href).searchParams.get("departmentId")).toBe("deli");
    } finally {
      cleanupWidgets();
      guard.dispose();
      history.replaceState(null, "", original);
    }
  });

  it("publishes preview repairs through the adapter without adding an entry", async () => {
    const original = location.href;
    history.replaceState(
      { marker: "retained" },
      "",
      "/manage/venue-settings/view/receipts?departmentId=removed",
    );
    const guard = new NavigationGuard(window, {
      isDirty: () => false,
      request: async (proceed) => {
        await proceed();
        return "proceeded";
      },
    });
    const length = history.length;
    try {
      await mount(
        stubApi({
          getVenueDepartments: async () => [
            { id: "deli", name: "Deli", active: true },
            { id: "bar", name: "Bar", active: true },
          ],
        }),
      );
      expect(new URL(guard.href).searchParams.get("departmentId")).toBe("deli");
      expect(history.length).toBe(length);
      expect(history.state).toMatchObject({ marker: "retained", __wtNavigation: { index: 0 } });
    } finally {
      cleanupWidgets();
      guard.dispose();
      history.replaceState(null, "", original);
    }
  });

  it("does not restore a traversed preview until the history adapter accepts it", async () => {
    const original = location.href;
    history.replaceState(null, "", "/manage/venue-settings/view/receipts?departmentId=deli");
    let dirty = false;
    let keep!: () => void;
    const guard = new NavigationGuard(window, {
      isDirty: () => dirty,
      request: () =>
        new Promise((resolve) => {
          keep = () => resolve("kept");
        }),
    });
    try {
      const { el } = await mount(
        stubApi({
          getVenueDepartments: async () => [
            { id: "deli", name: "Deli", active: true },
            { id: "bar", name: "Bar", active: true },
          ],
        }),
      );
      await guard.write("/manage/venue-settings/view/receipts?departmentId=bar");
      const selector = q<HTMLElement & { value: string }>(el, "wt-combobox[name=departmentId]")!;
      await expect.poll(() => selector.value).toBe("bar");
      dirty = true;
      history.back();
      await expect.poll(() => typeof keep).toBe("function");
      expect(selector.value).toBe("bar");
      expect(new URL(guard.href).searchParams.get("departmentId")).toBe("bar");
      keep();
      await expect.poll(() => guard.write(guard.href)).toBe("proceeded");
      expect(selector.value).toBe("bar");
    } finally {
      cleanupWidgets();
      guard.dispose();
      history.replaceState(null, "", original);
    }
  });
});
