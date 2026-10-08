import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type {
  CategorySalesDto,
  CategoryTotalDto,
  DailyCloseDto,
  DashboardApi,
  SalesPeriodDto,
} from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { today } from "../date-utils.js";
import type { SalesScreen } from "./dashboard-sales-screen.js";
import "./dashboard-sales-screen.js";

const close: DailyCloseDto = {
  businessDay: "2026-08-29",
  vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
  cash: { byOrigin: [], tenderTotal: "0.00", tipTotal: "0.00" },
  counts: { sales: 0, corrections: 0, voids: 0 },
  topSellers: [],
};
const period: SalesPeriodDto = {
  from: "2026-08-01",
  to: "2026-08-29",
  vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
  topSellers: [],
};

function node(
  partial: Partial<CategoryTotalDto> & Pick<CategoryTotalDto, "kind" | "id" | "depth">,
): CategoryTotalDto {
  return {
    name: "",
    gross: "0.00",
    net: "0.00",
    direct: { gross: "0.00", net: "0.00", lines: 0 },
    children: [],
    ...partial,
  };
}

// Names no localized string uses, so a row reading the wrong field cannot pass.
const report: CategorySalesDto = {
  mode: "at_time_of_sale",
  tree: [
    node({
      kind: "category",
      id: "c-drinks",
      name: "Bebidas Casa",
      depth: 0,
      gross: "20.00",
      net: "17.00",
      direct: { gross: "5.00", net: "4.50", lines: 2 },
      children: [
        node({
          kind: "category",
          id: "c-softs",
          name: "Refrescos Casa",
          depth: 1,
          gross: "15.00",
          net: "12.50",
          direct: { gross: "15.00", net: "12.50", lines: 3 },
        }),
      ],
    }),
    node({
      kind: "category",
      id: "c-kitchen",
      name: "Cocina Casa",
      depth: 0,
      gross: "20.00",
      net: "18.00",
      children: [
        node({
          kind: "category",
          id: "c-starters",
          name: "Entrantes Casa",
          depth: 1,
          gross: "20.00",
          net: "18.00",
          // A sale and a later day's void of it: amounts cancel, the lines still count.
          direct: { gross: "0.00", net: "0.00", lines: 2 },
          children: [
            node({
              kind: "category",
              id: "c-croquetas",
              name: "Croquetas Casa",
              depth: 2,
              gross: "20.00",
              net: "18.00",
              direct: { gross: "20.00", net: "18.00", lines: 4 },
            }),
          ],
        }),
      ],
    }),
    node({
      kind: "uncategorised",
      id: "uncategorised",
      depth: 0,
      gross: "3.00",
      net: "2.70",
      direct: { gross: "3.00", net: "2.70", lines: 1 },
    }),
    node({
      kind: "not_recorded",
      id: "not_recorded",
      depth: 0,
      gross: "1.00",
      net: "6.00",
      direct: { gross: "0.00", net: "2.00", lines: 2 },
      children: [
        node({
          kind: "free_text",
          id: "Tapas viejas",
          name: "Tapas viejas",
          depth: 1,
          gross: "1.00",
          net: "4.00",
          direct: { gross: "1.00", net: "4.00", lines: 3 },
        }),
      ],
    }),
  ],
  gross: "44.00",
  net: "43.70",
  grossComplete: false,
  linesWithoutGross: 5,
};

const currentReport: CategorySalesDto = {
  mode: "current",
  tree: [
    node({
      kind: "category",
      id: "c-drinks",
      name: "Bebidas Hoy",
      depth: 0,
      gross: "4.00",
      net: "3.60",
      direct: { gross: "4.00", net: "3.60", lines: 1 },
    }),
    node({
      kind: "not_recorded",
      id: "not_recorded",
      depth: 0,
      gross: "0.00",
      net: "2.00",
      direct: { gross: "0.00", net: "2.00", lines: 2 },
    }),
  ],
  gross: "4.00",
  net: "5.60",
  grossComplete: true,
  linesWithoutGross: 0,
};

