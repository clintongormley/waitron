import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host, mount } from "@waitron/ui/src/test-helpers.js";
import { parseBlocks } from "../paint-rules.js";
import type { StaffingBlock } from "../slots.js";
import type { StaffRole } from "../staffing-types.js";
import type { StaffingChange, StaffingGrid } from "./staffing-grid.js";
import "./staffing-grid.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  setLocale("en");
});

const staffRoles: StaffRole[] = [
  { id: "hc", name: "Head chef", colour: "purple", position: 0, holderIds: [] },
  { id: "sc", name: "Sous chef", colour: "green", position: 1, holderIds: [] },
  { id: "dw", name: "Dishwasher", colour: "amber", position: 2, holderIds: [] },
];
const headChef: StaffingBlock = {
  staffRoleId: "hc",
  headcount: 1,
  startsAt: "09:00",
  endsAt: "16:30",
};
const sous: StaffingBlock = { staffRoleId: "sc", headcount: 2, startsAt: "09:00", endsAt: "15:00" };
const labels: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday" };

async function grid(
  days: Record<string, StaffingBlock[] | null> = { mon: [], tue: [headChef] },
  options: Partial<
    Pick<StaffingGrid, "chosen" | "headcount" | "followable" | "guides" | "readOnly">
  > = {},
) {
  const el = (await mount("<staffing-grid></staffing-grid>")) as StaffingGrid;
  el.columns = Object.keys(days).map((key) => ({ key, label: labels[key] ?? key }));
  el.days = new Map(Object.entries(days));
  el.staffRoles = staffRoles;
  el.cutover = "06:00";
  el.chosen = "chosen" in options ? options.chosen : "sc";
  el.headcount = options.headcount ?? 1;
  el.followable = options.followable ?? false;
  el.readOnly = options.readOnly ?? false;
  if (options.guides) el.guides = options.guides;
  await el.updateComplete;
  return el;
}

function column(el: StaffingGrid, key: string) {
  return el.shadowRoot!.querySelector<HTMLElement>(`.day[data-column="${key}"]`)!;
}
function point(
  el: StaffingGrid,
  key: string,
  minute: number,
  type: string,
  target?: EventTarget,
  pointerId = 7,
) {
  const box = column(el, key).getBoundingClientRect();
  pointAt(el, key, box.top + (minute / 1440) * box.height, type, target, pointerId);
}
function pointAt(
  el: StaffingGrid,
  key: string,
  clientY: number,
  type: string,
  target?: EventTarget,
  pointerId = 7,
) {
  const box = column(el, key).getBoundingClientRect();
  (target ?? (type === "pointerdown" ? column(el, key) : window)).dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId,
      button: 0,
      clientX: box.left + box.width / 2,
      clientY,
    }),
  );
}
async function drag(el: StaffingGrid, key: string, from: number, to: number, target?: Element) {
  point(el, key, from, "pointerdown", target);
  point(el, key, to, "pointermove");
  await el.updateComplete;
  point(el, key, to, "pointerup");
  await el.updateComplete;
}
function changes(el: StaffingGrid) {
  const result: StaffingChange[] = [];
  el.addEventListener("staffing-change", (event) => result.push(event.detail));
  return result;
}
function block(el: StaffingGrid, key: string, index = 0) {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(
    `.day[data-column="${key}"] button.block[data-index="${index}"]`,
  )!;
}
function edge(el: StaffingGrid, key: string, index: number, side: "start" | "end") {
  return block(el, key, index).querySelector<HTMLElement>(`.edge[data-edge="${side}"]`)!;
}
function menu(el: StaffingGrid) {
  return el.shadowRoot!.querySelector<HTMLElement>(".menu")!;
}
function menuButton(el: StaffingGrid, label: string) {
  return [...menu(el).querySelectorAll<HTMLElementTagNameMap["wt-button"]>("wt-button")].find(
    (button) => button.textContent!.trim() === label,
  )!;
}
function stepper(el: StaffingGrid) {
  return menu(el).querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("wt-number-stepper")!;
}
function columnMenu(el: StaffingGrid, key: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    `.heading[data-column="${key}"] wt-row-actions`,
  )!;
}
function columnAction(el: StaffingGrid, key: string, label: string) {
  return [...columnMenu(el, key).querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.textContent!.trim() === label,
  );
}
function chooser(el: StaffingGrid) {
  return el.shadowRoot!.querySelector<HTMLElement>(".chooser")!;
}
function choice(el: StaffingGrid, label: string) {
  return [...chooser(el).querySelectorAll<HTMLLabelElement>("label")]
    .find((row) => row.textContent!.trim() === label)!
    .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}
function chooserButton(el: StaffingGrid, label: string) {
  return [...chooser(el).querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.textContent!.trim() === label,
  )!;
}

