import { afterEach, expect, it } from "vitest";
import type { SectionMember } from "@waitron/catalogue/src/section-types.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import: pulls the module in for its `@customElement` side effect.
import { MemberListEditor, sectionParents, sectionsHolding } from "./member-list-editor.js";
import { t } from "../i18n/t.js";

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
    sections,
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
  const select = q<HTMLSelectElement>(el, 'select[name="member-ref"]');
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
}

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
  const el = await mount({ products: [], sections: [] });
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

it("offers products and sections under separate headings, leaving out held and excluded ones", async () => {
  const el = await mount();
  const groups = [...el.shadowRoot!.querySelectorAll("optgroup")];
  expect(groups.map((group) => group.label)).toEqual([
    t("members.products"),
    t("members.sections"),
  ]);
  const texts = (group: HTMLOptGroupElement) =>
    [...group.querySelectorAll("option")].map((option) => option.textContent!.trim());
  // Burger and Lemonade are already held; Drinks is held and Favourites is excluded.
  expect(texts(groups[0]!)).toEqual(["Chips", "Salad"]);
  expect(texts(groups[1]!)).toEqual(["Beer", "Desserts"]);
});

it("leaves out a heading with nothing under it", async () => {
  const el = await mount({ excludeSectionIds: ["s-beer", "s-favourites", "s-desserts"] });
  const groups = [...el.shadowRoot!.querySelectorAll("optgroup")];
  expect(groups.map((group) => group.label)).toEqual([t("members.products")]);
});

it("adds the chosen product or section and resets the picker", async () => {
  const el = await mount();
  const adds = capture<{ ref: unknown }>(el, "wt-member-add");
  await choose(el, "section:s-beer");
  q(el, '[data-test="add"]').click();
  await el.updateComplete;
  expect(q<HTMLSelectElement>(el, 'select[name="member-ref"]').value).toBe("");
  await choose(el, "product:p-salad");
  q(el, '[data-test="add"]').click();
  await el.updateComplete;
  expect(adds).toEqual([
    { ref: { kind: "section", sectionId: "s-beer" } },
    { ref: { kind: "product", productId: "p-salad" } },
  ]);
});

it("explains, rather than adding, when Add is pressed with nothing chosen", async () => {
  const el = await mount();
  const adds = capture(el, "wt-member-add");
  q(el, '[data-test="add"]').click();
  await el.updateComplete;
  expect(adds).toEqual([]);
  const error = q(el, '[data-test="add-error"]');
  expect(error.textContent!.trim()).toBe(t("members.choose_first"));
  const select = q(el, 'select[name="member-ref"]');
  expect(select.getAttribute("aria-invalid")).toBe("true");
  expect(select.getAttribute("aria-describedby")).toBe(error.id);
  await choose(el, "product:p-chips");
  expect(el.shadowRoot!.querySelector('[data-test="add-error"]')).toBeNull();
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
  expect(q<HTMLSelectElement>(el, 'select[name="member-ref"]').disabled).toBe(true);
  expect(q<HTMLButtonElement>(el, '[data-test="drag-m-burger"]').disabled).toBe(true);
  expect((q(el, '[data-test="add"]') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
  q(el, '[data-test="add"]').click();
  q(el, '[data-test="remove-m-burger"]').click();
  q(el, '[data-test="open-m-drinks"]').click();
  q(el, '[data-test="drag-m-burger"]').dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(el.shadowRoot!.querySelector('[data-test="add-error"]')).toBeNull();
});

it("says the list is empty and still offers everything not excluded", async () => {
  const el = await mount({ members: [] });
  expect(rowIds(el)).toEqual([]);
  expect(q(el, '[data-test="empty"]').textContent!.trim()).toBe(t("members.empty"));
  const options = [...el.shadowRoot!.querySelectorAll("optgroup option")].map((option) =>
    option.textContent!.trim(),
  );
  expect(options).toEqual(["Burger", "Chips", "Lemonade", "Salad", "Beer", "Desserts", "Drinks"]);
});

it("drops a chosen product once the list comes to hold it, so Add explains rather than repeats it", async () => {
  const el = await mount();
  const adds = capture(el, "wt-member-add");
  await choose(el, "product:p-chips");
  el.members = [
    ...members(),
    { id: "m-chips", position: 3, ref: { kind: "product", productId: "p-chips" } },
  ];
  await el.updateComplete;
  expect(q<HTMLSelectElement>(el, 'select[name="member-ref"]').value).toBe("");
  q(el, '[data-test="add"]').click();
  await el.updateComplete;
  expect(adds).toEqual([]);
  expect(q(el, '[data-test="add-error"]')).not.toBeNull();
});

it("keeps a choice that is still on offer when the list changes around it", async () => {
  const el = await mount();
  const adds = capture(el, "wt-member-add");
  await choose(el, "section:s-desserts");
  el.members = members().filter((member) => member.id !== "m-lemonade");
  await el.updateComplete;
  expect(q<HTMLSelectElement>(el, 'select[name="member-ref"]').value).toBe("section:s-desserts");
  q(el, '[data-test="add"]').click();
  expect(adds).toEqual([{ ref: { kind: "section", sectionId: "s-desserts" } }]);
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