const printers = [
  { id: "p-bar", name: "Barra Casa" },
  { id: "p-kitchen", name: "Cocina Impresora" },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getSalesOverview: vi.fn().mockImplementation(async () => ({
      businessDay: today(),
      takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      openTables: { open: 0, total: 0 },
      topSellers: [],
    })),
    getDailyClose: vi.fn().mockResolvedValue(close),
    getSalesPeriod: vi.fn().mockResolvedValue(period),
    getCategorySales: vi.fn().mockResolvedValue(report),
    getReportPrinters: vi.fn().mockResolvedValue(printers),
    printCategorySales: vi.fn().mockResolvedValue({ jobId: "job-1" }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: SalesScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

async function mount(api: DashboardApi): Promise<SalesScreen> {
  const { el } = await mountWidget<SalesScreen>("dashboard-sales-screen", { api });
  await flush(el);
  return el;
}

function q<T extends Element = HTMLElement>(el: SalesScreen, test: string): T | null {
  return el.shadowRoot!.querySelector<T>(`[data-test="${test}"]`);
}

type PrinterField = HTMLElement & {
  name: string;
  value: string;
  options: { value: string; label: string }[];
};

function setDate(el: SalesScreen, test: string, value: string): void {
  const input = q<HTMLInputElement>(el, test)!;
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function pickMode(el: SalesScreen, mode: "at_time_of_sale" | "current"): void {
  const radio = el.shadowRoot!.querySelector<HTMLInputElement>(
    `input[name="mode"][value="${mode}"]`,
  )!;
  radio.click();
}

/** Each rendered row as [name shown, depth, kind, gross, net]. */
function rows(el: SalesScreen): [string, number, string, string, string][] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=category-row]")].map(
    (row) => [
      row.querySelector("[data-test=category-label]")!.textContent!.trim(),
      Number(row.dataset.depth),
      row.dataset.kind!,
      row.querySelector("[data-test=category-gross]")!.textContent!.trim(),
      row.querySelector("[data-test=category-net]")!.textContent!.trim(),
    ],
  );
}

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("dashboard-sales-screen — category report", () => {
  it("asks for today's categories at time of sale, extras separate, and says so in the heading", async () => {
    const api = stubApi();
    const el = await mount(api);
    expect(api.getCategorySales).toHaveBeenCalledTimes(1);
    expect(api.getCategorySales).toHaveBeenCalledWith(today(), today(), "at_time_of_sale", false);
    expect(q(el, "categories-heading")!.textContent!.trim()).toBe(
      "Categorías en el momento de la venta",
    );
    const checked = el.shadowRoot!.querySelector<HTMLInputElement>('input[name="mode"]:checked')!;
    expect(checked.value).toBe("at_time_of_sale");
    expect(q<HTMLInputElement>(el, "extras-into-dish")!.checked).toBe(false);
    expect(q<HTMLInputElement>(el, "extras-into-dish")!.name).toBe("extrasIntoDish");
  });

  it("re-asks in current mode when the mode changes, and the heading follows it", async () => {
    const api = stubApi({
      getCategorySales: vi.fn(async (_f: string, _t: string, mode: string) =>
        mode === "current" ? currentReport : report,
      ) as unknown as DashboardApi["getCategorySales"],
    });
    const el = await mount(api);
    pickMode(el, "current");
    await flush(el);
    expect(api.getCategorySales).toHaveBeenLastCalledWith(today(), today(), "current", false);
    expect(q(el, "categories-heading")!.textContent!.trim()).toBe("Categorías actuales");
    expect(rows(el).map((r) => r[0])).toEqual(["Bebidas Hoy", "No registrada"]);
    pickMode(el, "at_time_of_sale");
    await flush(el);
    expect(api.getCategorySales).toHaveBeenLastCalledWith(
      today(),
      today(),
      "at_time_of_sale",
      false,
    );
    expect(q(el, "categories-heading")!.textContent!.trim()).toBe(
      "Categorías en el momento de la venta",
    );
  });

  it("re-asks with extras rolled into their dish when the box is ticked, and without when cleared", async () => {
    const api = stubApi();
    const el = await mount(api);
    q<HTMLInputElement>(el, "extras-into-dish")!.click();
    await flush(el);
    expect(api.getCategorySales).toHaveBeenLastCalledWith(
      today(),
      today(),
      "at_time_of_sale",
      true,
    );
    q<HTMLInputElement>(el, "extras-into-dish")!.click();
    await flush(el);
    expect(api.getCategorySales).toHaveBeenLastCalledWith(
      today(),
      today(),
      "at_time_of_sale",
      false,
    );
  });

  it("asks for the chosen range, and keeps the chosen mode, on a period", async () => {
    const api = stubApi();
    const el = await mount(api);
    pickMode(el, "current");
    await flush(el);
    setDate(el, "from-picker", "2026-08-01");
    await flush(el);
    expect(api.getCategorySales).toHaveBeenLastCalledWith("2026-08-01", today(), "current", false);
    expect(q(el, "period")).not.toBeNull();
    expect(q(el, "category-table")).not.toBeNull();
  });

  it("asks for nothing, and shows no section, while the range runs backwards", async () => {
    const api = stubApi();
    const el = await mount(api);
    setDate(el, "from-picker", "2099-01-01");
    await flush(el);
    expect(api.getCategorySales).toHaveBeenCalledTimes(1);
    expect(q(el, "categories")).toBeNull();
  });

  it("lays the tree out depth first, with a Directly-in row only for a parent that has children and lines of its own", async () => {
    const el = await mount(stubApi());
    expect(rows(el)).toEqual([
      ["Bebidas Casa", 0, "category", "20,00\u00a0€", "17,00\u00a0€"],
      ["Directamente en Bebidas Casa", 1, "direct", "5,00\u00a0€", "4,50\u00a0€"],
      ["Refrescos Casa", 1, "category", "15,00\u00a0€", "12,50\u00a0€"],
      // No Directly-in row: Cocina Casa has children but no lines of its own.
      ["Cocina Casa", 0, "category", "20,00\u00a0€", "18,00\u00a0€"],
      ["Entrantes Casa", 1, "category", "20,00\u00a0€", "18,00\u00a0€"],
      // Its direct amounts cancel to zero, but it has lines, so the row stays.
      ["Directamente en Cocina Casa › Entrantes Casa", 2, "direct", "0,00\u00a0€", "0,00\u00a0€"],
      // A leaf with lines of its own has no Directly-in row.
      ["Croquetas Casa", 2, "category", "20,00\u00a0€", "18,00\u00a0€"],
      ["Sin categoría", 0, "uncategorised", "3,00\u00a0€", "2,70\u00a0€"],
      ["No registrada", 0, "not_recorded", "1,00\u00a0€", "6,00\u00a0€"],
      ["Categoría desconocida", 1, "direct", "0,00\u00a0€", "2,00\u00a0€"],
      ["Tapas viejas", 1, "free_text", "1,00\u00a0€", "4,00\u00a0€"],
    ]);
    expect(q(el, "category-total-gross")!.textContent!.trim()).toBe("44,00\u00a0€");
    expect(q(el, "category-total-net")!.textContent!.trim()).toBe("43,70\u00a0€");
  });

  it("indents each row by its depth, and shows a category's parents before its own name", async () => {
    const el = await mount(stubApi());
    const cells = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=category-row] th")];
    const indent = (i: number): number => parseFloat(getComputedStyle(cells[i]!).paddingLeft);
    // Rows 0, 4 and 6 are Bebidas Casa (0), Entrantes Casa (1) and Croquetas Casa (2).
    expect(indent(4)).toBeGreaterThan(indent(0));
    expect(indent(6)).toBeGreaterThan(indent(4));
    expect(indent(3)).toBe(indent(0));
    const path = cells[6]!.querySelector<HTMLElement>("[data-test=category-path]")!;
    expect(path.textContent).toBe("Cocina Casa › Entrantes Casa › ");
    expect(path.offsetWidth).toBeGreaterThan(1);
    expect(cells[6]!.textContent!.trim()).toBe("Cocina Casa › Entrantes Casa › Croquetas Casa");
    expect(cells[6]!.querySelector(".visually-hidden")).toBeNull();
    expect(cells[0]!.querySelector("[data-test=category-path]")).toBeNull();
    expect(cells[0]!.querySelector(".visually-hidden")).toBeNull();
    // A Directly-in row names its category by the whole path, so it needs no path of its own.
    expect(cells[5]!.textContent!.trim()).toBe("Directamente en Cocina Casa › Entrantes Casa");
    expect(cells[5]!.querySelector("[data-test=category-path]")).toBeNull();
  });

  it("tells two categories with one name apart by their paths, each mode naming its own parents", async () => {
    const mains = (id: string, parent: string, name: string, mode: CategorySalesDto["mode"]) =>
      ({
        mode,
        tree: [
          node({
            kind: "category",
            id: parent,
            name,
            depth: 0,
            gross: "10.00",
            net: "9.00",
            children: [
              node({
                kind: "category",
                id,
                name: "Principales",
                depth: 1,
                gross: "10.00",
                net: "9.00",
                direct: { gross: "10.00", net: "9.00", lines: 1 },
              }),
            ],
          }),
        ],
        gross: "10.00",
        net: "9.00",
        grossComplete: true,
        linesWithoutGross: 0,
      }) satisfies CategorySalesDto;
    // Today's tree renamed Almuerzo to Mediodía, so each mode's rows name their own parents.
    const twoBranches = (mode: CategorySalesDto["mode"]): CategorySalesDto => {
      const food = mains("c-food-mains", "c-food", "Comida", mode);
      const lunchName = mode === "current" ? "Mediodía" : "Almuerzo";
      const lunch = mains("c-lunch-mains", "c-lunch", lunchName, mode);
      return { ...food, tree: [...lunch.tree, ...food.tree], gross: "20.00", net: "18.00" };
    };
    const api = stubApi({
      getCategorySales: vi.fn(async (_f: string, _t: string, mode: CategorySalesDto["mode"]) =>
        twoBranches(mode),
      ) as unknown as DashboardApi["getCategorySales"],
    });
    const el = await mount(api);
    // What is drawn: the text a screen reader alone hears is left out.
    const shown = (): string[] =>
      [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=category-row] th")].map((th) => {
        const copy = th.cloneNode(true) as HTMLElement;
        for (const hidden of copy.querySelectorAll(".visually-hidden")) hidden.remove();
        return copy.textContent!.replace(/\s+/g, " ").trim();
      });
    expect(shown()).toEqual([
      "Almuerzo",
      "Almuerzo › Principales",
      "Comida",
      "Comida › Principales",
    ]);
    pickMode(el, "current");
    await flush(el);
    expect(api.getCategorySales).toHaveBeenLastCalledWith(today(), today(), "current", false);
    expect(shown()).toEqual([
      "Mediodía",
      "Mediodía › Principales",
      "Comida",
      "Comida › Principales",
    ]);
  });

  it("shows no path for No category, Not recorded or what sits under Not recorded", async () => {
    const el = await mount(stubApi());
    const cells = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=category-row] th")];
    // Rows 7 to 10: Sin categoría, No registrada, Categoría desconocida, Tapas viejas.
    for (const cell of cells.slice(7)) {
      expect(cell.querySelector("[data-test=category-path]")).toBeNull();
    }
    expect(cells[7]!.textContent!.trim()).toBe("Sin categoría");
    expect(cells[8]!.textContent!.trim()).toBe("No registrada");
    // A screen reader still hears which row they sit under; nothing is shown.
    const hidden = cells[10]!.querySelector<HTMLElement>(".visually-hidden")!;
    expect(hidden.textContent).toBe("No registrada › ");
    expect(hidden.offsetWidth).toBeLessThanOrEqual(1);
    expect(cells[9]!.querySelector(".visually-hidden")!.textContent).toBe("No registrada › ");
  });

  it("names the screen's own rows and the mode in English", async () => {
    setLocale("en");
    const api = stubApi({
      getCategorySales: vi.fn(async (_f: string, _t: string, mode: string) =>
        mode === "current" ? currentReport : report,
      ) as unknown as DashboardApi["getCategorySales"],
    });
    const el = await mount(api);
    expect(q(el, "categories-heading")!.textContent!.trim()).toBe("Categories at time of sale");
    const names = rows(el).map((r) => r[0]);
    expect(names).toContain("Directly in Bebidas Casa");
    expect(names).toContain("No category");
    expect(names).toContain("Not recorded");
    expect(names).toContain("Category unknown");
    expect(names).not.toContain("Directly in Not recorded");
    pickMode(el, "current");
    await flush(el);
    expect(q(el, "categories-heading")!.textContent!.trim()).toBe("Current categories");
  });

  it("keeps a name holding a replacement pattern as it is", async () => {
    setLocale("en");
    const drinks = { ...report.tree[0]!, name: "Bar $& Grill" };
    const el = await mount(
      stubApi({ getCategorySales: vi.fn().mockResolvedValue({ ...report, tree: [drinks] }) }),
    );
    expect(rows(el)[1]![0]).toBe("Directly in Bar $& Grill");
  });

  it("says the gross total is incomplete, with the count of lines, in Spanish and English", async () => {
    const el = await mount(stubApi());
    expect(q(el, "gross-incomplete")!.textContent!.trim()).toBe(
      "Total bruto incompleto: 5 líneas registradas antes de que empezara la clasificación",
    );
    cleanupWidgets();
    setLocale("en");
    const english = await mount(stubApi());
    expect(q(english, "gross-incomplete")!.textContent!.trim()).toBe(
      "Gross total incomplete: 5 lines recorded before classification began",
    );
  });

  it("ties the incomplete note to the gross total it qualifies", async () => {
    const el = await mount(stubApi());
    const total = q(el, "category-total-gross")!;
    const describedBy = total.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(el.shadowRoot!.getElementById(describedBy!)).toBe(q(el, "gross-incomplete"));
  });

  it("says one line in the singular", async () => {
    const api = stubApi({
      getCategorySales: vi.fn().mockResolvedValue({ ...report, linesWithoutGross: 1 }),
    });
    const el = await mount(api);
    expect(q(el, "gross-incomplete")!.textContent!.trim()).toBe(
      "Total bruto incompleto: 1 línea registrada antes de que empezara la clasificación",
    );
    cleanupWidgets();
    setLocale("en");
    const english = await mount(api);
    expect(q(english, "gross-incomplete")!.textContent!.trim()).toBe(
      "Gross total incomplete: 1 line recorded before classification began",
    );
  });

  it("shows no incomplete note when every line has a gross", async () => {
    const el = await mount(stubApi({ getCategorySales: vi.fn().mockResolvedValue(currentReport) }));
    expect(q(el, "category-table")).not.toBeNull();
    expect(q(el, "gross-incomplete")).toBeNull();
    expect(q(el, "category-total-gross")!.hasAttribute("aria-describedby")).toBe(false);
  });

  it("says so when no sale falls in the range", async () => {
    const el = await mount(
      stubApi({
        getCategorySales: vi.fn().mockResolvedValue({
          ...currentReport,
          tree: [],
          gross: "0.00",
          net: "0.00",
        }),
      }),
    );
    expect(q(el, "category-table")).toBeNull();
    expect(q(el, "categories-empty")!.textContent!.trim()).toBe("No hay ventas en este intervalo.");
  });

  it("explains a current report refused for today's categories, and leaves the rest of the screen alone", async () => {
    setLocale("en");
    const api = stubApi({
      getCategorySales: vi.fn(async (_f: string, _t: string, mode: string) => {
        if (mode === "current") throw { code: "sale_classification.invalid" };
        return report;
      }) as unknown as DashboardApi["getCategorySales"],
    });
    const el = await mount(api);
    pickMode(el, "current");
    await flush(el);
    const message = q(el, "categories-error")!;
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.textContent!.trim()).toBe(codeMessage("sale_classification.invalid", "en"));
    expect(message.textContent).toContain("categories");
    expect(message.textContent).toContain("at time of sale");
    expect(q(el, "category-table")).toBeNull();
    expect(q(el, "error")).toBeNull();
    expect(q(el, "daily-close")).not.toBeNull();
    // Back at time of sale, the report returns and the message goes.
    pickMode(el, "at_time_of_sale");
    await flush(el);
    expect(q(el, "categories-error")).toBeNull();
    expect(q(el, "category-table")).not.toBeNull();
  });

  it("has an English and a Spanish sentence for a refused current report", () => {
    const generic = codeMessage("test.unmapped_code", "en");
    expect(codeMessage("sale_classification.invalid", "en")).not.toBe(generic);
    expect(codeMessage("sale_classification.invalid", "es")).not.toBe(
      codeMessage("test.unmapped_code", "es"),
    );
    expect(codeMessage("sale_classification.invalid", "es")).toContain("momento de la venta");
  });

  it("drops the refusal when a refresh after the catalogue is fixed succeeds", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({
        getCategorySales: vi.fn().mockRejectedValue({ code: "sale_classification.invalid" }),
      }),
      { liveData },
    );
    const el = await mount(api);
    pickMode(el, "current");
    await vi.waitFor(() =>
      expect(api.getCategorySales).toHaveBeenLastCalledWith(today(), today(), "current", false),
    );
    await vi.waitFor(() => expect(q(el, "categories-error")).not.toBeNull());
    vi.mocked(api.getCategorySales).mockResolvedValue(currentReport);
    liveData.invalidate([{ type: "categories", id: "fixed" }]);
    await vi.waitFor(() => expect(q(el, "category-table")).not.toBeNull());
    expect(q(el, "categories-error")).toBeNull();
  });

  it("takes the older report off screen when a live refresh is refused, and shows the next report that succeeds", async () => {
    setLocale("en");
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const el = await mount(api);
    pickMode(el, "current");
    await vi.waitFor(() =>
      expect(api.getCategorySales).toHaveBeenLastCalledWith(today(), today(), "current", false),
    );
    await vi.waitFor(() => expect(rows(el)).toHaveLength(11));
    vi.mocked(api.getCategorySales).mockRejectedValue({ code: "sale_classification.invalid" });
    liveData.invalidate([{ type: "categories", id: "edited" }]);
    await vi.waitFor(() => expect(q(el, "categories-error")).not.toBeNull());
    expect(q(el, "categories-error")!.textContent!.trim()).toBe(
      codeMessage("sale_classification.invalid", "en"),
    );
    expect(q(el, "category-table")).toBeNull();
    expect(q(el, "categories-empty")).toBeNull();
    vi.mocked(api.getCategorySales).mockResolvedValue(currentReport);
    liveData.invalidate([{ type: "categories", id: "fixed" }]);
    await vi.waitFor(() => expect(rows(el)).toHaveLength(2));
    expect(q(el, "categories-error")).toBeNull();
  });

  it("refreshes the category report when a sale lands", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const el = await mount(api);
    await vi.waitFor(() => expect(rows(el)).toHaveLength(11));
    vi.mocked(api.getCategorySales).mockResolvedValue(currentReport);
    liveData.invalidate([{ type: "sale_lines", id: "new-line" }]);
    await vi.waitFor(() => expect(rows(el)).toHaveLength(2));
  });

  it("keeps the report at time of sale when the catalogue is edited, and refreshes today's", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const el = await mount(api);
    await vi.waitFor(() => expect(rows(el)).toHaveLength(11));
    liveData.invalidate([{ type: "categories", id: "edited" }]);
    liveData.invalidate([{ type: "products", id: "edited" }]);
    await flush(el);
    expect(api.getCategorySales).toHaveBeenCalledTimes(1);
    pickMode(el, "current");
    await vi.waitFor(() => expect(api.getCategorySales).toHaveBeenCalledTimes(2));
    liveData.invalidate([{ type: "categories", id: "edited" }]);
    await vi.waitFor(() => expect(api.getCategorySales).toHaveBeenCalledTimes(3));
  });
});