test("a block is a button drawn at its times, named by its day, staff role, headcount and range", async () => {
  const el = await grid({ tue: [{ ...headChef, headcount: 3 }] });
  const box = column(el, "tue").getBoundingClientRect();
  const at = block(el, "tue").getBoundingClientRect();
  expect((at.top - box.top) / box.height).toBeCloseTo(3 / 24, 2);
  expect(at.height / box.height).toBeCloseTo(7.5 / 24, 2);
  expect(block(el, "tue").getAttribute("aria-label")).toBe(
    "Tuesday, Head chef, 3 people, 09:00–16:30",
  );
  expect(block(el, "tue").textContent).toContain("HC");
  expect(block(el, "tue").textContent).toContain("×3");
  expect(block(el, "tue").getAttribute("data-colour")).toBe("purple");
  const style = getComputedStyle(block(el, "tue"));
  const probe = document.createElement("div");
  probe.style.background = "var(--wt-color-palette-purple)";
  host.append(probe);
  expect(style.backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
  expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
});

interface Clip {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** The part of the page an element's overflow clipping leaves showing: its padding box. */
function clipOf(at: HTMLElement): Clip {
  const outer = at.getBoundingClientRect();
  return {
    left: outer.left + at.clientLeft,
    top: outer.top + at.clientTop,
    right: outer.left + at.clientLeft + at.clientWidth,
    bottom: outer.top + at.clientTop + at.clientHeight,
  };
}
/** Every piece of text a block draws, with its box and what the block and the clipping elements
 *  inside it leave showing. */
function blockTexts(el: StaffingGrid) {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>(".block")].flatMap((at) => {
    const walker = document.createTreeWalker(at, NodeFilter.SHOW_TEXT);
    const texts: { text: string; box: DOMRect; clip: Clip }[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.textContent!.trim() === "") continue;
      let clip = clipOf(at);
      for (let up = node.parentElement!; up !== at; up = up.parentElement!) {
        if (getComputedStyle(up).overflow === "visible") continue;
        const inner = clipOf(up);
        clip = {
          left: Math.max(clip.left, inner.left),
          top: Math.max(clip.top, inner.top),
          right: Math.min(clip.right, inner.right),
          bottom: Math.min(clip.bottom, inner.bottom),
        };
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      texts.push({ text: node.textContent!, box: range.getBoundingClientRect(), clip });
    }
    return texts;
  });
}
const inside = (box: DOMRect, clip: Clip) =>
  box.left >= clip.left - 0.5 &&
  box.right <= clip.right + 0.5 &&
  box.top >= clip.top - 0.5 &&
  box.bottom <= clip.bottom + 0.5;
const outside = (box: DOMRect, clip: Clip) =>
  box.left >= clip.right - 0.5 ||
  box.right <= clip.left + 0.5 ||
  box.top >= clip.bottom - 0.5 ||
  box.bottom <= clip.top + 0.5;

for (const [width, height, narrowest] of [
  [1280, 900, 45],
  [390, 844, 32],
] as const)
  test(`at ${width}×${height}, four side-by-side blocks show their staff roles' initials and cut no text`, async () => {
    const old = [window.innerWidth, window.innerHeight];
    try {
      await page.viewport(width, height);
      const lunch: StaffingBlock[] = [
        headChef,
        { ...sous, headcount: 1 },
        { staffRoleId: "sc", headcount: 12, startsAt: "11:00", endsAt: "17:00" },
        { staffRoleId: "dw", headcount: 1, startsAt: "13:00", endsAt: "16:30" },
        { staffRoleId: "dw", headcount: 1, startsAt: "20:00", endsAt: "20:45" },
      ];
      const el = await grid({
        mon: [],
        tue: lunch,
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      });
      expect(block(el, "tue", 0).getBoundingClientRect().width).toBeLessThan(narrowest);
      const texts = blockTexts(el);
      for (const { text, box, clip } of texts)
        expect(inside(box, clip) || outside(box, clip), `"${text}" is cut by its block`).toBe(true);
      const shown = (index: number) =>
        texts
          .filter(({ box, clip }) => inside(box, clip))
          .some(({ text, box }) => {
            const at = block(el, "tue", index).getBoundingClientRect();
            return (
              text === ["HC", "SC", "SC", "Di", "Di"][index] &&
              box.left >= at.left &&
              box.right <= at.right &&
              box.top >= at.top &&
              box.bottom <= at.bottom
            );
          });
      for (const index of [0, 1, 2, 3])
        expect(shown(index), `block ${index}'s initials`).toBe(true);
    } finally {
      await page.viewport(old[0]!, old[1]!);
    }
  });

test("at 390×844 a narrow block shows both its times or neither", async () => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(390, 844);
    const dinner: StaffingBlock[] = [
      { staffRoleId: "hc", headcount: 1, startsAt: "18:00", endsAt: "00:00" },
      { staffRoleId: "sc", headcount: 1, startsAt: "18:00", endsAt: "00:00" },
      { staffRoleId: "dw", headcount: 1, startsAt: "20:00", endsAt: "00:00" },
    ];
    const el = await grid({ mon: [], tue: dinner, wed: [], thu: [], fri: [], sat: [], sun: [] });
    const texts = blockTexts(el);
    const visible = (text: string, index: number) => {
      const at = block(el, "tue", index).getBoundingClientRect();
      return texts.some(
        (seen) =>
          seen.text === text &&
          seen.box.left >= at.left &&
          seen.box.right <= at.right &&
          inside(seen.box, seen.clip),
      );
    };
    for (const [index, { startsAt, endsAt }] of dinner.entries())
      expect(visible(startsAt, index), `block ${index}`).toBe(visible(endsAt, index));
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
});

