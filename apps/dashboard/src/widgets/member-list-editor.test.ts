import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtModal } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import type { SectionMember } from "@waitron/catalogue/src/section-types.js";
import { chooseOption, middleWithin, textLines } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import: pulls the module in for its `@customElement` side effect.
import { MemberListEditor, sectionParents, sectionsHolding } from "./member-list-editor.js";
import { setLocale, t } from "../i18n/t.js";

afterEach(cleanupWidgets);

const products = [
  { id: "p-burger", name: "Burger" },
  { id: "p-lemonade", name: "Lemonade" },
  { id: "p-chips", name: "Chips" },
  { id: "p-salad", name: "Salad" },
];

/** Each section's customer names read differently from its internal name (CLAUDE.md §3), so a row
 * that showed the customer wording would fail rather than pass by coincidence. */
const sections = [
  { id: "s-drinks", internalName: "Drinks", names: { en: "Something to drink", es: "Bebidas" } },
  { id: "s-beer", internalName: "Beer", names: { en: "Cold beers", es: "Cervezas" } },
  { id: "s-favourites", internalName: "Favourites", names: { en: "Our picks", es: "Favoritos" } },
  { id: "s-desserts", internalName: "Desserts", names: { en: "Sweet things", es: "Postres" } },
];

const members = (): SectionMember[] => [
  { id: "m-burger", position: 0, ref: { kind: "product", productId: "p-burger" } },
  { id: "m-drinks", position: 1, ref: { kind: "section", sectionId: "s-drinks" } },
  { id: "m-lemonade", position: 2, ref: { kind: "product", productId: "p-lemonade" } },
];

async function mount(props: Partial<MemberListEditor> = {}) {
  const { el } = await mountWidget<MemberListEditor>("dashboard-member-list-editor", {
    members: members(),
    products,
    nodes: sections.map((section) => ({
      memberId: `m-${section.id.slice(2)}`,
      ref: { kind: "section" as const, sectionId: section.id },
      internalName: section.internalName,
      names: section.names,
      children: [],
    })),
    excludeSectionIds: ["s-favourites"],
    label: "Members of Lunch specials",
    ...props,
  });
  return el;
}

function q<T extends Element = HTMLElement>(el: MemberListEditor, selector: string): T {
  return el.shadowRoot!.querySelector<T>(selector)!;
}

function rowIds(el: MemberListEditor): (string | null)[] {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.getAttribute("data-member"),
  );
}

