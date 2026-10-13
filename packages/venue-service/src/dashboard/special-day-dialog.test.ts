import { afterEach, beforeEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { SpecialDayDetail } from "../special-days.js";
import type { SpecialDayDialog } from "./special-day-dialog.js";
import "./special-day-dialog.js";

let el: SpecialDayDialog;
beforeEach(() => setLocale("en"));
afterEach(() => {
  el?.remove();
  setLocale("en");
});
const stored: SpecialDayDetail = {
  id: "d1",
  name: "Christmas dinners",
  repeatsYearly: false,
  dates: [
    { date: "2026-12-14", closedAllDay: false },
    { date: "2026-12-20", closedAllDay: true },
  ],
  paint: [
    {
      departmentId: "restaurant",
      date: "2026-12-14",
      ranges: [{ periodId: "dinner", startsAt: "19:00", endsAt: "23:00" }],
    },
  ],
  zonePaint: [],
};
const navidad = {
  id: "h",
  date: "2026-12-25",
  name: "Navidad",
  scope: "national" as const,
  sourceId: "s",
};

async function mount(setup: (dialog: SpecialDayDialog) => void = () => {}) {
  el = document.createElement("special-day-dialog");
  setup(el);
  el.open = true;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const q = <T extends Element = HTMLElement>(selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const field = (name: string) => q<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!;
async function change(name: string, detail: object) {
  field(name).dispatchEvent(
    new CustomEvent("wt-change", { detail, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function click(selector: string) {
  q(selector)!.click();
  await el.updateComplete;
}
const save = () => q<HTMLElementTagNameMap["wt-button"]>("[data-test=save-special-day]")!;
const footer = () => q<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!;
function saves() {
  const sent: unknown[] = [];
  el.addEventListener("special-day-save", (event) => sent.push((event as CustomEvent).detail));
  return sent;
}
async function addDates(from: string, to = "") {
  await click("[data-test=add-dates]");
  await change("addFrom", { value: from });
  if (to) await change("addTo", { value: to });
  await click("[data-test=add-dates-confirm]");
}
const shownDates = () =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-date]")].map((row) => row.dataset.date);

it("creates a special day with two dates and a Closed tick, sending SpecialDayInput by value", async () => {
  await mount((dialog) => (dialog.date = "2026-11-04"));
  const sent = saves();
  expect(shownDates()).toEqual(["2026-11-04"]);
  await change("name", { value: "  Staff party  " });
  await addDates("2026-11-05");
  expect(shownDates()).toEqual(["2026-11-04", "2026-11-05"]);
  await change("closed.2026-11-05", { checked: true });
  save().click();
  expect(sent).toEqual([
    {
      id: null,
      input: {
        name: "Staff party",
        repeatsYearly: false,
        dates: [
          { date: "2026-11-04", closedAllDay: false },
          { date: "2026-11-05", closedAllDay: true },
        ],
      },
    },
  ]);
});

it("adds a range from two date fields and removes a date", async () => {
  await mount((dialog) => (dialog.date = "2026-12-14"));
  await addDates("2026-12-16", "2026-12-18");
  expect(shownDates()).toEqual(["2026-12-14", "2026-12-16", "2026-12-17", "2026-12-18"]);
  await click('[data-date="2026-12-17"] [data-test=remove-date]');
  expect(shownDates()).toEqual(["2026-12-14", "2026-12-16", "2026-12-18"]);
});

it("refuses a range that ends before it starts beside the second date field", async () => {
  await mount((dialog) => (dialog.date = "2026-12-14"));
  await addDates("2026-12-18", "2026-12-16");
  expect(field("addTo").error).toBe("The last date is before the first.");
  expect(shownDates()).toEqual(["2026-12-14"]);
});

it("editing the name only sends the dates unchanged and no paint", async () => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  const sent = saves();
  expect(field("name").value).toBe("Christmas dinners");
  await change("name", { value: "Company dinners" });
  save().click();
  expect(sent).toEqual([
    {
      id: "d1",
      input: {
        name: "Company dinners",
        repeatsYearly: false,
        dates: [
          { date: "2026-12-14", closedAllDay: false },
          { date: "2026-12-20", closedAllDay: true },
        ],
      },
    },
  ]);
  expect(Object.keys((sent[0] as { input: object }).input)).not.toContain("paint");
});

it("opens Save quiet and disabled, primary after a change and quiet again once undone", async () => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  const sent = saves();
  expect(save().variant).toBe("secondary");
  expect(save().disabled).toBe(true);
  save().click();
  expect(sent).toEqual([]);
  await change("closed.2026-12-14", { checked: true });
  expect(save().variant).toBe("primary");
  expect(save().disabled).toBe(false);
  await change("closed.2026-12-14", { checked: false });
  expect(save().variant).toBe("secondary");
  expect(save().disabled).toBe(true);
});

it("marks a missing name and an empty date list on Save and holds Save until fixed", async () => {
  await mount((dialog) => (dialog.date = "2026-11-04"));
  await change("repeats", { checked: true });
  await click('[data-date="2026-11-04"] [data-test=remove-date]');
  save().click();
  await el.updateComplete;
  expect(field("name").required).toBe(true);
  expect(field("name").error).toBe("Enter a name.");
  expect(q("[data-error=dates]")!.textContent).toBe("Add at least one date.");
  expect(footer().error).toBe("Correct the highlighted fields to continue.");
  expect(save().disabled).toBe(true);
  await change("name", { value: "Fair" });
  await addDates("2026-11-04");
  expect(save().disabled).toBe(false);
});

it("pre-fills a public holiday's name and date and saves it as a new special day", async () => {
  await mount((dialog) => {
    dialog.date = "2026-12-25";
    dialog.holidays = [navidad];
  });
  const sent = saves();
  expect(field("name").value).toBe("Navidad");
  expect(shownDates()).toEqual(["2026-12-25"]);
  expect(q("[data-test=add-to]")).toBeNull();
  expect(save().disabled).toBe(false);
  save().click();
  expect(sent).toEqual([
    {
      id: null,
      input: {
        name: "Navidad",
        repeatsYearly: false,
        dates: [{ date: "2026-12-25", closedAllDay: false }],
      },
    },
  ]);
});

it("offers Add to <name> first when a special day of the holiday's name exists", async () => {
  await mount((dialog) => {
    dialog.date = "2026-12-25";
    dialog.holidays = [navidad];
    dialog.existing = [
      { id: "other", name: "Christmas dinners" },
      { id: "n2025", name: "Navidad" },
    ];
  });
  const added: unknown[] = [];
  el.addEventListener("special-day-add-to", (event) => added.push((event as CustomEvent).detail));
  expect(q("[data-test=add-to]")!.textContent).toContain("Add to Navidad");
  expect(q("[name=name]")).toBeNull();
  await click("[data-test=add-to]");
  expect(added).toEqual([{ id: "n2025", date: "2026-12-25" }]);
});

it("declining the offer keeps the pre-filled new special day", async () => {
  await mount((dialog) => {
    dialog.date = "2026-12-25";
    dialog.holidays = [navidad];
    dialog.existing = [{ id: "n2025", name: "Navidad" }];
  });
  await click("[data-test=new-instead]");
  expect(q("[data-test=add-to]")).toBeNull();
  expect(field("name").value).toBe("Navidad");
  expect(shownDates()).toEqual(["2026-12-25"]);
});

it("shows the holiday-name note on a public-holiday date and not on an ordinary one", async () => {
  const note = "Every year follows the holiday's name to its date each year.";
  await mount((dialog) => {
    dialog.date = "2026-12-24";
    dialog.holidays = [navidad];
  });
  expect(el.shadowRoot!.textContent).not.toContain(note);
  await addDates("2026-12-25");
  expect(q("[data-test=holiday-note]")!.textContent).toBe(note);
  await click('[data-date="2026-12-25"] [data-test=remove-date]');
  expect(el.shadowRoot!.textContent).not.toContain(note);
});

it("shows the leap-year hint only for a repeating February 29", async () => {
  await mount((dialog) => (dialog.date = "2028-02-29"));
  expect(el.shadowRoot!.textContent).not.toContain("Repeats only in leap years");
  await change("repeats", { checked: true });
  expect(el.shadowRoot!.textContent).toContain("Repeats only in leap years");
});

it.each([
  [
    "en",
    "Christmas dinners already holds Sun, 20 Dec 2026.",
    "Correct the highlighted fields to continue.",
  ],
  [
    "es",
    "Christmas dinners ya tiene el dom, 20 dic 2026.",
    "Corrige los campos marcados para continuar.",
  ],
] as const)(
  "shows special_day.date_taken under Dates naming the other special day (%s)",
  async (locale, message, bottom) => {
    setLocale(locale);
    await mount((dialog) => (dialog.date = "2026-12-20"));
    await change("name", { value: "Party" });
    el.refusal = {
      code: "special_day.date_taken",
      params: { date: "2026-12-20", name: "Christmas dinners", specialDayId: "d1" },
    };
    await el.updateComplete;
    expect(q("[data-error=dates]")!.textContent).toBe(message);
    expect(footer().error).toBe(bottom);
    expect(save().disabled).toBe(false);
  },
);

it("places an unknown refusal at the bottom and keeps Save available", async () => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  await change("name", { value: "Changed" });
  el.refusal = { code: "special_day.not_found", params: { specialDayId: "d1" } };
  await el.updateComplete;
  expect(q("[data-error=dates]")).toBeNull();
  expect(footer().error).toBe("The change could not be saved.");
  expect(save().disabled).toBe(false);
});

it("sends Every year as repeatsYearly", async () => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  const sent = saves();
  await change("repeats", { checked: true });
  save().click();
  expect(sent).toEqual([
    {
      id: "d1",
      input: { name: "Christmas dinners", repeatsYearly: true, dates: stored.dates },
    },
  ]);
});

it.each([
  ["name", "name"],
  ["dates.0.date", "dates"],
  ["repeatsYearly", "repeats"],
])(
  "puts a special_day.invalid naming %s under its field and keeps Save available",
  async (named, shown) => {
    await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
    await change("closed.2026-12-14", { checked: true });
    el.refusal = { code: "special_day.invalid", params: { field: named } };
    await el.updateComplete;
    const message =
      shown === "dates"
        ? q("[data-error=dates]")?.textContent
        : shown === "repeats"
          ? q("[data-error=repeats]")?.textContent
          : field(shown).error;
    expect(message).toBe("Check this field.");
    expect(footer().error).toBe("Correct the highlighted fields to continue.");
    expect(save().disabled).toBe(false);
  },
);

it.each([
  ["en", "Sun, 20 Dec 2026 meets another of these dates."],
  ["es", "dom, 20 dic 2026 coincide con otra de estas fechas."],
] as const)("says which date meets another under Dates (%s)", async (locale, message) => {
  setLocale(locale);
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  await change("repeats", { checked: true });
  el.refusal = {
    code: "special_day.invalid",
    params: { field: "dates.1.date", reason: "overlap" },
  };
  await el.updateComplete;
  expect(q("[data-error=dates]")!.textContent).toBe(message);
});

it("shows the holiday-name note on a saved date that stored a holiday name, with no holidays loaded", async () => {
  await mount((dialog) => {
    dialog.specialDay = {
      ...structuredClone(stored),
      dates: [{ date: "2026-04-03", closedAllDay: false, holidayName: "Viernes Santo" }],
    };
  });
  const sent = saves();
  expect(q("[data-test=holiday-note]")).not.toBeNull();
  await change("name", { value: "Easter" });
  save().click();
  expect((sent[0] as { input: { dates: unknown } }).input.dates).toEqual([
    { date: "2026-04-03", closedAllDay: false },
  ]);
});

it("offers the same-named special day with the latest date, the lowest id on a tie", async () => {
  await mount((dialog) => {
    dialog.date = "2026-12-25";
    dialog.holidays = [navidad];
    dialog.existing = [
      { id: "c", name: "Navidad", latest: "2025-12-25" },
      { id: "a", name: "Navidad", latest: "2024-12-25" },
      { id: "b", name: "Navidad", latest: "2025-12-25" },
      { id: "z", name: "Navidad" },
      { id: "x", name: "Other", latest: "2027-01-01" },
    ];
  });
  const added: unknown[] = [];
  el.addEventListener("special-day-add-to", (event) => added.push((event as CustomEvent).detail));
  await click("[data-test=add-to]");
  expect(added).toEqual([{ id: "b", date: "2026-12-25" }]);
});

it.each([
  [
    { code: "special_day.date_taken", params: { date: "2026-12-25", name: "Christmas dinners" } },
    "Christmas dinners already holds Fri, 25 Dec 2026.",
  ],
  [{ code: "hours.clock_changed" }, "The change could not be saved."],
])("shows a refused Add to in the offer and keeps it available (%#)", async (refusal, message) => {
  await mount((dialog) => {
    dialog.date = "2026-12-25";
    dialog.holidays = [navidad];
    dialog.existing = [{ id: "n2025", name: "Navidad" }];
  });
  el.refusal = refusal;
  await el.updateComplete;
  expect(q("[data-error=offer]")!.textContent).toBe(message);
  expect(q<HTMLElementTagNameMap["wt-button"]>("[data-test=add-to]")!.disabled).toBe(false);
});

it("labels the range's second field Last date (optional), with no hint a date field cannot draw", async () => {
  await mount((dialog) => (dialog.date = "2026-12-14"));
  await click("[data-test=add-dates]");
  expect(field("addTo").label).toBe("Last date (optional)");
  expect(field("addTo").hint).toBe("");
});

it("shows no holiday-name note on a saved date with no stored name, even when it is now a visible holiday", async () => {
  await mount((dialog) => {
    dialog.specialDay = {
      ...structuredClone(stored),
      dates: [{ date: "2026-12-25", closedAllDay: false }],
    };
    dialog.holidays = [navidad];
  });
  expect(q("[data-test=holiday-note]")).toBeNull();
});

it("asks for a first date beside the first field and adds nothing without one", async () => {
  await mount((dialog) => (dialog.date = "2026-12-14"));
  await click("[data-test=add-dates]");
  await click("[data-test=add-dates-confirm]");
  expect(field("addFrom").error).toBe("Enter a valid date.");
  expect(field("addTo").error).toBe("");
  expect(shownDates()).toEqual(["2026-12-14"]);
});

it("refuses a last date that is not a calendar date beside the second field", async () => {
  await mount((dialog) => (dialog.date = "2026-12-14"));
  await addDates("2026-12-16", "20261-12-20");
  expect(field("addFrom").error).toBe("");
  expect(field("addTo").error).toBe("Enter a valid date.");
  expect(shownDates()).toEqual(["2026-12-14"]);
});

it("refuses a range of more than 366 dates beside the last date field, and takes 366", async () => {
  await mount((dialog) => (dialog.date = "2026-11-04"));
  await addDates("2026-01-01", "2027-01-02");
  expect(field("addTo").error).toBe("Choose at most 366 dates.");
  expect(shownDates()).toEqual(["2026-11-04"]);
  await change("addTo", { value: "2027-01-01" });
  await click("[data-test=add-dates-confirm]");
  const dates = shownDates();
  expect(dates).toHaveLength(366);
  expect([dates[0], dates.at(-1)]).toEqual(["2026-01-01", "2027-01-01"]);
});

it("opens a new special day with no date when it was given none, and asks for one on Save", async () => {
  await mount();
  const sent = saves();
  expect(shownDates()).toEqual([]);
  await change("name", { value: "Fair" });
  save().click();
  await el.updateComplete;
  expect(q("[data-error=dates]")!.textContent).toBe("Add at least one date.");
  expect(sent).toEqual([]);
});

it.each([
  ["no field", { code: "special_day.invalid" }],
  ["a field the form does not show", { code: "special_day.invalid", params: { field: "colour" } }],
])("places a special_day.invalid naming %s at the bottom", async (_, refusal) => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  await change("name", { value: "Changed" });
  el.refusal = refusal;
  await el.updateComplete;
  expect(field("name").error).toBe("");
  expect(q("[data-error=dates]")).toBeNull();
  expect(q("[data-error=repeats]")).toBeNull();
  expect(footer().error).toBe("The change could not be saved.");
  expect(save().disabled).toBe(false);
});

it("says Check this field under Dates for a date_taken refusal that names no date", async () => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  await change("name", { value: "Changed" });
  el.refusal = { code: "special_day.date_taken" };
  await el.updateComplete;
  expect(q("[data-error=dates]")!.textContent).toBe("Check this field.");
});