describe("dashboard-sales-screen — printing the category report", () => {
  it("offers this location's printers and sends the report as shown to the chosen one", async () => {
    setLocale("en");
    const api = stubApi();
    const el = await mount(api);
    const select = q<PrinterField>(el, "print-printer")!;
    expect(select.name).toBe("printerId");
    expect(select.options.map((o) => [o.value, o.label])).toEqual([
      ["p-bar", "Barra Casa"],
      ["p-kitchen", "Cocina Impresora"],
    ]);
    expect(select.value).toBe("p-bar");
    q<HTMLInputElement>(el, "extras-into-dish")!.click();
    await flush(el);
    await chooseOption(select, "p-kitchen");
    q(el, "print-categories")!.click();
    await flush(el);
    expect(api.printCategorySales).toHaveBeenCalledWith({
      from: today(),
      to: today(),
      mode: "at_time_of_sale",
      extrasIntoDish: true,
      printerId: "p-kitchen",
    });
    const status = q(el, "print-status")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent!.trim()).toBe("Category sales sent to Cocina Impresora.");
    expect(q(el, "print-error")).toBeNull();
    // A new question clears the answer to the old one.
    pickMode(el, "current");
    await flush(el);
    expect(q(el, "print-status")).toBeNull();
  });

  it("marks the button busy while the job is being sent", async () => {
    let finish!: (value: { jobId: string }) => void;
    const api = stubApi({
      printCategorySales: vi.fn(
        () => new Promise<{ jobId: string }>((resolve) => (finish = resolve)),
      ),
    });
    const el = await mount(api);
    const button = q<HTMLElement & { loading: boolean }>(el, "print-categories")!;
    button.click();
    await flush(el);
    expect(button.loading).toBe(true);
    // A second press while the first is in flight sends nothing more.
    button.click();
    await flush(el);
    expect(api.printCategorySales).toHaveBeenCalledTimes(1);
    finish({ jobId: "job-1" });
    await flush(el);
    expect(button.loading).toBe(false);
  });

  it("shows no answer from a print sent for the report shown before the question changed", async () => {
    let finish!: (value: { jobId: string }) => void;
    const api = stubApi({
      printCategorySales: vi.fn(
        () => new Promise<{ jobId: string }>((resolve) => (finish = resolve)),
      ),
    });
    const el = await mount(api);
    const button = q<HTMLElement & { loading: boolean }>(el, "print-categories")!;
    button.click();
    await flush(el);
    pickMode(el, "current");
    await flush(el);
    finish({ jobId: "job-1" });
    await flush(el);
    expect(q(el, "print-status")).toBeNull();
    expect(q(el, "print-error")).toBeNull();
    expect(button.loading).toBe(false);
  });

  it("shows no refusal of a print sent for the report shown before the question changed", async () => {
    let refuse!: (reason: unknown) => void;
    const api = stubApi({
      printCategorySales: vi.fn(
        () => new Promise<{ jobId: string }>((_resolve, reject) => (refuse = reject)),
      ),
    });
    const el = await mount(api);
    const button = q<HTMLElement & { loading: boolean }>(el, "print-categories")!;
    button.click();
    await flush(el);
    q<HTMLInputElement>(el, "extras-into-dish")!.click();
    await flush(el);
    refuse({ code: "printer.not_found" });
    await flush(el);
    expect(q(el, "print-error")).toBeNull();
    expect(q(el, "print-status")).toBeNull();
    expect(button.loading).toBe(false);
  });

  it("shows a refused print by its code's message", async () => {
    setLocale("en");
    const api = stubApi({
      printCategorySales: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });
    const el = await mount(api);
    q(el, "print-categories")!.click();
    await flush(el);
    const error = q(el, "print-error")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent!.trim()).toBe(codeMessage("printer.not_found", "en"));
    expect(q(el, "print-status")).toBeNull();
    // The next attempt's success replaces the refusal.
    vi.mocked(api.printCategorySales).mockResolvedValue({ jobId: "job-2" });
    q(el, "print-categories")!.click();
    await flush(el);
    expect(q(el, "print-error")).toBeNull();
    expect(q(el, "print-status")).not.toBeNull();
  });

  it("says there is nowhere to print, and disables Print, when the location has no printer", async () => {
    setLocale("en");
    const api = stubApi({ getReportPrinters: vi.fn().mockResolvedValue([]) });
    const el = await mount(api);
    expect(q(el, "print-printer")).toBeNull();
    expect(q(el, "no-printers")!.textContent!.trim()).toBe(
      "No active printer at this location. Ask a manager to add one under Printers.",
    );
    const button = q<HTMLElement & { disabled: boolean }>(el, "print-categories")!;
    expect(button.disabled).toBe(true);
    button.click();
    await flush(el);
    expect(api.printCategorySales).not.toHaveBeenCalled();
  });

  it("does not say there is nowhere to print while the printers load or after their read fails", async () => {
    const pending = await mount(
      stubApi({ getReportPrinters: vi.fn().mockReturnValue(new Promise(() => undefined)) }),
    );
    expect(q(pending, "print-categories")).not.toBeNull();
    expect(q(pending, "no-printers")).toBeNull();
    const failed = await mount(
      stubApi({ getReportPrinters: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    );
    await vi.waitFor(() => expect(q(failed, "printers-error")).not.toBeNull());
    expect(q(failed, "no-printers")).toBeNull();
  });

  it("falls back to the first printer when the chosen one leaves the list", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const el = await mount(api);
    await vi.waitFor(() => expect(q(el, "print-printer")).not.toBeNull());
    const select = q<PrinterField>(el, "print-printer")!;
    await chooseOption(select, "p-kitchen");
    // A refresh that still holds the chosen printer keeps it.
    vi.mocked(api.getReportPrinters).mockResolvedValue([
      { id: "p-new", name: "Terraza Casa" },
      ...printers,
    ]);
    liveData.invalidate([{ type: "printers", id: "p-new" }]);
    await vi.waitFor(() => expect(q<PrinterField>(el, "print-printer")!.options).toHaveLength(3));
    expect(q<PrinterField>(el, "print-printer")!.value).toBe("p-kitchen");
    vi.mocked(api.getReportPrinters).mockResolvedValue([{ id: "p-new", name: "Terraza Casa" }]);
    liveData.invalidate([{ type: "printers", id: "p-kitchen" }]);
    await vi.waitFor(() => expect(q<PrinterField>(el, "print-printer")!.value).toBe("p-new"));
    q(el, "print-categories")!.click();
    await flush(el);
    expect(api.printCategorySales).toHaveBeenCalledWith(
      expect.objectContaining({ printerId: "p-new" }),
    );
  });

  it("drops the printer list's failure when a later read succeeds", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({ getReportPrinters: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
      { liveData },
    );
    const el = await mount(api);
    await vi.waitFor(() => expect(q(el, "printers-error")).not.toBeNull());
    vi.mocked(api.getReportPrinters).mockResolvedValue(printers);
    liveData.invalidate([{ type: "printers", id: "p-bar" }]);
    await vi.waitFor(() => expect(q(el, "print-printer")).not.toBeNull());
    expect(q(el, "printers-error")).toBeNull();
  });

  it("shows why the printer list could not be read", async () => {
    setLocale("en");
    const api = stubApi({
      getReportPrinters: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const el = await mount(api);
    expect(q(el, "printers-error")!.textContent!.trim()).toBe(
      codeMessage("authorization.not_permitted", "en"),
    );
    expect(q<HTMLElement & { disabled: boolean }>(el, "print-categories")!.disabled).toBe(true);
    // A new question about the report leaves the list's failure standing.
    pickMode(el, "current");
    await flush(el);
    expect(q(el, "printers-error")).not.toBeNull();
  });
});

describe("dashboard-sales-screen — the report printer field", () => {
  it("picks the printer from a labelled dropdown starting on the first, and prints to the one chosen", async () => {
    const api = stubApi();
    const el = await mount(api);
    const printer = el.shadowRoot!.querySelector("wt-combobox[data-test=print-printer]") as
      | (HTMLElement & {
          name: string;
          label: string;
          search: string;
          value: string;
          options: { value: string; label: string }[];
        })
      | null;
    expect(printer!.name).toBe("printerId");
    expect(printer!.label).toBe(t("sales.printer"));
    expect(printer!.search).toBe("auto");
    expect(printer!.options).toEqual([
      { value: "p-bar", label: "Barra Casa" },
      { value: "p-kitchen", label: "Cocina Impresora" },
    ]);
    expect(printer!.value).toBe("p-bar");
    await chooseOption(printer!, "p-kitchen");
    q(el, "print-categories")!.click();
    await flush(el);
    expect(api.printCategorySales).toHaveBeenCalledWith(
      expect.objectContaining({ printerId: "p-kitchen" }),
    );
  });
});
