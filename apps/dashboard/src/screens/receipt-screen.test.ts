import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, ReceiptConfig } from "../api/client.js";
import { ReceiptScreen } from "./receipt-screen.js";

/**
 * The receipt editor screen. Its `api` is a stub: `getLayout` returns a known layout+receipt the
 * screen loads on connect (it reads only the `receipt` half), `putReceipt` a spy the Guardar path
 * calls with the composed config. Assertions cover each behaviour on its own: the two fields LOAD from
 * `getLayout().receipt`; editing them and clicking Guardar calls `putReceipt` with the composed config;
 * a blank field yields an ABSENT key (so an empty input never sends `""` — the config matches
 * `DEFAULT_RECEIPT = {}` rather than `{ headerSubtitle: "" }`); a rejected `putReceipt`/`getLayout`
 * surfaces a `role="alert"` with the raw code.
 */

function stubApi(overrides: Partial<DashboardApi> = {}, receipt: ReceiptConfig = {}): DashboardApi {
  return {
    getLayout: vi.fn().mockResolvedValue({
      // The layout half is irrelevant to this screen; a bare definition keeps the shape honest.
      definition: [{ type: "product-grid", region: "main", config: {} }],
      receipt: { ...receipt },
    }),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight getLayout and the follow-up render. */
async function flush(el: ReceiptScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: ReceiptScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const qa = (el: ReceiptScreen, sel: string) => Array.from(el.shadowRoot!.querySelectorAll(sel));
const errorKey = (el: ReceiptScreen): string | null =>
  (el as unknown as { errorKey: string | null }).errorKey;
const lastPut = (api: DashboardApi): ReceiptConfig =>
  (api.putReceipt as unknown as { mock: { calls: [ReceiptConfig][] } }).mock.calls.at(-1)![0];

/** Fire the header wt-input's composed change, exactly as `wt-input` dispatches it. */
function typeHeader(el: ReceiptScreen, value: string): void {
  q(el, "[data-test=header-subtitle]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

/** Fire the footer <textarea>'s native input event, exactly as a keystroke does. */
function typeFooter(el: ReceiptScreen, value: string): void {
  const ta = q(el, "[data-test=footer-message]") as HTMLTextAreaElement;
  ta.value = value;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(cleanupWidgets);

describe("receipt-screen", () => {
  it("loads the two fields from getLayout().receipt on connect", async () => {
    const api = stubApi({}, { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias por su visita" });
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    expect(api.getLayout).toHaveBeenCalledTimes(1);
    const header = q(el, "[data-test=header-subtitle]") as HTMLElement & { value: string };
    const footer = q(el, "[data-test=footer-message]") as HTMLTextAreaElement;
    expect(header.value).toBe("Calle Mayor 1");
    expect(footer.value).toBe("Gracias por su visita");
  });

  it("renders exactly one h1 (Recibo)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    const h1s = qa(el, "h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toContain("Recibo");
  });

  it("leaves both fields empty when the receipt config is empty", async () => {
    const api = stubApi(); // receipt: {}
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    const header = q(el, "[data-test=header-subtitle]") as HTMLElement & { value: string };
    const footer = q(el, "[data-test=footer-message]") as HTMLTextAreaElement;
    expect(header.value).toBe("");
    expect(footer.value).toBe("");
  });

  it("Guardar composes the edited fields and calls putReceipt with them", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    typeHeader(el, "Av. de la Constitución 3");
    typeFooter(el, "Gracias por su visita");
    await el.updateComplete;
    q(el, "[data-test=save]")!.click();
    await flush(el);

    expect(api.putReceipt).toHaveBeenCalledTimes(1);
    expect(lastPut(api)).toEqual({
      headerSubtitle: "Av. de la Constitución 3",
      footerMessage: "Gracias por su visita",
    });
  });

  it("saves a loaded receipt round-trip verbatim (no edit)", async () => {
    const api = stubApi({}, { headerSubtitle: "Calle Mayor 1", footerMessage: "Hasta pronto" });
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(lastPut(api)).toEqual({ headerSubtitle: "Calle Mayor 1", footerMessage: "Hasta pronto" });
  });

  it("omits a blank field so it reaches putReceipt as an ABSENT key, not an empty string", async () => {
    // Load with both populated, then blank the header (spaces only) → the composed config drops it.
    const api = stubApi({}, { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias" });
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    typeHeader(el, "   "); // whitespace-only is blank
    await el.updateComplete;
    q(el, "[data-test=save]")!.click();
    await flush(el);

    const sent = lastPut(api);
    expect(sent).toEqual({ footerMessage: "Gracias" });
    expect("headerSubtitle" in sent).toBe(false);
  });

  it("sends an empty {} when both fields are blank (matches DEFAULT_RECEIPT)", async () => {
    const api = stubApi(); // both empty from the start
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(lastPut(api)).toEqual({});
  });

  it("trims surrounding whitespace off a saved field", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    typeFooter(el, "  Gracias por su visita  ");
    await el.updateComplete;
    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(lastPut(api)).toEqual({ footerMessage: "Gracias por su visita" });
  });

  it("surfaces a rejected putReceipt as a role=alert with the raw code", async () => {
    const api = stubApi({ putReceipt: vi.fn().mockRejectedValue({ code: "receipt.invalid" }) });
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    q(el, "[data-test=save]")!.click();
    await flush(el);

    expect(errorKey(el)).toBe("receipt.invalid");
    expect(q(el, "[role=alert]")?.textContent).toContain("receipt.invalid");
  });

  it("falls back to server.internal when a rejected putReceipt carries no code", async () => {
    const api = stubApi({ putReceipt: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("server.internal");
  });

  it("shows an error key when the initial load is rejected (and never rejects)", async () => {
    const api = stubApi({ getLayout: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
    await flush(el);

    expect(errorKey(el)).toBe("server.internal");
    expect(q(el, "[role=alert]")?.textContent).toContain("server.internal");
  });

  it("contains the field change events so they do not leak past the screen (stopPropagation)", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<ReceiptScreen>("dashboard-receipt-screen", { api });
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