test("a block draws its staff role's initials, headcount and times on their own lines, keeping the full name in its accessible name", async () => {
  const el = await grid({
    tue: [{ staffRoleId: "dw", headcount: 2, startsAt: "13:00", endsAt: "16:30" }],
  });
  expect(block(el, "tue").getAttribute("aria-label")).toBe(
    "Tuesday, Dishwasher, 2 people, 13:00–16:30",
  );
  expect(
    [...block(el, "tue").querySelectorAll(".text")].map((line) => line.textContent!.trim()),
  ).toEqual(["Di", "×2", "13:00", "16:30"]);
});

test("a drag down a column previews and adds a block of the chosen staff role and headcount", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: "dw", headcount: 2 });
  const seen = changes(el);
  point(el, "mon", 420, "pointerdown");
  point(el, "mon", 630, "pointermove");
  await el.updateComplete;
  const preview = el.shadowRoot!.querySelector<HTMLElement>(".preview")!;
  expect(preview.textContent).toContain("Dishwasher ×2 13:00–16:30");
  expect(seen).toEqual([]);
  point(el, "mon", 630, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([
    {
      key: "mon",
      blocks: [headChef, { staffRoleId: "dw", headcount: 2, startsAt: "13:00", endsAt: "16:30" }],
    },
  ]);
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
});

test("a drag starting on a block adds beside it rather than changing it", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: "sc" });
  const seen = changes(el);
  await drag(el, "mon", 300, 480, block(el, "mon").querySelector("span")!);
  expect(seen).toEqual([
    {
      key: "mon",
      blocks: [headChef, { staffRoleId: "sc", headcount: 1, startsAt: "11:00", endsAt: "14:00" }],
    },
  ]);
});

test("with no chosen staff role a drag adds nothing", async () => {
  const el = await grid({ mon: [] }, { chosen: undefined });
  const seen = changes(el);
  await drag(el, "mon", 120, 240);
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
  expect(seen).toEqual([]);
});

test("a drag over the whole day adds a block no longer than the server allows", async () => {
  const el = await grid({ mon: [] }, { chosen: "hc" });
  const seen = changes(el);
  await drag(el, "mon", 1440, 0);
  expect(seen).toEqual([
    {
      key: "mon",
      blocks: [{ staffRoleId: "hc", headcount: 1, startsAt: "06:00", endsAt: "05:45" }],
    },
  ]);
});

test("overlapping blocks sit side by side; blocks that only touch share a lane", async () => {
  const later: StaffingBlock = { ...sous, startsAt: "15:00", endsAt: "17:00" };
  const el = await grid({ mon: [headChef, sous, later] });
  const [first, second, third] = [0, 1, 2].map((i) => block(el, "mon", i).getBoundingClientRect());
  expect(second!.left).toBeGreaterThan(first!.right - 1);
  expect(Math.abs(first!.width - second!.width)).toBeLessThan(1);
  expect(third!.left).toBeCloseTo(second!.left, 0);
  const box = column(el, "mon").getBoundingClientRect();
  expect(first!.width).toBeLessThan(box.width / 2);
  const alone = await grid({ tue: [headChef] });
  expect(block(alone, "tue").getBoundingClientRect().width).toBeGreaterThan(
    column(alone, "tue").getBoundingClientRect().width * 0.8,
  );
});

