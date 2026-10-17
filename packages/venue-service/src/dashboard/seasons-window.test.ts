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

type WindowApi = Pick<OpeningHoursApi, "saveSeasons" | "readSeasonDeleteImpact">;
async function mount(
  readOnly = false,
  api: Partial<WindowApi> = {},
  specialDays: { id: string; name: string }[] = [],
) {
  const el = document.createElement("seasons-window");
  el.seasons = seasons;
  el.clockRevision = 3;
  el.specialDays = specialDays;
  el.readOnly = readOnly;
  el.api = {
    saveSeasons: vi.fn(),
    readSeasonDeleteImpact: vi.fn(),
    ...api,
  } as unknown as WindowApi;
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

type Saved = Awaited<ReturnType<WindowApi["saveSeasons"]>>;
function held() {
  let resolve!: (value: Saved) => void;
  let reject!: (error: unknown) => void;
  const answer = new Promise<Saved>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { answer, resolve, reject };
}
function savedEvents() {
  const events: CustomEvent<{ seasons: Saved }>[] = [];
  const listen = (event: Event) => events.push(event as CustomEvent<{ seasons: Saved }>);
  document.body.addEventListener("seasons-saved", listen);
  listeners.push(() => document.body.removeEventListener("seasons-saved", listen));
  return events;
}
const listeners: (() => void)[] = [];
afterEach(() => {
  for (const stop of listeners.splice(0)) stop();
});
const save = (el: SeasonsWindow) => button(el, "save-seasons")!;
const bottom = (el: SeasonsWindow) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!.error;
const startError = (el: SeasonsWindow, key: string) =>
  [...root(el).querySelectorAll(`tr[data-row="${key}"] [data-error=startsOn]`)].map((node) =>
    node.textContent!.trim(),
  );
const fieldError = (el: SeasonsWindow, name: string) =>
  (field(el, name) as unknown as { error: string }).error;
const rowErrorsShown = (el: SeasonsWindow) =>
  [...root(el).querySelectorAll<HTMLElement>("tbody [data-error]")].length +
  [...root(el).querySelectorAll<Field & { error: string }>("tbody [name]")].filter(
    (control) => control.error,
  ).length;

it("Save is quiet and disabled until the draft changes, and an undone edit makes it quiet again", async () => {
  // Moved from season-chips.test.ts:128-143's disabled and variant checks.
  const el = await mount();
  expect([save(el).disabled, save(el).variant]).toEqual([true, "secondary"]);
  await change(el, "season-0-name", "Deep winter");
  expect([save(el).disabled, save(el).variant]).toEqual([false, "primary"]);
  await change(el, "season-0-name", "Winter");
  expect([save(el).disabled, save(el).variant]).toEqual([true, "secondary"]);
});

it("one Save sends every change with the clock revision the draft was clean at, then says it saved", async () => {
  // Moved from season-chips.test.ts:128, :145, :163, :478 and :489.
  const returned: Saved = [{ id: "x", name: "X", startsOn: "01-01", colour: "grey" }];
  const saveSeasons = vi.fn(async () => returned);
  const el = await mount(false, { saveSeasons });
  const events = savedEvents();
  await press(el, button(el, "add-season")!);
  const feriaColour = field(el, "season-4-colour").value;
  await change(el, "season-0-name", "Deep winter");
  await change(el, "season-1-colour", "teal");
  await change(el, "season-2-day", "15");
  await change(el, "season-4-name", "Feria");
  await change(el, "season-4-month", "04");
  await change(el, "season-4-day", "10");
  await press(el, bins(el)[3]!);
  el.clockRevision = 9;
  await el.updateComplete;
  await press(el, save(el));
  await expect.poll(() => events.length).toBe(1);
  expect(saveSeasons).toHaveBeenCalledTimes(1);
  expect(saveSeasons).toHaveBeenCalledWith(
    {
      save: [
        { id: "winter", name: "Deep winter", startsOn: "12-01", colour: "blue" },
        { id: "spring", name: "Spring", startsOn: "03-01", colour: "teal" },
        { id: "summer", name: "Summer", startsOn: "06-15", colour: "amber" },
        { name: "Feria", startsOn: "04-10", colour: feriaColour },
      ],
      delete: ["autumn"],
    },
    3,
  );
  expect(events[0]!.detail.seasons).toBe(returned);
  expect([events[0]!.bubbles, events[0]!.composed]).toEqual([true, true]);
  await el.updateComplete;
  expect([save(el).disabled, save(el).variant, save(el).loading]).toEqual([
    true,
    "secondary",
    false,
  ]);
});

it("takes a clock revision that arrives while the draft is clean", async () => {
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => [...seasons]);
  const el = await mount(false, { saveSeasons });
  el.clockRevision = 5;
  await el.updateComplete;
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
  expect(saveSeasons.mock.calls[0]![1]).toBe(5);
});

