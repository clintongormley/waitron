import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { SeasonChips, SeasonChip, SeasonWrites } from "./season-chips.js";
import type { SeasonDialog } from "./season-dialog.js";
import type { Season } from "../season-rules.js";
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

function fakeApi(overrides: Partial<SeasonWrites> = {}) {
  return {
    saveSeason: vi.fn(async (id: string, input: { name: string; startsOn: string }) => ({
      id,
      colour: "grey" as const,
      ...input,
    })),
    addSeason: vi.fn(async (input: { name: string; startsOn: string }) => ({
      id: "n",
      colour: "grey" as const,
      ...input,
    })),
    deleteSeason: vi.fn(async () => {}),
    readSeasonDeleteImpact: vi.fn(async () => ({
      departments: [
        { id: "b", name: "Bar" },
        { id: "k", name: "Kitchen" },
      ],
    })),
    ...overrides,
  };
}
async function mount(seasons: SeasonChip[] = four, api = fakeApi(), revision = 7) {
  el = document.createElement("season-chips");
  el.seasons = seasons;
  el.clockRevision = revision;
  el.api = api;
  el.specialDays = [{ id: "sd1", name: "Christmas dinners" }];
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  return { api, changed: changes() };
}
function changes() {
  const seen: unknown[] = [];
  el.addEventListener("season-changed", (event) => seen.push(event));
  return seen;
}
const chips = () => [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("[data-season]")];
const dialog = () => el.shadowRoot!.querySelector<SeasonDialog>("season-dialog")!;
const dq = <T extends Element = HTMLElement>(selector: string) =>
  dialog().shadowRoot!.querySelector<T>(selector);
