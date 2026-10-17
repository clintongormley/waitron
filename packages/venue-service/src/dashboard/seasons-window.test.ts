import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { SeasonsWindow } from "./seasons-window.js";
import "./seasons-window.js";

const seasons = [
  { id: "spring", name: "Spring", startsOn: "03-01", colour: "green" as const },
  { id: "summer", name: "Summer", startsOn: "06-01", colour: "amber" as const },
  { id: "autumn", name: "Autumn", startsOn: "09-01", colour: "orange" as const },
  { id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" as const },
];
const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

async function mount(readOnly = false) {
  const el = document.createElement("seasons-window");
  el.seasons = seasons;
  el.clockRevision = 3;
  el.specialDays = [];
  el.readOnly = readOnly;
  el.api = {
    saveSeasons: vi.fn(),
    readSeasonDeleteImpact: vi.fn(),
  } as unknown as Pick<OpeningHoursApi, "saveSeasons" | "readSeasonDeleteImpact">;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const root = (el: SeasonsWindow) => el.shadowRoot!;
const rowKeys = (el: SeasonsWindow) =>
  [...root(el).querySelectorAll<HTMLElement>("tbody tr")].map((row) => row.dataset.row);
const rowNames = (el: SeasonsWindow) =>
  [...root(el).querySelectorAll<HTMLElement>("tbody tr")].map(
    (_, index) => field(el, `season-${index}-name`).value,
  );
type Field = HTMLElement & {
  value: string;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};
function field(el: SeasonsWindow, name: string): Field {
  const control = root(el).querySelector<Field>(`[name="${name}"]`);
  expect(control, `field ${name}`).not.toBeNull();
  return control!;
}
async function change(el: SeasonsWindow, name: string, value: string) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
const runsUntil = (el: SeasonsWindow, key: string) =>
  root(el).querySelector(`tr[data-row="${key}"] [data-test=runs-until]`)!.textContent!.trim();
const headings = (el: SeasonsWindow) =>
  [...root(el).querySelectorAll("thead th")].map((th) =>
    th.textContent!.replace(/\s+/g, " ").trim(),
  );
const bins = (el: SeasonsWindow) => [
  ...root(el).querySelectorAll<HTMLElementTagNameMap["wt-button"]>("[data-test=delete-season]"),
];
const button = (el: SeasonsWindow, test: string) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${test}]`);
async function press(el: SeasonsWindow, target: HTMLElement) {
  target.shadowRoot!.querySelector("button")!.click();
  await el.updateComplete;
}

it("draws a wide modal headed Seasons, marked as the seasons calendar window", async () => {
  const el = await mount();
  expect(el.dataset.test).toBe("calendar-window");
  expect(el.dataset.window).toBe("seasons");
  const modal = root(el).querySelector("wt-modal")!;
  expect(modal.heading).toBe("Seasons");
  expect(modal.size).toBeUndefined();
  const guard = async () => true;
  el.beforeClose = guard;
  await el.updateComplete;
  expect(modal.beforeClose).toBe(guard);
});

it("lists every season from the one in force on 1 January, with colour, name, start and Runs until", async () => {
  const el = await mount();
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn"]);
  expect(rowNames(el)).toEqual(["Winter", "Spring", "Summer", "Autumn"]);
  const colour = root(el).querySelector<HTMLElementTagNameMap["wt-colour-chooser"]>(
    "wt-colour-chooser[name=season-0-colour]",
  )!;
  expect(colour.value).toBe("blue");
  expect(colour.hideLabel).toBe(true);
  expect(colour.label).toBe("Colour");
  expect(field(el, "season-0-name").getAttribute("label")).toBe("Name");
  expect(field(el, "season-0-day").value).toBe("1");
  expect(field(el, "season-0-day").getAttribute("label")).toBe("Day");
  expect(field(el, "season-0-month").value).toBe("12");
  expect(field(el, "season-0-month").getAttribute("label")).toBe("Month");
  for (const name of ["season-0-name", "season-0-day", "season-0-month"])
    expect(field(el, name).hasAttribute("hide-label"), name).toBe(true);
  expect(runsUntil(el, "winter")).toBe("28 Feb");
  expect(runsUntil(el, "spring")).toBe("31 May");
  expect(headings(el).slice(0, 4)).toEqual(["Colour", "Season*", "Starts on*", "Runs until"]);
  expect(root(el).querySelector("[data-test=window-hint]")!.textContent!.trim()).toBe(
    "A season runs until the next one starts. The list re-sorts by start date when you save.",
  );
  expect(button(el, "add-season")!.textContent!.trim()).toBe("+ Season");
  expect(button(el, "add-season")!.variant).toBe("secondary");
});

it("edits a name, a colour and a start in place, and Runs until follows the draft", async () => {
  const el = await mount();
  await change(el, "season-2-name", "High summer");
  expect(field(el, "season-2-name").value).toBe("High summer");
  await change(el, "season-2-colour", "teal");
  expect(field(el, "season-2-colour").value).toBe("teal");
  await change(el, "season-2-day", "15");
  await change(el, "season-2-month", "06");
  expect(runsUntil(el, "spring")).toBe("14 Jun");
  expect(runsUntil(el, "summer")).toBe("31 Aug");
  // Rows keep their place while editing.
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn"]);

  await change(el, "season-1-day", "31");
  await change(el, "season-1-month", "04");
  expect(field(el, "season-1-day").value).toBe("30");
  expect(field(el, "season-1-day").options).toHaveLength(30);
  await change(el, "season-1-month", "02");
  expect(field(el, "season-1-day").value).toBe("28");
  expect(field(el, "season-1-day").options.map((option) => option.value)).toEqual(
    Array.from({ length: 28 }, (_, index) => String(index + 1)),
  );
  expect(field(el, "season-1-month").options.map((option) => option.label)).toContain("February");
});

it("+ Season adds an empty row at the end, offered the first calendar colour no row uses", async () => {
  const el = await mount();
  await press(el, button(el, "add-season")!);
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn", "new-1"]);
  expect(field(el, "season-4-colour").value).toBe("red");
  expect(field(el, "season-4-name").value).toBe("");
  expect(field(el, "season-4-day").value).toBe("");
  expect(field(el, "season-4-month").value).toBe("");
  expect(runsUntil(el, "new-1")).toBe("");
  expect(bins(el)[4]!.getAttribute("aria-label")).toBe("Delete this new season");
  await press(el, button(el, "add-season")!);
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn", "new-1", "new-2"]);
  expect(field(el, "season-5-colour").value).toBe("lime");
  await change(el, "season-4-name", "Carnival");
  expect(bins(el)[4]!.getAttribute("aria-label")).toBe("Delete Carnival");
});

it("the colour chooser names the other rows that use each colour", async () => {
  const el = await mount();
  const chooser = field(
    el,
    "season-0-colour",
  ) as unknown as HTMLElementTagNameMap["wt-colour-chooser"];
  const green = chooser.choices.find((choice) => choice.value === "green")!;
  expect(green.usedBy).toEqual(["Spring"]);
  expect(chooser.choices.find((choice) => choice.value === "blue")!.usedBy).toEqual([]);
  expect(chooser.usedByLabel!("Green", "Spring")).toBe("Green, used by Spring");
});

it("the bin removes a row; the last row's bin is disabled", async () => {
  const el = await mount();
  expect(bins(el).map((bin) => bin.getAttribute("aria-label"))).toEqual([
    "Delete Winter",
    "Delete Spring",
    "Delete Summer",
    "Delete Autumn",
  ]);
  await press(el, bins(el)[2]!);
  expect(rowKeys(el)).toEqual(["winter", "spring", "autumn"]);
  expect(runsUntil(el, "spring")).toBe("31 Aug");
  await press(el, bins(el)[0]!);
  await press(el, bins(el)[0]!);
  expect(rowKeys(el)).toEqual(["autumn"]);
  expect(bins(el)).toHaveLength(1);
  expect(bins(el)[0]!.disabled).toBe(true);
});

it("marks the name, day and month of every row required, the heading drawing the one asterisk", async () => {
  const el = await mount();
  const marks = [...root(el).querySelectorAll("thead th")].map(
    (th) => th.querySelector(".required[aria-hidden=true]")?.textContent ?? null,
  );
  expect(marks.slice(0, 4)).toEqual([null, "*", "*", null]);
  await press(el, button(el, "add-season")!);
  for (let index = 0; index < 5; index += 1) {
    const name = field(el, `season-${index}-name`);
    expect(name.shadowRoot!.querySelector("input")!.required, `row ${index} name`).toBe(true);
    for (const part of ["day", "month"]) {
      const combobox = field(el, `season-${index}-${part}`);
      expect(combobox.hasAttribute("required"), `row ${index} ${part}`).toBe(true);
    }
    for (const part of ["name", "day", "month", "colour"]) {
      const control = field(el, `season-${index}-${part}`);
      await control.updateComplete;
      expect(
        control.shadowRoot!.querySelector("[data-required], .required"),
        `row ${index} ${part} draws its own asterisk`,
      ).toBeNull();
    }
  }
});

it("Save stays quiet and disabled until the draft changes", async () => {
  const el = await mount();
  const save = button(el, "save-seasons")!;
  expect(save.textContent!.trim()).toBe("Save");
  expect(save.disabled).toBe(true);
  expect(save.variant).toBe("secondary");
  await change(el, "season-0-name", "Winter ");
  expect(save.disabled).toBe(true);
  await change(el, "season-0-name", "Deep winter");
  expect(save.disabled).toBe(false);
  expect(save.variant).toBe("primary");
});

it("Cancel asks the modal to close for cancel", async () => {
  const el = await mount();
  const reasons: string[] = [];
  el.beforeClose = async (reason) => {
    reasons.push(reason);
    return true;
  };
  await el.updateComplete;
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve, { once: true }));
  const cancel = button(el, "cancel-seasons")!;
  expect(cancel.getAttribute("slot")).toBe("cancel");
  expect(cancel.textContent!.trim()).toBe("Cancel");
  await userEvent.click(cancel);
  await closed;
  expect(reasons).toEqual(["cancel"]);
});

it("a viewer sees the table as text with Close and nothing to change", async () => {
  const el = await mount(true);
  for (const selector of [
    "wt-input",
    "wt-combobox",
    "wt-colour-chooser",
    "[data-test=delete-season]",
    "[data-test=add-season]",
    "[data-test=save-seasons]",
    "[data-test=cancel-seasons]",
  ])
    expect(root(el).querySelector(selector), selector).toBeNull();
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn"]);
  const winter = root(el).querySelector<HTMLElement>("tr[data-row=winter]")!;
  const cells = [...winter.querySelectorAll("td")].map((td) =>
    td.textContent!.replace(/\s+/g, " ").trim(),
  );
  expect(cells).toEqual(["Blue", "Winter", "1 Dec", "28 Feb"]);
  const swatch = winter.querySelector<HTMLElement>("[data-tint]")!;
  expect(swatch.dataset.tint).toBe("blue");
  expect(getComputedStyle(swatch).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(headings(el)).toEqual(["Colour", "Season", "Starts on", "Runs until"]);
  const close = button(el, "close-seasons")!;
  expect(close.getAttribute("slot")).toBe("cancel");
  expect(close.textContent!.trim()).toBe("Close");
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve, { once: true }));
  await userEvent.click(close);
  await closed;
});

it("Spanish", async () => {
  try {
    setLocale("es");
    const el = await mount();
    expect(headings(el).slice(0, 4)).toEqual(["Color", "Temporada*", "Empieza el*", "Hasta el"]);
    expect(root(el).querySelector("[data-test=window-hint]")!.textContent!.trim()).toBe(
      "Una temporada dura hasta que empieza la siguiente. La lista se ordena por fecha de inicio al guardar.",
    );
    expect(bins(el)[0]!.getAttribute("aria-label")).toBe("Eliminar Winter");
    await press(el, button(el, "add-season")!);
    expect(bins(el)[4]!.getAttribute("aria-label")).toBe("Eliminar esta temporada nueva");
    expect(runsUntil(el, "winter")).toBe("28 feb");
  } finally {
    setLocale("en");
  }
});

const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
function inside(box: DOMRect) {
  expect(box.width).toBeGreaterThan(0);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(window.innerWidth);
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
}

it.each(["en", "es"] as const)(
  "fits the window at 1280 and scrolls only its table at 390 (%s)",
  async (locale) => {
    const old = [window.innerWidth, window.innerHeight] as const;
    try {
      setLocale(locale);
      await page.viewport(1280, 900);
      expect(window.innerWidth).toBe(1280);
      const el = await mount();
      await frames();
      const region = root(el).querySelector<HTMLElement>(".table-wrap")!;
      expect(region.getAttribute("role")).toBe("region");
      expect(region.tabIndex).toBe(0);
      expect(region.getAttribute("aria-label")).toBe(locale === "en" ? "Seasons" : "Temporadas");
      expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth);

      await page.viewport(390, 800);
      expect(window.innerWidth).toBe(390);
      await frames();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
      expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
      const body = root(el)
        .querySelector("wt-modal")!
        .shadowRoot!.querySelector<HTMLElement>(".body")!;
      expect(body.scrollWidth, "the window's body scrolls sideways").toBeLessThanOrEqual(
        body.clientWidth,
      );
      for (const test of ["cancel-seasons", "save-seasons"])
        inside(button(el, test)!.getBoundingClientRect());
      const chooser = field(el, "season-0-colour");
      await userEvent.click(chooser.shadowRoot!.querySelector<HTMLElement>("button.trigger")!);
      const panel = chooser.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      await expect.poll(() => panel.matches(":popover-open")).toBe(true);
      await frames();
      inside(panel.getBoundingClientRect());
    } finally {
      setLocale("en");
      await page.viewport(old[0], old[1]);
    }
  },
);