it("swapping two starts sends one request holding both", async () => {
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => [...seasons]);
  const el = await mount(false, { saveSeasons });
  await change(el, "season-1-month", "06");
  await change(el, "season-2-month", "03");
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
  expect(saveSeasons).toHaveBeenCalledWith(
    {
      save: [
        { id: "spring", name: "Spring", startsOn: "06-01", colour: "green" },
        { id: "summer", name: "Summer", startsOn: "03-01", colour: "amber" },
      ],
      delete: [],
    },
    3,
  );
});

it("asks for a name and a start before sending, beside each row, with one message at the bottom", async () => {
  // Moved from season-chips.test.ts:178 and :430.
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => [...seasons]);
  const el = await mount(false, { saveSeasons });
  await press(el, button(el, "add-season")!);
  await press(el, save(el));
  expect(saveSeasons).not.toHaveBeenCalled();
  expect(fieldError(el, "season-4-name")).toBe("Enter a name.");
  expect(startError(el, "new-1")).toEqual(["Choose a day and a month."]);
  for (const part of ["day", "month"])
    expect(field(el, `season-4-${part}`).hasAttribute("invalid"), part).toBe(true);
  const message = root(el).querySelector<HTMLElement>(
    'tr[data-row="new-1"] [data-error=startsOn]',
  )!;
  expect(message.id).not.toBe("");
  expect(
    root(el).querySelector('tr[data-row="new-1"] [role=group]')!.getAttribute("aria-describedby"),
  ).toBe(message.id);
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  const name = field(el, "season-4-name");
  await expect.poll(() => name.shadowRoot!.activeElement?.tagName).toBe("INPUT");
  expect(save(el).disabled).toBe(true);
  // The other rows are untouched.
  expect(fieldError(el, "season-0-name")).toBe("");
  expect(startError(el, "winter")).toEqual([]);

  await change(el, "season-4-name", "Feria");
  expect(fieldError(el, "season-4-name")).toBe("");
  expect(save(el).disabled).toBe(true);
  await change(el, "season-4-month", "04");
  await change(el, "season-4-day", "10");
  expect(startError(el, "new-1")).toEqual([]);
  expect(bottom(el)).toBe("");
  expect(save(el).disabled).toBe(false);
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
});

it("marks two rows that share a name or a start", async () => {
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => [...seasons]);
  const el = await mount(false, { saveSeasons });
  await change(el, "season-1-name", " Winter ");
  await change(el, "season-2-month", "12");
  await press(el, save(el));
  expect(saveSeasons).not.toHaveBeenCalled();
  expect(fieldError(el, "season-0-name")).toBe("Another season has this name.");
  expect(fieldError(el, "season-1-name")).toBe("Another season has this name.");
  expect(fieldError(el, "season-2-name")).toBe("");
  expect(startError(el, "winter")).toEqual(["Another season starts on this day."]);
  expect(startError(el, "summer")).toEqual(["Another season starts on this day."]);
  expect(startError(el, "spring")).toEqual([]);
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
});

it.each([
  [{ field: "save.1.name", reason: "taken" }, "summer", "name", "Another season has this name."],
  [
    { field: "save.0.startsOn", reason: "taken" },
    "spring",
    "startsOn",
    "Another season starts on this day.",
  ],
  [{ field: "save.0.startsOn" }, "spring", "startsOn", "Choose a day and a month."],
  [{ field: "save.0.name" }, "spring", "name", "Enter a name."],
  [{ field: "save.0.colour" }, "spring", "colour", "Choose a colour."],
] as const)(
  "puts a refused field under its row, and keeps Save enabled (%o)",
  async (params, key, where, message) => {
    // Moved from season-chips.test.ts:226 (every row) and :346.
    const saveSeasons = vi.fn(async () => {
      throw { code: "season.invalid", params };
    });
    const el = await mount(false, { saveSeasons });
    const events = savedEvents();
    await change(el, "season-1-name", "Early spring");
    await change(el, "season-2-name", "High summer");
    await press(el, save(el));
    const index = rowKeys(el).indexOf(key);
    const shown = () =>
      where === "startsOn"
        ? startError(el, key).join("")
        : fieldError(el, `season-${index}-${where}`);
    await expect.poll(shown).toBe(message);
    expect(rowErrorsShown(el)).toBe(1);
    expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect([save(el).disabled, save(el).variant]).toEqual([false, "primary"]);
    expect(events).toEqual([]);
    if (where === "startsOn") await change(el, `season-${index}-day`, "2");
    else if (where === "colour") await change(el, `season-${index}-colour`, "teal");
    else await change(el, `season-${index}-name`, "Another");
    expect(shown()).toBe("");
    expect(bottom(el)).toBe("");
  },
);

