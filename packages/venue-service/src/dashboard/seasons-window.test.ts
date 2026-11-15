import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { SeasonsWindow } from "./seasons-window.js";
import "./seasons-window.js";
import {
  clockChangeConflict,
  clockChangeConflictSentence,
} from "../testing/clock-change-conflict.js";
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
async function mount(
  seasonId = "summer",
  saveSeasons: OpeningHoursApi["saveSeasons"] = vi.fn(async () => seasons),
) {
  const el = document.createElement("seasons-window");
  Object.assign(el, { seasons, seasonId, clockRevision: 3, api: { saveSeasons } });
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const root = (el: SeasonsWindow) => el.shadowRoot!;
const field = (el: SeasonsWindow, name: string) =>
  root(el).querySelector<
    HTMLElementTagNameMap["wt-input"] & {
      options: { value: string; label: string; usedBy?: string[] }[];
    }
  >(`[name=${name}]`)!;
async function change(el: SeasonsWindow, name: string, value: string) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
const save = (el: SeasonsWindow) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-seasons]")!;
const bottom = (el: SeasonsWindow) => root(el).querySelector("wt-form-actions")!.error;
async function press(el: SeasonsWindow) {
  save(el).shadowRoot!.querySelector("button")!.click();
  await el.updateComplete;
}
it("edits only the addressed season and sends only its changed entry", async () => {
  const saveSeasons = vi.fn(async () => seasons);
  const el = await mount("summer", saveSeasons);
  expect(root(el).querySelectorAll("wt-input")).toHaveLength(1);
  expect(field(el, "name").value).toBe("Summer");
  expect(
    root(el).querySelectorAll("wt-modal, table, [data-test=delete-season], [data-test=add-season]"),
  ).toHaveLength(0);
  await change(el, "name", "High summer");
  await press(el);
  expect(saveSeasons).toHaveBeenCalledWith(
    {
      save: [{ id: "summer", name: "High summer", startsOn: "06-01", colour: "amber" }],
      delete: [],
    },
    3,
  );
});
it("starts a new season blank in the first unused colour, and creates only it", async () => {
  const saved = [
    ...seasons,
    { id: "feria", name: "Feria", startsOn: "04-10", colour: "red" as const },
  ];
  const saveSeasons = vi.fn(async () => saved);
  const el = await mount("", saveSeasons);
  expect(field(el, "name").value).toBe("");
  expect(field(el, "colour").value).toBe("red");
  expect([save(el).disabled, save(el).variant]).toEqual([true, "secondary"]);
  await change(el, "name", "Feria");
  await change(el, "month", "04");
  await change(el, "day", "10");
  await press(el);
  expect(saveSeasons).toHaveBeenCalledWith(
    { save: [{ name: "Feria", startsOn: "04-10", colour: "red" }], delete: [] },
    3,
  );
  el.seasons = saved;
  await el.updateComplete;
  expect(save(el).disabled).toBe(true);
});
it("marks required fields visibly and clamps a late day when the month becomes shorter", async () => {
  const el = await mount();
  for (const name of ["name", "colour", "day", "month"]) {
    expect(field(el, name).required).toBe(true);
    expect(field(el, name).hasAttribute("hide-label")).toBe(false);
  }
  await change(el, "day", "31");
  await change(el, "month", "04");
  expect(field(el, "day").value).toBe("30");
  await change(el, "month", "02");
  expect(field(el, "day").value).toBe("28");
  expect(field(el, "day").options.map((o) => o.value)).toEqual(
    Array.from({ length: 28 }, (_, i) => String(i + 1)),
  );
  expect(field(el, "month").options.map((o) => o.label)).toContain("February");
});
it("marks the colours used by other named seasons and paints with pale tints", async () => {
  const el = await mount();
  const chooser = root(el).querySelector("wt-colour-chooser")!;
  expect(chooser.choices.find((c) => c.value === "blue")?.usedBy).toEqual(["Winter"]);
  expect(chooser.choices.find((c) => c.value === "amber")?.usedBy).toEqual([]);
  expect(chooser.choices.find((c) => c.value === "blue")?.fill).toBe(
    "var(--wt-color-station-blue)",
  );
});
it("Save stays quiet until changed, and undoing the edit makes it quiet again", async () => {
  const el = await mount();
  expect([save(el).disabled, save(el).variant]).toEqual([true, "secondary"]);
  await change(el, "name", "High summer");
  expect([save(el).disabled, save(el).variant]).toEqual([false, "primary"]);
  await change(el, "name", "Summer");
  expect([save(el).disabled, save(el).variant]).toEqual([true, "secondary"]);
});
it("takes a new clock revision while clean and keeps it while dirty", async () => {
  const saveSeasons = vi.fn(async () => seasons);
  const el = await mount("summer", saveSeasons);
  el.clockRevision = 8;
  await el.updateComplete;
  await change(el, "name", "High summer");
  el.clockRevision = 9;
  await el.updateComplete;
  await press(el);
  expect(saveSeasons).toHaveBeenCalledWith(
    {
      save: [{ id: "summer", name: "High summer", startsOn: "06-01", colour: "amber" }],
      delete: [],
    },
    8,
  );
});
it("marks a new season's missing name and start and focuses the first invalid field without writing", async () => {
  const saveSeasons = vi.fn(async () => seasons);
  const el = await mount("", saveSeasons);
  await change(el, "colour", "purple");
  await press(el);
  expect(field(el, "name").error).toBe("Enter a name.");
  expect(root(el).querySelector("[data-error=startsOn]")!.textContent).toBe(
    "Choose a day and a month.",
  );
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(save(el).disabled).toBe(true);
  expect(saveSeasons).not.toHaveBeenCalled();
  await expect.poll(() => root(el).activeElement).toBe(field(el, "name"));
});
it.each([
  ["name", "Winter", "Another season has this name."],
  ["month", "03", "Another season starts on this day."],
] as const)("checks %s against every other season", async (name, value, error) => {
  const saveSeasons = vi.fn(async () => seasons);
  const el = await mount("summer", saveSeasons);
  await change(el, name, value);
  await press(el);
  expect(
    name === "name"
      ? field(el, name).error
      : root(el).querySelector("[data-error=startsOn]")!.textContent,
  ).toBe(error);
  expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
  expect(saveSeasons).not.toHaveBeenCalled();
});
it.each([
  [{ field: "save.0.name", reason: "taken" }, "name", "Another season has this name."],
  [{ field: "save.0.name" }, "name", "Enter a name."],
  [{ field: "save.0.colour" }, "colour", "Choose a colour."],
  [{ field: "save.0.startsOn", reason: "taken" }, "day", "Another season starts on this day."],
  [{ field: "save.0.startsOn" }, "day", "Choose a day and a month."],
] as const)(
  "maps the submitted entry's field refusal and permits retry (%j)",
  async (params, name, message) => {
    const saveSeasons = vi.fn(async () => {
      throw { code: "season.invalid", params };
    });
    const el = await mount("summer", saveSeasons);
    await change(el, "name", "High summer");
    await press(el);
    const shown = () =>
      name === "day"
        ? root(el).querySelector("[data-error=startsOn]")?.textContent
        : field(el, name).error;
    await expect.poll(shown).toBe(message);
    expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(save(el).disabled).toBe(false);
    await press(el);
    expect(saveSeasons).toHaveBeenCalledTimes(2);
    await change(el, name, name === "day" ? "2" : name === "colour" ? "teal" : "Another");
    expect(shown() ?? "").toBe("");
    expect(bottom(el)).toBe("");
  },
);
it.each([
  [{ code: "hours.clock_changed" }, "The business-day start changed. Reload hours."],
  [clockChangeConflict, clockChangeConflictSentence],
  [
    { code: "season.invalid", params: { field: "delete", reason: "last" } },
    "A venue keeps at least one season.",
  ],
  [{ code: "network.unavailable" }, "The change could not be saved."],
  [{ code: "season.invalid", params: { field: "save.1.name" } }, "The change could not be saved."],
])("keeps an unplaced refusal beside Save with retry enabled (%j)", async (refusal, message) => {
  const el = await mount(
    "summer",
    vi.fn(async () => {
      throw refusal;
    }),
  );
  await change(el, "day", "15");
  await press(el);
  await expect.poll(() => bottom(el)).toBe(message);
  expect(field(el, "day").value).toBe("15");
  expect(save(el).disabled).toBe(false);
});
it("shows Save busy and disables editing controls and Cancel while sending", async () => {
  let done!: (value: typeof seasons) => void;
  const el = await mount(
    "summer",
    vi.fn(
      () =>
        new Promise<typeof seasons>((resolve) => {
          done = resolve;
        }),
    ),
  );
  await change(el, "name", "High summer");
  await press(el);
  expect([save(el).loading, save(el).disabled]).toEqual([true, true]);
  for (const control of root(el).querySelectorAll(
    "wt-input, wt-combobox, wt-colour-chooser, wt-button",
  ))
    expect((control as HTMLElementTagNameMap["wt-button"]).disabled).toBe(true);
  done(seasons);
  await expect.poll(() => save(el).loading).toBe(false);
});
it("Enter in Name saves the single season", async () => {
  const saveSeasons = vi.fn(async () => seasons);
  const el = await mount("summer", saveSeasons);
  await change(el, "name", "High summer");
  await userEvent.click(field(el, "name").shadowRoot!.querySelector("input")!);
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => saveSeasons.mock.calls.length).toBe(1);
});
it("a clean draft follows a snapshot and a dirty draft keeps its changed field but takes other live fields", async () => {
  const el = await mount();
  el.seasons = seasons.map((s) => (s.id === "summer" ? { ...s, name: "Remote summer" } : s));
  await el.updateComplete;
  expect(field(el, "name").value).toBe("Remote summer");
  await change(el, "name", "My summer");
  el.seasons = el.seasons.map((s) =>
    s.id === "summer" ? { ...s, name: "Later summer", colour: "teal" } : s,
  );
  await el.updateComplete;
  expect(field(el, "name").value).toBe("My summer");
  expect(field(el, "colour").value).toBe("teal");
});
it.each(["snapshot", "refusal"])(
  "marks a selected season missing after %s and leaves it unsaveable",
  async (how) => {
    const el = await mount(
      "summer",
      vi.fn(async () => {
        throw { code: "season.not_found", params: { seasonId: "summer" } };
      }),
    );
    await change(el, "name", "My summer");
    if (how === "snapshot") {
      el.seasons = seasons.filter((s) => s.id !== "summer");
      await el.updateComplete;
    } else await press(el);
    await expect.poll(() => field(el, "name").error).toBe("This season no longer exists.");
    expect(save(el).disabled).toBe(true);
    expect(field(el, "name").value).toBe("My summer");
  },
);
it("an earlier opening's Save answer cannot commit the reconnected draft", async () => {
  let done!: (value: typeof seasons) => void;
  const el = await mount(
    "summer",
    vi.fn(
      () =>
        new Promise<typeof seasons>((resolve) => {
          done = resolve;
        }),
    ),
  );
  await change(el, "name", "My summer");
  await press(el);
  el.remove();
  document.body.append(el);
  await el.updateComplete;
  done(seasons);
  await expect.poll(() => save(el).loading).toBe(false);
  expect(field(el, "name").value).toBe("My summer");
  expect(save(el).disabled).toBe(false);
});
it("keeps a newer snapshot over the Save answer", async () => {
  let done!: (value: typeof seasons) => void;
  const el = await mount(
    "summer",
    vi.fn(
      () =>
        new Promise<typeof seasons>((resolve) => {
          done = resolve;
        }),
    ),
  );
  await change(el, "name", "Written summer");
  await press(el);
  el.seasons = seasons.map((s) => (s.id === "summer" ? { ...s, name: "Newer summer" } : s));
  await el.updateComplete;
  done(seasons);
  await expect.poll(() => save(el).loading).toBe(false);
  expect(field(el, "name").value).toBe("Newer summer");
});