function capture<T>(el: HTMLElement, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

async function choose(el: MemberListEditor, value: string): Promise<void> {
  await chooseOption(memberBox(el), value);
  await el.updateComplete;
}

/** The option headings in the order the dropdown draws them. */
const headings = (el: MemberListEditor): string[] => [
  ...new Set(memberBox(el).options.flatMap((option) => (option.group ? [option.group] : []))),
];

type MemberBox = HTMLElement & {
  value: string;
  label: string;
  placeholder: string;
  search: string;
  error: string;
  required: boolean;
  disabled: boolean;
  options: { value: string; label: string; group?: string }[];
  updateComplete: Promise<unknown>;
};

const memberBox = (el: MemberListEditor): MemberBox =>
  q<MemberBox>(el, 'wt-combobox[name="member-ref"]');

/** What the closed dropdown shows on its trigger, not what its properties say it holds. */
async function shownMember(el: MemberListEditor): Promise<string | undefined> {
  const box = memberBox(el);
  await box.updateComplete;
  return box.shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
}

it("picks what to add from the shared dropdown, products then sections under their headings", async () => {
  const el = await mount({ sectionChoices: true });
  const adds = capture<{ ref: unknown }>(el, "wt-member-add");
  const box = memberBox(el);
  expect(box).not.toBeNull();
  expect(box.label).toBe(t("members.add_label"));
  expect(box.required).toBe(false);
  expect(box.search).toBe("auto");
  expect(box.placeholder).toBe(t("members.tile_placeholder"));
  expect(box.options).toEqual([
    { value: "", label: t("members.tile_placeholder") },
    { value: "product:p-chips", label: "Chips", group: t("members.products") },
    { value: "product:p-salad", label: "Salad", group: t("members.products") },
    { value: "section:s-beer", label: "Beer", group: t("members.sections") },
    { value: "section:s-desserts", label: "Desserts", group: t("members.sections") },
  ]);
  expect(box.value).toBe("");
  expect(await shownMember(el)).toBe(t("members.tile_placeholder"));
  await chooseOption(box, "section:s-beer");
  await el.updateComplete;
  expect(await shownMember(el)).toBe(t("members.tile_placeholder"));
  expect(adds).toEqual([{ ref: { kind: "section", sectionId: "s-beer" } }]);
});

it("replaces a missing member through the same dropdown, required and with no empty row", async () => {
  const el = await mount({
    members: [
      ...members(),
      { id: "m-gone", position: 3, ref: { kind: "missing", name: "Old special" } },
    ],
    replaceable: new Set(["m-gone"]),
  });
  const replaces = capture<{ memberId: string; ref: unknown }>(el, "wt-member-replace");
  q(el, '[data-test="replace-m-gone"]').click();
  await el.updateComplete;
  const box = memberBox(el);
  expect(box.label).toBe(t("action.replace"));
  expect(box.required).toBe(true);
  expect(box.placeholder).toBe(t("members.add_placeholder"));
  expect(box.options).toEqual([
    { value: "product:p-chips", label: "Chips", group: t("members.products") },
    { value: "product:p-salad", label: "Salad", group: t("members.products") },
  ]);
  q(el, '[data-test="add"]').click();
  await el.updateComplete;
  expect(box.error).toBe(t("members.tile_choose_first"));
  await chooseOption(box, "product:p-salad");
  await el.updateComplete;
  expect(box.error).toBe("");
  expect(await shownMember(el)).toBe("Salad");
  q(el, '[data-test="add"]').click();
  expect(replaces).toEqual([
    { memberId: "m-gone", ref: { kind: "product", productId: "p-salad" } },
  ]);
});

it("lists members in position order, naming each one's kind in text and a section by its internal name", async () => {
  const shuffled = members().reverse();
  const el = await mount({ members: shuffled });
  expect(rowIds(el)).toEqual(["m-burger", "m-drinks", "m-lemonade"]);
  const drinks = q(el, 'tr[data-member="m-drinks"]');
  expect(drinks.querySelector('[data-test="name"]')!.textContent!.trim()).toBe("Drinks");
  expect(drinks.querySelector('[data-test="kind"]')!.textContent!.trim()).toBe(
    t("members.kind_section"),
  );
  expect(drinks.textContent).not.toContain("Something to drink");
  expect(drinks.textContent).not.toContain("Bebidas");
  const burger = q(el, 'tr[data-member="m-burger"]');
  expect(burger.querySelector('[data-test="kind"]')!.textContent!.trim()).toBe(
    t("members.kind_product"),
  );
  expect(t("members.kind_product")).not.toBe(t("members.kind_section"));
  expect(q(el, ".table-wrap").getAttribute("aria-label")).toBe("Members of Lunch specials");
});

it("names a member whose product or section it was not given as unavailable, keeping its kind", async () => {
  const el = await mount({ products: [], nodes: [] });
  const burger = q(el, 'tr[data-member="m-burger"]');
  expect(burger.querySelector('[data-test="name"]')!.textContent!.trim()).toBe(
    t("members.missing"),
  );
  expect(burger.querySelector('[data-test="kind"]')!.textContent!.trim()).toBe(
    t("members.kind_product"),
  );
  const drinks = q(el, 'tr[data-member="m-drinks"]');
  expect(drinks.querySelector('[data-test="name"]')!.textContent!.trim()).toBe(
    t("members.missing"),
  );
});

it("moves the first row down on ArrowDown, reporting to: 1, and keeps focus on the moved row", async () => {
  const el = await mount();
  const moves = capture<{ memberId: string; to: number }>(el, "wt-member-move");
  const handle = q(el, '[data-test="drag-m-burger"]');
  handle.focus();
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await el.updateComplete;
  expect(moves).toEqual([{ memberId: "m-burger", to: 1 }]);
  expect(rowIds(el)).toEqual(["m-drinks", "m-burger", "m-lemonade"]);
  expect(el.shadowRoot!.activeElement).toBe(q(el, '[data-test="drag-m-burger"]'));

  // The host applies the move and hands the list back as new objects: focus stays put.
  el.members = [
    { id: "m-drinks", position: 0, ref: { kind: "section", sectionId: "s-drinks" } },
    { id: "m-burger", position: 1, ref: { kind: "product", productId: "p-burger" } },
    { id: "m-lemonade", position: 2, ref: { kind: "product", productId: "p-lemonade" } },
  ];
  await el.updateComplete;
  expect(rowIds(el)).toEqual(["m-drinks", "m-burger", "m-lemonade"]);
  expect(el.shadowRoot!.activeElement).toBe(q(el, '[data-test="drag-m-burger"]'));
});

it("labels each reorder handle with the member's name", async () => {
  const el = await mount();
  expect(q(el, '[data-test="drag-m-drinks"]').getAttribute("aria-label")).toBe(
    `${t("members.reorder")}: Drinks`,
  );
});

it("reports nothing when a drag continues after its member left the list", async () => {
  const el = await mount();
  const moves = capture(el, "wt-member-move");
  const handle = q(el, '[data-test="drag-m-burger"]');
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 7 }));
  // A refresh drops the member being dragged, mid-gesture.
  el.members = members().filter((member) => member.id !== "m-burger");
  await el.updateComplete;
  const box = q(el, 'tr[data-member="m-lemonade"]').getBoundingClientRect();
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 7,
      clientY: box.top + box.height / 2,
    }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7 }));
  await el.updateComplete;
  expect(moves).toEqual([]);
  expect(rowIds(el)).toEqual(["m-drinks", "m-lemonade"]);
});

