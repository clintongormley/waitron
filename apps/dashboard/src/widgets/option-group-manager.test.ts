import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { OptionGroup, OptionGroupInput, OptionGroupItem } from "../api/client.js";
import { OptionGroupManager } from "./option-group-manager.js";

afterEach(cleanupWidgets);

const groups: OptionGroup[] = [
  {
    id: "g1",
    name: { es: "Tamaño" },
    minSelect: 1,
    maxSelect: 1,
    required: true,
    sort: 0,
    active: true,
  },
  {
    id: "g2",
    name: { es: "Extras" },
    minSelect: 0,
    maxSelect: 3,
    required: false,
    sort: 1,
    active: true,
  },
];

const items: OptionGroupItem[] = [
  {
    id: "i1",
    groupId: "g1",
    name: { es: "Pequeño" },
    priceDelta: "0.00",
    vatClass: null,
    sort: 0,
    active: true,
  },
  {
    id: "i2",
    groupId: "g1",
    name: { es: "Grande" },
    priceDelta: "1.50",
    vatClass: "reduced",
    sort: 1,
    active: true,
  },
];

/** Set a native <select>'s value and fire its `change`, exactly as the browser does on a pick. */
function selectValue(el: OptionGroupManager, sel: string, value: string): void {
  const node = el.shadowRoot!.querySelector<HTMLSelectElement>(sel)!;
  node.value = value;
  node.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

/** Drive a wt-input the way the operator does: type into it (its composed wt-change). */
function type(el: OptionGroupManager, dataTest: string, value: string): void {
  const input = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${dataTest}]`)!;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

/** Drive a wt-switch the way the operator does: toggle it (its composed wt-change). */
function toggle(el: OptionGroupManager, dataTest: string, checked: boolean): void {
  const input = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${dataTest}]`)!;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
}