it("says Check this field when an overlap names a date the list does not hold", async () => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  await change("repeats", { checked: true });
  el.refusal = {
    code: "special_day.invalid",
    params: { field: "dates.5.date", reason: "overlap" },
  };
  await el.updateComplete;
  expect(q("[data-error=dates]")!.textContent).toBe("Check this field.");
});

it("clears a refusal once its own field changes, and keeps it through another field's change", async () => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  await change("closed.2026-12-14", { checked: true });
  el.refusal = { code: "special_day.invalid", params: { field: "name" } };
  await el.updateComplete;
  await change("repeats", { checked: true });
  expect(field("name").error).toBe("Check this field.");
  await change("name", { value: "Company dinners" });
  expect(field("name").error).toBe("");
  expect(footer().error).toBe("");
});

it("Enter in a field saves, and Enter while adding dates does not", async () => {
  await mount((dialog) => (dialog.date = "2026-11-04"));
  const sent = saves();
  const enter = (name: string) =>
    field(name)
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await change("name", { value: "Fair" });
  await click("[data-test=add-dates]");
  enter("addFrom");
  enter("name");
  expect(sent).toEqual([]);
  await change("addFrom", { value: "2026-11-05" });
  await click("[data-test=add-dates-confirm]");
  enter("name");
  expect(sent).toEqual([
    {
      id: null,
      input: {
        name: "Fair",
        repeatsYearly: false,
        dates: [
          { date: "2026-11-04", closedAllDay: false },
          { date: "2026-11-05", closedAllDay: false },
        ],
      },
    },
  ]);
});