/** Presses on a row's handle, crosses the rows named in `over` one by one, then ends the gesture. */
async function drag(
  el: MemberListEditor,
  memberId: string,
  over: string[],
  end: "pointerup" | "pointercancel" = "pointerup",
  seen?: unknown[],
): Promise<number[]> {
  const counts: number[] = [];
  q(el, `[data-test="drag-${memberId}"]`).dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerId: 9 }),
  );
  for (const target of over) {
    const box = q(el, `tr[data-member="${target}"]`).getBoundingClientRect();
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 9,
        clientY: box.top + box.height / 2,
      }),
    );
    await el.updateComplete;
    if (seen) counts.push(seen.length);
  }
  document.dispatchEvent(new PointerEvent(end, { bubbles: true, pointerId: 9 }));
  await el.updateComplete;
  return counts;
}

it("reports a pointer drag once, when it ends, with the row's final place", async () => {
  const el = await mount();
  const moves = capture<{ memberId: string; to: number }>(el, "wt-member-move");
  const during = await drag(el, "m-burger", ["m-drinks", "m-lemonade"], "pointerup", moves);
  // The rows follow the pointer while it moves, but nothing is reported until it lets go.
  expect(during).toEqual([0, 0]);
  expect(rowIds(el)).toEqual(["m-drinks", "m-lemonade", "m-burger"]);
  expect(moves).toEqual([{ memberId: "m-burger", to: 2 }]);
});

it("reports a cancelled drag's final place too, since the rows already moved", async () => {
  const el = await mount();
  const moves = capture<{ memberId: string; to: number }>(el, "wt-member-move");
  await drag(el, "m-lemonade", ["m-drinks"], "pointercancel");
  expect(rowIds(el)).toEqual(["m-burger", "m-lemonade", "m-drinks"]);
  expect(moves).toEqual([{ memberId: "m-lemonade", to: 1 }]);
});

it("reports nothing for a drag that ends where it started", async () => {
  const el = await mount();
  const moves = capture(el, "wt-member-move");
  await drag(el, "m-burger", ["m-drinks", "m-drinks"]);
  expect(rowIds(el)).toEqual(["m-burger", "m-drinks", "m-lemonade"]);
  await drag(el, "m-burger", []);
  expect(moves).toEqual([]);
});

it("reports nothing when the dragged member leaves the list before the drag ends", async () => {
  const el = await mount();
  const moves = capture(el, "wt-member-move");
  q(el, '[data-test="drag-m-burger"]').dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerId: 9 }),
  );
  const box = q(el, 'tr[data-member="m-drinks"]').getBoundingClientRect();
  document.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerId: 9, clientY: box.top + 1 }),
  );
  await el.updateComplete;
  el.members = members().filter((member) => member.id !== "m-burger");
  await el.updateComplete;
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9 }));
  await el.updateComplete;
  expect(moves).toEqual([]);
});

