import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, LayoutDef } from "../api/client.js";
import { LayoutScreen } from "./layout-screen.js";

/**
 * The layout editor screen. Its `api` is a stub: `getLayout` returns a known layout the screen loads on
 * connect, `putLayout` a spy the Guardar path calls with the composed definition. Assertions cover each
 * behaviour on its own (plan Task 11 Step 1): render one row per widget per region; ↑/↓ reorder (with
 * ends disabled); Eliminar remove; the Añadir picker of not-yet-placed types; Editar's product-grid
 * columns field reaching putLayout; Guardar's compose order; a rejected putLayout's role="alert".
 */

/** The default six-widget layout (= DEFAULT_LAYOUT / LAYOUT_A): product-grid in main, the rest aside. */
const FULL: LayoutDef = [
  { type: "product-grid", region: "main", config: {} },
  { type: "basket", region: "aside", config: {} },
  { type: "total", region: "aside", config: {} },
  { type: "tender-pay", region: "aside", config: {} },
  { type: "held-orders", region: "aside", config: {} },
  { type: "prep-queue", region: "aside", config: {} },
];

/** The four sale-critical widgets only — leaves held-orders + prep-queue as the picker's choices. */
const PARTIAL: LayoutDef = [
  { type: "product-grid", region: "main", config: {} },
  { type: "basket", region: "aside", config: {} },
  { type: "total", region: "aside", config: {} },
  { type: "tender-pay", region: "aside", config: {} },
];

