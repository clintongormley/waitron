import { afterEach, beforeEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { SeasonChips, SeasonChip } from "./season-chips.js";
import { SEASON_TINT_TOKENS } from "./season-tint.js";
import "./season-chips.js";

const winter: SeasonChip = {
  id: "w",
  name: "Winter",
  startsOn: "12-01",
  lastDay: "02-29",
  colour: "blue",
};
const spring: SeasonChip = {
  id: "sp",
  name: "Spring",
  startsOn: "03-01",
  lastDay: "05-31",
  colour: "green",
};
const summer: SeasonChip = {
  id: "su",
  name: "Summer",
  startsOn: "06-01",
  lastDay: "08-31",
  colour: "amber",
};
const autumn: SeasonChip = {
  id: "a",
  name: "Autumn",
  startsOn: "09-01",
  lastDay: "11-30",
  colour: "orange",
};
const four: SeasonChip[] = [spring, summer, autumn, winter];

let el: SeasonChips;
beforeEach(() => setLocale("en"));
afterEach(() => {
  el?.remove();
  setLocale("en");
});

async function mount(seasons: SeasonChip[] = four) {
  el = document.createElement("season-chips");
  el.seasons = seasons;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
}
const chips = () => [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("[data-season]")];

it("labels each chip from the server's last day and tints it by its season's stored colour", async () => {
  const fifth: SeasonChip = {
    id: "x",
    name: "Late summer",
    startsOn: "08-01",
    lastDay: "08-31",
    colour: "teal",
  };
  await mount([spring, summer, { ...fifth }, autumn, winter]);
  expect(chips().map((chip) => chip.textContent!.replace(/\s+/g, " ").trim())).toEqual([
    "Spring · 1 Mar – 31 May",
    "Summer · 1 Jun – 31 Aug",
    "Late summer · 1 Aug – 31 Aug",
    "Autumn · 1 Sept – 30 Nov",
    "Winter · 1 Dec – 29 Feb",
  ]);
  expect(chips().map((chip) => chip.dataset.tint)).toEqual([
    "green",
    "amber",
    "teal",
    "orange",
    "blue",
  ]);
  expect(el.shadowRoot!.querySelector("[data-test=season-edit]")).toBeNull();
});

it("paints each chip with its season's stored colour", async () => {
  await mount();
  const probe = (value: string) => {
    const span = document.createElement("span");
    span.style.color = value;
    el.shadowRoot!.append(span);
    const read = getComputedStyle(span).color;
    span.remove();
    return read;
  };
  for (const [chip, season] of chips().map((chip, index) => [chip, four[index]!] as const)) {
    const { tint, onTint, line } = SEASON_TINT_TOKENS[season.colour];
    const painted = getComputedStyle(chip);
    expect([painted.backgroundColor, painted.color, painted.borderTopColor], season.name).toEqual([
      probe(tint),
      probe(onTint),
      probe(line),
    ]);
  }
  expect(new Set(chips().map((chip) => getComputedStyle(chip).backgroundColor)).size).toBe(
    new Set(four.map(({ colour }) => colour)).size,
  );
});

it("read-only chips offer their weeks and nothing else", async () => {
  el = document.createElement("season-chips");
  el.seasons = four;
  el.readOnly = true;
  document.body.append(el);
  await el.updateComplete;
  expect(chips().map((chip) => chip.tagName)).toEqual(["SPAN", "SPAN", "SPAN", "SPAN"]);
  expect(
    [...el.shadowRoot!.querySelectorAll("button, wt-button")].map(
      (button) => (button as HTMLElement).dataset.test,
    ),
  ).toEqual(["season-week", "season-week", "season-week", "season-week"]);
  expect(el.shadowRoot!.textContent).not.toContain("✎");
});

it("asks for a season's week from the chip's name, naming it, and opens no dialog", async () => {
  await mount();
  const asked: CustomEvent<{ seasonId: string }>[] = [];
  document.body.addEventListener("season-week-open", (event) =>
    asked.push(event as CustomEvent<{ seasonId: string }>),
  );
  const week = chips()[3]!.querySelector<HTMLElement>("[data-test=season-week]")!;
  expect(week.textContent!.trim()).toBe("Winter · 1 Dec – 29 Feb");
  expect(week.getAttribute("aria-label")).toBe("Winter · 1 Dec – 29 Feb, edit the standard week");
  week.click();
  await el.updateComplete;
  expect(asked.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
    [{ seasonId: "w" }, true, true],
  ]);
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
});