test("two blocks with the same start are told apart by their place, not their start", async () => {
  const el = await grid({ mon: [headChef, { ...headChef, staffRoleId: "sc" }] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon", 1));
  await userEvent.click(menuButton(el, "Delete"));
  expect(seen).toEqual([{ key: "mon", blocks: [headChef] }]);
});

test("dragging a block's bottom edge resizes its end; its top edge resizes its start", async () => {
  const el = await grid({ mon: [headChef, sous] }, { chosen: undefined });
  const seen = changes(el);
  point(el, "mon", 630, "pointerdown", edge(el, "mon", 0, "end"));
  point(el, "mon", 720, "pointermove");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")!.textContent).toContain(
    "Head chef ×1 09:00–18:00",
  );
  point(el, "mon", 720, "pointerup");
  await el.updateComplete;
  await drag(el, "mon", 180, 120, edge(el, "mon", 1, "start"));
  expect(seen).toEqual([
    { key: "mon", blocks: [{ ...headChef, endsAt: "18:00" }, sous] },
    { key: "mon", blocks: [headChef, { ...sous, startsAt: "08:00" }] },
  ]);
});

test("an edge dragged past the other edge leaves the block a quarter hour long", async () => {
  const el = await grid({ mon: [headChef] });
  const seen = changes(el);
  await drag(el, "mon", 180, 900, edge(el, "mon", 0, "start"));
  expect(seen).toEqual([{ key: "mon", blocks: [{ ...headChef, startsAt: "16:15" }] }]);
});

test("the click that ends a resize does not open the block's menu", async () => {
  const el = await grid({ mon: [headChef] });
  changes(el);
  const end = edge(el, "mon", 0, "end");
  point(el, "mon", 630, "pointerdown", end);
  point(el, "mon", 720, "pointermove");
  point(el, "mon", 720, "pointerup");
  block(el, "mon").click();
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
});

test("clicking a block opens its staff roles, How many and Delete; a staff role changes it", async () => {
  const el = await grid({ mon: [headChef, sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon", 1));
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(menu(el).getAttribute("role")).toBe("dialog");
  expect(block(el, "mon", 1).getAttribute("aria-expanded")).toBe("true");
  expect(menuButton(el, "Head chef")).toBeDefined();
  expect(menuButton(el, "Sous chef").disabled).toBe(true);
  expect(menuButton(el, "Dishwasher")).toBeDefined();
  expect(stepper(el).label).toBe("How many");
  expect(stepper(el).name).toBe("headcount");
  expect(stepper(el).value).toBe("2");
  expect(stepper(el).min).toBe(1);
  expect(stepper(el).max).toBe(50);
  expect(menu(el).getAttribute("aria-label")).toBe("Sous chef, 2 people, 09:00–15:00");
  await userEvent.click(menuButton(el, "Dishwasher"));
  await el.updateComplete;
  expect(seen).toEqual([{ key: "mon", blocks: [headChef, { ...sous, staffRoleId: "dw" }] }]);
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 1));
});

test("How many changes the block's headcount, within 1 to 50, and keeps the menu open", async () => {
  const el = await grid({ mon: [sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon"));
  stepper(el).shadowRoot!.querySelector<HTMLButtonElement>('button[data-step="1"]')!.click();
  await el.updateComplete;
  expect(seen).toEqual([{ key: "mon", blocks: [{ ...sous, headcount: 3 }] }]);
  expect(menu(el).matches(":popover-open")).toBe(true);
  for (const value of ["0", "51", "", "2.5", "2"])
    stepper(el).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  expect(seen).toHaveLength(1);
});

test("Delete in the menu removes the block; Backspace on a focused block removes it too", async () => {
  const el = await grid({ mon: [headChef, sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon", 0));
  await userEvent.click(menuButton(el, "Delete"));
  expect(seen).toEqual([{ key: "mon", blocks: [sous] }]);
  expect(menu(el).matches(":popover-open")).toBe(false);
  el.days = new Map([["mon", [headChef, sous]]]);
  await el.updateComplete;
  block(el, "mon", 1).focus();
  await userEvent.keyboard("{Backspace}");
  expect(seen[1]).toEqual({ key: "mon", blocks: [headChef] });
});

test("Delete or Backspace inside an open menu deletes, but not while typing in How many", async () => {
  const el = await grid({ mon: [headChef, sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon", 0));
  stepper(el).shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{Backspace}");
  expect(seen.filter((change) => change.blocks?.length === 1)).toEqual([]);
  menuButton(el, "Sous chef").focus();
  await userEvent.keyboard("{Delete}");
  expect(seen.at(-1)).toEqual({ key: "mon", blocks: [sous] });
});

test("keyboard: blocks are buttons in tab order, Enter opens one, Escape closes and refocuses it", async () => {
  const el = await grid({ mon: [headChef, sous] });
  block(el, "mon", 0).focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 0));
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 0));
  await userEvent.tab();
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 1));
});

test("after a Delete the focus goes to the block now in its place, else the one before, else the column", async () => {
  const el = await grid({ mon: [headChef, sous] });
  el.addEventListener("staffing-change", (event) => {
    el.days = new Map([["mon", event.detail.blocks ?? []]]);
  });
  block(el, "mon", 0).focus();
  await userEvent.keyboard("{Delete}");
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 0));
  expect(block(el, "mon", 0).getAttribute("aria-label")).toContain("Sous chef");
  await userEvent.keyboard("{Delete}");
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(column(el, "mon"));
});

test("the menu closes when the host removes its block, and a new target closes it", async () => {
  const el = await grid({ mon: [headChef, sous] });
  await userEvent.click(block(el, "mon", 1));
  el.days = new Map([["mon", [headChef]]]);
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
  await userEvent.click(block(el, "mon", 0));
  el.target = "same";
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
});

test("each column's ⋮ offers Copy to… and Clear; Clear empties the day", async () => {
  const el = await grid({ mon: [headChef], tue: [] });
  const seen = changes(el);
  expect(columnMenu(el, "mon").label).toBe("Monday options");
  await userEvent.click(columnMenu(el, "mon"));
  expect(columnAction(el, "mon", "Copy to…")).toBeDefined();
  expect(columnAction(el, "mon", "Follow the season")).toBeUndefined();
  await userEvent.click(columnAction(el, "mon", "Clear")!);
  await userEvent.click(columnMenu(el, "tue"));
  await userEvent.click(columnAction(el, "tue", "Clear")!);
  expect(seen).toEqual([{ key: "mon", blocks: [] }]);
});

test("Copy to… copies the day by value, one change per ticked day that differs", async () => {
  const el = await grid({ mon: [headChef, sous], tue: [], wed: [headChef, sous] });
  const seen = changes(el);
  await userEvent.click(columnMenu(el, "mon"));
  await userEvent.click(columnAction(el, "mon", "Copy to…")!);
  await el.updateComplete;
  expect(chooser(el).matches(":popover-open")).toBe(true);
  expect(chooser(el).textContent).toContain("Copy Monday to");
  await userEvent.click(choice(el, "Tuesday"));
  await userEvent.click(choice(el, "Wednesday"));
  await userEvent.click(chooserButton(el, "Copy"));
  await el.updateComplete;
  expect(seen).toEqual([{ key: "tue", blocks: [headChef, sous] }]);
  expect(seen[0]!.blocks![0]).not.toBe(headChef);
  expect(chooser(el).matches(":popover-open")).toBe(false);
});

test("copying a day that follows the season makes the ticked days follow it", async () => {
  const el = await grid({ mon: null, tue: [headChef] }, { followable: true });
  const seen = changes(el);
  await userEvent.click(columnMenu(el, "mon"));
  await userEvent.click(columnAction(el, "mon", "Copy to…")!);
  await el.updateComplete;
  await userEvent.click(choice(el, "Tuesday"));
  await userEvent.click(chooserButton(el, "Copy"));
  expect(seen).toEqual([{ key: "tue", blocks: null }]);
});

test("followable: each ⋮ offers Follow the season, which sends null; a following day sends none", async () => {
  const el = await grid({ mon: [headChef], tue: null }, { followable: true });
  const seen = changes(el);
  await userEvent.click(columnMenu(el, "mon"));
  await userEvent.click(columnAction(el, "mon", "Follow the season")!);
  await userEvent.click(columnMenu(el, "tue"));
  await userEvent.click(columnAction(el, "tue", "Follow the season")!);
  expect(seen).toEqual([{ key: "mon", blocks: null }]);
});

test("a day that follows the season says so; Clear and painting on it start from an empty day", async () => {
  const el = await grid({ mon: null }, { followable: true, chosen: "hc" });
  const seen = changes(el);
  expect(column(el, "mon").querySelector(".follows")!.textContent).toContain("Follows the season");
  await drag(el, "mon", 120, 240);
  await userEvent.click(columnMenu(el, "mon"));
  await userEvent.click(columnAction(el, "mon", "Clear")!);
  expect(seen).toEqual([
    {
      key: "mon",
      blocks: [{ staffRoleId: "hc", headcount: 1, startsAt: "08:00", endsAt: "10:00" }],
    },
    { key: "mon", blocks: [] },
  ]);
  el.days = new Map([["mon", []]]);
  await el.updateComplete;
  expect(column(el, "mon").querySelector(".follows")).toBeNull();
});

test("guides are drawn faintly behind the blocks, inert, at their times", async () => {
  const el = await grid(
    { mon: [headChef] },
    {
      guides: new Map([
        [
          "mon",
          [
            { startsAt: "13:00", endsAt: "16:00" },
            { startsAt: "20:00", endsAt: "00:00" },
          ],
        ],
      ]),
    },
  );
  const guides = [...column(el, "mon").querySelectorAll<HTMLElement>(".guide")];
  expect(guides).toHaveLength(2);
  const box = column(el, "mon").getBoundingClientRect();
  const evening = guides[1]!.getBoundingClientRect();
  expect((evening.top - box.top) / box.height).toBeCloseTo(14 / 24, 2);
  expect((evening.bottom - box.top) / box.height).toBeCloseTo(18 / 24, 2);
  expect(getComputedStyle(guides[0]!).pointerEvents).toBe("none");
  expect(guides[0]!.getAttribute("aria-hidden")).toBe("true");
  const faint = Number(getComputedStyle(guides[0]!, "::before").opacity);
  expect(faint).toBeGreaterThan(0);
  expect(faint).toBeLessThan(1);
  expect(guides[1]!.compareDocumentPosition(block(el, "mon"))).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

test("read-only: a drag adds nothing, blocks are not buttons, nothing deletes, and no ⋮", async () => {
  const el = await grid({ mon: [], tue: [headChef] }, { readOnly: true });
  const seen = changes(el);
  await drag(el, "mon", 120, 240);
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
  const shown = el.shadowRoot!.querySelector<HTMLElement>('.day[data-column="tue"] .block')!;
  expect(shown.tagName).toBe("DIV");
  expect(shown.querySelector(".edge")).toBeNull();
  shown.click();
  shown.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.querySelector("wt-row-actions")).toBeNull();
  expect(el.shadowRoot!.querySelector(".scroll")!.getAttribute("tabindex")).toBe("0");
  expect(seen).toEqual([]);
});

test("turning read-only closes an open block menu", async () => {
  const el = await grid({ mon: [headChef] });
  await userEvent.click(block(el, "mon"));
  el.readOnly = true;
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
});

test("a column named in columnErrors marks its heading and describes its day", async () => {
  const el = await grid({ mon: [], tue: [] });
  el.columnErrors = new Map([["tue", "Check this day's blocks."]]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('.heading[data-column="tue"][data-error]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('.heading[data-column="mon"][data-error]')).toBeNull();
  const described = column(el, "tue").getAttribute("aria-describedby")!;
  expect(el.shadowRoot!.getElementById(described)!.textContent).toBe("Check this day's blocks.");
});

test("a block whose staff role is unknown draws uncoloured and nameless rather than failing", async () => {
  const el = await grid({ mon: [{ ...headChef, staffRoleId: "gone" }] });
  expect(block(el, "mon").hasAttribute("data-colour")).toBe(false);
  expect(block(el, "mon").getAttribute("aria-label")).toBe("Monday, 1 person, 09:00–16:30");
});

test("the text is Spanish under the Spanish locale", async () => {
  setLocale("es");
  const el = await grid({ mon: null }, { followable: true });
  expect(column(el, "mon").querySelector(".follows")!.textContent).toContain("Sigue la temporada");
  await userEvent.click(columnMenu(el, "mon"));
  expect(columnAction(el, "mon", "Seguir la temporada")).toBeDefined();
  const named = await grid({ tue: [headChef, sous] });
  expect(block(named, "tue", 0).getAttribute("aria-label")).toBe(
    "Tuesday, Head chef, 1 persona, 09:00–16:30",
  );
  expect(block(named, "tue", 1).getAttribute("aria-label")).toBe(
    "Tuesday, Sous chef, 2 personas, 09:00–15:00",
  );
});

test("a block that crosses the changeover is drawn down to the end of the day", async () => {
  const el = await grid({ mon: [{ ...headChef, startsAt: "22:00", endsAt: "07:00" }] });
  const box = column(el, "mon").getBoundingClientRect();
  expect(block(el, "mon").getBoundingClientRect().bottom).toBeCloseTo(box.bottom, 0);
});

test("a column the days map does not hold draws as an empty day and paints into it", async () => {
  const el = await grid({ mon: [] }, { chosen: "hc" });
  el.columns = [...el.columns, { key: "tue", label: "Tuesday" }];
  await el.updateComplete;
  const seen = changes(el);
  expect(column(el, "tue").querySelector(".follows")).toBeNull();
  await drag(el, "tue", 120, 240);
  expect(seen).toEqual([
    {
      key: "tue",
      blocks: [{ staffRoleId: "hc", headcount: 1, startsAt: "08:00", endsAt: "10:00" }],
    },
  ]);
});

test("a resize whose block the host removes mid-drag previews and changes nothing", async () => {
  const el = await grid({ mon: [headChef, sous] });
  const seen = changes(el);
  point(el, "mon", 360, "pointerdown", edge(el, "mon", 1, "end"));
  point(el, "mon", 420, "pointermove");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")).not.toBeNull();
  el.days = new Map([["mon", [headChef]]]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
  point(el, "mon", 420, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([]);
});

test("a preview and a read-only block of an unknown staff role draw uncoloured", async () => {
  const el = await grid({ mon: [{ ...headChef, staffRoleId: "gone" }] }, { chosen: "gone" });
  point(el, "mon", 720, "pointerdown");
  point(el, "mon", 840, "pointermove");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")!.hasAttribute("data-colour")).toBe(false);
  point(el, "mon", 840, "pointerup");
  el.readOnly = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".block")!.hasAttribute("data-colour")).toBe(false);
});

test("a key pressed on the closed menu does nothing", async () => {
  const el = await grid({ mon: [headChef] });
  const seen = changes(el);
  menu(el).dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  menu(el).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(seen).toEqual([]);
});

test("scrolling sideways fades the side that has columns hidden beyond it", async () => {
  const el = await grid({ mon: [], tue: [], wed: [] });
  el.style.width = "300px";
  const scroll = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  await vi.waitFor(() => expect(el.dataset.overflow).toBe("end"));
  const scrolled = new Promise((resolve) =>
    scroll.addEventListener("scroll", resolve, { once: true }),
  );
  scroll.scrollLeft = scroll.scrollWidth;
  await scrolled;
  expect(el.dataset.overflow).toBe("start");
});

test("a one-step resize moves the edge a quarter hour wherever in the edge strip the press lands", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: undefined });
  const seen = changes(el);
  const strip = edge(el, "mon", 0, "end").getBoundingClientRect();
  const row = column(el, "mon").getBoundingClientRect().height / 96;
  const into = [0.5, 1, 2, 3, 4, 5, 6, 7, 7.5].map((px) => (px / 8) * strip.height);
  for (const px of into) {
    const at = strip.top + px;
    pointAt(el, "mon", at, "pointerdown", edge(el, "mon", 0, "end"));
    pointAt(el, "mon", at - row, "pointermove");
    pointAt(el, "mon", at - row, "pointerup");
    await el.updateComplete;
  }
  expect(seen.map((change) => change.blocks![0]!.endsAt)).toEqual(into.map(() => "16:15"));
});

test("a press anywhere in an edge strip released where it landed changes nothing", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: undefined });
  const seen = changes(el);
  const strip = edge(el, "mon", 0, "end").getBoundingClientRect();
  for (const px of [0.5, 2, 4, 6, 7.5].map((n) => (n / 8) * strip.height)) {
    pointAt(el, "mon", strip.top + px, "pointerdown", edge(el, "mon", 0, "end"));
    pointAt(el, "mon", strip.top + px, "pointerup");
    await el.updateComplete;
  }
  expect(seen).toEqual([]);
});

