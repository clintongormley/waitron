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

it("labels the range's second field Last date with its hint as the placeholder", async () => {
  await mount((dialog) => (dialog.date = "2026-12-14"));
  await click("[data-test=add-dates]");
  expect(field("addTo").label).toBe("Last date");
  expect(field("addTo").hint).toBe("Empty for one date");
});