function click(el: OptionGroupManager, dataTest: string): void {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${dataTest}]`)!.click();
}

describe("option-group-manager", () => {
  it("lists one row per group with its name", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
    });
    const rows = el.shadowRoot!.querySelectorAll("[data-test^=group-row-]");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Tamaño");
    expect(rows[1]!.textContent).toContain("Extras");
  });

  it("renders no group rows for an empty list", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups: [],
    });
    expect(el.shadowRoot!.querySelectorAll("[data-test^=group-row-]").length).toBe(0);
  });

  // A row's name falls back to any OTHER locale's value when the primary locale is missing, then to
  // the bare id when the name map is empty — a name in the wrong language beats a blank row, and an id
  // beats nothing (the `primaryName` rule, mirroring `recipe-screen.ts`'s `#productName`).
  it("falls back to another locale's name, then to the bare id", async () => {
    const oddGroups: OptionGroup[] = [
      {
        id: "g3",
        name: { en: "Size" },
        minSelect: 0,
        maxSelect: 1,
        required: false,
        sort: 0,
        active: true,
      },
      { id: "g4", name: {}, minSelect: 0, maxSelect: 1, required: false, sort: 0, active: true },
    ];
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups: oddGroups,
    });
    expect(el.shadowRoot!.querySelector("[data-test=group-row-g3]")!.textContent).toContain("Size");
    expect(el.shadowRoot!.querySelector("[data-test=group-row-g4]")!.textContent).toContain("g4");
  });

  // ── Create a group ────────────────────────────────────────────────────────────────────────────

  it("emits create-option-group with the typed name + defaults on submit", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups: [],
    });
    const detail = new Promise<OptionGroupInput>((resolve) =>
      el.addEventListener("create-option-group", (e) => resolve((e as CustomEvent).detail)),
    );
    type(el, "group-name-es", "Tamaño");
    await el.updateComplete;
    click(el, "create-group");
    expect(await detail).toEqual({
      name: { es: "Tamaño" },
      minSelect: 0,
      maxSelect: 1,
      required: false,
      sort: 0,
      active: true,
    });
  });

  it("emits create-option-group with edited min/max/required/active/sort", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups: [],
    });
    const detail = new Promise<OptionGroupInput>((resolve) =>
      el.addEventListener("create-option-group", (e) => resolve((e as CustomEvent).detail)),
    );
    type(el, "group-name-es", "Tamaño");
    type(el, "group-new-min", "1");
    type(el, "group-new-max", "2");
    type(el, "group-new-sort", "5");
    toggle(el, "group-new-required", true);
    toggle(el, "group-new-active", false);
    await el.updateComplete;
    click(el, "create-group");
    expect(await detail).toEqual({
      name: { es: "Tamaño" },
      minSelect: 1,
      maxSelect: 2,
      required: true,
      sort: 5,
      active: false,
    });
  });

  it("drops an empty-locale name before emitting create-option-group", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups: [],
      locales: ["es", "en"],
    });
    const detail = new Promise<OptionGroupInput>((resolve) =>
      el.addEventListener("create-option-group", (e) => resolve((e as CustomEvent).detail)),
    );
    type(el, "group-name-es", "Tamaño");
    // "en" left blank.
    await el.updateComplete;
    click(el, "create-group");
    expect((await detail).name).toEqual({ es: "Tamaño" });
  });

  it("emits create-option-group as a bubbling, composed event", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups: [],
    });
    const seen = new Promise<Event>((resolve) =>
      el.addEventListener("create-option-group", resolve),
    );
    type(el, "group-name-es", "Tamaño");
    await el.updateComplete;
    click(el, "create-group");
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  // ── Inline edit an existing group ────────────────────────────────────────────────────────────

  it("emits update-option-group when a row's min changes", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
    });
    const detail = new Promise<{ id: string; patch: Record<string, unknown> }>((resolve) =>
      el.addEventListener("update-option-group", (e) => resolve((e as CustomEvent).detail)),
    );
    type(el, "group-min-g2", "1");
    expect(await detail).toEqual({ id: "g2", patch: { minSelect: 1 } });
  });

  it("emits update-option-group when a row's required switch toggles", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
    });
    const detail = new Promise<{ id: string; patch: Record<string, unknown> }>((resolve) =>
      el.addEventListener("update-option-group", (e) => resolve((e as CustomEvent).detail)),
    );
    toggle(el, "group-required-g2", true);
    expect(await detail).toEqual({ id: "g2", patch: { required: true } });
  });

  it("emits update-option-group when a row's active switch toggles", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
    });
    const detail = new Promise<{ id: string; patch: Record<string, unknown> }>((resolve) =>
      el.addEventListener("update-option-group", (e) => resolve((e as CustomEvent).detail)),
    );
    toggle(el, "group-active-g1", false);
    expect(await detail).toEqual({ id: "g1", patch: { active: false } });
  });

  it("emits update-option-group when a row's max or sort changes", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
    });
    let detail = new Promise<{ id: string; patch: Record<string, unknown> }>((resolve) =>
      el.addEventListener("update-option-group", (e) => resolve((e as CustomEvent).detail), {
        once: true,
      }),
    );
    type(el, "group-max-g1", "2");
    expect(await detail).toEqual({ id: "g1", patch: { maxSelect: 2 } });

    detail = new Promise((resolve) =>
      el.addEventListener("update-option-group", (e) => resolve((e as CustomEvent).detail), {
        once: true,
      }),
    );
    type(el, "group-sort-g1", "3");
    expect(await detail).toEqual({ id: "g1", patch: { sort: 3 } });
  });

  it("ignores a non-numeric min/max/sort edit (no event)", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
    });
    let fired = false;
    el.addEventListener("update-option-group", () => {
      fired = true;
    });
    type(el, "group-min-g1", "abc");
    await el.updateComplete;
    expect(fired).toBe(false);
  });

  // ── Group-form inline error (options.group_invalid, never a crash) ─────────────────────────────

  it("surfaces a groupError as a role=alert inline message, localised (never the raw code)", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups: [],
      groupError: "options.group_invalid",
    });
    const alert = el.shadowRoot!.querySelector("[data-test=group-error]")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain(codeMessage("options.group_invalid", "es-ES"));
    expect(alert.textContent).not.toContain("options.group_invalid");
  });

  it("renders no group error when groupError is null", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups: [],
      groupError: null,
    });
    expect(el.shadowRoot!.querySelector("[data-test=group-error]")).toBeNull();
  });

  it("shows newly-created groups once the screen reloads the groups prop (no crash)", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups: [],
    });
    expect(el.shadowRoot!.querySelectorAll("[data-test^=group-row-]").length).toBe(0);
    // Simulate the screen's reload after a successful create-option-group.
    el.groups = groups;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-test^=group-row-]").length).toBe(2);
  });

  // ── Items panel ──────────────────────────────────────────────────────────────────────────────

  it("does not render an items panel when no group is expanded", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
    });
    expect(el.shadowRoot!.querySelector("[data-test^=items-]")).toBeNull();
  });

  it("emits toggle-option-group-items with the group id on the Items button", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
    });
    const detail = new Promise<{ groupId: string }>((resolve) =>
      el.addEventListener("toggle-option-group-items", (e) => resolve((e as CustomEvent).detail)),
    );
    click(el, "toggle-items-g1");
    expect(await detail).toEqual({ groupId: "g1" });
  });

  it("renders the expanded group's items and shows them on reload", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
      expandedGroupId: "g1",
      items: [],
    });
    expect(el.shadowRoot!.querySelectorAll("[data-test^=item-row-]").length).toBe(0);
    // Simulate the screen's reload after a successful create-option-group-item.
    el.items = items;
    await el.updateComplete;
    const rows = el.shadowRoot!.querySelectorAll("[data-test^=item-row-]");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Pequeño");
    expect(rows[1]!.textContent).toContain("Grande");
  });

  it("renders the item VAT select with an inherit option + one per VAT class", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
      expandedGroupId: "g1",
      items,
    });
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=item-vat-i1]")!;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", "general", "reduced", "super_reduced", "zero"]);
    expect(select.value).toBe(""); // i1 has vatClass: null → inherit
  });

  // ── Create an item ───────────────────────────────────────────────────────────────────────────

  it("emits create-option-group-item for the expanded group with the typed fields", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
      expandedGroupId: "g1",
      items: [],
    });
    const detail = new Promise<{ groupId: string } & Record<string, unknown>>((resolve) =>
      el.addEventListener("create-option-group-item", (e) => resolve((e as CustomEvent).detail)),
    );
    type(el, "item-name-es", "Mediano");
    type(el, "item-new-price", "0.75");
    selectValue(el, "[data-test=item-new-vat]", "reduced");
    type(el, "item-new-sort", "2");
    toggle(el, "item-new-active", false);
    await el.updateComplete;
    click(el, "create-item");
    expect(await detail).toEqual({
      groupId: "g1",
      name: { es: "Mediano" },
      priceDelta: "0.75",
      vatClass: "reduced",
      sort: 2,
      active: false,
    });
  });

  it("emits create-option-group-item with vatClass null when inherit is left selected", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
      expandedGroupId: "g1",
      items: [],
    });
    const detail = new Promise<{ groupId: string } & Record<string, unknown>>((resolve) =>
      el.addEventListener("create-option-group-item", (e) => resolve((e as CustomEvent).detail)),
    );
    type(el, "item-name-es", "Mediano");
    await el.updateComplete;
    click(el, "create-item");
    expect((await detail).vatClass).toBeNull();
  });

  it("returns the new-item VAT picker to inherit (null) after picking a class then reverting", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
      expandedGroupId: "g1",
      items: [],
    });
    selectValue(el, "[data-test=item-new-vat]", "reduced");
    selectValue(el, "[data-test=item-new-vat]", "");
    await el.updateComplete;
    const detail = new Promise<{ groupId: string } & Record<string, unknown>>((resolve) =>
      el.addEventListener("create-option-group-item", (e) => resolve((e as CustomEvent).detail)),
    );
    type(el, "item-name-es", "Mediano");
    await el.updateComplete;
    click(el, "create-item");
    expect((await detail).vatClass).toBeNull();
  });

  // ── Inline edit an existing item ─────────────────────────────────────────────────────────────

  it("emits update-option-group-item when an item row's price delta changes", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
      expandedGroupId: "g1",
      items,
    });
    const detail = new Promise<{ groupId: string; itemId: string; patch: Record<string, unknown> }>(
      (resolve) =>
        el.addEventListener("update-option-group-item", (e) => resolve((e as CustomEvent).detail)),
    );
    type(el, "item-price-i1", "2.00");
    expect(await detail).toEqual({ groupId: "g1", itemId: "i1", patch: { priceDelta: "2.00" } });
  });

  it("emits update-option-group-item when an item row's VAT override changes", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
      expandedGroupId: "g1",
      items,
    });
    const detail = new Promise<{ groupId: string; itemId: string; patch: Record<string, unknown> }>(
      (resolve) =>
        el.addEventListener("update-option-group-item", (e) => resolve((e as CustomEvent).detail)),
    );
    selectValue(el, "[data-test=item-vat-i1]", "general");
    expect(await detail).toEqual({ groupId: "g1", itemId: "i1", patch: { vatClass: "general" } });
  });

  it("emits update-option-group-item with vatClass null when reverted to inherit", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
      expandedGroupId: "g1",
      items,
    });
    const detail = new Promise<{ groupId: string; itemId: string; patch: Record<string, unknown> }>(
      (resolve) =>
        el.addEventListener("update-option-group-item", (e) => resolve((e as CustomEvent).detail)),
    );
    selectValue(el, "[data-test=item-vat-i2]", "");
    expect(await detail).toEqual({ groupId: "g1", itemId: "i2", patch: { vatClass: null } });
  });

  it("emits update-option-group-item when an item row's sort or active changes", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
      expandedGroupId: "g1",
      items,
    });
    let detail = new Promise<{ groupId: string; itemId: string; patch: Record<string, unknown> }>(
      (resolve) =>
        el.addEventListener("update-option-group-item", (e) => resolve((e as CustomEvent).detail), {
          once: true,
        }),
    );
    type(el, "item-sort-i1", "9");
    expect(await detail).toEqual({ groupId: "g1", itemId: "i1", patch: { sort: 9 } });

    detail = new Promise((resolve) =>
      el.addEventListener("update-option-group-item", (e) => resolve((e as CustomEvent).detail), {
        once: true,
      }),
    );
    toggle(el, "item-active-i1", false);
    expect(await detail).toEqual({ groupId: "g1", itemId: "i1", patch: { active: false } });
  });

  it("surfaces an itemError as a role=alert inline message, localised", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups,
      expandedGroupId: "g1",
      items: [],
      itemError: "management.request_invalid",
    });
    const alert = el.shadowRoot!.querySelector("[data-test=item-error]")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain(codeMessage("management.request_invalid", "es-ES"));
  });

  // ── i18n ─────────────────────────────────────────────────────────────────────────────────────

  it("renders the create-group button label from the i18n layer", async () => {
    const { el } = await mountWidget<OptionGroupManager>("dashboard-option-group-manager", {
      groups: [],
    });
    expect(el.shadowRoot!.querySelector("[data-test=create-group]")!.textContent).toContain(
      t("action.create", "es-ES"),
    );
  });
});
