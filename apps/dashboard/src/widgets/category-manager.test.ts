import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
import type { CategorySummary, Station } from "../api/client.js";
import { CategoryManager } from "./category-manager.js";

afterEach(cleanupWidgets);

const categories: CategorySummary[] = [
  { id: "c1", name: "Entrantes" },
  { id: "c2", name: "Postres" },
];

const stations: Station[] = [
  {
    id: "s1",
    name: "Cocina",
    displayOrder: 0,
    isDefault: true,
    active: true,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
  {
    id: "s2",
    name: "Plancha",
    displayOrder: 1,
    isDefault: false,
    active: true,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
];

/** Set a native <select>'s value and fire its `change`, exactly as the browser does on a pick. */
function selectValue(el: CategoryManager, sel: string, value: string): void {
  const node = el.shadowRoot!.querySelector<HTMLSelectElement>(sel)!;
  node.value = value;
  node.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

/** Drive the create field the way the operator does: type into the wt-input (its composed wt-change). */
function type(el: CategoryManager, value: string): void {
  const input = el.shadowRoot!.querySelector<HTMLElement>("[data-test=category-name]")!;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

describe("category-manager", () => {
  it("lists one row per category with its name", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", { categories });
    const rows = el.shadowRoot!.querySelectorAll("[data-test=category-row]");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Entrantes");
    expect(rows[1]!.textContent).toContain("Postres");
  });

  // The create field's label and the create button render through the i18n layer (localised UI
  // chrome). Category NAMES stay raw operator DATA (covered by the row tests above), not translated.
  it("renders the create field label and button from the i18n layer", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", { categories });
    expect(el.shadowRoot!.querySelector("[data-test=category-name]")!.getAttribute("label")).toBe(
      t("category.new", "es-ES"),
    );
    expect(el.shadowRoot!.querySelector("[data-test=create]")!.textContent).toContain(
      t("action.create", "es-ES"),
    );
  });

  it("renders no category rows for an empty list", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", {
      categories: [],
    });
    expect(el.shadowRoot!.querySelectorAll("[data-test=category-row]").length).toBe(0);
  });

  it("emits create-category with the typed name on submit", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", { categories });
    const detail = new Promise<{ name: string }>((resolve) =>
      el.addEventListener("create-category", (e) => resolve((e as CustomEvent).detail)),
    );
    type(el, "Bebidas");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    expect((await detail).name).toBe("Bebidas");
  });

  it("trims surrounding whitespace from the emitted name", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", { categories });
    const detail = new Promise<{ name: string }>((resolve) =>
      el.addEventListener("create-category", (e) => resolve((e as CustomEvent).detail)),
    );
    type(el, "   Bebidas   ");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    expect((await detail).name).toBe("Bebidas");
  });

  it("does not emit for an empty or whitespace-only name", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", { categories });
    let fired = false;
    el.addEventListener("create-category", () => {
      fired = true;
    });
    // Never typed anything → empty.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    // Typed only whitespace → still empty after trim.
    type(el, "    ");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    expect(fired).toBe(false);
  });

  // create-category must escape the widget's shadow boundary to reach the catalogue screen, so it is
  // dispatched bubbles+composed — pinned so a future edit does not quietly drop either flag.
  it("emits create-category as a bubbling, composed event", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", { categories });
    const seen = new Promise<Event>((resolve) => el.addEventListener("create-category", resolve));
    type(el, "Bebidas");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // ── Category → kitchen-station routing (KDS-1) ──────────────────────────────────────────────────

  it("renders a station select per category row (an inherit option + one per active station)", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", {
      categories,
      stations,
    });
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "[data-test=category-station-c1]",
    )!;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", "s1", "s2"]); // the empty "— none —" plus each station id
  });

  it("emits set-category-station with the picked station id on change", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", {
      categories,
      stations,
    });
    const detail = new Promise<{ categoryId: string; stationId: string | null }>((resolve) =>
      el.addEventListener("set-category-station", (e) => resolve((e as CustomEvent).detail)),
    );
    selectValue(el, "[data-test=category-station-c1]", "s2");
    expect(await detail).toEqual({ categoryId: "c1", stationId: "s2" });
  });

  it("emits set-category-station with a null stationId when the inherit option is picked", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", {
      categories,
      stations,
    });
    const detail = new Promise<{ categoryId: string; stationId: string | null }>((resolve) =>
      el.addEventListener("set-category-station", (e) => resolve((e as CustomEvent).detail)),
    );
    selectValue(el, "[data-test=category-station-c1]", "");
    expect(await detail).toEqual({ categoryId: "c1", stationId: null });
  });

  it("emits set-category-station as a bubbling, composed event", async () => {
    const { el } = await mountWidget<CategoryManager>("dashboard-category-manager", {
      categories,
      stations,
    });
    const seen = new Promise<Event>((resolve) =>
      el.addEventListener("set-category-station", resolve),
    );
    selectValue(el, "[data-test=category-station-c1]", "s1");
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });
});
