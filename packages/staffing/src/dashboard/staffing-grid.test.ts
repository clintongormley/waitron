import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { chooseOption, cleanup, host, mount } from "@waitron/ui/src/test-helpers.js";
import { parseBlocks } from "../paint-rules.js";
import type { StaffingBlock } from "../slots.js";
import type { StaffRole } from "../staffing-types.js";
import type { StaffingChange, StaffingGrid } from "./staffing-grid.js";
import "./staffing-grid.js";
import { STAFFING_STRINGS } from "./strings.js";

const guideIdentity = {
  periodId: "lunch",
  periodName: "Lunch",
  periodColour: "blue" as const,
  departmentId: "dining",
  departmentName: "Dining room",
};

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
function twoFrames() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
/** Clicks a block, which picks it and opens its menu, then closes the menu with Escape. */
async function pickBlock(el: StaffingGrid, key: string, index = 0) {
  await userEvent.click(block(el, key, index));
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  await twoFrames();
}
function picked(el: StaffingGrid) {
  return el.shadowRoot!.querySelector("[data-picked]");
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
async function step(el: StaffingGrid, by: 1 | -1) {
  stepper(el).shadowRoot!.querySelector<HTMLButtonElement>(`button[data-step="${by}"]`)!.click();
  await el.updateComplete;
}
function roleField(el: StaffingGrid) {
  return menu(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "wt-combobox[name=staff-role]",
  )!;
}
function save(el: StaffingGrid) {
  return menu(el).querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save-block"]')!;
}
function cancel(el: StaffingGrid) {
  return menu(el).querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="cancel-block"]')!;
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
    "Tuesday, Head chef, 3 people, 09:00–16:30: HC ×3 09:00 16:30",
  );
  expect(block(el, "tue").getAttribute("title")).toBe("Tuesday, Head chef, 3 people, 09:00–16:30");
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
    "Tuesday, Dishwasher, 2 people, 13:00–16:30: Di ×2 13:00 16:30",
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
  await pickBlock(el, "mon", 0);
  point(el, "mon", 630, "pointerdown", edge(el, "mon", 0, "end"));
  point(el, "mon", 720, "pointermove");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".preview")!.textContent).toContain(
    "Head chef ×1 09:00–18:00",
  );
  point(el, "mon", 720, "pointerup");
  await el.updateComplete;
  await pickBlock(el, "mon", 1);
  await drag(el, "mon", 180, 120, edge(el, "mon", 1, "start"));
  expect(seen).toEqual([
    { key: "mon", blocks: [{ ...headChef, endsAt: "18:00" }, sous] },
    { key: "mon", blocks: [headChef, { ...sous, startsAt: "08:00" }] },
  ]);
});

test("an unpicked block has no edges, and a drag from its top quarter paints a new block", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: "sc" });
  const seen = changes(el);
  expect(block(el, "mon").querySelector(".edge")).toBeNull();
  const at = block(el, "mon").getBoundingClientRect();
  const under = el.shadowRoot!.elementFromPoint(at.left + at.width / 2, at.top + 2)!;
  expect(under).toBe(block(el, "mon"));
  await drag(el, "mon", 180, 300, under);
  expect(seen).toEqual([
    {
      key: "mon",
      blocks: [headChef, { staffRoleId: "sc", headcount: 1, startsAt: "09:00", endsAt: "11:00" }],
    },
  ]);
});

test("clicking a block picks it: focused, marked, and only its edges resize it", async () => {
  const el = await grid({ mon: [headChef, sous] });
  const seen = changes(el);
  await pickBlock(el, "mon", 0);
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 0));
  expect(block(el, "mon", 0).hasAttribute("data-picked")).toBe(true);
  expect(block(el, "mon", 1).querySelector(".edge")).toBeNull();
  await drag(el, "mon", 630, 720, edge(el, "mon", 0, "end"));
  expect(seen).toEqual([{ key: "mon", blocks: [{ ...headChef, endsAt: "18:00" }, sous] }]);
});

test("a picked block stays picked while focus is in its menu, and is unpicked when focus goes anywhere else", async () => {
  const el = await grid({ mon: [headChef, sous], tue: [] });
  await userEvent.click(block(el, "mon", 0));
  await el.updateComplete;
  await twoFrames();
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(block(el, "mon", 0).hasAttribute("data-picked")).toBe(true);
  await userEvent.click(column(el, "tue"), { position: { x: 5, y: 5 } });
  await el.updateComplete;
  await twoFrames();
  expect(picked(el)).toBeNull();
  expect(menu(el).matches(":popover-open")).toBe(false);
  await pickBlock(el, "mon", 0);
  expect(picked(el)).toBe(block(el, "mon", 0));
  await userEvent.tab();
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 1));
  expect(picked(el)).toBeNull();
});

