import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-combobox.js";
import type { ComboboxOption, WtCombobox } from "./wt-combobox.js";
import { registerIcons } from "./wt-icon.js";

afterEach(cleanup);

registerIcons({
  check: "M2 8 L6 12 L14 4",
  "chevron-down": "M3 6 L8 11 L13 6",
  leaf: "M2 14 L14 2",
});

async function openThemed(
  html: string,
  theme: "light" | "dark",
  options: ComboboxOption[] = TAGS,
): Promise<WtCombobox> {
  const el = (await mountThemed(html, theme)) as WtCombobox;
  el.options = options;
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
  return el;
}

const TAGS = [
  { value: "gluten-free", label: "Gluten-free" },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
];

const DESCRIBED: ComboboxOption[] = [
  { value: "public", label: "Public", description: "Can be ordered on its own." },
  { value: "staff", label: "Staff only", description: "Only staff can order it." },
  { value: "plain", label: "Plain" },
];

// axe scores no contrast inside an aria-disabled row (a disabled row drawn in the panel's own colour
// passed every case below), so these cases measure the greyed text themselves. The parser reads
// rgb()/rgba() only, which is why each colour is checked for that form first.
function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgba?\(/);
    const [r, g, bl] = rgb
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => Number(part) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** The disabled row's label and second line against the panel, which a disabled row never repaints. */
function expectReadableDisabledRow(el: WtCombobox): void {
  const row = el.shadowRoot!.querySelector<HTMLElement>('[aria-disabled="true"]')!;
  const panel = getComputedStyle(el.shadowRoot!.querySelector("[popover]")!).backgroundColor;
  expect(getComputedStyle(row).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  for (const part of [".option-label", ".option-description"]) {
    const color = getComputedStyle(row.querySelector(part)!).color;
    expect(contrastRatio(color, panel)).toBeGreaterThanOrEqual(4.5);
  }
}

const WITH_DISABLED: ComboboxOption[] = [
  { value: "pan", label: "Pan de centeno" },
  {
    value: "vino",
    label: "Vino",
    disabled: true,
    description: "Tiene variantes, así que no puede ser un extra",
  },
];

describe.each(["light", "dark"] as const)("wt-combobox a11y (%s theme)", (theme) => {
  test("closed, empty", async () => {
    await mountThemed('<wt-combobox label="Dietary tags"></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  // No visible `label` — the accessible name has to come from the forwarded aria-label fallback.
  test("closed, named via aria-label", async () => {
    await mountThemed('<wt-combobox aria-label="Dietary tags"></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  test("open with results", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await expectNoA11yViolations(host);
  });

  test("open with the add row showing", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags" allow-add></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
    await expectNoA11yViolations(host);
  });

  test("open with no matches and allowAdd off", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
    await expectNoA11yViolations(host);
  });

  test("multiple, with a selection", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    el.values = ["vegan"];
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await expectNoA11yViolations(host);
  });

  test("invalid, with an error message", async () => {
    await mountThemed(
      '<wt-combobox label="Dietary tags" invalid error="Choose at least one tag"></wt-combobox>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    await mountThemed('<wt-combobox label="Dietary tags" disabled></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  test("required", async () => {
    await mountThemed('<wt-combobox label="Dietary tags" required></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });
  test("closed, with a value chosen", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Etiquetas" value="vegan"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("open, with the chosen row ticked", async () => {
    await openThemed('<wt-combobox label="Etiquetas" value="vegan"></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  test("open, with icons", async () => {
    await openThemed('<wt-combobox label="Etiquetas"></wt-combobox>', theme, [
      { value: "vegan", label: "Vegano", icon: "leaf" },
      { value: "halal", label: "Halal", icon: "check" },
    ]);
    await expectNoA11yViolations(host);
  });

  test("open, with options described by a second line", async () => {
    const el = await openThemed(
      '<wt-combobox label="Standalone ordering" search="never" value="staff"></wt-combobox>',
      theme,
      DESCRIBED,
    );
    // Without this the scan could pass on a list that drew no descriptions.
    expect(el.shadowRoot!.querySelectorAll(".option-description")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  // A hovered row is painted --wt-color-bg, so its description is muted text on a different colour
  // from the panel's.
  test("open, with the cursor over a described row", async () => {
    const el = await openThemed(
      '<wt-combobox label="Standalone ordering" search="never" value="staff"></wt-combobox>',
      theme,
      DESCRIBED,
    );
    const row = el.shadowRoot!.querySelector<HTMLElement>('[role="option"]')!;
    await userEvent.hover(row);
    expect(row.matches(":hover")).toBe(true);
    expect(row.querySelector(".option-description")).not.toBeNull();
    expect(getComputedStyle(row).backgroundColor).toBe(getComputedStyle(host).backgroundColor);
    await expectNoA11yViolations(host);
  });

  test("opened from the keyboard, with a described row active", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Standalone ordering" search="never" value="staff"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = DESCRIBED;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>(".trigger")!.focus();
    await userEvent.keyboard("{ArrowDown}");
    const active = el.shadowRoot!.querySelector(".option.active")!;
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.querySelector(".option-description")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("closed, with a disabled option among the options and chosen", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Producto" value="vino"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = WITH_DISABLED;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe("Vino");
    await expectNoA11yViolations(host);
  });

  test("open, with a disabled option and its second line", async () => {
    const el = await openThemed(
      '<wt-combobox label="Producto"></wt-combobox>',
      theme,
      WITH_DISABLED,
    );
    // Without this the scan could pass on a list that drew no disabled row.
    const disabled = el.shadowRoot!.querySelector('[aria-disabled="true"]')!;
    expect(disabled.querySelector(".option-description")).not.toBeNull();
    await expectNoA11yViolations(host);
    expectReadableDisabledRow(el);
  });

  test("open, with the cursor over a disabled row", async () => {
    const el = await openThemed(
      '<wt-combobox label="Producto" search="never"></wt-combobox>',
      theme,
      WITH_DISABLED,
    );
    const row = el.shadowRoot!.querySelector<HTMLElement>('[aria-disabled="true"]')!;
    await userEvent.hover(row, { force: true });
    expect(row.matches(":hover")).toBe(true);
    await expectNoA11yViolations(host);
    expectReadableDisabledRow(el);
  });

  test("opened from the keyboard, with a disabled row active", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Producto" search="never"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = WITH_DISABLED;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>(".trigger")!.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    const active = el.shadowRoot!.querySelector(".option.active")!;
    expect(active.getAttribute("aria-disabled")).toBe("true");
    await expectNoA11yViolations(host);
    expectReadableDisabledRow(el);
  });

  test("open, with groups", async () => {
    await openThemed('<wt-combobox label="Miembros"></wt-combobox>', theme, [
      { value: "ana", label: "Ana", group: "Personal" },
      { value: "luis", label: "Luis", group: "Personal" },
      { value: "bar", label: "Barra", group: "Puestos" },
    ]);
    await expectNoA11yViolations(host);
  });

  const WITH_PRIMARY: ComboboxOption[] = [
    { value: "pan", label: "Pan extra", group: "Extras" },
    { value: "new-extras", label: "Nueva lista de extras…", group: "Extras", primary: true },
    { value: "coccion", label: "Punto", group: "Opciones" },
    { value: "new-options", label: "Nueva lista de opciones…", group: "Opciones", primary: true },
  ];

  test("open, with a primary row in each group", async () => {
    const el = await openThemed('<wt-combobox label="Modificadores"></wt-combobox>', theme, [
      ...WITH_PRIMARY.slice(0, 2).map((option) => ({ ...option, icon: "leaf" })),
      ...WITH_PRIMARY.slice(2),
    ]);
    // Without this the scan could pass on a list that painted no row in the primary colour.
    const [plain, primary] = el.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]');
    expect(getComputedStyle(primary!).color).not.toBe(getComputedStyle(plain!).color);
    await expectNoA11yViolations(host);
  });

  test("open, with the cursor over a primary row", async () => {
    const el = await openThemed(
      '<wt-combobox label="Modificadores" search="never"></wt-combobox>',
      theme,
      WITH_PRIMARY,
    );
    const [plain, row] = el.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]');
    await userEvent.hover(row!);
    expect(row!.matches(":hover")).toBe(true);
    expect(getComputedStyle(row!).backgroundColor).toBe(getComputedStyle(host).backgroundColor);
    expect(getComputedStyle(row!).color).not.toBe(getComputedStyle(plain!).color);
    await expectNoA11yViolations(host);
  });

  test("opened from the keyboard, with a primary row active", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Modificadores" search="never"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = WITH_PRIMARY;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>(".trigger")!.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    const active = el.shadowRoot!.querySelector(".option.active")!;
    expect(active.textContent!.trim()).toBe("Nueva lista de extras…");
    const plain = el.shadowRoot!.querySelector('[role="option"]')!;
    expect(getComputedStyle(active).color).not.toBe(getComputedStyle(plain).color);
    await expectNoA11yViolations(host);
  });

  test("open, with an action row", async () => {
    await openThemed('<wt-combobox label="Unidad" value="kg"></wt-combobox>', theme, [
      { value: "kg", label: "Kilogramo" },
      { value: "add-unit", label: "Añadir unidad…", action: true },
    ]);
    await expectNoA11yViolations(host);
  });

  test("open, without a search box", async () => {
    await openThemed('<wt-combobox label="Papel" search="never"></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  test("open, with focus back on the trigger", async () => {
    const el = await openThemed('<wt-combobox label="Etiquetas"></wt-combobox>', theme);
    el.shadowRoot!.querySelector<HTMLElement>(".trigger")!.focus();
    await expectNoA11yViolations(host);
  });

  test("compact, with its label hidden", async () => {
    await mountThemed('<wt-combobox label="Plato" hide-label></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  test("with a hint shown as the placeholder", async () => {
    await mountThemed(
      '<wt-combobox label="Etiquetas" hint="Elige la principal"></wt-combobox>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with a help button beside it", async () => {
    await mountThemed(
      '<wt-combobox label="Etiquetas"><button slot="help" aria-label="Ayuda">?</button></wt-combobox>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("disabled, with a value chosen", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Etiquetas" value="vegan" disabled></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
  test("opened from the keyboard without a search box, focus on the list and a row active", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Papel" search="never" value="vegan"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>(".trigger")!.focus();
    await userEvent.keyboard("{ArrowDown}");
    const list = el.shadowRoot!.querySelector('[role="listbox"]')!;
    expect(el.shadowRoot!.activeElement).toBe(list);
    expect(list.getAttribute("aria-activedescendant")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  const TREE: ComboboxOption[] = [
    { value: "", label: "Sin categoría" },
    { value: "bebidas", label: "Bebidas", valueLabel: "Bebidas", depth: 0 },
    { value: "alcohol", label: "Con alcohol", valueLabel: "Bebidas › Con alcohol", depth: 1 },
    {
      value: "cocteles",
      label: "Cócteles",
      valueLabel: "Bebidas › Con alcohol › Cócteles",
      depth: 2,
    },
  ];

  test("open, with rows indented by depth", async () => {
    const el = await openThemed(
      '<wt-combobox label="Categoría" value="cocteles"></wt-combobox>',
      theme,
      TREE,
    );
    // Without this the scan could pass on a list that indented nothing.
    const [, , , deepest] = el.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]');
    expect(parseFloat(getComputedStyle(deepest!).paddingInlineStart)).toBeGreaterThan(
      parseFloat(
        getComputedStyle(el.shadowRoot!.querySelector('[role="option"]')!).paddingInlineStart,
      ),
    );
    await expectNoA11yViolations(host);
  });

  async function mountLink(attrs: string): Promise<WtCombobox> {
    const el = (await mountThemed(
      `<wt-combobox label="Categoría" appearance="link" ${attrs}></wt-combobox>`,
      theme,
    )) as WtCombobox;
    el.options = TREE;
    el.actionLabel = "Cambiar";
    await el.updateComplete;
    // Without this the scan could pass on a field-box trigger.
    expect(el.shadowRoot!.querySelector(".field")).toBeNull();
    return el;
  }

  test("link appearance, closed, with a value chosen", async () => {
    await mountLink('value="cocteles"');
    await expectNoA11yViolations(host);
  });

  test("link appearance, closed, with nothing chosen", async () => {
    await mountLink('show-empty-option value=""');
    await expectNoA11yViolations(host);
  });

  test("link appearance, focused", async () => {
    const el = await mountLink('value="cocteles"');
    el.focus();
    await expectNoA11yViolations(host);
  });

  test("link appearance, open", async () => {
    const el = await mountLink('value="cocteles"');
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    expect(el.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    await expectNoA11yViolations(host);
  });

  test("link appearance, with an error", async () => {
    await mountLink('value="cocteles" error="Elige una categoría"');
    await expectNoA11yViolations(host);
  });

  test("link appearance, disabled", async () => {
    await mountLink('value="cocteles" disabled');
    await expectNoA11yViolations(host);
  });

  test("opened from the keyboard with a search box and a row active", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Etiquetas" value="vegan"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>(".trigger")!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(
      el.shadowRoot!.querySelector(".search")!.getAttribute("aria-activedescendant"),
    ).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
