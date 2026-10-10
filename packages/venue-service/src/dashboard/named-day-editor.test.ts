import { afterEach, beforeEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { NamedDayEditor } from "./named-day-editor.js";
import "./named-day-editor.js";
let el: NamedDayEditor;
beforeEach(() => setLocale("en"));
afterEach(() => {
  el?.remove();
  setLocale("en");
});
const day = {
  id: "d1",
  date: "2028-02-29",
  name: "Anniversary",
  kind: "working_day" as const,
  repeats: true,
  ownHours: false,
  closeWholeVenue: false,
};
async function mount(edit = false) {
  el = document.createElement("named-day-editor");
  if (edit) el.day = { ...day };
  el.open = true;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}
function field(name: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name=${name}]`)!;
}
async function change(name: string, detail: object) {
  field(name).dispatchEvent(
    new CustomEvent("wt-change", { detail, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function save() {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-named-day]",
  )!;
}
it("marks missing date and name on attempted Save and holds Save until corrected", async () => {
  await mount();
  await change("repeats", { checked: true });
  save().click();
  await el.updateComplete;
  expect(field("date").required).toBe(true);
  expect(field("name").required).toBe(true);
  expect(field("date").error).not.toBe("");
  expect(field("name").error).toBe("Enter a name.");
  expect(save().disabled).toBe(true);
  await change("date", { value: "2027-05-01" });
  await change("name", { value: "May day" });
  expect(save().disabled).toBe(false);
});
it("opens unchanged Save quiet and sends the changed trimmed input without station cells", async () => {
  await mount(true);
  const writes: unknown[] = [];
  el.addEventListener("named-day-save", (e) => writes.push((e as CustomEvent).detail));
  expect(save().variant).toBe("secondary");
  expect(save().disabled).toBe(true);
  save().click();
  expect(writes).toEqual([]);
  await change("name", { value: "  Birthday  " });
  save().click();
  expect(writes).toEqual([
    {
      id: "d1",
      input: {
        date: "2028-02-29",
        name: "Birthday",
        kind: "working_day",
        repeats: true,
        ownHours: false,
        closeWholeVenue: false,
      },
    },
  ]);
});
it("suggests holiday names until the person replaces the suggestion", async () => {
  await mount();
  el.holidays = [
    { id: "h", date: "2027-05-01", name: "Labour Day", scope: "national", sourceId: "s" },
  ];
  await el.updateComplete;
  await change("date", { value: "2027-05-01" });
  expect(field("name").value).toBe("Labour Day");
  el.holidays = [{ ...el.holidays[0]!, name: "Updated holiday" }];
  await el.updateComplete;
  expect(field("name").value).toBe("Updated holiday");
  await change("name", { value: "Our day" });
  el.holidays = [];
  await el.updateComplete;
  expect(field("name").value).toBe("Our day");
});
it("shows the leap-year hint only for repeating February 29", async () => {
  await mount(true);
  expect(el.shadowRoot!.textContent).toContain("Repeats only in leap years");
  await change("repeats", { checked: false });
  expect(el.shadowRoot!.textContent).not.toContain("Repeats only in leap years");
});
it("opening a repeating day with its own hours says the change applies every year and is savable immediately", async () => {
  el = document.createElement("named-day-editor");
  el.day = { ...day };
  el.ownHours = true;
  el.savableAtOpen = true;
  el.open = true;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("This changes the day every year");
  expect(save().disabled).toBe(false);
});
it("closure hides the hours choice and emits normal-week hours", async () => {
  await mount(true);
  await change("ownHours", { value: "own" });
  await change("closeWholeVenue", { checked: true });
  expect(field("ownHours")).toBeNull();
  const writes: unknown[] = [];
  el.addEventListener("named-day-save", (e) => writes.push((e as CustomEvent).detail));
  save().click();
  expect(writes).toEqual([
    {
      id: "d1",
      input: {
        date: "2028-02-29",
        name: "Anniversary",
        kind: "working_day",
        repeats: true,
        ownHours: false,
        closeWholeVenue: true,
      },
    },
  ]);
});
it.each(["date", "name", "kind", "repeats", "ownHours", "closeWholeVenue"])(
  "places hours.invalid beside %s without disabling retry",
  async (name) => {
    await mount(true);
    await change("name", { value: "Changed" });
    el.refusal = { code: "hours.invalid", params: { field: name } };
    await el.updateComplete;
    if (name === "repeats")
      expect(el.shadowRoot!.querySelector("[data-error=repeats]")!.textContent).toContain(
        "Check this field.",
      );
    else if (name === "closeWholeVenue")
      expect(el.shadowRoot!.querySelector("[data-error=closeWholeVenue]")!.textContent).not.toBe(
        "",
      );
    else expect(field(name).error).not.toBe("");
    expect(save().disabled).toBe(false);
  },
);
it("places a taken date under Date and unknown refusals at the bottom", async () => {
  await mount(true);
  el.refusal = { code: "special_date.date_taken" };
  await el.updateComplete;
  expect(field("date").error).not.toBe("");
  expect(field("name").error).toBe("");
  el.refusal = { code: "special_date.not_found" };
  await el.updateComplete;
  expect(field("date").error).toBe("");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).not.toBe("");
});

it.each([
  ["en", "The change could not be saved.", "Check this field."],
  ["es", "No se pudo guardar el cambio.", "Revisa este campo."],
] as const)(
  "keeps an Hours refusal visible through closure changes (%s)",
  async (locale, bottom, fieldError) => {
    await mount(true);
    setLocale(locale);
    await change("name", { value: "Changed" });
    el.refusal = { code: "hours.invalid", params: { field: "ownHours" } };
    await el.updateComplete;
    expect(field("ownHours").error).toBe(fieldError);
    await change("closeWholeVenue", { checked: true });
    expect(field("ownHours")).toBeNull();
    const footer =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!;
    expect(footer.error).toBe(bottom);
    expect(save().disabled).toBe(false);
    await change("closeWholeVenue", { checked: false });
    expect(field("ownHours").error).toBe(fieldError);
  },
);

it.each([
  ["en", "The change could not be saved."],
  ["es", "No se pudo guardar el cambio."],
] as const)(
  "shows an Hours refusal supplied while already closed at the bottom (%s)",
  async (locale, bottom) => {
    await mount(true);
    setLocale(locale);
    await change("name", { value: "Changed" });
    await change("closeWholeVenue", { checked: true });
    el.refusal = { code: "hours.invalid", params: { field: "ownHours" } };
    await el.updateComplete;
    expect(field("ownHours")).toBeNull();
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).toBe(bottom);
    expect(save().disabled).toBe(false);
  },
);

it.each([
  ["en", "Check this field.", "Correct the highlighted fields to continue."],
  ["es", "Revisa este campo.", "Corrige los campos marcados para continuar."],
] as const)(
  "keeps a repeat refusal beside the choice and allows retry (%s)",
  async (locale, message, bottom) => {
    await mount(true);
    setLocale(locale);
    await change("name", { value: "Changed" });
    el.refusal = { code: "hours.invalid", params: { field: "repeats" } };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-error=repeats]")!.textContent).toBe(message);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).toBe(bottom);
    expect(save().disabled).toBe(false);
    const writes: unknown[] = [];
    el.addEventListener("named-day-save", (event) => writes.push((event as CustomEvent).detail));
    save().click();
    expect(writes).toEqual([
      {
        id: "d1",
        input: {
          date: "2028-02-29",
          name: "Changed",
          kind: "working_day",
          repeats: true,
          ownHours: false,
          closeWholeVenue: false,
        },
      },
    ]);
  },
);