it("a refused field stays with the row the request named, not the row now at that place", async () => {
  const saveSeasons = vi.fn(async () => {
    throw { code: "season.invalid", params: { field: "save.0.name", reason: "taken" } };
  });
  const el = await mount(false, { saveSeasons });
  await change(el, "season-2-name", "High summer");
  await press(el, save(el));
  await expect.poll(() => fieldError(el, "season-2-name")).toBe("Another season has this name.");
  expect(fieldError(el, "season-0-name")).toBe("");
});

it.each([
  [
    {
      code: "season.invalid",
      params: { field: "seasons", reason: "end_offset", seasonId: "autumn", weekday: 5 },
    },
    "A period’s end offset would run into Autumn on Friday.",
  ],
  [
    {
      code: "season.invalid",
      params: { field: "seasons", reason: "end_offset", date: "2026-12-24", specialDayId: "sd1" },
    },
    "A period’s end offset would run into Christmas dinners on Thu, 24 Dec 2026.",
  ],
  [
    {
      code: "season.invalid",
      params: { field: "seasons", reason: "end_offset", date: "2031-12-24", specialDayId: "other" },
    },
    "A period’s end offset would run into Wed, 24 Dec 2031.",
  ],
  [{ code: "hours.clock_changed" }, "The business-day start changed. Reload hours."],
  [
    { code: "hours.clock_change_pending" },
    "Cancel the pending business-day change before editing hours.",
  ],
  [
    { code: "season.invalid", params: { field: "delete", reason: "last" } },
    "A venue keeps at least one season.",
  ],
  [{ code: "season.not_found", params: { seasonId: "autumn" } }, "This season no longer exists."],
  [{ code: "network.unavailable" }, "The change could not be saved."],
])(
  "says an end-offset clash, a changed or pending business-day start and the last season at the bottom (%o)",
  async (refusal, message) => {
    // Moved from season-chips.test.ts:249 (every row), :286 and :301.
    const saveSeasons = vi.fn(async () => {
      throw refusal;
    });
    const el = await mount(false, { saveSeasons }, [{ id: "sd1", name: "Christmas dinners" }]);
    const events = savedEvents();
    await change(el, "season-3-day", "15");
    await press(el, save(el));
    await expect.poll(() => bottom(el)).toBe(message);
    expect(rowErrorsShown(el)).toBe(0);
    expect(field(el, "season-3-day").value).toBe("15");
    expect(root(el).querySelector("wt-modal")!.open).toBe(true);
    expect(events).toEqual([]);
    expect(save(el).disabled).toBe(false);
  },
);

it("while saving, Save shows busy, nothing else acts, and Escape does not close", async () => {
  // Moved from season-chips.test.ts:376 and :399.
  const { answer, reject } = held();
  const saveSeasons = vi.fn(() => answer);
  const el = await mount(false, { saveSeasons });
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  expect(save(el).loading).toBe(true);
  for (const name of ["season-0-name", "season-0-day", "season-0-month", "season-0-colour"])
    expect((field(el, name) as unknown as { disabled: boolean }).disabled, name).toBe(true);
  for (const test of ["add-season", "cancel-seasons"])
    expect(button(el, test)!.disabled, test).toBe(true);
  for (const bin of bins(el)) expect(bin.disabled).toBe(true);
  await press(el, save(el));
  save(el).dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(saveSeasons).toHaveBeenCalledTimes(1);
  const modal = root(el).querySelector("wt-modal")!;
  expect(await modal.requestClose("escape")).toBe(false);
  expect(await modal.requestClose("cancel")).toBe(false);
  await userEvent.keyboard("{Escape}");
  await el.updateComplete;
  expect(modal.open).toBe(true);
  reject({ code: "hours.clock_changed" });
  await expect.poll(() => save(el).loading).toBe(false);
  expect(field(el, "season-0-name").hasAttribute("disabled")).toBe(false);
});

