import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { unitName, vatClassName } from "../i18n/domain.js";
// Value import (not `import type`): pulls in the module for its `@customElement` side effect, which
// registers `dashboard-product-form` so `mountWidget` can create it.
import { ProductForm } from "./product-form.js";
import type {
  AllergenDeclaration,
  CategorySummary,
  DashboardApi,
  Product,
  Station,
} from "../api/client.js";

afterEach(cleanupWidgets);

const CATEGORIES: CategorySummary[] = [
  { id: "cat-bebidas", name: "Bebidas" },
  { id: "cat-postres", name: "Postres" },
];

const STATIONS: Station[] = [
  { id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
  { id: "s2", name: "Plancha", displayOrder: 1, isDefault: false, active: true },
];

/** The base props every mount needs: an open dialog scoped to a catalogue, with the category list. */
function baseProps(overrides: Partial<ProductForm> = {}): Partial<ProductForm> {
  return { open: true, catalogueId: "cat-1", categories: CATEGORIES, ...overrides };
}

/** The wt-dialog inside the form, once its own first render (which calls showModal) has settled. */
async function openedDialog(el: ProductForm): Promise<HTMLDialogElement> {
  const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return wtDialog.shadowRoot!.querySelector("dialog")!;
}

/** Type into a wt-input by its data-test, via the composed `wt-change` it dispatches. */
async function setInput(el: ProductForm, testId: string, value: string): Promise<void> {
  const input = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}

/** Pick a native <select>'s option by its data-test. */
async function setSelect(el: ProductForm, testId: string, value: string): Promise<void> {
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>(`[data-test=${testId}]`)!;
  select.value = value;
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

/** Flip a wt-switch by its data-test, via the composed `wt-change` it dispatches. */
async function setSwitch(el: ProductForm, testId: string, checked: boolean): Promise<void> {
  const sw = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!;
  sw.dispatchEvent(new CustomEvent("wt-change", { detail: { checked } }));
  await el.updateComplete;
}

/** Announce an allergen declaration from the child picker, as the real picker's event would. */
async function emitAllergens(el: ProductForm, value: AllergenDeclaration): Promise<void> {
  const picker = el.shadowRoot!.querySelector("dashboard-allergen-picker")!;
  picker.dispatchEvent(
    new CustomEvent("allergens-changed", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Announce a stored image reference from the child upload control, as its event would. */
async function emitImage(el: ProductForm, image: string): Promise<void> {
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  upload.dispatchEvent(
    new CustomEvent("image-changed", { detail: { image }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Click the footer confirm control. */
function confirm(el: ProductForm): void {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
}

/** Resolve with the next event of `type` dispatched from the form host. */
function nextEvent<T>(el: ProductForm, type: string): Promise<CustomEvent<T>> {
  return new Promise((resolve) =>
    el.addEventListener(type, (e) => resolve(e as CustomEvent<T>), { once: true }),
  );
}

describe("product-form", () => {
  it("stays closed by default", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      catalogueId: "cat-1",
      categories: CATEGORIES,
    });
    expect((await openedDialog(el)).open).toBe(false);
  });

  it("opens the dialog when open is set", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    expect((await openedDialog(el)).open).toBe(true);
  });

  it("offers the four VAT classes and both pricing units", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    const vat = [...el.shadowRoot!.querySelectorAll("[data-test=vat-class] option")].map(
      (o) => (o as HTMLOptionElement).value,
    );
    const unit = [...el.shadowRoot!.querySelectorAll("[data-test=pricing-unit] option")].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(vat).toEqual(["general", "reduced", "super_reduced", "zero"]);
    expect(unit).toEqual(["each", "weight"]);
  });

  // The VAT and pricing-unit options carry localised LABELS while keeping their raw WIRE VALUES (the
  // CHECK-set tokens the create/update body sends) — the same render-edge translation staff-list uses.
  it("labels the VAT and unit options with localised names, keeping the wire values", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    const vatOptions = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=vat-class] option"),
    ];
    for (const o of vatOptions) {
      expect(o.textContent!.trim()).toBe(vatClassName(o.value, "es-ES"));
      expect(o.textContent!.trim()).not.toBe(o.value);
    }
    const unitOptions = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=pricing-unit] option"),
    ];
    for (const o of unitOptions) {
      expect(o.textContent!.trim()).toBe(unitName(o.value, "es-ES"));
      expect(o.textContent!.trim()).not.toBe(o.value);
    }
  });

  it("lists the loaded categories plus a — none — option that maps to null", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    const values = [...el.shadowRoot!.querySelectorAll("[data-test=category] option")].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(values).toEqual(["", "cat-bebidas", "cat-postres"]);
    // The no-category option carries localised text while its wire value stays the empty string.
    const none = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=category] option"),
    ].find((o) => o.value === "")!;
    expect(none.textContent!.trim()).toBe(t("product.no_category", "es-ES"));
  });

  // The whole create round-trip: fill every field, leave the picker PENDING and no image, confirm,
  // assert the assembled body — and, load-bearing, that `allergens` and `image` keys are OMITTED.
  it("emits create-product with the assembled body, omitting allergens (PENDING) and image (unset)", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    await setInput(el, "description-es", "Café con leche");
    await setInput(el, "unit-price", "2.50");
    await setSelect(el, "vat-class", "reduced");
    await setSelect(el, "pricing-unit", "each");
    await setSelect(el, "category", "cat-bebidas");

    const created = nextEvent<{ [k: string]: unknown }>(el, "create-product");
    confirm(el);
    const body = (await created).detail;
    expect(body).toEqual({
      catalogueId: "cat-1",
      categoryId: "cat-bebidas",
      descriptions: { es: "Café con leche" },
      unitPrice: "2.50",
      vatClass: "reduced",
      pricingUnit: "each",
      active: true,
    });
    // The create-vs-patch asymmetry: an explicit `allergens: null` makes the server throw
    // `allergen.invalid_code`, so a PENDING picker must OMIT the key entirely, not send null.
    expect("allergens" in body).toBe(false);
    expect("image" in body).toBe(false);
  });

  // When the picker is reviewed and an image is set, both keys ARE present in the create body.
  it("includes allergens and image in the create body when set", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    await setInput(el, "description-es", "Tarta");
    await setInput(el, "unit-price", "4.00");
    await emitAllergens(el, { gluten: { presence: "contains", source: "trigo" } });
    await emitImage(el, "sha.png");

    const created = nextEvent<{ [k: string]: unknown }>(el, "create-product");
    confirm(el);
    const body = (await created).detail;
    expect(body.allergens).toEqual({ gluten: { presence: "contains", source: "trigo" } });
    expect(body.image).toBe("sha.png");
  });

  // A reviewed-but-none declaration ({}) is NOT PENDING — it must be sent, not omitted.
  it("includes an empty allergens map ({}) in the create body", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    await setInput(el, "description-es", "Agua");
    await emitAllergens(el, {});
    const created = nextEvent<{ [k: string]: unknown }>(el, "create-product");
    confirm(el);
    const body = (await created).detail;
    expect("allergens" in body).toBe(true);
    expect(body.allergens).toEqual({});
  });

  it("maps the — none — category to null in the create body", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    await setInput(el, "description-es", "Café");
    await setSelect(el, "category", "");
    const created = nextEvent<{ categoryId: unknown }>(el, "create-product");
    confirm(el);
    expect((await created).detail.categoryId).toBe(null);
  });

  it("defaults active true and toggles it via the switch", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    await setInput(el, "description-es", "Café");
    await setSwitch(el, "active", false);
    const created = nextEvent<{ active: unknown }>(el, "create-product");
    confirm(el);
    expect((await created).detail.active).toBe(false);
  });

  // A non-empty PRIMARY-locale description is required client-side (the column is NOT NULL; a nameless
  // product is a UI error). An empty name blocks confirm — no event — and shows an error. The banner
  // renders LOCALISED copy through the i18n layer, never the raw `product.description_required` code
  // (which stays raw in @state; codeMessage maps it at the render edge, mirroring the screens).
  it("blocks confirm and shows a localised error when the primary description is empty", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    let fired = false;
    el.addEventListener("create-product", () => (fired = true));
    confirm(el);
    await el.updateComplete;
    expect(fired).toBe(false);
    const alert = el.shadowRoot!.querySelector("[role=alert]");
    expect(alert).not.toBe(null);
    expect(alert!.textContent).toContain(codeMessage("product.description_required", "es-ES"));
    expect(alert!.textContent).not.toContain("product.description_required");
  });

  // Whitespace-only is still empty.
  it("treats a whitespace-only primary description as empty", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    await setInput(el, "description-es", "   ");
    let fired = false;
    el.addEventListener("create-product", () => (fired = true));
    confirm(el);
    await el.updateComplete;
    expect(fired).toBe(false);
  });

  // create-product must cross this widget's shadow boundary to reach the catalogue screen, so it is
  // dispatched bubbles+composed.
  it("emits create-product as a bubbling, composed event", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    await setInput(el, "description-es", "Café");
    const seen = nextEvent(el, "create-product");
    confirm(el);
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // ── Edit mode ─────────────────────────────────────────────────────────────────────────────────

  const EDIT_PRODUCT: Product = {
    id: "prod-1",
    catalogueId: "cat-1",
    categoryId: "cat-postres",
    descriptions: { es: "Té verde" },
    pricingUnit: "weight",
    unitPrice: "1.20",
    vatClass: "super_reduced",
    active: false,
    allergens: { gluten: { presence: "contains" } },
    // No recipe floor, so the manual overlay equals the published union — the picker seeds from this.
    manualAllergens: { gluten: { presence: "contains" } },
    image: "img123.png",
  };

  it("pre-fills every field from a passed product in edit mode", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
    });
    await el.updateComplete;
    const desc = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=description-es]",
    )!;
    const price = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=unit-price]",
    )!;
    const vat = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=vat-class]")!;
    const unit = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=pricing-unit]")!;
    const category = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=category]")!;
    expect(desc.value).toBe("Té verde");
    expect(price.value).toBe("1.20");
    expect(vat.value).toBe("super_reduced");
    expect(unit.value).toBe("weight");
    expect(category.value).toBe("cat-postres");
    // The allergen picker is seeded via its `declaration` — its reviewed toggle reflects the product.
    const picker = el.shadowRoot!.querySelector("dashboard-allergen-picker")!;
    await (picker as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const reviewed = picker.shadowRoot!.querySelector<HTMLInputElement & { checked: boolean }>(
      "[data-test=reviewed]",
    )!;
    expect(reviewed.checked).toBe(true);
    // The image control is seeded via its `image` property — its preview shows the product's picture.
    const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
    await (upload as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const preview = upload.shadowRoot!.querySelector<HTMLImageElement>("[data-test=preview]")!;
    expect(preview.getAttribute("src")).toBe("/media/img123.png");
  });

  it("emits update-product with the id and a patch of the mutable fields in edit mode", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
    });
    await el.updateComplete;
    const updated = nextEvent<{ id: string; patch: Record<string, unknown> }>(el, "update-product");
    confirm(el);
    const detail = (await updated).detail;
    expect(detail.id).toBe("prod-1");
    expect(detail.patch).toEqual({
      categoryId: "cat-postres",
      descriptions: { es: "Té verde" },
      unitPrice: "1.20",
      vatClass: "super_reduced",
      pricingUnit: "weight",
      allergens: { gluten: { presence: "contains" } },
      image: "img123.png",
      active: false,
    });
  });

  // An edit that clears the allergen review sends `allergens: null` in the patch — LEGAL for a patch
  // (it resets the declaration to PENDING), unlike a create.
  it("sends allergens: null in an edit patch to clear the declaration", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
    });
    await el.updateComplete;
    await emitAllergens(el, null);
    const updated = nextEvent<{ patch: { allergens: unknown } }>(el, "update-product");
    confirm(el);
    const patch = (await updated).detail.patch;
    expect("allergens" in patch).toBe(true);
    expect(patch.allergens).toBe(null);
  });

  it("seeds the allergen picker from manualAllergens, not the published union", async () => {
    // Published `allergens` carries the computed union (manual gluten ∪ derived eggs); the manual overlay is
    // gluten only. The picker MUST show the manual overlay — seeding from the published union would double-count
    // the derived eggs into the manual overlay on the next save.
    const product = {
      id: "11111111-1111-1111-1111-111111111111",
      catalogueId: "c",
      categoryId: null,
      descriptions: { es: "bocadillo" },
      pricingUnit: "each" as const,
      unitPrice: "3.00",
      vatClass: "general" as const,
      active: true,
      image: null,
      allergens: {
        eggs: { presence: "contains" as const },
        gluten: { presence: "contains" as const },
      },
      manualAllergens: { gluten: { presence: "contains" as const } },
    };
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      ...baseProps(),
      product,
      open: true,
    });
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector("[data-test=allergens]") as HTMLElement & {
      declaration: unknown;
    };
    expect(picker.declaration).toEqual({ gluten: { presence: "contains" } });
  });

  // ── Dialog dismissal + single-flight ──────────────────────────────────────────────────────────

  it("resets open to false when the dialog is closed (wt-close)", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    const nativeDialog = await openedDialog(el);
    expect(nativeDialog.open).toBe(true);
    const closed = new Promise<void>((resolve) =>
      el.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    nativeDialog.close();
    await closed;
    await el.updateComplete;
    expect(el.open).toBe(false);
  });

  // The api the screen passes for uploads is threaded down to the image control unchanged.
  it("passes its api through to the image-upload control", async () => {
    const api = { uploadImage: vi.fn() } as unknown as DashboardApi;
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps({ api }));
    const upload = el.shadowRoot!.querySelector<HTMLElement & { api: unknown }>(
      "dashboard-image-upload",
    )!;
    expect(upload.api).toBe(api);
  });

  // Single-flight: while a create/update round-trip is in flight the screen sets `busy`, and a second
  // confirm is ignored (the mutations are not server-idempotent) — the staff-screen guard shape.
  it("ignores a confirm while busy (single-flight)", async () => {
    const { el } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      baseProps({ busy: true }),
    );
    await setInput(el, "description-es", "Café");
    let fired = false;
    el.addEventListener("create-product", () => (fired = true));
    confirm(el);
    await el.updateComplete;
    expect(fired).toBe(false);
  });

  // ── Product → kitchen-station override routing (KDS-1) ──────────────────────────────────────────
  // The override select is EDIT-MODE ONLY (a new product has no id yet and inherits its category
  // route; an override is set on an existing product). It fires immediately on change (the floor
  // zone-assign shape), not on Guardar, so it is a live side-write through its own event.

  it("renders the station-override select in edit mode (an inherit option + one per station)", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
      stations: STATIONS,
    });
    await el.updateComplete;
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=product-station]")!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "s1", "s2"]);
  });

  it("does NOT render the station-override select in create mode (no product yet)", async () => {
    const { el } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      baseProps({ stations: STATIONS }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=product-station]")).toBeNull();
  });

  it("emits set-product-station with the product id + picked station on change", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
      stations: STATIONS,
    });
    await el.updateComplete;
    const routed = nextEvent<{ productId: string; stationId: string | null }>(
      el,
      "set-product-station",
    );
    await setSelect(el, "product-station", "s2");
    expect((await routed).detail).toEqual({ productId: "prod-1", stationId: "s2" });
  });

  it("emits set-product-station with a null stationId when the inherit option is picked", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
      stations: STATIONS,
    });
    await el.updateComplete;
    const routed = nextEvent<{ productId: string; stationId: string | null }>(
      el,
      "set-product-station",
    );
    await setSelect(el, "product-station", "");
    expect((await routed).detail).toEqual({ productId: "prod-1", stationId: null });
  });
});
