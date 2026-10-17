import { describe, expect, it } from "vitest";
import { CALENDAR_COLOURS } from "../hours-types.js";
import type { Season } from "../season-rules.js";
import {
  addRow,
  daysIn,
  draftOf,
  goneKeys,
  mergeSeasonDraft,
  removeRow,
  rowErrors,
  runsUntil,
  sameDraft,
  seasonChange,
  type SeasonDraft,
  type SeasonRow,
} from "./season-draft.js";

const spring: Season = { id: "s1", name: "Spring", startsOn: "03-01", colour: "green" };
const summer: Season = { id: "s2", name: "Summer", startsOn: "06-01", colour: "amber" };
const autumn: Season = { id: "s3", name: "Autumn", startsOn: "09-01", colour: "orange" };
const winter: Season = { id: "s4", name: "Winter", startsOn: "12-01", colour: "blue" };
const year = [spring, summer, autumn, winter];

const row = (fields: Partial<SeasonRow> & { key: string }): SeasonRow => ({
  name: "",
  day: "",
  month: "",
  colour: "grey",
  ...fields,
});
const withRow = (draft: SeasonDraft, key: string, change: Partial<SeasonRow>): SeasonDraft => ({
  ...draft,
  rows: draft.rows.map((r) => (r.key === key ? { ...r, ...change } : r)),
});
const names = (draft: SeasonDraft) => draft.rows.map((r) => r.name);

describe("draftOf", () => {
  it("lists the season in force on 1 January first, then the rest by start", () => {
    const draft = draftOf([summer, winter, spring, autumn]);
    expect(names(draft)).toEqual(["Winter", "Spring", "Summer", "Autumn"]);
    expect(draft.deleted).toEqual([]);
    expect(draft.rows[0]).toEqual({
      key: "s4",
      id: "s4",
      name: "Winter",
      day: "1",
      month: "12",
      colour: "blue",
    });
  });

  it("puts a season starting on 1 January first", () => {
    const newYear: Season = { id: "s0", name: "New year", startsOn: "01-01", colour: "red" };
    expect(names(draftOf([winter, spring, newYear]))).toEqual(["New year", "Spring", "Winter"]);
  });

  it("gives no rows for no seasons", () => {
    expect(draftOf([])).toEqual({ rows: [], deleted: [], next: 1 });
  });
});

describe("sameDraft", () => {
  it("is true for the same rows and false once a field or the deleted list differs", () => {
    const draft = draftOf(year);
    expect(sameDraft(draft, draftOf(year))).toBe(true);
    expect(sameDraft(draft, withRow(draft, "s1", { name: "Spring!" }))).toBe(false);
    expect(sameDraft(draft, withRow(draft, "s1", { day: "2" }))).toBe(false);
    expect(sameDraft(draft, withRow(draft, "s1", { month: "04" }))).toBe(false);
    expect(sameDraft(draft, withRow(draft, "s1", { colour: "red" }))).toBe(false);
    expect(sameDraft(draft, { ...draft, deleted: ["s9"] })).toBe(false);
    expect(
      sameDraft({ ...draft, deleted: ["s8", "s9"] }, { ...draft, deleted: ["s9", "s8"] }),
    ).toBe(true);
    expect(sameDraft({ ...draft, deleted: ["s8"] }, { ...draft, deleted: ["s9"] })).toBe(false);
    expect(sameDraft(draft, addRow(draft))).toBe(false);
    expect(sameDraft(draft, { ...draft, rows: draft.rows.slice(1) })).toBe(false);
  });
});

it("treats a name changed only by spaces around it as unchanged", () => {
  const draft = draftOf(year);
  expect(sameDraft(withRow(draft, "s1", { name: " Spring " }), draft)).toBe(true);
});

