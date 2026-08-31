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
  Course,
  DashboardApi,
  OptionGroup,
  Product,
  Station,
} from "../api/client.js";

afterEach(cleanupWidgets);

const CATEGORIES: CategorySummary[] = [
  { id: "cat-bebidas", name: "Bebidas" },
  { id: "cat-postres", name: "Postres" },
];

const STATIONS: Station[] = [
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

const COURSES: Course[] = [
  { id: "k1", name: "Entrantes", displayOrder: 0, active: true },
  { id: "k2", name: "Postres", displayOrder: 1, active: true },
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
      optionGroupIds: [],
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
      optionGroupIds: [],
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

  // ── Product → default-course routing (KDS-2), the sibling of the station override above ─────────────

  it("renders the default-course select in edit mode (a none option + one per course)", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
      courses: COURSES,
    });
    await el.updateComplete;
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=product-course]")!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "k1", "k2"]);
  });

  it("does NOT render the default-course select in create mode (no product yet)", async () => {
    const { el } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      baseProps({ courses: COURSES }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=product-course]")).toBeNull();
  });

  it("emits set-product-course with the product id + picked course on change", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
      courses: COURSES,
    });
    await el.updateComplete;
    const routed = nextEvent<{ productId: string; courseId: string | null }>(
      el,
      "set-product-course",
    );
    await setSelect(el, "product-course", "k2");
    expect((await routed).detail).toEqual({ productId: "prod-1", courseId: "k2" });
  });

  it("emits set-product-course with a null courseId when the none option is picked", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
      courses: COURSES,
    });
    await el.updateComplete;
    const routed = nextEvent<{ productId: string; courseId: string | null }>(
      el,
      "set-product-course",
    );
    await setSelect(el, "product-course", "");
    expect((await routed).detail).toEqual({ productId: "prod-1", courseId: null });
  });

  // ── Product → option-group attach (Task 12) ─────────────────────────────────────────────────────
  // Pick + ORDER which reusable option groups apply. Unlike the station/course overrides above this
  // renders in BOTH create and edit mode (the server accepts `optionGroupIds` on POST too — there is no
  // existing product id to wait for), and the ordered set is carried on the SAME create/update body sent
  // on confirm, not a separate live-write route.

  const OPTION_GROUPS: OptionGroup[] = [
    {
      id: "og1",
      name: { es: "Tamaño" },
      minSelect: 1,
      maxSelect: 1,
      required: true,
      sort: 0,
      active: true,
    },
    {
      id: "og2",
      name: { es: "Extras" },
      minSelect: 0,
      maxSelect: 3,
      required: false,
      sort: 1,
      active: true,
    },
    {
      id: "og3",
      name: { es: "Salsas" },
      minSelect: 0,
      maxSelect: 2,
      required: false,
      sort: 2,
      active: true,
    },
  ];

  /** Pick `groupId` in the attach picker and click Add. */
  async function attachGroup(el: ProductForm, groupId: string): Promise<void> {
    await setSelect(el, "option-group-pick", groupId);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=option-group-add]")!.click();
    await el.updateComplete;
  }

  it("renders no attached groups and offers every group in create mode", async () => {
    const { el } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      baseProps({ optionGroups: OPTION_GROUPS }),
    );
    expect(el.shadowRoot!.querySelectorAll("[data-test^=option-group-attached-]").length).toBe(0);
    const values = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=option-group-pick] option"),
    ].map((o) => o.value);
    expect(values).toEqual(["og1", "og2", "og3"]);
  });

  // A picker option's label falls back to another locale's name, then to the bare id — the same
  // `primaryName` rule `option-group-manager.ts` uses for its own rows, duplicated here for the
  // picker's inline label (the picker offers groups, not items/groups this widget owns state for).
  it("labels a picker option by another locale's name, then by the bare id", async () => {
    const oddGroups: OptionGroup[] = [
      {
        id: "og4",
        name: { en: "Sauce" },
        minSelect: 0,
        maxSelect: 1,
        required: false,
        sort: 0,
        active: true,
      },
      { id: "og5", name: {}, minSelect: 0, maxSelect: 1, required: false, sort: 0, active: true },
    ];
    const { el } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      baseProps({ optionGroups: oddGroups }),
    );
    const labels = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=option-group-pick] option"),
    ].map((o) => o.textContent!.trim());
    expect(labels).toEqual(["Sauce", "og5"]);
  });

  it("labels an attached row by another locale's name, then by the bare id", async () => {
    const oddGroups: OptionGroup[] = [
      {
        id: "og4",
        name: { en: "Sauce" },
        minSelect: 0,
        maxSelect: 1,
        required: false,
        sort: 0,
        active: true,
      },
      { id: "og5", name: {}, minSelect: 0, maxSelect: 1, required: false, sort: 0, active: true },
    ];
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      optionGroups: oddGroups,
      attachedGroupIds: ["og4", "og5"],
    });
    await el.updateComplete;
    const rows = el.shadowRoot!.querySelectorAll("[data-test^=option-group-attached-]");
    expect(rows[0]!.textContent).toContain("Sauce");
    expect(rows[1]!.textContent).toContain("og5");
  });

  it("attaches groups in picked order and sends them on create", async () => {
    const { el } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      baseProps({ optionGroups: OPTION_GROUPS }),
    );
    await attachGroup(el, "og2");
    await attachGroup(el, "og1");
    const rows = el.shadowRoot!.querySelectorAll("[data-test^=option-group-attached-]");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Extras");
    expect(rows[1]!.textContent).toContain("Tamaño");

    await setInput(el, "description-es", "Bocadillo");
    const created = nextEvent<{ optionGroupIds: string[] }>(el, "create-product");
    confirm(el);
    expect((await created).detail.optionGroupIds).toEqual(["og2", "og1"]);
  });

  it("excludes an already-attached group from the picker", async () => {
    const { el } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      baseProps({ optionGroups: OPTION_GROUPS }),
    );
    await attachGroup(el, "og1");
    const values = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=option-group-pick] option"),
    ].map((o) => o.value);
    expect(values).toEqual(["og2", "og3"]);
  });

  it("reorders attached groups with move up/down", async () => {
    const { el } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      baseProps({ optionGroups: OPTION_GROUPS }),
    );
    await attachGroup(el, "og1");
    await attachGroup(el, "og2");
    await attachGroup(el, "og3");

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=option-group-down-og1]")!.click();
    await el.updateComplete;

    await setInput(el, "description-es", "Bocadillo");
    const created = nextEvent<{ optionGroupIds: string[] }>(el, "create-product");
    confirm(el);
    expect((await created).detail.optionGroupIds).toEqual(["og2", "og1", "og3"]);
  });

  it("does not move the first row up or the last row down (disabled at the ends)", async () => {
    const { el } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      baseProps({ optionGroups: OPTION_GROUPS }),
    );
    await attachGroup(el, "og1");
    await attachGroup(el, "og2");
    const up = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-test=option-group-up-og1]")!;
    const down = el.shadowRoot!.querySelector<HTMLButtonElement>(
      "[data-test=option-group-down-og2]",
    )!;
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
  });

  it("removes an attached group", async () => {
    const { el } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      baseProps({ optionGroups: OPTION_GROUPS }),
    );
    await attachGroup(el, "og1");
    await attachGroup(el, "og2");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=option-group-remove-og1]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-test^=option-group-attached-]").length).toBe(1);

    await setInput(el, "description-es", "Bocadillo");
    const created = nextEvent<{ optionGroupIds: string[] }>(el, "create-product");
    confirm(el);
    expect((await created).detail.optionGroupIds).toEqual(["og2"]);
  });

  it("always sends optionGroupIds — [] when nothing is attached", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", baseProps());
    await setInput(el, "description-es", "Café");
    const created = nextEvent<{ optionGroupIds: string[] }>(el, "create-product");
    confirm(el);
    expect((await created).detail.optionGroupIds).toEqual([]);
  });

  // ── Read-back seeding: shows currently-attached groups on load, in ORDER ────────────────────────

  it("seeds the attach list from attachedGroupIds (the read-back), in order, in edit mode", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
      optionGroups: OPTION_GROUPS,
      attachedGroupIds: ["og3", "og1"],
    });
    await el.updateComplete;
    const rows = el.shadowRoot!.querySelectorAll("[data-test^=option-group-attached-]");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Salsas");
    expect(rows[1]!.textContent).toContain("Tamaño");

    const updated = nextEvent<{ patch: { optionGroupIds: string[] } }>(el, "update-product");
    confirm(el);
    expect((await updated).detail.patch.optionGroupIds).toEqual(["og3", "og1"]);
  });

  // The read-back can name an id `optionGroups` has not (yet) loaded — e.g. the group list's own GET
  // is still in flight — so a row for it falls back to the bare id rather than throwing on a lookup miss.
  it("shows the bare id for an attached group not (yet) present in optionGroups", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
      optionGroups: [],
      attachedGroupIds: ["og9"],
    });
    await el.updateComplete;
    const row = el.shadowRoot!.querySelector("[data-test=option-group-attached-og9]")!;
    expect(row.textContent).toContain("og9");
  });

  it("reseeds the attach list when attachedGroupIds arrives AFTER the form is already open", async () => {
    // Mirrors the async read-back the screen kicks off on edit-product: the form opens first (product
    // set, attachedGroupIds still its default []), then the screen's GET resolves and updates the prop.
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
      optionGroups: OPTION_GROUPS,
    });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-test^=option-group-attached-]").length).toBe(0);

    el.attachedGroupIds = ["og2"];
    await el.updateComplete;
    const rows = el.shadowRoot!.querySelectorAll("[data-test^=option-group-attached-]");
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain("Extras");
  });

  it("resets the attach list to empty when the form reopens for a create after an edit", async () => {
    const { el } = await mountWidget<ProductForm>("dashboard-product-form", {
      open: true,
      catalogueId: "cat-1",
      categories: CATEGORIES,
      product: EDIT_PRODUCT,
      optionGroups: OPTION_GROUPS,
      attachedGroupIds: ["og1"],
    });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-test^=option-group-attached-]").length).toBe(1);

    // The screen closes, then reopens for a fresh create: product → null, attachedGroupIds → [].
    el.product = null;
    el.attachedGroupIds = [];
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-test^=option-group-attached-]").length).toBe(0);
  });
});