test("a click on a button outside the grid unpicks the block", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: "sc" });
  const seen = changes(el);
  const outside = document.createElement("button");
  outside.textContent = "Elsewhere";
  host.append(outside);
  await pickBlock(el, "mon", 0);
  const strip = edge(el, "mon", 0, "end").getBoundingClientRect();
  await userEvent.click(outside);
  await el.updateComplete;
  expect(picked(el)).toBeNull();
  const under = el.shadowRoot!.elementFromPoint(
    strip.left + strip.width / 2,
    strip.top + strip.height / 2,
  )!;
  expect(under).toBe(block(el, "mon"));
  await drag(el, "mon", 630, 720, under);
  expect(seen).toEqual([
    {
      key: "mon",
      blocks: [headChef, { staffRoleId: "sc", headcount: 1, startsAt: "16:30", endsAt: "18:00" }],
    },
  ]);
});

test("picking a second block unpicks the first", async () => {
  const el = await grid({ mon: [headChef, sous] });
  await pickBlock(el, "mon", 0);
  await pickBlock(el, "mon", 1);
  expect(picked(el)).toBe(block(el, "mon", 1));
  expect(el.shadowRoot!.querySelectorAll("[data-picked]")).toHaveLength(1);
  expect(block(el, "mon", 0).querySelector(".edge")).toBeNull();
  expect(edge(el, "mon", 1, "end")).not.toBeNull();
});

test("a resized picked block stays picked once the host echoes it, so a second edge drag resizes again", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: undefined });
  const seen = changes(el);
  el.addEventListener("staffing-change", (event) => {
    el.days = new Map([[event.detail.key, event.detail.blocks]]);
  });
  await pickBlock(el, "mon", 0);
  await drag(el, "mon", 630, 720, edge(el, "mon", 0, "end"));
  expect(picked(el)).toBe(block(el, "mon", 0));
  await drag(el, "mon", 180, 120, edge(el, "mon", 0, "start"));
  expect(seen).toEqual([
    { key: "mon", blocks: [{ ...headChef, endsAt: "18:00" }] },
    { key: "mon", blocks: [{ ...headChef, startsAt: "08:00", endsAt: "18:00" }] },
  ]);
});

test("the host replacing the picked block, a new target, or turning read-only unpicks it; the same block sent again keeps it", async () => {
  const el = await grid({ mon: [headChef] });
  await pickBlock(el, "mon", 0);
  el.days = new Map([["mon", [{ ...headChef }]]]);
  await el.updateComplete;
  expect(picked(el)).toBe(block(el, "mon", 0));
  el.days = new Map([["mon", [{ ...headChef, headcount: 2 }]]]);
  await el.updateComplete;
  expect(picked(el)).toBeNull();
  await pickBlock(el, "mon", 0);
  el.target = "other";
  await el.updateComplete;
  expect(picked(el)).toBeNull();
  await pickBlock(el, "mon", 0);
  el.readOnly = true;
  await el.updateComplete;
  el.readOnly = false;
  await el.updateComplete;
  expect(picked(el)).toBeNull();
  expect(block(el, "mon", 0).querySelector(".edge")).toBeNull();
});

test("a focusout while the document has no focus keeps the pick", async () => {
  const el = await grid({ mon: [headChef] });
  await pickBlock(el, "mon", 0);
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  block(el, "mon", 0).dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: null }),
  );
  await el.updateComplete;
  expect(picked(el)).toBe(block(el, "mon", 0));
});

test("Escape, Cancel and Save each leave the block focused and picked", async () => {
  const el = await grid({ mon: [headChef, sous] });
  el.addEventListener("staffing-change", (event) => {
    el.days = new Map([[event.detail.key, event.detail.blocks]]);
  });
  await pickBlock(el, "mon", 1);
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 1));
  expect(picked(el)).toBe(block(el, "mon", 1));
  for (const close of ["Escape", "Cancel", "Save"] as const) {
    await userEvent.click(block(el, "mon", 1));
    await el.updateComplete;
    if (close === "Escape") await userEvent.keyboard("{Escape}");
    if (close === "Cancel") await userEvent.click(cancel(el));
    if (close === "Save") {
      await chooseOption(roleField(el), "dw");
      await el.updateComplete;
      await userEvent.click(save(el));
    }
    await el.updateComplete;
    await twoFrames();
    expect(menu(el).matches(":popover-open"), close).toBe(false);
    expect(el.shadowRoot!.activeElement, close).toBe(block(el, "mon", 1));
    expect(picked(el), close).toBe(block(el, "mon", 1));
  }
  expect(block(el, "mon", 1).getAttribute("aria-label")).toContain("Dishwasher");
});

test("a click on the menu's blank text keeps the menu open and the block picked", async () => {
  const el = await grid({ mon: [headChef, sous] });
  await userEvent.click(block(el, "mon", 1));
  await el.updateComplete;
  await userEvent.click(menu(el), { position: { x: 2, y: 2 } });
  await el.updateComplete;
  await twoFrames();
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(picked(el)).toBe(block(el, "mon", 1));
});

test("an edge dragged past the other edge leaves the block a quarter hour long", async () => {
  const el = await grid({ mon: [headChef] });
  const seen = changes(el);
  await pickBlock(el, "mon", 0);
  await drag(el, "mon", 180, 900, edge(el, "mon", 0, "start"));
  expect(seen).toEqual([{ key: "mon", blocks: [{ ...headChef, startsAt: "16:15" }] }]);
});