it("offers only products, leaving out held ones", async () => {
  const el = await mount();
  const groups = headings(el);
  expect(groups).toEqual([t("members.products")]);
  const texts = (group: string) =>
    memberBox(el)
      .options.filter((option) => option.group === group)
      .map((option) => option.label);
  // Burger and Lemonade are already held; Drinks is held and Favourites is excluded.
  expect(texts(groups[0]!)).toEqual(["Chips", "Salad"]);
  expect(groups).toHaveLength(1);
});

it("leaves out a heading with nothing under it", async () => {
  const el = await mount({ excludeSectionIds: ["s-beer", "s-favourites", "s-desserts"] });
  expect(headings(el)).toEqual([t("members.products")]);
});

it("adds the chosen product and resets the picker", async () => {
  const el = await mount();
  const adds = capture<{ ref: unknown }>(el, "wt-member-add");
  await choose(el, "product:p-chips");
  await el.updateComplete;
  expect(memberBox(el).value).toBe("");
  expect(await shownMember(el)).toBe(t("members.add_placeholder"));
  await choose(el, "product:p-salad");
  await el.updateComplete;
  expect(adds).toEqual([
    { ref: { kind: "product", productId: "p-chips" } },
    { ref: { kind: "product", productId: "p-salad" } },
  ]);
});

it.each([
  ["en", "Add a product", "Chips added."],
  ["es", "Añadir un producto", "Se ha añadido Chips."],
] as const)(
  "adds a menu product immediately and announces it in %s",
  async (locale, prompt, announcement) => {
    setLocale(locale);
    try {
      const el = await mount();
      const adds = capture<{ ref: unknown }>(el, "wt-member-add");
      const box = memberBox(el);
      expect(box.placeholder).toBe(prompt);
      expect(el.shadowRoot!.querySelector('[data-test="add"]')).toBeNull();

      box.shadowRoot!.querySelector<HTMLElement>("button.trigger")!.click();
      await box.updateComplete;
      [...box.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((row) => row.querySelector(".option-label")?.textContent?.trim() === "Chips")!
        .click();
      await el.updateComplete;

      expect(adds).toEqual([{ ref: { kind: "product", productId: "p-chips" } }]);
      expect(box.value).toBe("");
      expect(await shownMember(el)).toBe(prompt);
      expect(box.shadowRoot!.activeElement).toBe(box.shadowRoot!.querySelector("button.trigger"));
      expect(q(el, '[data-test="added-status"]').textContent!.trim()).toBe(announcement);
    } finally {
      setLocale("en");
      cleanupWidgets();
    }
  },
);

it("adds nothing when the menu picker closes without a choice", async () => {
  const el = await mount();
  const adds = capture(el, "wt-member-add");
  const box = memberBox(el);
  box.shadowRoot!.querySelector<HTMLElement>("button.trigger")!.click();
  await box.updateComplete;
  await userEvent.keyboard("{Escape}");
  await box.updateComplete;

  expect(adds).toEqual([]);
  expect(box.value).toBe("");
  expect(box.shadowRoot!.querySelector("button.trigger")!.getAttribute("aria-expanded")).toBe(
    "false",
  );
});

it("announces a section in Spanish without assuming its grammatical gender", async () => {
  setLocale("es");
  try {
    const el = await mount({ sectionChoices: true });
    await choose(el, "section:s-beer");
    expect(q(el, '[data-test="added-status"]').textContent!.trim()).toBe("Se ha añadido Beer.");
  } finally {
    setLocale("en");
    cleanupWidgets();
  }
});

it("announces a product again after the person removes and re-adds it", async () => {
  const el = await mount();
  const adds = capture(el, "wt-member-add");
  await choose(el, "product:p-chips");
  expect(q(el, '[data-test="added-status"]').textContent!.trim()).toBe("Chips added.");
  el.members = [
    ...members(),
    { id: "m-chips", position: 3, ref: { kind: "product", productId: "p-chips" } },
  ];
  await el.updateComplete;

  q(el, '[data-test="remove-m-chips"]').click();
  await el.updateComplete;
  expect(q(el, '[data-test="added-status"]').textContent!.trim()).toBe("");
  el.members = members();
  await el.updateComplete;
  await choose(el, "product:p-chips");
  expect(adds).toHaveLength(2);
  expect(q(el, '[data-test="added-status"]').textContent!.trim()).toBe("Chips added.");
});

it("adds nothing when the picker closes without a choice", async () => {
  const el = await mount();
  const adds = capture(el, "wt-member-add");
  const box = memberBox(el);
  box.shadowRoot!.querySelector<HTMLElement>("button.trigger")!.click();
  await box.updateComplete;
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  expect(adds).toEqual([]);
  expect(box.value).toBe("");
  expect(box.error).toBe("");
});

it("keeps the add picker within the standard form width in a modal on a wide window", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 800);
  try {
    const el = await mount({
      members: [
        ...members(),
        { id: "m-gone", position: 3, ref: { kind: "missing", name: "Old special" } },
      ],
      replaceable: new Set(["m-gone"]),
    });
    const modal = document.createElement("wt-modal") as WtModal;
    el.parentElement!.appendChild(modal);
    modal.appendChild(el);
    modal.open = true;
    await modal.updateComplete;
    await el.updateComplete;
    q(el, '[data-test="replace-m-gone"]').click();
    await el.updateComplete;
    q(el, '[data-test="add"]').click();
    await el.updateComplete;
    const probe = document.createElement("div");
    probe.style.width = "var(--wt-form-max-width)";
    el.shadowRoot!.appendChild(probe);
    const form = probe.getBoundingClientRect().width;
    expect(modal.shadowRoot!.querySelector(".body")!.clientWidth).toBeGreaterThan(form);
    const row = q(el, ".add").getBoundingClientRect();
    expect(row.width).toBeCloseTo(form, 0);
    const box = memberBox(el).shadowRoot!.querySelector(".field")!.getBoundingClientRect();
    expect(box.right - row.left).toBeLessThanOrEqual(form + 0.5);
    expect(box.width).toBeLessThanOrEqual(form);
    const error = memberBox(el).shadowRoot!.querySelector("[data-error]")!.getBoundingClientRect();
    expect(error.width).toBeCloseTo(box.width, 0);
    expect(error.width).toBeLessThanOrEqual(form);
  } finally {
    await page.viewport(width, height);
  }
});