function stubApi(overrides: Partial<DashboardApi> = {}, layout: LayoutDef = FULL): DashboardApi {
  return {
    // Deep-copy the seed so the screen's edits never mutate the fixture the next test reads.
    getLayout: vi.fn().mockResolvedValue({
      definition: layout.map((w) => ({ ...w, config: { ...w.config } })),
      receipt: {},
    }),
    putLayout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight getLayout and the follow-up render. */
async function flush(el: LayoutScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: LayoutScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const qa = (el: LayoutScreen, sel: string) => Array.from(el.shadowRoot!.querySelectorAll(sel));
const errorKey = (el: LayoutScreen): string | null =>
  (el as unknown as { errorKey: string | null }).errorKey;
const lastPut = (api: DashboardApi): LayoutDef =>
  (api.putLayout as unknown as { mock: { calls: [LayoutDef][] } }).mock.calls.at(-1)![0];

/** Fire the columns wt-input's composed change, exactly as `wt-input` dispatches it. */
function typeColumns(el: LayoutScreen, value: string): void {
  q(el, "[data-test=columns]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

afterEach(cleanupWidgets);

describe("layout-screen", () => {
  it("loads the layout on connect and renders one row per widget in each region", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    expect(api.getLayout).toHaveBeenCalledTimes(1);
    expect(qa(el, "[data-test=region-main] li")).toHaveLength(1);
    expect(qa(el, "[data-test=region-aside] li")).toHaveLength(5);
    expect(q(el, "[data-test=row-product-grid]")).not.toBeNull();
    expect(q(el, "[data-test=row-prep-queue]")).not.toBeNull();
  });

  it("renders exactly one h1 (Disposición)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    const h1s = qa(el, "h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toContain("Disposición");
  });

  it("moves a row down within its region, reflected in the next putLayout", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    // basket is first in aside; ↓ swaps it past total.
    q(el, "[data-test=down-basket]")!.click();
    await el.updateComplete;
    q(el, "[data-test=save]")!.click();
    await flush(el);

    const asideOrder = lastPut(api)
      .filter((w) => w.region === "aside")
      .map((w) => w.type);
    expect(asideOrder).toEqual(["total", "basket", "tender-pay", "held-orders", "prep-queue"]);
  });

  it("moves a row up within its region, reflected in the next putLayout", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    // total is second in aside; ↑ swaps it above basket.
    q(el, "[data-test=up-total]")!.click();
    await el.updateComplete;
    q(el, "[data-test=save]")!.click();
    await flush(el);

    const asideOrder = lastPut(api)
      .filter((w) => w.region === "aside")
      .map((w) => w.type);
    expect(asideOrder).toEqual(["total", "basket", "tender-pay", "held-orders", "prep-queue"]);
  });

  it("reorders and removes within the main region too (both columns are editable)", async () => {
    const seed: LayoutDef = [
      { type: "product-grid", region: "main", config: {} },
      { type: "basket", region: "main", config: {} },
      { type: "total", region: "aside", config: {} },
      { type: "tender-pay", region: "aside", config: {} },
    ];
    const api = stubApi({}, seed);
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    // product-grid is first in main; ↓ swaps it below basket.
    q(el, "[data-test=down-product-grid]")!.click();
    await el.updateComplete;
    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(
      lastPut(api)
        .filter((w) => w.region === "main")
        .map((w) => w.type),
    ).toEqual(["basket", "product-grid"]);

    // remove basket from main
    q(el, "[data-test=remove-basket]")!.click();
    await el.updateComplete;
    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(
      lastPut(api)
        .filter((w) => w.region === "main")
        .map((w) => w.type),
    ).toEqual(["product-grid"]);
  });

  it("disables ↑ on the first row and ↓ on the last row of a region", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    // aside ends
    expect(q(el, "[data-test=up-basket]")!.hasAttribute("disabled")).toBe(true);
    expect(q(el, "[data-test=down-basket]")!.hasAttribute("disabled")).toBe(false);
    expect(q(el, "[data-test=down-prep-queue]")!.hasAttribute("disabled")).toBe(true);
    // product-grid is the only main row → both disabled
    expect(q(el, "[data-test=up-product-grid]")!.hasAttribute("disabled")).toBe(true);
    expect(q(el, "[data-test=down-product-grid]")!.hasAttribute("disabled")).toBe(true);
  });

  it("removes a row so the next putLayout omits it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    q(el, "[data-test=remove-held-orders]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=row-held-orders]")).toBeNull();

    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(lastPut(api).some((w) => w.type === "held-orders")).toBe(false);
  });

  it("the Añadir picker lists only the widget types not yet placed", async () => {
    const api = stubApi({}, PARTIAL);
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    const options = qa(el, "[data-test=add-type] option").map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toEqual(["held-orders", "prep-queue"]);
  });

  it("hides the picker when every widget is already placed", async () => {
    const api = stubApi(); // FULL → nothing left to add
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=add-type]")).toBeNull();
    expect(q(el, "[data-test=add-widget]")).toBeNull();
  });

  it("adds the chosen widget to its natural region and includes it in the next putLayout", async () => {
    const api = stubApi({}, PARTIAL);
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    const select = q(el, "[data-test=add-type]") as HTMLSelectElement;
    select.value = "prep-queue";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;
    q(el, "[data-test=add-widget]")!.click();
    await el.updateComplete;

    expect(q(el, "[data-test=row-prep-queue]")).not.toBeNull();

    q(el, "[data-test=save]")!.click();
    await flush(el);
    const def = lastPut(api);
    expect(def.find((w) => w.type === "prep-queue")).toEqual({
      type: "prep-queue",
      region: "aside",
      config: {},
    });
    // appended at the end of aside (natural region)
    expect(
      def
        .filter((w) => w.region === "aside")
        .map((w) => w.type)
        .at(-1),
    ).toBe("prep-queue");
  });

  it("Editar on product-grid exposes a columns field whose value reaches putLayout", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=columns]")).toBeNull(); // collapsed by default
    q(el, "[data-test=edit-product-grid]")!.click();
    await el.updateComplete;

    typeColumns(el, "6");
    await el.updateComplete;
    q(el, "[data-test=save]")!.click();
    await flush(el);

    expect(lastPut(api).find((w) => w.type === "product-grid")!.config).toEqual({ columns: 6 });
  });

  it("clamps columns to 1..12 and clears the key on an empty or non-numeric value", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);
    q(el, "[data-test=edit-product-grid]")!.click();
    await el.updateComplete;

    const save = async () => {
      q(el, "[data-test=save]")!.click();
      await flush(el);
      return lastPut(api).find((w) => w.type === "product-grid")!.config;
    };

    typeColumns(el, "20");
    await el.updateComplete;
    expect(await save()).toEqual({ columns: 12 }); // clamp high

    typeColumns(el, "0");
    await el.updateComplete;
    expect(await save()).toEqual({ columns: 1 }); // clamp low

    typeColumns(el, "abc");
    await el.updateComplete;
    expect(await save()).toEqual({}); // non-numeric → key dropped

    typeColumns(el, "");
    await el.updateComplete;
    expect(await save()).toEqual({}); // emptied → key dropped
  });

  it("toggles the config sub-form closed when Editar is clicked again", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    q(el, "[data-test=edit-product-grid]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=columns]")).not.toBeNull();

    q(el, "[data-test=edit-product-grid]")!.click(); // second click collapses it
    await el.updateComplete;
    expect(q(el, "[data-test=columns]")).toBeNull();
  });

  it("shows a 'Sin ajustes' note for a widget with no config", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    q(el, "[data-test=edit-basket]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=row-basket]")!.textContent).toContain("Sin ajustes");
    expect(q(el, "[data-test=columns]")).toBeNull();
  });

  it("Guardar composes main-then-aside in displayed order and calls putLayout", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    q(el, "[data-test=save]")!.click();
    await flush(el);

    expect(api.putLayout).toHaveBeenCalledTimes(1);
    expect(lastPut(api)).toEqual(FULL); // round-trips the loaded layout verbatim
  });

  it("surfaces a rejected putLayout as a role=alert with the raw code", async () => {
    const api = stubApi({ putLayout: vi.fn().mockRejectedValue({ code: "layout.invalid" }) });
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    q(el, "[data-test=save]")!.click();
    await flush(el);

    expect(errorKey(el)).toBe("layout.invalid");
    expect(q(el, "[role=alert]")?.textContent).toContain("layout.invalid");
  });

  it("falls back to server.internal when a rejected putLayout carries no code", async () => {
    const api = stubApi({ putLayout: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    q(el, "[data-test=save]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("server.internal");
  });

  it("shows an error key when the initial load is rejected (and never rejects)", async () => {
    const api = stubApi({ getLayout: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);

    expect(errorKey(el)).toBe("server.internal");
    expect(q(el, "[role=alert]")?.textContent).toContain("server.internal");
  });

  it("contains the columns wt-change so it does not leak past the screen (stopPropagation)", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<LayoutScreen>("dashboard-layout-screen", { api });
    await flush(el);
    q(el, "[data-test=edit-product-grid]")!.click();
    await el.updateComplete;

    const escaped = vi.fn();
    host.addEventListener("wt-change", escaped);
    typeColumns(el, "4");
    await el.updateComplete;
    expect(escaped).not.toHaveBeenCalled();
  });
});