test("a second finger during a resize neither adds a block nor changes which edge moves", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: "sc" });
  const seen = changes(el);
  point(el, "mon", 630, "pointerdown", edge(el, "mon", 0, "end"));
  point(el, "mon", 720, "pointermove");
  point(el, "mon", 840, "pointerdown", column(el, "mon"), 8);
  point(el, "mon", 720, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([{ key: "mon", blocks: [{ ...headChef, endsAt: "18:00" }] }]);
});

test("a second finger on a block's edge during an add does not turn the add into a resize", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: "sc" });
  const seen = changes(el);
  point(el, "mon", 720, "pointerdown");
  point(el, "mon", 840, "pointermove");
  point(el, "mon", 630, "pointerdown", edge(el, "mon", 0, "end"), 8);
  point(el, "mon", 840, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([
    {
      key: "mon",
      blocks: [headChef, { staffRoleId: "sc", headcount: 1, startsAt: "18:00", endsAt: "20:00" }],
    },
  ]);
});

test("after deleting the last block the focus goes to the one before", async () => {
  const el = await grid({ mon: [headChef, sous] });
  el.addEventListener("staffing-change", (event) => {
    el.days = new Map([["mon", event.detail.blocks ?? []]]);
  });
  block(el, "mon", 1).focus();
  await userEvent.keyboard("{Delete}");
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 0));
  expect(block(el, "mon", 0).getAttribute("aria-label")).toContain("Head chef");
});