it("removes a member and opens a section member, stopping the click that asked", async () => {
  const el = await mount();
  const removes = capture(el, "wt-member-remove");
  const opens = capture(el, "wt-member-open");
  const clicks: Event[] = [];
  el.addEventListener("click", (event) => clicks.push(event));
  q(el, '[data-test="remove-m-lemonade"]').click();
  q(el, '[data-test="open-m-drinks"]').click();
  expect(removes).toEqual([{ memberId: "m-lemonade" }]);
  expect(opens).toEqual([{ sectionId: "s-drinks" }]);
  expect(clicks).toEqual([]);
  // A product has nothing to open.
  expect(el.shadowRoot!.querySelector('[data-test="open-m-burger"]')).toBeNull();
  expect(q(el, '[data-test="actions-m-lemonade"]').getAttribute("label")).toBe(
    `${t("members.actions")}: Lemonade`,
  );
});

it("offers no Open action when its host says a section member is not opened from this list", async () => {
  const el = await mount({ openable: false });
  expect(el.shadowRoot!.querySelector('[data-test="open-m-drinks"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="remove-m-drinks"]')).not.toBeNull();
});

it("shows a note its host gives for a member under that member's name, and none for the others", async () => {
  const el = await mount({ notes: new Map([["m-drinks", "Not on this menu"]]) });
  const drinks = q(el, 'tr[data-member="m-drinks"]');
  expect(drinks.querySelector('[data-test="note"]')!.textContent!.trim()).toBe("Not on this menu");
  expect(drinks.querySelector('[data-test="name"]')!.textContent).toContain("Drinks");
  expect(q(el, 'tr[data-member="m-burger"]').querySelector('[data-test="note"]')).toBeNull();
});

it("names the list a removal takes the member out of, when it is given one", async () => {
  const unnamed = await mount();
  expect(q(unnamed, '[data-test="remove-m-lemonade"]').textContent!.trim()).toBe(
    t("members.remove"),
  );
  const named = await mount({ listName: "Drinks" });
  expect(q(named, '[data-test="remove-m-lemonade"]').textContent!.trim()).toBe(
    t("members.remove_from").replace("{list}", "Drinks"),
  );
});

