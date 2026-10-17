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
  const guard = vi.fn(async () => true);
  el.beforeClose = guard;
  await el.updateComplete;
  expect(await modal.beforeClose!("cancel")).toBe(true);
  expect(guard).toHaveBeenCalledWith("cancel");
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

const focused = (el: SeasonsWindow) => root(el).activeElement;
const innerButton = (host: HTMLElement) => host.shadowRoot!.querySelector<HTMLElement>("button")!;

it("a bin pressed with the mouse hands focus to the bin of the row that took its place", async () => {
  const el = await mount();
  await userEvent.click(innerButton(bins(el)[1]!));
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter", "summer", "autumn"]);
  expect(focused(el)).toBe(bins(el)[1]);
  expect(bins(el)[1]!.shadowRoot!.activeElement).toBe(innerButton(bins(el)[1]!));
});

it("a bin pressed from the keyboard on the last row hands focus to the row above's bin, and the one row left hands it to + Season", async () => {
  const el = await mount();
  bins(el)[3]!.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer"]);
  expect(focused(el)).toBe(bins(el)[2]);
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(focused(el)).toBe(bins(el)[1]);
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter"]);
  expect(bins(el)[0]!.disabled).toBe(true);
  expect(focused(el)).toBe(button(el, "add-season"));
});