test("a resize that leaves the block as it was sends no change", async () => {
  const short: StaffingBlock = { ...headChef, startsAt: "09:00", endsAt: "09:15" };
  const el = await grid({ mon: [short] }, { chosen: undefined });
  const seen = changes(el);
  await drag(el, "mon", 180, 600, edge(el, "mon", 0, "start"));
  expect(seen).toEqual([]);
});

test("a stroke under way when the grid turns read-only, even before it redraws, or its target changes, is dropped", async () => {
  const el = await grid({ mon: [] }, { chosen: "hc" });
  const seen = changes(el);
  point(el, "mon", 120, "pointerdown");
  point(el, "mon", 240, "pointermove");
  el.readOnly = true;
  await el.updateComplete;
  point(el, "mon", 240, "pointerup");
  el.readOnly = false;
  await el.updateComplete;
  point(el, "mon", 120, "pointerdown");
  point(el, "mon", 240, "pointermove");
  el.readOnly = true;
  point(el, "mon", 240, "pointerup");
  await el.updateComplete;
  el.readOnly = false;
  await el.updateComplete;
  point(el, "mon", 120, "pointerdown");
  point(el, "mon", 240, "pointermove");
  el.target = "other";
  await el.updateComplete;
  point(el, "mon", 240, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([]);
});

test("the open menu closes when the host moves another block into its block's place", async () => {
  const el = await grid({ mon: [headChef, sous] });
  await userEvent.click(block(el, "mon", 1));
  const early: StaffingBlock = { ...sous, startsAt: "07:00", endsAt: "08:00" };
  el.days = new Map([["mon", [early, headChef, sous]]]);
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
});

test("the open menu stays open when its own headcount change comes back from the host", async () => {
  const el = await grid({ mon: [headChef, sous] });
  el.addEventListener("staffing-change", (event) => {
    el.days = new Map([["mon", event.detail.blocks ?? []]]);
  });
  await userEvent.click(block(el, "mon", 1));
  stepper(el).shadowRoot!.querySelector<HTMLButtonElement>('button[data-step="1"]')!.click();
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
  el.days = new Map([["mon", [headChef, { ...sous, headcount: 3 }]]]);
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(stepper(el).value).toBe("3");
});

test("a 30-minute block keeps both edges and a body to click", async () => {
  const el = await grid({ mon: [{ ...headChef, endsAt: "09:30" }] }, { chosen: undefined });
  const at = block(el, "mon").getBoundingClientRect();
  const start = edge(el, "mon", 0, "start").getBoundingClientRect();
  const end = edge(el, "mon", 0, "end").getBoundingClientRect();
  const x = at.left + at.width / 2;
  const hit = (y: number) => el.shadowRoot!.elementFromPoint(x, y) as HTMLElement;
  expect(hit(start.top + start.height / 2).dataset.edge).toBe("start");
  expect(hit(at.top + at.height / 2)).toBe(block(el, "mon"));
  expect(hit(end.top + end.height / 2).dataset.edge).toBe("end");
});

test("a 15-minute block's edges leave a gap between them; a long block's are a fixed strip", async () => {
  const el = await grid({ mon: [{ ...headChef, endsAt: "09:15" }], tue: [headChef] });
  const start = edge(el, "mon", 0, "start").getBoundingClientRect();
  const end = edge(el, "mon", 0, "end").getBoundingClientRect();
  expect(start.height).toBeGreaterThan(0);
  expect(end.top - start.bottom).toBeGreaterThan(0);
  const long = edge(el, "tue", 0, "end").getBoundingClientRect().height;
  const probe = document.createElement("div");
  probe.style.blockSize = "var(--wt-space-2)";
  host.append(probe);
  expect(long).toBeCloseTo(probe.getBoundingClientRect().height, 1);
});

const ROLE_ID = "7d4c1a52-0b8e-4f4e-9a57-3c2f1e6b9d10";

test("an end resize of a block kept on the day's last quarter hour sends a block the server accepts", async () => {
  const el = await grid({
    mon: [{ staffRoleId: ROLE_ID, headcount: 1, startsAt: "06:00", endsAt: "08:00" }],
  });
  el.cutover = "06:10";
  await el.updateComplete;
  const seen = changes(el);
  await drag(el, "mon", 1440, 1380, edge(el, "mon", 0, "end"));
  expect(seen).toEqual([
    {
      key: "mon",
      blocks: [{ staffRoleId: ROLE_ID, headcount: 1, startsAt: "05:45", endsAt: "06:00" }],
    },
  ]);
  expect(() => parseBlocks(seen[0]!.blocks, "blocks", "06:10")).not.toThrow();
});

test("a press on the end edge of a block that crosses the changeover, released where it landed, changes nothing", async () => {
  const el = await grid({ mon: [{ ...headChef, startsAt: "05:00", endsAt: "08:00" }] });
  el.cutover = "06:10";
  await el.updateComplete;
  const seen = changes(el);
  const strip = edge(el, "mon", 0, "end").getBoundingClientRect();
  pointAt(el, "mon", strip.top + strip.height / 2, "pointerdown", edge(el, "mon", 0, "end"));
  pointAt(el, "mon", strip.top + strip.height / 2, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([]);
  const box = column(el, "mon").getBoundingClientRect();
  expect(block(el, "mon").getBoundingClientRect().bottom).toBeCloseTo(box.bottom, 0);
});

test("a resize whose block the host replaces with another mid-drag changes nothing on release", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: "dw" });
  const seen = changes(el);
  point(el, "mon", 630, "pointerdown", edge(el, "mon", 0, "end"));
  point(el, "mon", 720, "pointermove");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")).not.toBeNull();
  el.days = new Map([["mon", [sous]]]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")).toBeNull();
  point(el, "mon", 720, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([]);
});

test("a resize released after the host replaced its block, before the grid redrew, changes nothing", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: "dw" });
  const seen = changes(el);
  point(el, "mon", 630, "pointerdown", edge(el, "mon", 0, "end"));
  point(el, "mon", 720, "pointermove");
  await el.updateComplete;
  el.days = new Map([["mon", [sous]]]);
  point(el, "mon", 720, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([]);
});

test("a read-only block is named in full, by its day, staff role, headcount and range", async () => {
  const el = await grid({ mon: [], tue: [headChef] }, { readOnly: true });
  const name = "Tuesday, Head chef, 1 person, 09:00–16:30";
  await expect.element(page.elementLocator(el).getByRole("img", { name })).toBeInTheDocument();
  expect(el.shadowRoot!.querySelector<HTMLElement>(".block")!.title).toBe(name);
});