describe("addRow", () => {
  it("appends a blank new row in the first colour no row has", () => {
    const draft = addRow(draftOf([{ ...spring, colour: "red" }]));
    expect(draft.rows.at(-1)).toEqual({
      key: "new-1",
      name: "",
      day: "",
      month: "",
      colour: "orange",
    });
    expect(addRow(draft).rows.map((r) => r.key)).toEqual(["s1", "new-1", "new-2"]);
  });

  it("takes the first calendar colour when all thirteen are taken", () => {
    const seasons = CALENDAR_COLOURS.map((colour, i) => ({
      id: `c${i}`,
      name: colour,
      startsOn: `${String((i % 12) + 1).padStart(2, "0")}-${i < 12 ? "01" : "15"}`,
      colour,
    }));
    expect(addRow(draftOf(seasons)).rows.at(-1)?.colour).toBe(CALENDAR_COLOURS[0]);
  });
});

it("never reuses a removed new row's key", () => {
  const draft = addRow(removeRow(addRow(addRow(draftOf(year))), "new-2", year));
  expect(draft.rows.map((r) => r.key)).toEqual(["s4", "s1", "s2", "s3", "new-1", "new-3"]);
});

describe("removeRow", () => {
  it("bins a stored row into deleted", () => {
    const draft = removeRow(draftOf(year), "s2", year);
    expect(names(draft)).toEqual(["Winter", "Spring", "Autumn"]);
    expect(draft.deleted).toEqual(["s2"]);
  });

  it("lets a new row just leave", () => {
    const draft = removeRow(addRow(draftOf(year)), "new-1", year);
    expect(draft).toEqual({ ...draftOf(year), next: 2 });
  });

  it("sends no delete for a row whose id is no longer stored", () => {
    const draft = removeRow(draftOf(year), "s2", [spring, autumn, winter]);
    expect(names(draft)).toEqual(["Winter", "Spring", "Autumn"]);
    expect(draft.deleted).toEqual([]);
  });
});

describe("daysIn", () => {
  it("gives February 28 days and April 30", () => {
    expect(daysIn("02")).toBe(28);
    expect(daysIn("04")).toBe(30);
    expect(daysIn("12")).toBe(31);
  });
});

describe("runsUntil", () => {
  const rows = draftOf(year).rows;

  it("runs a season until the day before the next one starts", () => {
    expect(runsUntil(rows, "s1")).toBe("05-31");
  });

  it("runs the last season until the day before the first", () => {
    expect(runsUntil(rows, "s4")).toBe("02-28");
  });

  it("is null for an incomplete row, which the others skip", () => {
    const draft = withRow(addRow(draftOf(year)), "new-1", { month: "04" });
    expect(runsUntil(draft.rows, "new-1")).toBeNull();
    expect(runsUntil(draft.rows, "s1")).toBe("05-31");
    expect(runsUntil(withRow(draft, "new-1", { day: "7", month: "" }).rows, "new-1")).toBeNull();
  });

  it("counts a complete new row, padding its day", () => {
    const draft = withRow(addRow(draftOf(year)), "new-1", { day: "5", month: "04" });
    expect(runsUntil(draft.rows, "s1")).toBe("04-04");
    expect(runsUntil(draft.rows, "new-1")).toBe("05-31");
  });

  it("runs a lone season until the day before its own start", () => {
    expect(runsUntil(draftOf([summer]).rows, "s2")).toBe("05-31");
  });

  it("is null for a key no row has", () => {
    expect(runsUntil(rows, "nope")).toBeNull();
  });
});