it("after a bin, Escape asks the leave question without a Tab first", async () => {
  const el = await mount();
  const guard = vi.fn(async () => false);
  el.beforeClose = guard;
  await el.updateComplete;
  await userEvent.click(innerButton(bins(el)[0]!));
  await el.updateComplete;
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => guard.mock.calls.length).toBe(1);
  expect(guard).toHaveBeenCalledWith("escape");
  expect(root(el).querySelector("wt-modal")!.open).toBe(true);
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

it.each(["en", "es"] as const)(
  "at 390 every row's bin and Day box are on screen on opening, and the bin stays put while the table scrolls (%s)",
  async (locale) => {
    const old = [window.innerWidth, window.innerHeight] as const;
    try {
      setLocale(locale);
      await page.viewport(390, 800);
      expect(window.innerWidth).toBe(390);
      const el = await mount();
      await change(el, "season-1-day", "31");
      await frames();
      expect(document.documentElement.scrollWidth).toBe(window.innerWidth);
      const day = field(el, "season-1-day").shadowRoot!.querySelector<HTMLElement>(".value")!;
      expect(day.textContent!.trim()).toBe("31");
      expect(day.scrollWidth, "the Day box shows 31 whole").toBeLessThanOrEqual(day.clientWidth);
      const modal = root(el).querySelector("wt-modal")!;
      const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!.getBoundingClientRect();
      const region = root(el).querySelector<HTMLElement>(".table-wrap")!;
      const shown = region.getBoundingClientRect();
      const within = (box: DOMRect, what: string) => {
        expect(box.width, what).toBeGreaterThan(0);
        expect(box.left, what).toBeGreaterThanOrEqual(Math.max(shown.left, body.left));
        expect(box.right, what).toBeLessThanOrEqual(Math.min(shown.right, body.right));
      };
      const rows = root(el).querySelectorAll("tbody tr");
      expect(rows).toHaveLength(4);
      const check = () =>
        rows.forEach((row, index) =>
          within(
            row.querySelector("[data-test=delete-season]")!.getBoundingClientRect(),
            `row ${index}'s bin`,
          ),
        );
      check();
      const binCell = rows[0]!.querySelector<HTMLElement>("td.bin")!;
      rows.forEach((row, index) => {
        const day = row.querySelector("wt-combobox[name$=-day]")!.getBoundingClientRect();
        within(day, `row ${index}'s Day box`);
        expect(day.right, `row ${index}'s Day box clears the bin column`).toBeLessThanOrEqual(
          binCell.getBoundingClientRect().left,
        );
      });

      expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
      region.scrollLeft = region.scrollWidth;
      await frames();
      expect(region.scrollLeft).toBeGreaterThan(0);
      check();
      const surface = getComputedStyle(modal.shadowRoot!.querySelector("dialog")!).backgroundColor;
      for (const cell of [binCell, root(el).querySelector<HTMLElement>("thead th:last-child")!])
        expect(getComputedStyle(cell).backgroundColor).toBe(surface);
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
  const el = await mount();
  expect([save(el).disabled, save(el).variant]).toEqual([true, "secondary"]);
  await change(el, "season-0-name", "Deep winter");
  expect([save(el).disabled, save(el).variant]).toEqual([false, "primary"]);
  await change(el, "season-0-name", "Winter");
  expect([save(el).disabled, save(el).variant]).toEqual([true, "secondary"]);
});

it("one Save sends every change with the clock revision the draft was clean at, then says it saved", async () => {
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
  [
    {
      code: "season.invalid",
      params: { field: "seasons", reason: "end_offset", date: "2026-12-24" },
    },
    "A period’s end offset would run into Thu, 24 Dec 2026.",
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
  [
    { code: "season.not_found", params: { seasonId: "elsewhere" } },
    "This season no longer exists.",
  ],
  [{ code: "network.unavailable" }, "The change could not be saved."],
])(
  "says an end-offset clash, a changed or pending business-day start and the last season at the bottom (%o)",
  async (refusal, message) => {
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

it("while saving, Save shows busy, nothing else acts, and Escape does not close until the save ends", async () => {
  const { answer, reject } = held();
  const saveSeasons = vi.fn(() => answer);
  const el = await mount(false, { saveSeasons });
  const guard = vi.fn(async () => true);
  el.beforeClose = guard;
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
  expect(guard).not.toHaveBeenCalled();
  reject({ code: "hours.clock_changed" });
  await expect.poll(() => save(el).loading).toBe(false);
  expect(field(el, "season-0-name").hasAttribute("disabled")).toBe(false);
  const closed = new Promise<void>((resolve) =>
    modal.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  field(el, "season-0-name").focus();
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(guard).toHaveBeenCalledTimes(1);
  expect(guard).toHaveBeenCalledWith("escape");
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

type Owner = {
  current(): unknown;
  snapshot(value: unknown): unknown;
  equal(a: unknown, b: unknown): boolean;
  restore(value: unknown): void;
};
/** A leave coordinator that hands out plain baselines and records every scope it registers. */
function fakeCoordinator() {
  const scopes: { owner: Owner; base: () => unknown; isDirty(): boolean; disposed: boolean }[] = [];
  const provide = (event: Event) => {
    (event as CustomEvent<{ accept(value: unknown): void }>).detail.accept({
      register(owner: Owner) {
        let base = owner.snapshot(owner.current());
        const entry = {
          owner,
          base: () => base,
          isDirty: () => !owner.equal(base, owner.current()),
          disposed: false,
        };
        scopes.push(entry);
        return {
          id: {},
          changed() {},
          isDirty: entry.isDirty,
          commit(value: unknown) {
            base = owner.snapshot(value);
          },
          dispose() {
            entry.disposed = true;
          },
        };
      },
    });
  };
  document.body.addEventListener("wt-leave-coordinator", provide);
  listeners.push(() => document.body.removeEventListener("wt-leave-coordinator", provide));
  return { scopes, live: () => scopes.filter((scope) => !scope.disposed) };
}

it("a Discard restores the baseline but never reuses a new row's key", async () => {
  const leave = fakeCoordinator();
  const el = await mount(false, {
    saveSeasons: vi.fn(async () => {
      throw { code: "hours.clock_changed" };
    }),
  });
  expect(leave.live()).toHaveLength(1);
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  await expect.poll(() => bottom(el)).toBe("The business-day start changed. Reload hours.");
  await press(el, button(el, "add-season")!);
  await press(el, button(el, "add-season")!);
  expect(rowKeys(el)).toContain("new-2");
  expect(fieldError(el, "season-4-name")).toBe("Enter a name.");
  const [scope] = leave.live();
  scope!.owner.restore(scope!.owner.snapshot(scope!.base()));
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn"]);
  expect(save(el).disabled).toBe(true);
  expect(bottom(el)).toBe("");
  await press(el, button(el, "add-season")!);
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn", "new-3"]);
  expect(rowErrorsShown(el)).toBe(0);
});

it("a window taken off the page and put back after a redraw still guards and saves its edit", async () => {
  const leave = fakeCoordinator();
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => [...seasons]);
  const el = await mount(false, { saveSeasons });
  await change(el, "season-0-name", "Deep winter");
  el.remove();
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(leave.live()).toHaveLength(0);
  document.body.append(el);
  await el.updateComplete;
  expect(leave.live()).toHaveLength(1);
  expect(leave.live()[0]!.isDirty()).toBe(true);
  expect([save(el).disabled, save(el).variant]).toEqual([false, "primary"]);
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
});

it("a refused field the request did not hold says the change could not be saved", async () => {
  const el = await mount(false, {
    saveSeasons: vi.fn(async () => {
      throw { code: "season.invalid", params: { field: "save.5.name", reason: "taken" } };
    }),
  });
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  await expect.poll(() => bottom(el)).toBe("The change could not be saved.");
  expect(rowErrorsShown(el)).toBe(0);
});

it("binning the row a refusal marked takes the bottom message away", async () => {
  const el = await mount(false, {
    saveSeasons: vi.fn(async () => {
      throw { code: "season.invalid", params: { field: "save.0.name", reason: "taken" } };
    }),
  });
  await change(el, "season-2-name", "High summer");
  await press(el, save(el));
  await expect.poll(() => fieldError(el, "season-2-name")).toBe("Another season has this name.");
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  await press(el, bins(el)[2]!);
  expect(rowErrorsShown(el)).toBe(0);
  expect(bottom(el)).toBe("");
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

type Impact = Awaited<ReturnType<WindowApi["readSeasonDeleteImpact"]>>;
function heldImpact() {
  let resolve!: (value: Impact) => void;
  let reject!: (error: unknown) => void;
  const answer = new Promise<Impact>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { answer, resolve, reject };
}
const notes = (el: SeasonsWindow) =>
  [...root(el).querySelectorAll("[data-test=delete-note]")].map((note) =>
    note.textContent!.replace(/\s+/g, " ").trim(),
  );

it("binning a stored season says where its days go and what is lost", async () => {
  const autumn = heldImpact();
  const spring = heldImpact();
  const summer = heldImpact();
  const readSeasonDeleteImpact = vi
    .fn<WindowApi["readSeasonDeleteImpact"]>()
    .mockReturnValueOnce(autumn.answer)
    .mockReturnValueOnce(spring.answer)
    .mockReturnValueOnce(summer.answer);
  const el = await mount(false, { readSeasonDeleteImpact });
  expect(notes(el)).toEqual([]);
  await press(el, bins(el)[3]!);
  expect(readSeasonDeleteImpact).toHaveBeenCalledTimes(1);
  expect(readSeasonDeleteImpact).toHaveBeenCalledWith("autumn");
  expect(notes(el)).toEqual(["Saving deletes Autumn; its days join Summer."]);
  autumn.resolve({
    departments: [
      { id: "b", name: "Bar" },
      { id: "k", name: "Kitchen" },
    ],
  });
  await expect
    .poll(() => notes(el))
    .toEqual([
      "Saving deletes Autumn; its days join Summer. The hours of Bar and Kitchen in it are lost.",
    ]);

  await press(el, bins(el)[1]!);
  spring.resolve({ departments: [] });
  await press(el, bins(el)[1]!);
  summer.reject({ code: "network.unavailable" });
  await expect
    .poll(() => notes(el))
    .toEqual([
      "Saving deletes Autumn; its days join Winter. The hours of Bar and Kitchen in it are lost.",
      "Saving deletes Spring; its days join Winter. No department has hours in it.",
      "Saving deletes Summer; its days join Winter. Which departments lose hours could not be read.",
    ]);
  expect(readSeasonDeleteImpact).toHaveBeenCalledTimes(3);

  await press(el, button(el, "add-season")!);
  await press(el, bins(el)[1]!);
  expect(readSeasonDeleteImpact).toHaveBeenCalledTimes(3);
  expect(notes(el)).toHaveLength(3);
});

it("a newer impact read's answer wins over an older one", async () => {
  const leave = fakeCoordinator();
  const older = heldImpact();
  const newer = heldImpact();
  const readSeasonDeleteImpact = vi
    .fn<WindowApi["readSeasonDeleteImpact"]>()
    .mockReturnValueOnce(older.answer)
    .mockReturnValueOnce(newer.answer);
  const el = await mount(false, { readSeasonDeleteImpact });
  await press(el, bins(el)[3]!);
  const [scope] = leave.live();
  scope!.owner.restore(scope!.owner.snapshot(scope!.base()));
  await el.updateComplete;
  expect(notes(el)).toEqual([]);
  await press(el, bins(el)[3]!);
  newer.resolve({ departments: [{ id: "b", name: "Bar" }] });
  await expect
    .poll(() => notes(el))
    .toEqual(["Saving deletes Autumn; its days join Summer. The hours of Bar in it are lost."]);
  older.resolve({ departments: [{ id: "r", name: "Restaurant" }] });
  await older.answer;
  await el.updateComplete;
  expect(notes(el)).toEqual([
    "Saving deletes Autumn; its days join Summer. The hours of Bar in it are lost.",
  ]);
});

it("Spanish: the bin and the delete note", async () => {
  try {
    setLocale("es");
    const impact = heldImpact();
    const el = await mount(false, {
      readSeasonDeleteImpact: vi.fn(() => impact.answer),
    });
    el.seasons = [
      { id: "spring", name: "Primavera", startsOn: "03-01", colour: "green" },
      { id: "summer", name: "Verano", startsOn: "06-01", colour: "amber" },
      { id: "autumn", name: "Otoño", startsOn: "09-01", colour: "orange" },
      { id: "winter", name: "Invierno", startsOn: "12-01", colour: "blue" },
    ];
    await el.updateComplete;
    expect(bins(el)[3]!.getAttribute("aria-label")).toBe("Eliminar Otoño");
    await press(el, bins(el)[3]!);
    expect(notes(el)).toEqual(["Al guardar se elimina Otoño; sus días pasan a Verano."]);
    impact.resolve({
      departments: [
        { id: "b", name: "Bar" },
        { id: "k", name: "Kitchen" },
      ],
    });
    await expect
      .poll(() => notes(el))
      .toEqual([
        "Al guardar se elimina Otoño; sus días pasan a Verano. Se pierden los horarios de Bar y Kitchen en ella.",
      ]);
    await press(el, button(el, "add-season")!);
    for (let count = 0; count < 3; count += 1) await press(el, bins(el)[0]!);
    expect(notes(el)[0]).toBe(
      "Al guardar se elimina Otoño. Se pierden los horarios de Bar y Kitchen en ella.",
    );
  } finally {
    setLocale("en");
  }
});

it("a season another session deleted is marked under a row the person changed", async () => {
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => [...seasons]);
  const el = await mount(false, { saveSeasons });
  await change(el, "season-0-name", "Deep winter");
  await change(el, "season-1-name", "Early spring");
  el.seasons = seasons.filter((season) => season.id !== "spring" && season.id !== "summer");
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter", "spring", "autumn"]);
  expect(fieldError(el, "season-1-name")).toBe("This season no longer exists.");
  expect(fieldError(el, "season-0-name")).toBe("");
  expect(save(el).disabled).toBe(true);
  await press(el, bins(el)[1]!);
  expect(rowKeys(el)).toEqual(["winter", "autumn"]);
  expect(save(el).disabled).toBe(false);
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
  expect(saveSeasons.mock.calls[0]![0]).toEqual({
    save: [{ id: "winter", name: "Deep winter", startsOn: "12-01", colour: "blue" }],
    delete: [],
  });
});

it("a binned season deleted elsewhere loses its note and sends no delete", async () => {
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => [...seasons]);
  const el = await mount(false, {
    saveSeasons,
    readSeasonDeleteImpact: vi.fn(async () => ({ departments: [] })),
  });
  await press(el, bins(el)[3]!);
  await expect.poll(() => notes(el)).toHaveLength(1);
  el.seasons = seasons.filter((season) => season.id !== "autumn");
  await el.updateComplete;
  expect(notes(el)).toEqual([]);
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
  expect(saveSeasons.mock.calls[0]![0]).toEqual({
    save: [{ id: "winter", name: "Deep winter", startsOn: "12-01", colour: "blue" }],
    delete: [],
  });
});

const feria = { id: "feria", name: "Feria", startsOn: "04-15", colour: "red" as const };
it("a snapshot while clean follows it and takes its clock revision", async () => {
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => [...seasons]);
  const el = await mount(false, { saveSeasons });
  el.seasons = [{ ...seasons[0]!, name: "Primavera" }, ...seasons.slice(1), feria];
  el.clockRevision = 7;
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter", "spring", "feria", "summer", "autumn"]);
  expect(rowNames(el)).toEqual(["Winter", "Primavera", "Feria", "Summer", "Autumn"]);
  expect(save(el).disabled).toBe(true);
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
  expect(saveSeasons.mock.calls[0]).toEqual([
    {
      save: [{ id: "winter", name: "Deep winter", startsOn: "12-01", colour: "blue" }],
      delete: [],
    },
    7,
  ]);
});

it("a snapshot while dirty keeps the person's changed fields and appends a season added elsewhere", async () => {
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => [...seasons]);
  const el = await mount(false, { saveSeasons });
  await change(el, "season-2-name", "High summer");
  el.seasons = [
    { ...seasons[0]!, name: "Primavera" },
    { ...seasons[1]!, name: "Verano", colour: "teal" },
    ...seasons.slice(2),
    feria,
  ];
  el.clockRevision = 8;
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn", "feria"]);
  expect(rowNames(el)).toEqual(["Winter", "Primavera", "High summer", "Autumn", "Feria"]);
  expect(field(el, "season-2-colour").value).toBe("teal");
  expect(save(el).disabled).toBe(false);
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
  expect(saveSeasons.mock.calls[0]).toEqual([
    {
      save: [{ id: "summer", name: "High summer", startsOn: "06-01", colour: "teal" }],
      delete: [],
    },
    3,
  ]);
});

it("a list set after the first draw fills the rows", async () => {
  const el = document.createElement("seasons-window");
  el.api = { saveSeasons: vi.fn(), readSeasonDeleteImpact: vi.fn() } as unknown as WindowApi;
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  expect(rowKeys(el)).toEqual([]);
  el.seasons = seasons;
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer", "autumn"]);
  expect(save(el).disabled).toBe(true);
});

it("a window put back on the page while clean shows the list that changed while it was away", async () => {
  const el = await mount();
  el.remove();
  el.seasons = [...seasons, feria];
  await new Promise((resolve) => setTimeout(resolve, 50));
  document.body.append(el);
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter", "spring", "feria", "summer", "autumn"]);
  expect(save(el).disabled).toBe(true);
});

it("the list that follows a save is taken as saved, so a second Save adds nothing again", async () => {
  const saved = [...seasons, feria];
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => saved);
  const el = await mount(false, { saveSeasons });
  await press(el, button(el, "add-season")!);
  await change(el, "season-4-name", "Feria");
  await change(el, "season-4-month", "04");
  await change(el, "season-4-day", "15");
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
  await el.updateComplete;
  el.seasons = saved;
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["winter", "spring", "feria", "summer", "autumn"]);
  expect(save(el).disabled).toBe(true);
  await press(el, button(el, "add-season")!);
  expect(rowKeys(el)).toContain("new-2");
});

it("a season the window just saved can be binned before the list that follows arrives", async () => {
  const saved = [...seasons, feria];
  const saveSeasons = vi.fn<WindowApi["saveSeasons"]>(async () => saved);
  const el = await mount(false, { saveSeasons });
  await press(el, button(el, "add-season")!);
  await change(el, "season-4-name", "Feria");
  await change(el, "season-4-month", "04");
  await change(el, "season-4-day", "15");
  await press(el, save(el));
  await expect.poll(() => rowKeys(el)).toContain("feria");
  await press(el, bins(el)[rowKeys(el).indexOf("feria")]!);
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(2);
  expect(saveSeasons.mock.calls[1]![0]).toEqual({ save: [], delete: ["feria"] });
});

it("a bin with no client to read the impact still says where the days go", async () => {
  const el = await mount();
  el.api = undefined;
  await el.updateComplete;
  await press(el, bins(el)[3]!);
  expect(notes(el)).toEqual(["Saving deletes Autumn; its days join Summer."]);
});

it("with no other row holding a start, the note still names the binned season", async () => {
  const el = await mount(false, {
    readSeasonDeleteImpact: vi.fn(async () => ({ departments: [] })),
  });
  await press(el, button(el, "add-season")!);
  for (let count = 0; count < 4; count += 1) await press(el, bins(el)[0]!);
  expect(rowKeys(el)).toEqual(["new-1"]);
  expect(notes(el)).toHaveLength(4);
  await expect
    .poll(() => notes(el)[0])
    .toBe("Saving deletes Winter. No department has hours in it.");
});

it("a row before the binned season with a start but no name is not named", async () => {
  const el = await mount(false, {
    readSeasonDeleteImpact: vi.fn(() => new Promise<never>(() => {})),
  });
  await press(el, button(el, "add-season")!);
  await change(el, "season-4-name", "  ");
  await change(el, "season-4-month", "10");
  await change(el, "season-4-day", "1");
  await press(el, bins(el)[0]!);
  expect(notes(el)).toEqual(["Saving deletes Winter."]);
});

const unanswered = () => vi.fn(() => new Promise<never>(() => {}));

it("a new season starting inside the binned one's days is named beside the season before it", async () => {
  const el = await mount(false, { readSeasonDeleteImpact: unanswered() });
  el.seasons = [
    { id: "autumn", name: "Autumn", startsOn: "09-01", colour: "orange" },
    { id: "late", name: "Late autumn", startsOn: "11-01", colour: "grey" },
    { id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" },
  ];
  await el.updateComplete;
  await press(el, button(el, "add-season")!);
  await change(el, "season-3-name", "Christmas");
  await change(el, "season-3-month", "12");
  await change(el, "season-3-day", "20");
  expect(rowKeys(el)[0]).toBe("winter");
  await press(el, bins(el)[0]!);
  expect(notes(el)).toEqual(["Saving deletes Winter; its days join Late autumn and Christmas."]);
});

it("the seasons a binned one's days join are listed by start, round the year from its own", async () => {
  const el = await mount(false, { readSeasonDeleteImpact: unanswered() });
  await press(el, button(el, "add-season")!);
  await change(el, "season-4-name", "Kings");
  await change(el, "season-4-month", "01");
  await change(el, "season-4-day", "6");
  await press(el, button(el, "add-season")!);
  await change(el, "season-5-name", "Christmas");
  await change(el, "season-5-month", "12");
  await change(el, "season-5-day", "20");
  await press(el, button(el, "add-season")!);
  await change(el, "season-6-name", "Easter");
  await change(el, "season-6-month", "04");
  await change(el, "season-6-day", "1");
  await press(el, bins(el)[0]!);
  expect(notes(el)).toEqual(["Saving deletes Winter; its days join Autumn, Christmas, and Kings."]);
});

it("a new season starting outside the binned one's days leaves the note naming one season", async () => {
  const el = await mount(false, { readSeasonDeleteImpact: unanswered() });
  await press(el, button(el, "add-season")!);
  await change(el, "season-4-name", "Christmas");
  await change(el, "season-4-month", "12");
  await change(el, "season-4-day", "20");
  await press(el, bins(el)[3]!);
  expect(notes(el)).toEqual(["Saving deletes Autumn; its days join Summer."]);
});

it("a season moved to start inside the binned one's days is named, and a binned neighbour never is", async () => {
  const el = await mount(false, { readSeasonDeleteImpact: unanswered() });
  await change(el, "season-0-month", "10");
  await change(el, "season-0-day", "15");
  await press(el, bins(el)[3]!);
  expect(notes(el)).toEqual(["Saving deletes Autumn; its days join Summer and Winter."]);
  await press(el, bins(el)[2]!);
  expect(notes(el)).toEqual([
    "Saving deletes Autumn; its days join Spring and Winter.",
    "Saving deletes Summer; its days join Spring.",
  ]);
});

it("a season holding the binned one's start and starting inside its days is named once", async () => {
  const el = await mount(false, { readSeasonDeleteImpact: unanswered() });
  await change(el, "season-0-month", "04");
  for (const index of [3, 2, 1]) await press(el, bins(el)[index]!);
  expect(notes(el)).toEqual([
    "Saving deletes Autumn; its days join Winter.",
    "Saving deletes Summer; its days join Winter.",
    "Saving deletes Spring; its days join Winter.",
  ]);
});

it("a Save refused because a changed season is gone marks that row until it is binned", async () => {
  const saveSeasons = vi
    .fn<WindowApi["saveSeasons"]>()
    .mockRejectedValueOnce({ code: "season.not_found", params: { seasonId: "autumn" } })
    .mockResolvedValueOnce([...seasons]);
  const el = await mount(false, { saveSeasons });
  await change(el, "season-0-name", "Deep winter");
  await change(el, "season-3-day", "15");
  await press(el, save(el));
  await expect.poll(() => fieldError(el, "season-3-name")).toBe("This season no longer exists.");
  expect(fieldError(el, "season-0-name")).toBe("");
  expect(save(el).disabled).toBe(true);
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  await press(el, bins(el)[3]!);
  expect(rowKeys(el)).toEqual(["winter", "spring", "summer"]);
  expect(save(el).disabled).toBe(false);
  expect(bottom(el)).toBe("");
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(2);
  expect(saveSeasons.mock.calls[1]![0]).toEqual({
    save: [{ id: "winter", name: "Deep winter", startsOn: "12-01", colour: "blue" }],
    delete: [],
  });
});

it("a Save refused because a binned season is gone drops its delete and its note", async () => {
  const saveSeasons = vi
    .fn<WindowApi["saveSeasons"]>()
    .mockRejectedValueOnce({ code: "season.not_found", params: { seasonId: "autumn" } })
    .mockResolvedValueOnce([...seasons]);
  const el = await mount(false, {
    saveSeasons,
    readSeasonDeleteImpact: vi.fn(async () => ({ departments: [] })),
  });
  await change(el, "season-0-name", "Deep winter");
  await press(el, bins(el)[3]!);
  await press(el, save(el));
  await expect.poll(() => notes(el)).toEqual([]);
  expect(bottom(el)).toBe("");
  expect(save(el).disabled).toBe(false);
  await press(el, save(el));
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(2);
  expect(saveSeasons.mock.calls[1]![0]).toEqual({
    save: [{ id: "winter", name: "Deep winter", startsOn: "12-01", colour: "blue" }],
    delete: [],
  });
});

it("draws the notes' live region empty before the first bin, and fills that same region", async () => {
  const el = await mount(false, {
    readSeasonDeleteImpact: vi.fn(() => new Promise<never>(() => {})),
  });
  const region = root(el).querySelector("[role=status]");
  expect(region).not.toBeNull();
  expect(region!.textContent!.trim()).toBe("");
  await press(el, bins(el)[3]!);
  expect(root(el).querySelector("[role=status]")).toBe(region);
  expect(region!.querySelectorAll("[data-test=delete-note]")).toHaveLength(1);
});

it("a Save's answer does not undo a newer list delivered while it was in flight", async () => {
  const { answer, resolve } = held();
  const el = await mount(false, { saveSeasons: vi.fn(() => answer) });
  await change(el, "season-0-name", "Deep winter");
  await press(el, save(el));
  const renamed = seasons.map((season) =>
    season.id === "winter" ? { ...season, name: "Deep winter" } : season,
  );
  el.seasons = [...renamed, feria];
  await el.updateComplete;
  resolve(renamed);
  await answer;
  await expect.poll(() => save(el).loading).toBe(false);
  expect(rowKeys(el)).toEqual(["winter", "spring", "feria", "summer", "autumn"]);
  expect(rowNames(el)[0]).toBe("Deep winter");
  expect(save(el).disabled).toBe(true);
});