it("Enter in a field presses Save", async () => {
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => [...seasons]);
  const el = await mount(false, { saveSeasons });
  await change(el, "season-0-name", "Deep winter");
  field(el, "season-0-name").shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
});

it("a save's answer that arrives after the window was closed and reopened neither closes the new window nor commits its draft", async () => {
  // Moved from season-chips.test.ts:501 ("keeps a save busy when an earlier save…"): an answer from
  // an earlier opening must not end a later one's state.
  const { answer, resolve } = held();
  const el = await mount(false, { saveSeasons: vi.fn(() => answer) });
  const events = savedEvents();
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  expect(save(el).loading).toBe(true);
  el.remove();
  document.body.append(el);
  await el.updateComplete;
  expect(save(el).loading).toBe(false);
  await change(el, "season-0-name", "Cold");
  resolve([...seasons]);
  await answer;
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(save(el).loading).toBe(false);
  expect([save(el).disabled, save(el).variant]).toEqual([false, "primary"]);
  expect(field(el, "season-0-name").value).toBe("Cold");
});

it("the same answer without a reopen does say it saved", async () => {
  const { answer, resolve } = held();
  const el = await mount(false, { saveSeasons: vi.fn(() => answer) });
  const events = savedEvents();
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  resolve([...seasons]);
  await expect.poll(() => events.length).toBe(1);
});

it("a refusal from an earlier opening shows nothing in the new one", async () => {
  const { answer, reject } = held();
  const el = await mount(false, { saveSeasons: vi.fn(() => answer) });
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  el.remove();
  document.body.append(el);
  await el.updateComplete;
  reject({ code: "season.invalid", params: { field: "save.0.name", reason: "taken" } });
  await answer.catch(() => undefined);
  await el.updateComplete;
  expect(bottom(el)).toBe("");
  expect(rowErrorsShown(el)).toBe(0);
});

it("a Discard restores the baseline but never reuses a new row's key", async () => {
  type Owner = {
    current(): unknown;
    snapshot(value: unknown): unknown;
    equal(a: unknown, b: unknown): boolean;
    restore(value: unknown): void;
  };
  let owner: Owner | undefined;
  let base: unknown;
  const provide = (event: Event) => {
    (event as CustomEvent<{ accept(value: unknown): void }>).detail.accept({
      register(registered: Owner) {
        owner = registered;
        base = registered.snapshot(registered.current());
        return {
          id: {},
          changed() {},
          isDirty: () => !registered.equal(base, registered.current()),
          commit(value: unknown) {
            base = registered.snapshot(value);
          },
          dispose() {},
        };
      },
    });
  };
  document.body.addEventListener("wt-leave-coordinator", provide);
  listeners.push(() => document.body.removeEventListener("wt-leave-coordinator", provide));
  const el = await mount();
  expect(owner).toBeDefined();
  await press(el, button(el, "add-season")!);
  await press(el, button(el, "add-season")!);
  expect(rowKeys(el)).toContain("new-2");
  owner!.restore(owner!.snapshot(base));
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn"]);
  expect(save(el).disabled).toBe(true);
  await press(el, button(el, "add-season")!);
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn", "new-3"]);
});

it("an earlier opening's answer leaves the new opening's own Save busy", async () => {
  const first = held();
  const second = held();
  const saveSeasons = vi
    .fn<WindowApi["saveSeasons"]>()
    .mockReturnValueOnce(first.answer)
    .mockReturnValueOnce(second.answer);
  const el = await mount(false, { saveSeasons });
  const events = savedEvents();
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  el.remove();
  document.body.append(el);
  await el.updateComplete;
  await change(el, "season-0-name", "Cold");
  await press(el, save(el));
  expect(saveSeasons).toHaveBeenCalledTimes(2);
  expect(save(el).loading).toBe(true);
  first.resolve([...seasons]);
  await first.answer;
  await el.updateComplete;
  expect(save(el).loading).toBe(true);
  expect(events).toEqual([]);
  second.resolve([...seasons]);
  await expect.poll(() => events.length).toBe(1);
  expect(save(el).loading).toBe(false);
});