describe("rowErrors", () => {
  it("has no entry for valid rows", () => {
    expect(rowErrors(draftOf(year).rows).size).toBe(0);
  });

  it("marks a blank name and a missing day or month as required", () => {
    const errors = rowErrors([
      row({ key: "a", name: "  ", day: "1", month: "01" }),
      row({ key: "b", name: "B", day: "1", month: "" }),
      row({ key: "c", name: "C", day: "", month: "03" }),
    ]);
    expect(errors.get("a")).toEqual({ name: "required" });
    expect(errors.get("b")).toEqual({ startsOn: "required" });
    expect(errors.get("c")).toEqual({ startsOn: "required" });
  });

  it("marks a trimmed name two rows share as taken on both", () => {
    const errors = rowErrors([
      row({ key: "a", name: " Winter", day: "1", month: "01" }),
      row({ key: "b", name: "Winter", day: "1", month: "02" }),
      row({ key: "c", name: "Spring", day: "1", month: "03" }),
    ]);
    expect(errors.get("a")).toEqual({ name: "taken" });
    expect(errors.get("b")).toEqual({ name: "taken" });
    expect(errors.has("c")).toBe(false);
  });

  it("marks a start two rows share as taken on both, whatever the day's padding", () => {
    const errors = rowErrors([
      row({ key: "a", name: "A", day: "1", month: "03" }),
      row({ key: "b", name: "B", day: "01", month: "03" }),
      row({ key: "c", name: "C", day: "1", month: "04" }),
    ]);
    expect(errors.get("a")).toEqual({ startsOn: "taken" });
    expect(errors.get("b")).toEqual({ startsOn: "taken" });
    expect(errors.has("c")).toBe(false);
  });

  it("does not count blank names or incomplete starts as shared", () => {
    const errors = rowErrors([
      row({ key: "a", name: "", day: "", month: "03" }),
      row({ key: "b", name: "", day: "", month: "03" }),
    ]);
    expect(errors.get("a")).toEqual({ name: "required", startsOn: "required" });
    expect(errors.get("b")).toEqual({ name: "required", startsOn: "required" });
  });
});

describe("seasonChange", () => {
  const baseline = draftOf(year);

  it("sends nothing for an unchanged draft", () => {
    expect(seasonChange(baseline, baseline)).toEqual({
      change: { save: [], delete: [] },
      keys: [],
    });
  });

  it("sends a rename trimmed, a recolour and a move padded, each with its id", () => {
    let draft = withRow(baseline, "s1", { name: " Primavera " });
    draft = withRow(draft, "s2", { colour: "red" });
    draft = withRow(draft, "s3", { day: "15", month: "08" });
    expect(seasonChange(draft, baseline)).toEqual({
      change: {
        save: [
          { id: "s1", name: "Primavera", startsOn: "03-01", colour: "green" },
          { id: "s2", name: "Summer", startsOn: "06-01", colour: "red" },
          { id: "s3", name: "Autumn", startsOn: "08-15", colour: "orange" },
        ],
        delete: [],
      },
      keys: ["s1", "s2", "s3"],
    });
  });

  it("does not send a row whose only change is spacing around its name", () => {
    const draft = withRow(baseline, "s1", { name: "Spring " });
    expect(seasonChange(draft, baseline).change.save).toEqual([]);
  });

  it("sends a new row without an id and a binned row's delete, keys lining up", () => {
    let draft = addRow(baseline);
    draft = withRow(draft, "new-1", { name: "Easter", day: "1", month: "04" });
    draft = withRow(draft, "s4", { name: "Invierno" });
    draft = removeRow(draft, "s2", year);
    const { change, keys } = seasonChange(draft, baseline);
    expect(change).toEqual({
      save: [
        { id: "s4", name: "Invierno", startsOn: "12-01", colour: "blue" },
        { name: "Easter", startsOn: "04-01", colour: draft.rows.at(-1)!.colour },
      ],
      delete: ["s2"],
    });
    expect(keys).toEqual(["s4", "new-1"]);
    expect(change.save[1]).not.toHaveProperty("id");
  });

  it("sends a stored row the baseline does not hold", () => {
    const draft = draftOf([spring]);
    expect(seasonChange(draft, draftOf([])).change.save).toEqual([
      { id: "s1", name: "Spring", startsOn: "03-01", colour: "green" },
    ]);
  });
});