it("while busy, disables every control and reports nothing", async () => {
  const el = await mount({ busy: true });
  const seen: string[] = [];
  for (const type of ["wt-member-add", "wt-member-remove", "wt-member-open", "wt-member-move"])
    el.addEventListener(type, () => seen.push(type));
  expect(memberBox(el).disabled).toBe(true);
  expect(q<HTMLButtonElement>(el, '[data-test="drag-m-burger"]').disabled).toBe(true);
  memberBox(el).dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "product:p-chips" },
      bubbles: true,
      composed: true,
    }),
  );
  q(el, '[data-test="remove-m-burger"]').click();
  q(el, '[data-test="open-m-drinks"]').click();
  q(el, '[data-test="drag-m-burger"]').dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(memberBox(el).error).toBe("");
  expect(q(el, '[data-test="added-status"]').textContent!.trim()).toBe("");
});

it("says the list is empty and still offers everything not excluded", async () => {
  const el = await mount({ members: [] });
  expect(rowIds(el)).toEqual([]);
  expect(q(el, '[data-test="empty"]').textContent!.trim()).toBe(t("members.empty"));
  const options = memberBox(el)
    .options.filter((option) => option.group)
    .map((option) => option.label);
  expect(options).toEqual(["Burger", "Chips", "Lemonade", "Salad"]);
});

it("drops a newly added product from the picker once the list holds it", async () => {
  const el = await mount();
  const adds = capture(el, "wt-member-add");
  await choose(el, "product:p-chips");
  expect(adds).toEqual([{ ref: { kind: "product", productId: "p-chips" } }]);
  el.members = [
    ...members(),
    { id: "m-chips", position: 3, ref: { kind: "product", productId: "p-chips" } },
  ];
  await el.updateComplete;
  expect(memberBox(el).value).toBe("");
  expect(await shownMember(el)).toBe(t("members.add_placeholder"));
  expect(memberBox(el).options.some((option) => option.value === "product:p-chips")).toBe(false);
  expect(adds).toHaveLength(1);
});

it("keeps an available product on offer when the list changes around it", async () => {
  const el = await mount();
  const adds = capture(el, "wt-member-add");
  await choose(el, "product:p-salad");
  expect(adds).toEqual([{ ref: { kind: "product", productId: "p-salad" } }]);
  el.members = members().filter((member) => member.id !== "m-lemonade");
  await el.updateComplete;
  expect(memberBox(el).value).toBe("");
  expect(await shownMember(el)).toBe(t("members.add_placeholder"));
  expect(memberBox(el).options.some((option) => option.value === "product:p-salad")).toBe(true);
  expect(adds).toEqual([{ ref: { kind: "product", productId: "p-salad" } }]);
});

it("keeps a replacement choice while an unrelated member changes", async () => {
  const el = await mount({
    members: [
      ...members(),
      { id: "m-gone", position: 3, ref: { kind: "missing", name: "Old special" } },
    ],
    replaceable: new Set(["m-gone"]),
  });
  const replaces = capture<{ memberId: string; ref: unknown }>(el, "wt-member-replace");
  q(el, '[data-test="replace-m-gone"]').click();
  await el.updateComplete;
  await choose(el, "product:p-salad");
  el.members = [
    ...members().filter((member) => member.id !== "m-lemonade"),
    { id: "m-gone", position: 2, ref: { kind: "missing", name: "Old special" } },
  ];
  await el.updateComplete;
  expect(memberBox(el).value).toBe("product:p-salad");
  expect(await shownMember(el)).toBe("Salad");
  q(el, '[data-test="add"]').click();
  expect(replaces).toEqual([
    { memberId: "m-gone", ref: { kind: "product", productId: "p-salad" } },
  ]);
});

it("finds the section and every section holding it however deep, even round a loop", () => {
  const holds = (id: string, ...sectionIds: string[]) => ({
    id,
    members: sectionIds.map((sectionId, position) => ({
      id: `${id}-${sectionId}`,
      position,
      ref: { kind: "section" as const, sectionId },
    })),
  });
  const parents = sectionParents([
    holds("s-fav", "s-drinks"),
    holds("s-drinks", "s-beer"),
    holds("s-bar", "s-beer"),
    holds("s-beer"),
    holds("s-a", "s-b"),
    holds("s-b", "s-a"),
  ]);
  expect(sectionsHolding(parents, "s-beer").sort()).toEqual([
    "s-bar",
    "s-beer",
    "s-drinks",
    "s-fav",
  ]);
  expect(sectionsHolding(parents, "s-fav")).toEqual(["s-fav"]);
  expect(sectionsHolding(parents, "s-a").sort()).toEqual(["s-a", "s-b"]);
});

