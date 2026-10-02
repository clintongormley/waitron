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
  { value: "public", label: "Público", description: "Se puede pedir por sí solo." },
  { value: "staff", label: "Solo personal", description: "Solo el personal puede pedirlo." },
  { value: "plain", label: "Sin descripción" },
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
      '<wt-combobox label="Pedido por separado" search="never" value="staff"></wt-combobox>',
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
      '<wt-combobox label="Pedido por separado" search="never" value="staff"></wt-combobox>',
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
      '<wt-combobox label="Pedido por separado" search="never" value="staff"></wt-combobox>',
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

  test("open, with groups", async () => {
    await openThemed('<wt-combobox label="Miembros"></wt-combobox>', theme, [
      { value: "ana", label: "Ana", group: "Personal" },
      { value: "luis", label: "Luis", group: "Personal" },
      { value: "bar", label: "Barra", group: "Puestos" },
    ]);
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