describe("mergeSeasonDraft", () => {
  const baseline = draftOf(year);

  it("follows the latest list when the draft is clean", () => {
    const latest = [{ ...spring, name: "Primavera" }, summer, winter];
    const merged = mergeSeasonDraft(baseline, baseline, latest);
    expect(merged.draft).toEqual(draftOf(latest));
    expect(merged.baseline).toEqual(draftOf(latest));
    expect(merged.gone).toEqual([]);
  });

  it("lets an untouched row in a dirty draft follow a rename elsewhere", () => {
    const draft = withRow(baseline, "s2", { name: "Verano" });
    const latest = [{ ...spring, name: "Primavera" }, summer, autumn, winter];
    const merged = mergeSeasonDraft(draft, baseline, latest);
    expect(names(merged.draft)).toEqual(["Winter", "Primavera", "Verano", "Autumn"]);
    expect(merged.baseline).toEqual(draftOf(latest));
    expect(merged.gone).toEqual([]);
  });

  it("keeps the person's name over a rename elsewhere; the baseline takes the new one", () => {
    const draft = withRow(baseline, "s1", { name: "Mine" });
    const latest = [{ ...spring, name: "Theirs" }, summer, autumn, winter];
    const merged = mergeSeasonDraft(draft, baseline, latest);
    expect(merged.draft.rows.find((r) => r.key === "s1")?.name).toBe("Mine");
    expect(merged.baseline.rows.find((r) => r.key === "s1")?.name).toBe("Theirs");
  });

  it("takes a rename elsewhere and keeps the person's colour on the same row", () => {
    const draft = withRow(baseline, "s1", { colour: "red" });
    const latest = [{ ...spring, name: "Theirs" }, summer, autumn, winter];
    const merged = mergeSeasonDraft(draft, baseline, latest);
    expect(merged.draft.rows.find((r) => r.key === "s1")).toMatchObject({
      name: "Theirs",
      colour: "red",
    });
  });

  it("keeps the person's start over a move elsewhere, and takes a move of an unchanged start", () => {
    const draft = withRow(baseline, "s1", { day: "10" });
    const latest = [
      { ...spring, startsOn: "04-20" },
      { ...summer, startsOn: "07-02" },
      autumn,
      winter,
    ];
    const merged = mergeSeasonDraft(draft, baseline, latest);
    expect(merged.draft.rows.find((r) => r.key === "s1")).toMatchObject({ day: "10", month: "03" });
    expect(merged.draft.rows.find((r) => r.key === "s2")).toMatchObject({ day: "2", month: "07" });
  });

  it("appends a season added elsewhere to both the draft and the baseline", () => {
    const draft = withRow(baseline, "s1", { name: "Mine" });
    const easter: Season = { id: "s5", name: "Easter", startsOn: "04-01", colour: "pink" };
    const merged = mergeSeasonDraft(draft, baseline, [...year, easter]);
    expect(merged.draft.rows.at(-1)).toEqual(draftOf([easter]).rows[0]);
    expect(merged.baseline.rows.map((r) => r.key)).toContain("s5");
    expect(merged.gone).toEqual([]);
  });

  it("drops an untouched season deleted elsewhere from both", () => {
    const draft = withRow(baseline, "s1", { name: "Mine" });
    const merged = mergeSeasonDraft(draft, baseline, [spring, autumn, winter]);
    expect(merged.draft.rows.map((r) => r.key)).toEqual(["s4", "s1", "s3"]);
    expect(merged.baseline.rows.map((r) => r.key)).not.toContain("s2");
    expect(merged.gone).toEqual([]);
  });

  it("keeps a touched season deleted elsewhere and names it in gone, through a second merge", () => {
    const draft = withRow(baseline, "s2", { name: "Mine" });
    const latest = [spring, autumn, winter];
    const merged = mergeSeasonDraft(draft, baseline, latest);
    expect(merged.draft.rows.find((r) => r.key === "s2")?.name).toBe("Mine");
    expect(merged.baseline.rows.map((r) => r.key)).not.toContain("s2");
    expect(merged.gone).toEqual(["s2"]);

    const again = mergeSeasonDraft(merged.draft, merged.baseline, latest);
    expect(again.draft.rows.map((r) => r.key)).toContain("s2");
    expect(again.gone).toEqual(["s2"]);
  });

  it("keeps the person's edits to a gone season that comes back, and stops naming it gone", () => {
    const draft = withRow(baseline, "s2", { name: "Mine" });
    const merged = mergeSeasonDraft(draft, baseline, [spring, autumn, winter]);
    const back = mergeSeasonDraft(merged.draft, merged.baseline, [...year]);
    expect(back.draft.rows.find((r) => r.key === "s2")?.name).toBe("Mine");
    expect(back.baseline.rows.find((r) => r.key === "s2")?.name).toBe("Summer");
    expect(back.gone).toEqual([]);
  });

  it("takes a rename elsewhere when the person only added spaces to the name", () => {
    const draft = withRow(withRow(baseline, "s1", { name: "Spring " }), "s2", { colour: "red" });
    const latest = [{ ...spring, name: "Primavera" }, summer, autumn, winter];
    const merged = mergeSeasonDraft(draft, baseline, latest);
    expect(merged.draft.rows.find((r) => r.key === "s1")?.name).toBe("Primavera");
    expect(seasonChange(merged.draft, merged.baseline).change.save).toEqual([
      { id: "s2", name: "Summer", startsOn: "06-01", colour: "red" },
    ]);
  });

  it("keeps the new-key counter, so a later row never takes an earlier key", () => {
    const draft = removeRow(
      addRow(addRow(withRow(baseline, "s1", { name: "Mine" }))),
      "new-2",
      year,
    );
    const merged = mergeSeasonDraft(draft, baseline, [...year]);
    expect(addRow(merged.draft).rows.at(-1)?.key).toBe("new-3");
    const clean = mergeSeasonDraft({ ...baseline, next: 5 }, baseline, [...year]);
    expect(clean.draft.next).toBe(5);
  });

  it("names in gone exactly the rows goneKeys finds, and binning one clears it", () => {
    const draft = withRow(withRow(baseline, "s2", { name: "Mine" }), "s3", { name: "Ours" });
    const latest = [spring, winter];
    const merged = mergeSeasonDraft(draft, baseline, latest);
    expect(merged.gone).toEqual(["s2", "s3"]);
    expect(goneKeys(merged.draft, merged.baseline)).toEqual(merged.gone);
    const binned = removeRow(merged.draft, "s2", latest);
    expect(goneKeys(binned, merged.baseline)).toEqual(["s3"]);
    expect(binned.deleted).toEqual([]);
    expect(goneKeys(baseline, baseline)).toEqual([]);
  });

  it("forgets the delete of a binned season deleted elsewhere", () => {
    const draft = withRow(removeRow(baseline, "s2", year), "s1", { name: "Mine" });
    const merged = mergeSeasonDraft(draft, baseline, [spring, autumn, winter]);
    expect(merged.draft.deleted).toEqual([]);
    expect(merged.draft.rows.map((r) => r.key)).toEqual(["s4", "s1", "s3"]);
    expect(merged.gone).toEqual([]);
  });

  it("keeps a binned season that still exists binned, not appended", () => {
    const draft = removeRow(baseline, "s2", year);
    const merged = mergeSeasonDraft(draft, baseline, [...year]);
    expect(merged.draft.deleted).toEqual(["s2"]);
    expect(merged.draft.rows.map((r) => r.key)).toEqual(["s4", "s1", "s3"]);
  });

  it("leaves new rows untouched", () => {
    const draft = withRow(addRow(baseline), "new-1", { name: "Easter", day: "1", month: "04" });
    const merged = mergeSeasonDraft(draft, baseline, [spring, summer, winter]);
    expect(merged.draft.rows.at(-1)).toEqual(draft.rows.at(-1));
    expect(merged.draft.rows.map((r) => r.key)).toEqual(["s4", "s1", "s2", "new-1"]);
  });
});