it.each(["light", "dark"] as const)(
  "matches row controls with a themed full-size included-menu link in %s",
  async (theme) => {
    const { el } = await mountWidget<MemberListEditor>(
      "dashboard-member-list-editor",
      {
        members: [
          { id: "included", position: 0, ref: { kind: "section", sectionId: "drinks-root" } },
        ],
        nodes: [
          {
            memberId: "included",
            ref: { kind: "section", sectionId: "drinks-root" },
            internalName: "Drinks",
            includedMenuId: "drinks",
            children: [],
          },
        ],
        label: "Lunch",
      },
      theme,
    );
    const actions =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>("wt-row-actions")!;
    await actions.updateComplete;
    actions.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    const link = actions.querySelector<HTMLAnchorElement>("a")!;
    el.style.setProperty("--wt-color-text", "rgb(17, 93, 201)");
    expect(link.getAttribute("href")).toBe("/manage/menus/menu/drinks/view/structure");
    expect(getComputedStyle(link).color).toBe("rgb(17, 93, 201)");
    const remove = actions.querySelector<HTMLElementTagNameMap["wt-button"]>("wt-button")!;
    await remove.updateComplete;
    const control = remove.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(link.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    expect(getComputedStyle(link).padding).toBe(getComputedStyle(control).padding);
    expect(getComputedStyle(link).fontWeight).toBe(getComputedStyle(control).fontWeight);
    link.focus();
    expect(el.shadowRoot!.activeElement).toBe(link);
    expect(getComputedStyle(link).outlineStyle).not.toBe("none");
  },
);

it("describes both tile choices in the Home mode and products alone in structural mode", async () => {
  const el = await mount({ sectionChoices: true });
  const prompt = () => memberBox(el).options.find((option) => option.value === "")?.label;
  expect(prompt()).toBe(t("members.tile_placeholder"));
  expect(memberBox(el).placeholder).toBe(t("members.tile_placeholder"));
  el.sectionChoices = false;
  await el.updateComplete;
  expect(prompt()).toBe(t("members.add_placeholder"));
  expect(memberBox(el).placeholder).toBe(t("members.add_placeholder"));
});

it.each([
  [1280, "light"],
  [1280, "dark"],
  [390, "light"],
  [390, "dark"],
] as const)(
  "puts a member's grip, kind and row menu on the first line of a wrapping name with a note at %ipx (%s)",
  async (frame, theme) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(frame, 844);
    try {
      const { el } = await mountWidget<MemberListEditor>(
        "dashboard-member-list-editor",
        {
          members: members(),
          products: [
            {
              id: "p-burger",
              name: "Beef burger on a brioche bun with cheddar, pickles, lettuce, tomato and the house sauce, ".repeat(
                4,
              ),
            },
            ...products.slice(1),
          ],
          notes: new Map([["m-burger", "Not on this menu"]]),
          label: "Members of Lunch specials",
        },
        theme,
      );
      expect(el.parentElement!.getAttribute("data-theme")).toBe(theme);
      const row = q(el, 'tr[data-member="m-burger"]');
      const name = row.querySelector('[data-test="name"]')!;
      const handle = row.querySelector<HTMLElement>(".handle")!;

      expect(window.innerWidth).toBe(frame);
      expect(row.getBoundingClientRect().height).toBeGreaterThan(
        handle.getBoundingClientRect().height * 1.5,
      );
      expect(textLines(name).length, "the name wraps").toBeGreaterThan(1);
      expect(row.querySelector('[data-test="note"]')).not.toBeNull();
      const line = textLines(name)[0]!;
      const within = middleWithin(line);
      const icon = (handle.querySelector("wt-icon") ?? handle).getBoundingClientRect();
      const menu = row.querySelector("wt-row-actions")!.getBoundingClientRect();
      const kind = textLines(row.querySelector('[data-test="kind"]')!)[0]!;
      expect(
        { icon: within(icon), menu: within(menu), kind: within(kind) },
        JSON.stringify({ line, icon, menu, kind }),
      ).toEqual({ icon: true, menu: true, kind: true });
    } finally {
      await page.viewport(width, height);
    }
  },
);