it("Cancel on an unchanged special day closes the dialog and tells the host", async () => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  let closes = 0;
  el.addEventListener("special-day-close", () => closes++);
  await click("wt-button[slot=cancel]");
  await expect.poll(() => closes).toBe(1);
  expect(el.open).toBe(false);
});

it("ignores every control while a save is in flight", async () => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  const sent = saves();
  let closes = 0;
  el.addEventListener("special-day-close", () => closes++);
  await change("name", { value: "Company dinners" });
  await click("[data-test=add-dates]");
  el.busy = true;
  await el.updateComplete;
  await change("name", { value: "Ignored" });
  await change("closed.2026-12-14", { checked: true });
  await change("repeats", { checked: true });
  await change("addFrom", { value: "2026-12-16" });
  await change("addTo", { value: "2026-12-17" });
  await click("[data-test=add-dates-confirm]");
  await click('[data-date="2026-12-20"] [data-test=remove-date]');
  await click("[data-test=save-special-day]");
  await click("wt-button[slot=cancel]");
  el.busy = false;
  await el.updateComplete;
  expect(sent).toEqual([]);
  expect(closes).toBe(0);
  expect(el.open).toBe(true);
  expect(field("name").value).toBe("Company dinners");
  expect(field("addFrom").value).toBe("");
  expect(field("addTo").value).toBe("");
  expect(shownDates()).toEqual(["2026-12-14", "2026-12-20"]);
  expect(q<HTMLElementTagNameMap["wt-switch"]>('[name="closed.2026-12-14"]')!.checked).toBe(false);
  expect(q<HTMLElementTagNameMap["wt-switch"]>("[name=repeats]")!.checked).toBe(false);
});

it("ignores the add-dates control while a save is in flight", async () => {
  await mount((dialog) => (dialog.specialDay = structuredClone(stored)));
  el.busy = true;
  await el.updateComplete;
  await click("[data-test=add-dates]");
  el.busy = false;
  await el.updateComplete;
  expect(q("[name=addFrom]")).toBeNull();
});

it("ignores the offer's buttons while a save is in flight", async () => {
  await mount((dialog) => {
    dialog.date = "2026-12-25";
    dialog.holidays = [navidad];
    dialog.existing = [{ id: "n2025", name: "Navidad" }];
  });
  const added: unknown[] = [];
  el.addEventListener("special-day-add-to", (event) => added.push((event as CustomEvent).detail));
  el.busy = true;
  await el.updateComplete;
  await click("[data-test=add-to]");
  await click("[data-test=new-instead]");
  el.busy = false;
  await el.updateComplete;
  expect(added).toEqual([]);
  expect(q("[data-test=add-to]")).not.toBeNull();
});
