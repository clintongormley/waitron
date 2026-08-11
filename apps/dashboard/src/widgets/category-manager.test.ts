import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { CategorySummary } from "../api/client.js";
import { CategoryManager } from "./category-manager.js";

afterEach(cleanupWidgets);

const categories: CategorySummary[] = [
  { id: "c1", name: "Entrantes" },
  { id: "c2", name: "Postres" },
];

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
});