test("the click that ends a resize does not open the block's menu", async () => {
  const el = await grid({ mon: [headChef] });
  changes(el);
  await pickBlock(el, "mon", 0);
  const end = edge(el, "mon", 0, "end");
  point(el, "mon", 630, "pointerdown", end);
  point(el, "mon", 720, "pointermove");
  point(el, "mon", 720, "pointerup");
  block(el, "mon").click();
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
});

for (const [what, refresh] of [
  [
    "the host replaces the block",
    (el: StaffingGrid) => {
      el.days = new Map([["mon", [{ ...headChef, headcount: 2 }]]]);
    },
  ],
  [
    "the target changes",
    (el: StaffingGrid) => {
      el.target = "other";
    },
  ],
] as const) {
  test(`a resize dropped because ${what} does not open the block's menu when released over it`, async () => {
    const el = await grid({ mon: [headChef] }, { chosen: undefined });
    const seen = changes(el);
    let refreshed = false;
    // Added once the press has begun the stroke, so it runs after the stroke has stretched.
    const onMove = () => {
      if (refreshed || el.shadowRoot!.querySelector(".preview") === null) return;
      refreshed = true;
      refresh(el);
    };
    await pickBlock(el, "mon", 0);
    const onDown = () => window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    const strip = edge(el, "mon", 0, "end").getBoundingClientRect();
    const body = block(el, "mon").getBoundingClientRect();
    try {
      await userEvent.dragAndDrop(edge(el, "mon", 0, "end"), block(el, "mon"), {
        sourcePosition: { x: strip.width / 2, y: strip.height / 2 },
        targetPosition: { x: body.width / 2, y: body.height / 2 },
      });
    } finally {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
    }
    await el.updateComplete;
    expect(refreshed).toBe(true);
    expect(seen).toEqual([]);
    expect(menu(el).matches(":popover-open")).toBe(false);
    await userEvent.click(block(el, "mon"));
    expect(menu(el).matches(":popover-open")).toBe(true);
  });
}

test("a dropped resize whose pointer is cancelled leaves the next click on a block opening its menu", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: undefined });
  await pickBlock(el, "mon", 0);
  point(el, "mon", 630, "pointerdown", edge(el, "mon", 0, "end"));
  point(el, "mon", 720, "pointermove");
  await el.updateComplete;
  el.days = new Map([["mon", [{ ...headChef, headcount: 2 }]]]);
  await el.updateComplete;
  point(el, "mon", 720, "pointercancel");
  point(el, "mon", 720, "pointerup");
  block(el, "mon").click();
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
});