it("names the chip's week in Spanish, starting with what it shows", async () => {
  setLocale("es");
  await mount();
  const week = chips()[3]!.querySelector<HTMLElement>("[data-test=season-week]")!;
  const shown = week.textContent!.trim();
  expect(shown).toMatch(/^Winter · /);
  expect(week.getAttribute("aria-label")).toBe(`${shown}, editar la semana estándar`);
});

it("read-only, a chip's name still asks for its week, named as showing it", async () => {
  el = document.createElement("season-chips");
  el.seasons = four;
  el.readOnly = true;
  document.body.append(el);
  await el.updateComplete;
  const asked: CustomEvent<{ seasonId: string }>[] = [];
  document.body.addEventListener("season-week-open", (event) =>
    asked.push(event as CustomEvent<{ seasonId: string }>),
  );
  const week = chips()[3]!.querySelector<HTMLElement>("[data-test=season-week]")!;
  expect(week.textContent!.trim()).toBe("Winter · 1 Dec – 29 Feb");
  expect(week.getAttribute("aria-label")).toBe("Winter · 1 Dec – 29 Feb, show the standard week");
  expect(chips()[3]!.querySelector("[data-test=season-edit]")).toBeNull();
  week.click();
  await el.updateComplete;
  expect(asked.map((event) => event.detail)).toEqual([{ seasonId: "w" }]);
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
});

it("as a key only, draws each chip's name and dates with no button to press", async () => {
  el = document.createElement("season-chips");
  el.seasons = four;
  el.keyOnly = true;
  document.body.append(el);
  await el.updateComplete;
  const asked: Event[] = [];
  document.body.addEventListener("season-week-open", (event) => asked.push(event));
  expect(chips().map((chip) => chip.textContent!.trim())).toEqual([
    "Spring · 1 Mar – 31 May",
    "Summer · 1 Jun – 31 Aug",
    "Autumn · 1 Sept – 30 Nov",
    "Winter · 1 Dec – 29 Feb",
  ]);
  expect(chips()[3]!.dataset.tint).toBeTruthy();
  expect(el.shadowRoot!.querySelectorAll("button, wt-button")).toHaveLength(0);
  chips()[3]!.click();
  await el.updateComplete;
  expect(asked).toEqual([]);
});

it("slotted content follows the last chip", async () => {
  el = document.createElement("season-chips");
  el.seasons = [spring, winter];
  const extra = document.createElement("button");
  extra.textContent = "Periods…";
  el.append(extra);
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=add-season]")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("+ Season");
  const last = chips()[1]!.getBoundingClientRect();
  const box = extra.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.left).toBeGreaterThanOrEqual(last.right);
  expect(box.top).toBeLessThan(last.bottom);
  expect(box.bottom).toBeGreaterThan(last.top);
});

it("as a key only, still draws slotted content after the chips", async () => {
  el = document.createElement("season-chips");
  el.seasons = [spring, winter];
  el.keyOnly = true;
  const extra = document.createElement("span");
  extra.textContent = "after";
  el.append(extra);
  document.body.append(el);
  await el.updateComplete;
  const last = chips()[1]!.getBoundingClientRect();
  const box = extra.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.left).toBeGreaterThanOrEqual(last.right);
  expect(box.top).toBeLessThan(last.bottom);
});