async function settle() {
  await el.updateComplete;
  const shown = el.shadowRoot!.querySelector<SeasonDialog>("season-dialog");
  await shown?.updateComplete;
}
async function openChip(name: string) {
  chips()
    .find((chip) => chip.textContent!.includes(name))!
    .querySelector<HTMLElement>("[data-test=season-edit]")!
    .click();
  await settle();
}
async function openAdd() {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-season]")!.click();
  await settle();
}
async function change(name: string, value: string) {
  dq(`[name="${name}"]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle();
}
const save = () => dq<HTMLElementTagNameMap["wt-button"]>("[data-test=save-season]")!;
async function click(selector: string) {
  dq(selector)!.click();
  await settle();
}
const footerError = () => dq<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!.error;
const fieldError = (name: string) =>
  dq<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!.error;

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
    "Spring · 1 Mar – 31 May ✎",
    "Summer · 1 Jun – 31 Aug ✎",
    "Late summer · 1 Aug – 31 Aug ✎",
    "Autumn · 1 Sept – 30 Nov ✎",
    "Winter · 1 Dec – 29 Feb ✎",
  ]);
  expect(chips().map((chip) => chip.dataset.tint)).toEqual([
    "green",
    "amber",
    "teal",
    "orange",
    "blue",
  ]);
  expect(chips()[0]!.querySelector("[data-test=season-edit]")!.getAttribute("aria-label")).toBe(
    "Edit Spring, 1 Mar – 31 May",
  );
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

it("renames a season through the api with its start and the clock revision, then says it changed", async () => {
  const { api, changed } = await mount();
  await openChip("Winter");
  expect(dq<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value).toBe("Winter");
  expect(save().disabled).toBe(true);
  expect(save().variant).toBe("secondary");
  await change("name", " Cold season ");
  expect(save().disabled).toBe(false);
  await click("[data-test=save-season]");
  await expect.poll(() => changed.length).toBe(1);
  expect(api.saveSeason).toHaveBeenCalledWith("w", { name: "Cold season", startsOn: "12-01" }, 7);
  expect((changed[0] as CustomEvent).bubbles).toBe(true);
  expect((changed[0] as CustomEvent).composed).toBe(true);
  await settle();
  expect(el.shadowRoot!.querySelector("season-dialog")).toBeNull();
});

it("moves a season's start by day and month, keeping the day inside a shorter month", async () => {
  const { api, changed } = await mount();
  await openChip("Spring");
  await change("startDay", "31");
  await change("startMonth", "04");
  expect(dq<HTMLElementTagNameMap["wt-combobox"]>("[name=startDay]")!.value).toBe("30");
  await change("startMonth", "02");
  expect(dq<HTMLElementTagNameMap["wt-combobox"]>("[name=startDay]")!.value).toBe("28");
  expect(
    dq<HTMLElementTagNameMap["wt-combobox"]>("[name=startDay]")!
      .options.map((o) => o.value)
      .at(-1),
  ).toBe("28");
  await click("[data-test=save-season]");
  await expect.poll(() => changed.length).toBe(1);
  expect(api.saveSeason).toHaveBeenCalledWith("sp", { name: "Spring", startsOn: "02-28" }, 7);
});

it("adds a season from an empty dialog, sending its name and start", async () => {
  const { api, changed } = await mount();
  await openAdd();
  expect(dq<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value).toBe("");
  expect(dq("[data-test=delete-season]")).toBeNull();
  expect(save().disabled).toBe(true);
  await change("name", "Mid autumn");
  await change("startMonth", "10");
  await change("startDay", "15");
  await click("[data-test=save-season]");
  await expect.poll(() => changed.length).toBe(1);
  expect(api.addSeason).toHaveBeenCalledWith({ name: "Mid autumn", startsOn: "10-15" }, 7);
  expect(api.saveSeason).not.toHaveBeenCalled();
});

it("asks for a name and a start before sending a new season", async () => {
  const { api } = await mount();
  await openAdd();
  await change("name", " ");
  await click("[data-test=save-season]");
  expect(fieldError("name")).not.toBe("");
  expect(dq("[data-error=startsOn]")!.textContent).toBe("Choose a day and a month.");
  expect(api.addSeason).not.toHaveBeenCalled();
});

it("has no Delete when the venue has one season", async () => {
  await mount([{ ...winter, startsOn: "01-01", lastDay: "12-31" }]);
  await openChip("Winter");
  expect(dq("[data-test=delete-season]")).toBeNull();
});

it("confirms a delete naming the departments that lose hours, then deletes with the revision", async () => {
  const { api, changed } = await mount();
  await openChip("Spring");
  await click("[data-test=delete-season]");
  await expect
    .poll(() => dq("[data-test=delete-confirm-text]")?.textContent ?? "")
    .toContain("Bar and Kitchen");
  expect(api.readSeasonDeleteImpact).toHaveBeenCalledWith("sp");
  expect(dq("[data-test=delete-confirm-text]")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
    "Delete Spring? Its days join Winter. The hours of Bar and Kitchen in it are lost.",
  );
  expect(api.deleteSeason).not.toHaveBeenCalled();
  await click("[data-test=confirm-delete-season]");
  await expect.poll(() => changed.length).toBe(1);
  expect(api.deleteSeason).toHaveBeenCalledWith("sp", 7);
});

it("says no hours are lost when no department painted the season, and Back returns to the form", async () => {
  const api = fakeApi({ readSeasonDeleteImpact: vi.fn(async () => ({ departments: [] })) });
  await mount(four, api);
  await openChip("Winter");
  await change("name", "Cold");
  await click("[data-test=delete-season]");
  await expect
    .poll(() => dq("[data-test=delete-confirm-text]")?.textContent ?? "")
    .toContain("No department has hours in it.");
  expect(dq("[data-test=delete-confirm-text]")!.textContent).toContain("Its days join Autumn.");
  await click("[data-test=cancel-delete-season]");
  expect(dq<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value).toBe("Cold");
  expect(api.deleteSeason).not.toHaveBeenCalled();
});

it.each([
  [{ field: "name", reason: "taken" }, "name", "Another season has this name."],
  [{ field: "startsOn", reason: "taken" }, "startsOn", "Another season starts on this day."],
  [{ field: "startsOn" }, "startsOn", "Choose a day and a month."],
])("shows season.invalid %o under the field it names", async (params, where, message) => {
  const api = fakeApi({
    saveSeason: vi.fn(async () => {
      throw { code: "season.invalid", params };
    }),
  });
  const { changed } = await mount(four, api);
  await openChip("Spring");
  await change("name", "Summer");
  await click("[data-test=save-season]");
  await expect
    .poll(() =>
      where === "name" ? fieldError("name") : (dq("[data-error=startsOn]")?.textContent ?? ""),
    )
    .toBe(message);
  expect(changed).toEqual([]);
  expect(footerError()).toBe("Correct the highlighted fields to continue.");
});

it.each([
  [
    { date: "2026-12-24", specialDayId: "sd1" },
    "A period’s end offset would run into Christmas dinners on Thu, 24 Dec 2026.",
  ],
  [{ seasonId: "a", weekday: 5 }, "A period’s end offset would run into Autumn on Friday."],
  [
    { date: "2031-12-24", specialDayId: "other" },
    "A period’s end offset would run into Wed, 24 Dec 2031.",
  ],
  [{ date: "2026-12-24" }, "A period’s end offset would run into Thu, 24 Dec 2026."],
])("shows an end-offset refusal %o beside Save and keeps the draft", async (clash, message) => {
  const api = fakeApi({
    saveSeason: vi.fn(async () => {
      throw {
        code: "season.invalid",
        params: {
          field: "startsOn",
          reason: "end_offset",
          departmentId: "k",
          periodId: "p",
          ...clash,
        },
      };
    }),
  });
  const { changed } = await mount(four, api);
  await openChip("Autumn");
  await change("startDay", "15");
  await click("[data-test=save-season]");
  await expect.poll(() => footerError()).toBe(message);
  expect(dq("[data-error=startsOn]")).toBeNull();
  expect(dq<HTMLElementTagNameMap["wt-combobox"]>("[name=startDay]")!.value).toBe("15");
  expect(dialog().open).toBe(true);
  expect(changed).toEqual([]);
});

it("shows a changed business-day start beside Save", async () => {
  const api = fakeApi({
    addSeason: vi.fn(async () => {
      throw { code: "hours.clock_changed" };
    }),
  });
  await mount(four, api);
  await openAdd();
  await change("name", "Mid autumn");
  await change("startMonth", "10");
  await change("startDay", "15");
  await click("[data-test=save-season]");
  await expect.poll(() => footerError()).toBe("The business-day start changed. Reload hours.");
});

it("shows a refused delete in the confirmation", async () => {
  const api = fakeApi({
    deleteSeason: vi.fn(async () => {
      throw { code: "season.invalid", params: { field: "seasonId", reason: "last" } };
    }),
  });
  const { changed } = await mount(four, api);
  await openChip("Spring");
  await click("[data-test=delete-season]");
  await expect.poll(() => dq("[data-test=confirm-delete-season]")).not.toBeNull();
  await click("[data-test=confirm-delete-season]");
  await expect
    .poll(() => dq("[data-error=delete]")?.textContent ?? "")
    .toBe("A venue keeps at least one season.");
  expect(changed).toEqual([]);
});

it("says the season no longer exists when a save or a delete finds it gone", async () => {
  const gone = async () => {
    throw { code: "season.not_found", params: { seasonId: "w" } };
  };
  await mount(four, fakeApi({ saveSeason: vi.fn(gone), deleteSeason: vi.fn(gone) }));
  await openChip("Winter");
  await change("name", "Cold");
  await click("[data-test=save-season]");
  await expect.poll(() => footerError()).toBe("This season no longer exists.");
  await click("[data-test=delete-season]");
  await expect.poll(() => dq("[data-test=confirm-delete-season]")).not.toBeNull();
  await click("[data-test=confirm-delete-season]");
  await expect
    .poll(() => dq("[data-error=delete]")?.textContent ?? "")
    .toBe("This season no longer exists.");
});

it("offers no editing when read-only", async () => {
  el = document.createElement("season-chips");
  el.seasons = four;
  el.readOnly = true;
  document.body.append(el);
  await el.updateComplete;
  expect(chips().map((chip) => chip.tagName)).toEqual(["SPAN", "SPAN", "SPAN", "SPAN"]);
  expect(el.shadowRoot!.querySelector("[data-test=add-season]")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("✎");
});

it("keeps Save enabled after a server refusal until the draft changes", async () => {
  const api = fakeApi({
    saveSeason: vi.fn(async () => {
      throw { code: "hours.clock_changed" };
    }),
  });
  await mount(four, api);
  await openChip("Winter");
  await change("name", "Cold");
  await click("[data-test=save-season]");
  await expect.poll(() => footerError()).not.toBe("");
  expect(save().disabled).toBe(false);
  expect(save().variant).toBe("primary");
});

it("says the impact could not be loaded when reading it fails, and keeps the form", async () => {
  const api = fakeApi({
    readSeasonDeleteImpact: vi.fn(async () => {
      throw { code: "network.unavailable" };
    }),
  });
  await mount(four, api);
  await openChip("Spring");
  await click("[data-test=delete-season]");
  await expect
    .poll(() => footerError())
    .toBe("The deletion impact could not be loaded. Try again.");
  expect(dq("[data-test=delete-confirm-text]")).toBeNull();
});

it("shows only Delete as busy while the impact is read, and only the confirm while deleting", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => (release = resolve));
  const api = fakeApi({
    readSeasonDeleteImpact: vi.fn(async () => {
      await waiting;
      return { departments: [] };
    }),
    deleteSeason: vi.fn(() => new Promise<void>(() => {})),
  });
  await mount(four, api);
  await openChip("Spring");
  await click("[data-test=delete-season]");
  const button = (test: string) => dq<HTMLElementTagNameMap["wt-button"]>(`[data-test=${test}]`)!;
  expect(button("delete-season").loading).toBe(true);
  expect(save().loading).toBe(false);
  release();
  await expect.poll(() => dq("[data-test=confirm-delete-season]")).not.toBeNull();
  await click("[data-test=confirm-delete-season]");
  expect(button("confirm-delete-season").loading).toBe(true);
  expect(button("cancel-delete-season").loading).toBe(false);
});

it("stays open on Escape and on a close request while its save is in flight, and closes on Escape after", async () => {
  let refuse!: () => void;
  const api = fakeApi({
    saveSeason: vi.fn(
      () =>
        new Promise<never>((_, reject) => (refuse = () => reject({ code: "hours.clock_changed" }))),
    ),
  });
  await mount(four, api);
  await openChip("Winter");
  await change("name", "Cold");
  await click("[data-test=save-season]");
  const modal = dq<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
  await userEvent.keyboard("{Escape}");
  expect(await modal.requestClose("escape")).toBe(false);
  expect(await modal.requestClose("cancel")).toBe(false);
  await settle();
  expect(modal.open).toBe(true);
  expect(dialog().open).toBe(true);
  refuse();
  await expect.poll(() => footerError()).not.toBe("");
  const closed = new Promise<void>((resolve) =>
    modal.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  dq<HTMLElement>("[name=name]")!.focus();
  await userEvent.keyboard("{Escape}");
  await closed;
  await settle();
  expect(el.shadowRoot!.querySelector("season-dialog")).toBeNull();
});

it("marks the start once, describes the group by its error, and asks no field of its own", async () => {
  await mount();
  await openAdd();
  const legend = dq("legend")!;
  expect(legend.textContent!.replace(/\s+/g, " ").trim()).toBe("Starts on*");
  expect(legend.querySelector("[aria-hidden=true]")!.textContent).toBe("*");
  for (const name of ["startDay", "startMonth"])
    expect(dq<HTMLElementTagNameMap["wt-combobox"]>(`[name=${name}]`)!.required).toBe(false);
  await change("name", "Mid autumn");
  await click("[data-test=save-season]");
  const error = dq("[data-error=startsOn]")!;
  expect(dq("fieldset")!.getAttribute("aria-describedby")).toBe(error.id);
  expect(error.id).not.toBe("");
});

it("uses one verb for delete in Spanish", async () => {
  setLocale("es");
  await mount();
  await openChip("Spring");
  expect(dq("[data-test=delete-season]")!.textContent!.trim()).toBe("Eliminar temporada");
  await click("[data-test=delete-season]");
  await expect.poll(() => dq("[data-test=confirm-delete-season]")).not.toBeNull();
  expect(dq("[data-test=confirm-delete-season]")!.textContent!.trim()).toBe("Eliminar");
  expect(dq("[data-test=delete-confirm-text]")!.textContent).toContain(
    "Se pierden los horarios de Bar y Kitchen en ella.",
  );
});

it("says when its dialog opens, so the host can read the special days a refusal may name", async () => {
  await mount();
  const opened: Event[] = [];
  const listen = (event: Event) => opened.push(event);
  document.body.addEventListener("season-dialog-open", listen);
  try {
    await openChip("Winter");
    expect(opened).toHaveLength(1);
    expect([opened[0]!.bubbles, opened[0]!.composed]).toEqual([true, true]);
    await openAdd();
    expect(opened).toHaveLength(1);
    dialog().dispatchEvent(new CustomEvent("season-close"));
    await settle();
    await openAdd();
    expect(opened).toHaveLength(2);
  } finally {
    document.body.removeEventListener("season-dialog-open", listen);
  }
});

it("saves with the clock revision the dialog opened at, though a newer one arrived while editing", async () => {
  const { api, changed } = await mount(four, fakeApi(), 7);
  await openChip("Spring");
  await change("startDay", "2");
  el.clockRevision = 8;
  await settle();
  await click("[data-test=save-season]");
  await expect.poll(() => changed.length).toBe(1);
  expect(api.saveSeason).toHaveBeenCalledWith("sp", { name: "Spring", startsOn: "03-02" }, 7);
});

it("deletes with the clock revision the dialog opened at, though a newer one arrived while confirming", async () => {
  const { api, changed } = await mount(four, fakeApi(), 7);
  await openChip("Spring");
  await click("[data-test=delete-season]");
  await expect.poll(() => dq("[data-test=confirm-delete-season]")).not.toBeNull();
  el.clockRevision = 8;
  await settle();
  await click("[data-test=confirm-delete-season]");
  await expect.poll(() => changed.length).toBe(1);
  expect(api.deleteSeason).toHaveBeenCalledWith("sp", 7);
});

it("keeps a save busy when an earlier save, sent before the chips were moved, answers first", async () => {
  const answers: (() => void)[] = [];
  const api = fakeApi({
    saveSeason: vi.fn(
      (id: string, input: { name: string; startsOn: string }) =>
        new Promise<Season>((resolve) =>
          answers.push(() => resolve({ id, colour: "grey", ...input })),
        ),
    ),
  });
  await mount(four, api);
  await openChip("Winter");
  await change("name", "Cold");
  await click("[data-test=save-season]");
  el.remove();
  document.body.append(el);
  await settle();
  await openChip("Winter");
  await change("name", "Colder");
  await click("[data-test=save-season]");
  expect(save().loading).toBe(true);
  answers[0]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settle();
  expect(save().loading).toBe(true);
  expect(api.saveSeason).toHaveBeenCalledTimes(2);
});

it("withdraws a delete confirmation and says so when another session deletes its season", async () => {
  const { api, changed } = await mount([spring, winter]);
  await openChip("Winter");
  await click("[data-test=delete-season]");
  await expect.poll(() => dq("[data-test=confirm-delete-season]")).not.toBeNull();
  el.seasons = [{ ...spring, startsOn: "01-01", lastDay: "12-31" }];
  await settle();
  expect(dq("[data-test=delete-confirm-text]")).toBeNull();
  expect(dq("[data-test=confirm-delete-season]")).toBeNull();
  expect(footerError()).toBe("This season no longer exists.");
  expect(api.deleteSeason).not.toHaveBeenCalled();
  expect(changed).toEqual([]);
});

it("asks for a season's week from the chip's name, naming it, and opens no dialog", async () => {
  await mount();
  const asked: CustomEvent<{ seasonId: string }>[] = [];
  document.body.addEventListener("season-week-open", (event) =>
    asked.push(event as CustomEvent<{ seasonId: string }>),
  );
  const week = chips()[3]!.querySelector<HTMLElement>("[data-test=season-week]")!;
  expect(week.textContent!.trim()).toBe("Winter · 1 Dec – 29 Feb");
  expect(week.getAttribute("aria-label")).toBe("Winter · 1 Dec – 29 Feb, edit the week");
  week.click();
  await settle();
  expect(asked.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
    [{ seasonId: "w" }, true, true],
  ]);
  expect(el.shadowRoot!.querySelector("season-dialog")).toBeNull();
});

it("names the chip's week in Spanish, starting with what it shows", async () => {
  setLocale("es");
  await mount();
  const week = chips()[3]!.querySelector<HTMLElement>("[data-test=season-week]")!;
  const shown = week.textContent!.trim();
  expect(shown).toMatch(/^Winter · /);
  expect(week.getAttribute("aria-label")).toBe(`${shown}, editar la semana`);
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
  expect(week.getAttribute("aria-label")).toBe("Winter · 1 Dec – 29 Feb, show the week");
  expect(chips()[3]!.querySelector("[data-test=season-edit]")).toBeNull();
  week.click();
  await el.updateComplete;
  expect(asked.map((event) => event.detail)).toEqual([{ seasonId: "w" }]);
  expect(el.shadowRoot!.querySelector("season-dialog")).toBeNull();
});

it("as a key only, draws each chip's name and dates with no button to press", async () => {
  el = document.createElement("season-chips");
  el.seasons = four;
  el.api = fakeApi();
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

it("slotted content follows + Season on the chips' row", async () => {
  el = document.createElement("season-chips");
  el.seasons = [spring, winter];
  el.api = fakeApi();
  const extra = document.createElement("button");
  extra.textContent = "Periods…";
  el.append(extra);
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  const add = el
    .shadowRoot!.querySelector<HTMLElement>("[data-test=add-season]")!
    .getBoundingClientRect();
  const box = extra.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.left).toBeGreaterThanOrEqual(add.right);
  expect(box.top).toBeLessThan(add.bottom);
  expect(box.bottom).toBeGreaterThan(add.top);
});

it("as a key only, still draws slotted content after the chips", async () => {
  el = document.createElement("season-chips");
  el.seasons = [spring, winter];
  el.api = fakeApi();
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