test("clicking a block opens its staff role, How many and Delete; a staff role changes it on Save", async () => {
  const el = await grid({ mon: [headChef, sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon", 1));
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(menu(el).getAttribute("role")).toBe("dialog");
  expect(block(el, "mon", 1).getAttribute("aria-expanded")).toBe("true");
  expect(roleField(el).value).toBe("sc");
  expect(roleField(el).options.map(({ value, label }) => [value, label])).toEqual([
    ["hc", "Head chef"],
    ["sc", "Sous chef"],
    ["dw", "Dishwasher"],
  ]);
  expect(stepper(el).label).toBe("How many");
  expect(stepper(el).name).toBe("headcount");
  expect(stepper(el).value).toBe("2");
  expect(stepper(el).min).toBe(1);
  expect(stepper(el).max).toBe(50);
  expect(menu(el).getAttribute("aria-label")).toBe("Sous chef, 2 people, 09:00–15:00");
  await chooseOption(roleField(el), "dw");
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(menu(el).matches(":popover-open")).toBe(true);
  await userEvent.click(save(el));
  await el.updateComplete;
  expect(seen).toEqual([{ key: "mon", blocks: [headChef, { ...sous, staffRoleId: "dw" }] }]);
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 1));
});

test("How many changes the editor's headcount and keeps the editor open; only Save sends it", async () => {
  const el = await grid({ mon: [sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon"));
  await step(el, 1);
  expect(stepper(el).value).toBe("3");
  expect(seen).toEqual([]);
  expect(menu(el).matches(":popover-open")).toBe(true);
  await step(el, 1);
  expect(seen).toEqual([]);
  await userEvent.click(save(el));
  await el.updateComplete;
  expect(seen).toEqual([{ key: "mon", blocks: [{ ...sous, headcount: 4 }] }]);
});

test("clicking a block opens a wide editor: Staff role and How many on one row, then Cancel and Delete, and Save alone on the right", async () => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(1280, 900);
    const el = await grid({ mon: [headChef, sous] });
    await userEvent.click(block(el, "mon", 1));
    await el.updateComplete;
    const field = roleField(el);
    expect(field.label).toBe("Staff role");
    expect(field.value).toBe("sc");
    expect(field.required).toBe(true);
    expect(field.options.map(({ value }) => value)).toEqual(["hc", "sc", "dw"]);
    expect(stepper(el).value).toBe("2");
    expect(stepper(el).min).toBe(1);
    expect(stepper(el).max).toBe(50);
    const remove = menuButton(el, "Delete");
    expect(
      Math.abs(field.getBoundingClientRect().top - stepper(el).getBoundingClientRect().top),
    ).toBeLessThanOrEqual(1);
    expect(save(el).getBoundingClientRect().left).toBeGreaterThan(
      remove.getBoundingClientRect().right,
    );
    expect(cancel(el).getBoundingClientRect().right).toBeLessThanOrEqual(
      remove.getBoundingClientRect().left,
    );
    expect(save(el).disabled).toBe(true);
    expect(save(el).variant).toBe("secondary");
    expect(el.shadowRoot!.activeElement).toBe(field);
    expect(cancel(el).variant).toBe("secondary");
    expect(remove.variant).toBe("danger");
    const group = cancel(el).parentElement!;
    expect(group.slot).toBe("cancel");
    expect([...group.children]).toEqual([cancel(el), remove]);
    expect(save(el).slot).toBe("");
    expect(save(el).parentElement!.localName).toBe("wt-form-actions");
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
});

test("typing in the role field filters the list", async () => {
  const el = await grid({ mon: [sous] });
  await userEvent.click(block(el, "mon"));
  await userEvent.click(roleField(el));
  await userEvent.keyboard("dis");
  await roleField(el).updateComplete;
  const rows = [...roleField(el).shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(rows.map((row) => row.textContent!.trim())).toEqual(["Dishwasher"]);
});

test("a changed role or How many makes Save loud; changing it back makes it quiet; nothing is sent before Save", async () => {
  const el = await grid({ mon: [sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon"));
  const quiet = () => [save(el).disabled, save(el).variant];
  expect(quiet()).toEqual([true, "secondary"]);
  await chooseOption(roleField(el), "dw");
  await el.updateComplete;
  expect(quiet()).toEqual([false, "primary"]);
  await step(el, 1);
  expect(quiet()).toEqual([false, "primary"]);
  await step(el, -1);
  expect(quiet()).toEqual([false, "primary"]);
  await chooseOption(roleField(el), "sc");
  await el.updateComplete;
  expect(quiet()).toEqual([true, "secondary"]);
  await step(el, 1);
  expect(quiet()).toEqual([false, "primary"]);
  await step(el, -1);
  expect(quiet()).toEqual([true, "secondary"]);
  expect(seen).toEqual([]);
});

test("Save sends the role and How many together, closes the editor, and leaves the block focused and picked", async () => {
  const el = await grid({ mon: [headChef, sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon", 1));
  await chooseOption(roleField(el), "dw");
  await step(el, 1);
  await userEvent.click(save(el));
  await el.updateComplete;
  await twoFrames();
  expect(seen).toEqual([
    { key: "mon", blocks: [headChef, { ...sous, staffRoleId: "dw", headcount: 3 }] },
  ]);
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 1));
  expect(picked(el)).toBe(block(el, "mon", 1));
});

for (const how of ["Cancel", "Escape", "a click outside"] as const)
  test(`${how} throws the editor's change away`, async () => {
    const el = await grid({ mon: [headChef, sous], tue: [] });
    const seen = changes(el);
    await userEvent.click(block(el, "mon", 1));
    await step(el, 1);
    expect(stepper(el).value).toBe("3");
    if (how === "Cancel") await userEvent.click(cancel(el));
    if (how === "Escape") await userEvent.keyboard("{Escape}");
    if (how === "a click outside")
      await userEvent.click(column(el, "tue"), { position: { x: 5, y: 5 } });
    await el.updateComplete;
    await twoFrames();
    expect(menu(el).matches(":popover-open")).toBe(false);
    expect(seen).toEqual([]);
    if (how !== "a click outside") {
      expect(el.shadowRoot!.activeElement).toBe(block(el, "mon", 1));
      expect(picked(el)).toBe(block(el, "mon", 1));
    } else expect(picked(el)).toBeNull();
    await userEvent.click(block(el, "mon", 1));
    await el.updateComplete;
    expect(stepper(el).value).toBe("2");
    expect(roleField(el).value).toBe("sc");
    expect(save(el).disabled).toBe(true);
  });

test("opening the role list and choosing from it with clicks keeps the editor open", async () => {
  const el = await grid({ mon: [sous] });
  await userEvent.click(block(el, "mon"));
  await userEvent.click(roleField(el));
  await roleField(el).updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
  const row = [...roleField(el).shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.textContent!.trim() === "Dishwasher",
  )!;
  await userEvent.click(row);
  await el.updateComplete;
  await twoFrames();
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(roleField(el).value).toBe("dw");
  expect(save(el).variant).toBe("primary");
  expect(save(el).disabled).toBe(false);
});

test("the editor keeps its draft when the host sends the same block back, and closes when another block takes its place", async () => {
  const el = await grid({ mon: [headChef, sous] });
  await userEvent.click(block(el, "mon", 1));
  await step(el, 1);
  el.days = new Map([["mon", [headChef, { ...sous }]]]);
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(stepper(el).value).toBe("3");
  el.days = new Map([["mon", [headChef, { ...sous, headcount: 5 }]]]);
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
  await userEvent.click(block(el, "mon", 1));
  await el.updateComplete;
  expect(stepper(el).value).toBe("5");
  expect(save(el).disabled).toBe(true);
});

test("clicking the block whose editor is open keeps the draft", async () => {
  const el = await grid({ mon: [sous] });
  await userEvent.click(block(el, "mon"));
  await chooseOption(roleField(el), "dw");
  await step(el, 1);
  await userEvent.click(block(el, "mon"));
  await el.updateComplete;
  await twoFrames();
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(roleField(el).value).toBe("dw");
  expect(stepper(el).value).toBe("3");
  expect(save(el).variant).toBe("primary");
});

test("a block whose staff role is gone opens with an empty role; Save stays quiet, even after a How many change, until a known role is chosen", async () => {
  const el = await grid({ mon: [{ ...headChef, staffRoleId: "gone" }] });
  await userEvent.click(block(el, "mon"));
  expect(roleField(el).value).toBe("");
  expect(roleField(el).required).toBe(true);
  await step(el, 1);
  expect(save(el).disabled).toBe(true);
  expect(save(el).variant).toBe("secondary");
  await chooseOption(roleField(el), "dw");
  await el.updateComplete;
  expect(save(el).disabled).toBe(false);
  expect(save(el).variant).toBe("primary");
});

test("How many in the editor stays within 1 to 50 and puts back the last count for other text", async () => {
  const el = await grid({ mon: [sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon"));
  for (const [value, expected] of [
    ["0", 1],
    ["51", 50],
    ["2.5", 50],
    ["", 50],
    ["2", 2],
  ] as const) {
    const input = stepper(el).shadowRoot!.querySelector("input")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    await stepper(el).updateComplete;
    if (value === "") {
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: menu(el) }),
      );
      await stepper(el).updateComplete;
    }
    expect(input.value, value).toBe(String(expected));
    expect(menu(el).matches(":popover-open")).toBe(true);
  }
  expect(seen).toEqual([]);
  await step(el, 1);
  await userEvent.click(save(el));
  await el.updateComplete;
  expect(seen).toEqual([{ key: "mon", blocks: [{ ...sous, headcount: 3 }] }]);
});

test("the editor's text is Spanish under the Spanish locale", async () => {
  setLocale("es");
  const el = await grid({ mon: [sous] });
  await userEvent.click(block(el, "mon"));
  expect(roleField(el).label).toBe("Rol de personal");
  expect(roleField(el).searchPlaceholder).toBe("Buscar");
  expect(roleField(el).noResultsLabel).toBe("Sin resultados");
  expect(stepper(el).label).toBe("Cuántas personas");
  expect(cancel(el).textContent!.trim()).toBe("Cancelar");
  expect(menuButton(el, "Eliminar")).toBeDefined();
  expect(save(el).textContent!.trim()).toBe("Guardar");
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

test("Delete or Backspace in the editor deletes the block from its buttons but not from the role field or How many", async () => {
  const el = await grid({ mon: [headChef, sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon", 0));
  await el.updateComplete;
  roleField(el).focus();
  expect(el.shadowRoot!.activeElement).toBe(roleField(el));
  await userEvent.keyboard("{Backspace}");
  stepper(el).shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{Backspace}");
  await userEvent.click(roleField(el));
  await roleField(el).updateComplete;
  const search = roleField(el).shadowRoot!.querySelector<HTMLInputElement>("input.search")!;
  expect(roleField(el).shadowRoot!.activeElement).toBe(search);
  await userEvent.keyboard("{Backspace}");
  expect(seen).toEqual([]);
  expect(menu(el).matches(":popover-open")).toBe(true);
  cancel(el).focus();
  await userEvent.keyboard("{Delete}");
  expect(seen).toEqual([{ key: "mon", blocks: [sous] }]);
});

test("Escape with the role list open closes only the list; a second Escape closes the editor", async () => {
  const el = await grid({ mon: [sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon"));
  await step(el, 1);
  await userEvent.click(roleField(el));
  await roleField(el).updateComplete;
  const list = roleField(el).shadowRoot!.querySelector("[popover]")!;
  expect(list.matches(":popover-open")).toBe(true);
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  await twoFrames();
  expect(list.matches(":popover-open")).toBe(false);
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(stepper(el).value).toBe("3");
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  await twoFrames();
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(seen).toEqual([]);
  expect(picked(el)).toBe(block(el, "mon"));
});

test("Enter in How many saves", async () => {
  const el = await grid({ mon: [sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon"));
  const input = () => stepper(el).shadowRoot!.querySelector("input")!;
  input().focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(menu(el).matches(":popover-open")).toBe(true);
  await step(el, 1);
  input().focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  await twoFrames();
  expect(seen).toEqual([{ key: "mon", blocks: [{ ...sous, headcount: 3 }] }]);
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon"));
  expect(picked(el)).toBe(block(el, "mon"));
});

test("Tab out of the editor's last button closes it without sending and unpicks the block", async () => {
  const el = await grid({ mon: [headChef, sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon", 0));
  await step(el, 1);
  save(el).focus();
  expect(el.shadowRoot!.activeElement).toBe(save(el));
  await userEvent.tab();
  await el.updateComplete;
  await twoFrames();
  expect(menu(el).matches(":popover-open")).toBe(false);
  expect(menu(el).contains(el.shadowRoot!.activeElement)).toBe(false);
  expect(seen).toEqual([]);
  expect(picked(el)).toBeNull();
  await userEvent.click(block(el, "mon", 0));
  await el.updateComplete;
  expect(stepper(el).value).toBe("1");
});

test("an edge drag of the picked block with its editor open closes the editor when it first stretches, drops the draft, and resizes", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: undefined });
  const seen = changes(el);
  await userEvent.click(block(el, "mon"));
  await step(el, 1);
  // Dispatched, so the browser's light dismiss plays no part: only the grid can close the editor.
  point(el, "mon", 630, "pointerdown", edge(el, "mon", 0, "end"));
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
  point(el, "mon", 720, "pointermove");
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
  point(el, "mon", 720, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([{ key: "mon", blocks: [{ ...headChef, endsAt: "18:00" }] }]);
  await userEvent.click(block(el, "mon"));
  await el.updateComplete;
  expect(stepper(el).value).toBe("1");
  expect(save(el).disabled).toBe(true);
});

test("a press and release on the picked block's edge with no movement keeps the editor and its draft", async () => {
  const el = await grid({ mon: [sous] }, { chosen: undefined });
  const seen = changes(el);
  await userEvent.click(block(el, "mon"));
  await step(el, 1);
  const end = edge(el, "mon", 0, "end");
  const strip = end.getBoundingClientRect();
  const y = strip.top + strip.height / 2;
  // Dispatched: the browser does not light-dismiss, so this checks the grid keeps the editor.
  pointAt(el, "mon", y, "pointerdown", end);
  await el.updateComplete;
  pointAt(el, "mon", y, "pointerup");
  await el.updateComplete;
  await twoFrames();
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(stepper(el).value).toBe("3");
  // A real press: the browser light-dismisses the editor, and the click on its block shows it again.
  await userEvent.click(end);
  await el.updateComplete;
  await twoFrames();
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(stepper(el).value).toBe("3");
  expect(save(el).variant).toBe("primary");
  expect(picked(el)).toBe(block(el, "mon"));
  expect(seen).toEqual([]);
});

test("a paint drag from the picked block's body with its editor open closes the editor, drops the draft, and adds a block", async () => {
  const el = await grid({ mon: [headChef] }, { chosen: "sc" });
  const seen = changes(el);
  await userEvent.click(block(el, "mon"));
  await step(el, 1);
  point(el, "mon", 300, "pointerdown", block(el, "mon"));
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
  point(el, "mon", 420, "pointermove");
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(false);
  point(el, "mon", 420, "pointerup");
  await el.updateComplete;
  expect(seen).toEqual([
    {
      key: "mon",
      blocks: [headChef, { staffRoleId: "sc", headcount: 1, startsAt: "11:00", endsAt: "13:00" }],
    },
  ]);
  await userEvent.click(block(el, "mon"));
  await el.updateComplete;
  expect(stepper(el).value).toBe("1");
  expect(save(el).disabled).toBe(true);
});

test("at 390×844 the editor fits inside the window, and sits above a block low in the view when there is room", async () => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(390, 844);
    const late: StaffingBlock = {
      staffRoleId: "sc",
      headcount: 1,
      startsAt: "22:00",
      endsAt: "00:00",
    };
    const el = await grid({ mon: [late] });
    // Pushes the block down until its foot is a little above the window's.
    const spacer = document.createElement("div");
    spacer.style.height = `${innerHeight - 40 - block(el, "mon").getBoundingClientRect().bottom}px`;
    el.before(spacer);
    await userEvent.click(block(el, "mon"));
    await el.updateComplete;
    const box = menu(el).getBoundingClientRect();
    const at = block(el, "mon").getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(innerWidth);
    expect(at.top - box.height).toBeGreaterThanOrEqual(8);
    expect(box.bottom).toBeLessThanOrEqual(at.top + 0.5);
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
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
            { ...guideIdentity, startsAt: "13:00", endsAt: "16:00" },
            {
              ...guideIdentity,
              periodId: "dinner",
              periodName: "Dinner",
              periodColour: "green",
              startsAt: "20:00",
              endsAt: "00:00",
            },
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
  expect(described.split(" ")).toEqual(["column-error-tue", "guide-description-tue"]);
  expect(el.shadowRoot!.getElementById("column-error-tue")!.textContent).toBe(
    "Check this day's blocks.",
  );
  expect(el.shadowRoot!.getElementById("guide-description-tue")!.textContent).toBe("Closed");
});

test("a block whose staff role is unknown draws uncoloured and nameless rather than failing", async () => {
  const el = await grid({ mon: [{ ...headChef, staffRoleId: "gone" }] });
  expect(block(el, "mon").hasAttribute("data-colour")).toBe(false);
  expect(block(el, "mon").getAttribute("aria-label")).toBe(
    "Monday, 1 person, 09:00–16:30: ×1 09:00 16:30",
  );
});

test("the text is Spanish under the Spanish locale", async () => {
  setLocale("es");
  const el = await grid({ mon: null }, { followable: true });
  expect(column(el, "mon").querySelector(".follows")!.textContent).toContain("Sigue la temporada");
  await userEvent.click(columnMenu(el, "mon"));
  expect(columnAction(el, "mon", "Seguir la temporada")).toBeDefined();
  const named = await grid({ tue: [headChef, sous] });
  expect(block(named, "tue", 0).getAttribute("aria-label")).toBe(
    "Tuesday, Head chef, 1 persona, 09:00–16:30: HC ×1 09:00 16:30",
  );
  expect(block(named, "tue", 1).getAttribute("aria-label")).toBe(
    "Tuesday, Sous chef, 2 personas, 09:00–15:00: SC ×2 09:00 15:00",
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
  await pickBlock(el, "mon", 1);
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
  await pickBlock(el, "mon", 0);
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
  await pickBlock(el, "mon", 0);
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
  await pickBlock(el, "mon", 0);
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
  await pickBlock(el, "mon", 0);
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
  await pickBlock(el, "mon", 0);
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

test("the open menu stays open when the host sends its block back unchanged", async () => {
  const el = await grid({ mon: [headChef, sous] });
  const seen = changes(el);
  await userEvent.click(block(el, "mon", 1));
  await step(el, 1);
  expect(menu(el).matches(":popover-open")).toBe(true);
  el.days = new Map([["mon", [{ ...headChef }, { ...sous }]]]);
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
  expect(stepper(el).value).toBe("3");
  expect(save(el).variant).toBe("primary");
  expect(seen).toEqual([]);
});

test("a 30-minute block keeps both edges and a body to click", async () => {
  const el = await grid({ mon: [{ ...headChef, endsAt: "09:30" }] }, { chosen: undefined });
  await pickBlock(el, "mon", 0);
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
  await pickBlock(el, "mon", 0);
  const start = edge(el, "mon", 0, "start").getBoundingClientRect();
  const end = edge(el, "mon", 0, "end").getBoundingClientRect();
  expect(start.height).toBeGreaterThan(0);
  expect(end.top - start.bottom).toBeGreaterThan(0);
  await pickBlock(el, "tue", 0);
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
  await pickBlock(el, "mon", 0);
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
  await pickBlock(el, "mon", 0);
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
  await pickBlock(el, "mon", 0);
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
  await pickBlock(el, "mon", 0);
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

test("A724 labels period bands with their colours and unsnapped endpoints", async () => {
  const el = await grid(
    { mon: [] },
    {
      guides: new Map([
        [
          "mon",
          [
            { ...guideIdentity, startsAt: "13:00", endsAt: "15:53" },
            {
              ...guideIdentity,
              periodId: "dinner",
              periodName: "Dinner",
              periodColour: "green",
              startsAt: "15:53",
              endsAt: "17:00",
            },
          ],
        ],
      ]),
    },
  );
  const bands = [...column(el, "mon").querySelectorAll<HTMLElement>(".guide")];
  expect(bands[0]!.textContent).toContain("Lunch");
  expect(bands[0]!.textContent).toContain("13:00–15:53");
  expect(bands[0]!.dataset.colour).toBe("blue");
  expect(bands[1]!.textContent).toContain("Dinner");
  expect(bands[1]!.dataset.colour).toBe("green");
  const box = column(el, "mon").getBoundingClientRect();
  expect((bands[0]!.getBoundingClientRect().bottom - box.top) / box.height).toBeCloseTo(
    593 / 1440,
    3,
  );
  expect(bands[0]!.getBoundingClientRect().bottom).toBeCloseTo(
    bands[1]!.getBoundingClientRect().top,
    1,
  );
  const description = el.shadowRoot!.getElementById(
    column(el, "mon").getAttribute("aria-describedby")!,
  );
  expect(description?.textContent).toContain("Lunch 13:00–15:53");
});

test("A724 labels coloured periods in stable department lanes", async () => {
  const other = {
    ...guideIdentity,
    departmentId: "takeaway",
    departmentName: "Takeaway",
    periodId: "midday",
    periodName: "Midday",
    periodColour: "green" as const,
    startsAt: "14:00",
    endsAt: "18:00",
  };
  const el = await grid(
    { mon: [], tue: [] },
    {
      guides: new Map([
        ["mon", [{ ...guideIdentity, startsAt: "13:00", endsAt: "16:00" }, other]],
        ["tue", [other]],
      ]),
    },
  );
  el.guideKind = "station";
  el.guideDepartmentIds = ["dining", "takeaway"];
  el.requestUpdate();
  await el.updateComplete;
  const monday = [...column(el, "mon").querySelectorAll<HTMLElement>(".guide")];
  const tuesday = column(el, "tue").querySelector<HTMLElement>(".guide")!;
  const box = column(el, "mon").getBoundingClientRect();
  expect(monday[0]!.textContent).toContain("Dining room");
  expect(monday[1]!.textContent).toContain("Takeaway");
  expect(monday[0]!.getBoundingClientRect().width / box.width).toBeCloseTo(0.5, 2);
  expect(
    monday[1]!.getBoundingClientRect().left - monday[0]!.getBoundingClientRect().left,
  ).toBeCloseTo(column(el, "mon").clientWidth / 2, 1);
  const tueBox = column(el, "tue").getBoundingClientRect();
  expect((tuesday.getBoundingClientRect().left - tueBox.left) / tueBox.width).toBeCloseTo(0.5, 2);
  expect(tuesday.getBoundingClientRect().width / tueBox.width).toBeCloseTo(0.5, 2);
});

test.each([
  { locale: "en", closed: "Closed", orders: "No orders" },
  { locale: "es", closed: "Cerrado", orders: STAFFING_STRINGS.es["staffing.grid.no_orders"] },
])(
  "A724 distinguishes closed departments from no orders in $locale",
  async ({ locale, closed, orders }) => {
    setLocale(locale);
    if (locale === "es") expect(orders).not.toBe(STAFFING_STRINGS.en["staffing.grid.no_orders"]);
    const el = await grid({ mon: null });
    expect(column(el, "mon").querySelector(".guide-empty")?.textContent).toBe(closed);
    expect(column(el, "mon").querySelector(".follows")?.textContent).not.toBe("");
    el.guideKind = "station";
    el.requestUpdate();
    await el.updateComplete;
    expect(column(el, "mon").querySelector(".guide-empty")?.textContent).toBe(orders);
    expect(column(el, "mon").querySelector(".follows")).not.toBeNull();
  },
);

test("A724 guide backgrounds use palette tokens while labels stay at text strength", async () => {
  const el = await grid(
    { mon: [] },
    { guides: new Map([["mon", [{ ...guideIdentity, startsAt: "13:00", endsAt: "16:00" }]]]) },
  );
  host.style.setProperty("--wt-color-palette-blue", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-text", "rgb(50, 60, 70)");
  const band = column(el, "mon").querySelector<HTMLElement>(".guide")!;
  expect(getComputedStyle(band, "::before").backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(band).color).toBe("rgb(50, 60, 70)");
  expect(getComputedStyle(band).opacity).toBe("1");
  expect(Number(getComputedStyle(band, "::before").opacity)).toBeGreaterThan(0);
  expect(Number(getComputedStyle(band, "::before").opacity)).toBeLessThan(1);
});

test("A724 bands leave pointer painting and keyboard block editing available", async () => {
  const el = await grid(
    { mon: [] },
    { guides: new Map([["mon", [{ ...guideIdentity, startsAt: "08:00", endsAt: "12:00" }]]]) },
  );
  const seen = changes(el);
  const guide = column(el, "mon").querySelector<HTMLElement>(".guide")!;
  const box = guide.getBoundingClientRect();
  expect(el.shadowRoot!.elementFromPoint(box.left + box.width / 2, box.top + 3)).toBe(
    column(el, "mon"),
  );
  expect(getComputedStyle(guide.querySelector(".guide-label")!).pointerEvents).toBe("none");
  await drag(el, "mon", 180, 240);
  expect(seen.at(-1)).toEqual({
    key: "mon",
    blocks: [{ staffRoleId: "sc", headcount: 1, startsAt: "09:00", endsAt: "10:00" }],
  });
  await drag(el, "mon", 360, 420);
  expect(seen.at(-1)).toEqual({
    key: "mon",
    blocks: [{ staffRoleId: "sc", headcount: 1, startsAt: "12:00", endsAt: "13:00" }],
  });
  el.days = new Map([["mon", [headChef]]]);
  await el.updateComplete;
  block(el, "mon").focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(menu(el).matches(":popover-open")).toBe(true);
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(block(el, "mon"));
  expect(guide.querySelectorAll("[tabindex],button")).toHaveLength(0);
  await userEvent.keyboard("{Delete}");
  await el.updateComplete;
  expect(seen.at(-1)).toEqual({ key: "mon", blocks: [] });
});

test("A724 a long department name leaves the period visible in its lane", async () => {
  const el = await grid(
    { mon: [], tue: [] },
    {
      guides: new Map([
        [
          "mon",
          [
            {
              ...guideIdentity,
              departmentName: "Restaurant and terrace with a very long department name",
              startsAt: "13:00",
              endsAt: "16:00",
            },
          ],
        ],
        [
          "tue",
          [
            {
              ...guideIdentity,
              departmentId: "bar",
              departmentName: "Bar",
              startsAt: "13:00",
              endsAt: "16:00",
            },
          ],
        ],
      ]),
    },
  );
  el.guideKind = "station";
  el.guideDepartmentIds = ["dining", "bar"];
  el.requestUpdate();
  await el.updateComplete;
  const band = column(el, "mon").querySelector<HTMLElement>(".guide")!;
  const labels = band.querySelectorAll<HTMLElement>(".guide-label");
  expect(labels[1]!.textContent).toContain("Lunch");
  expect(labels[1]!.getBoundingClientRect().top).toBeLessThan(band.getBoundingClientRect().bottom);
});

test("A710 editable blocks offer their full day, name, count and times as a hover tooltip", async () => {
  const el = await grid({ tue: [headChef] });
  expect(block(el, "tue").title).toBe("Tuesday, Head chef, 1 person, 09:00–16:30");
});

test("painting across an existing staffing block adds a block and retains the original", async () => {
  const el = await grid({ mon: [headChef] });
  const seen = changes(el);
  await drag(el, "mon", 240, 300, block(el, "mon"));
  expect(seen).toEqual([
    {
      key: "mon",
      blocks: [headChef, { staffRoleId: "sc", headcount: 1, startsAt: "10:00", endsAt: "11:00" }],
    },
  ]);
});
