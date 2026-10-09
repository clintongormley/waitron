import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillKeepOpenDialog } from "./keep-open-dialog.js";
import "./keep-open-dialog.js";
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
const period = {
  id: "lunch",
  name: "Lunch",
  endsAt: "14:00",
  running: true,
  extendedUntil: null,
  dayEndsAt: "05:00",
  choices: ["14:15", "14:30", "19:00", "19:15", "05:00"],
  next: { name: "Dinner", startsAt: "19:00", endsAt: "23:00" },
};
async function mount(props: Partial<TillKeepOpenDialog> = {}) {
  const { el } = await mountWidget<TillKeepOpenDialog>("till-keep-open-dialog", {
    period,
    ...props,
  });
  expect(el.shadowRoot, "the keep-open editor renders").not.toBeNull();
  return el;
}
async function choose(el: TillKeepOpenDialog, value: string) {
  el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
it("offers only the server choices, labels the end of day and sends the selected endpoint once", async () => {
  const el = await mount();
  expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Keep Lunch open later today");
  expect(el.shadowRoot!.querySelector("[data-ends]")!.textContent!.trim()).toBe(
    "Lunch ends at 14:00 today.",
  );
  const field = el.shadowRoot!.querySelector("wt-combobox")!;
  expect([field.name, field.required, field.value]).toEqual(["until", true, ""]);
  expect(field.options).toEqual([
    { value: "14:15", label: "14:15" },
    { value: "14:30", label: "14:30" },
    { value: "19:00", label: "19:00" },
    { value: "19:15", label: "19:15" },
    { value: "05:00", label: "End of the day (05:00)" },
  ]);
  const heard: unknown[] = [];
  el.addEventListener("keep-open-confirm", (e) => heard.push((e as CustomEvent).detail));
  await choose(el, "14:30");
  el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
  expect(heard).toEqual([{ periodId: "lunch", until: "14:30" }]);
});
it.each([
  ["14:30", null],
  ["19:00", null],
  ["19:15", "Dinner will start at 19:15 instead of 19:00."],
  ["05:00", "Dinner will not run today."],
])("explains what choosing %s changes", async (value, sentence) => {
  const el = await mount();
  await choose(el, value!);
  expect(el.shadowRoot!.querySelector("[data-delay]")?.textContent ?? null).toBe(sentence);
});
it("orders next-period times through midnight using the offered sequence", async () => {
  const el = await mount({
    period: {
      ...period,
      endsAt: "23:00",
      choices: ["23:15", "00:00", "00:30", "01:00", "05:00"],
      next: { name: "Late service", startsAt: "00:30", endsAt: "03:00" },
    },
  });
  await choose(el, "00:00");
  expect(el.shadowRoot!.querySelector("[data-delay]")).toBeNull();
  await choose(el, "01:00");
  expect(el.shadowRoot!.querySelector("[data-delay]")!.textContent).toBe(
    "Late service will start at 01:00 instead of 00:30.",
  );
});
it("an already displaced next period is delayed by every newly offered choice", async () => {
  const el = await mount({
    period: {
      ...period,
      endsAt: "20:00",
      extendedUntil: "20:00",
      choices: ["20:15", "20:30", "05:00"],
    },
  });
  await choose(el, "20:30");
  expect(el.shadowRoot!.querySelector("[data-delay]")!.textContent).toBe(
    "Dinner will start at 20:30 instead of 19:00.",
  );
});
it("shows the ended sentence and removes an extension without selecting a new endpoint", async () => {
  const el = await mount({ period: { ...period, running: false, extendedUntil: "14:30" } });
  expect(el.shadowRoot!.querySelector("[data-ends]")!.textContent!.trim()).toBe(
    "Lunch ended at 14:00.",
  );
  const heard: unknown[] = [];
  el.addEventListener("keep-open-confirm", (e) => heard.push((e as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>("[data-stop]")!.click();
  expect(heard).toEqual([{ periodId: "lunch", until: null }]);
});
it("cannot remove an extension that does not exist", async () => {
  expect((await mount()).shadowRoot!.querySelector("[data-stop]")).toBeNull();
});
it("places a refusal carrying until beside that field and a correction above the buttons", async () => {
  const el = await mount({ refusal: "period_extension.invalid", refusalField: "until" });
  expect(el.shadowRoot!.querySelector("wt-combobox")!.error).toBe(
    "Choose a later time, in 15-minute steps, before the end of the day.",
  );
  expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(
    "Correct the highlighted fields to continue.",
  );
  await choose(el, "14:30");
  expect(el.shadowRoot!.querySelector("wt-combobox")!.error).toBe("");
  expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
});
it("a refusal about the period does not mark the endpoint", async () => {
  const el = await mount({ refusal: "period_extension.invalid", refusalField: "periodId" });
  expect(el.shadowRoot!.querySelector("wt-combobox")!.error).toBe("");
  expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(
    "Choose a later time, in 15-minute steps, before the end of the day.",
  );
});
it("drops a vanished endpoint after a refresh and blocks an invalid host press", async () => {
  const el = await mount();
  await choose(el, "14:30");
  el.period = { ...period, choices: ["19:00", "05:00"] };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-combobox")!.value).toBe("");
  const heard: unknown[] = [];
  el.addEventListener("keep-open-confirm", (e) => heard.push(e));
  el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
  expect(heard).toEqual([]);
});
it("busy and disconnected dialogs refuse both save and stop host presses", async () => {
  const el = await mount({ period: { ...period, extendedUntil: "14:30" } });
  await choose(el, "19:15");
  const heard: unknown[] = [];
  el.addEventListener("keep-open-confirm", (e) => heard.push(e));
  el.busy = true;
  await el.updateComplete;
  for (const name of ["submit", "stop"])
    el.shadowRoot!.querySelector<HTMLElement>(`[data-${name}]`)!.click();
  el.busy = false;
  el.remove();
  for (const name of ["submit", "stop"])
    el.shadowRoot!.querySelector<HTMLElement>(`[data-${name}]`)!.click();
  expect(heard).toEqual([]);
});
it("localizes the choices, effect and refusal in Spanish", async () => {
  try {
    setLocale("es");
    const el = await mount({
      period: {
        ...period,
        name: "Comida",
        next: { name: "Cena", startsAt: "19:00", endsAt: "23:00" },
      },
      refusal: "period_extension.not_allowed",
    });
    await choose(el, "05:00");
    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(
      "Ampliar hoy el horario de Comida",
    );
    expect(el.shadowRoot!.querySelector("[data-delay]")!.textContent).toBe("Hoy no habrá Cena.");
    expect(el.shadowRoot!.querySelector("wt-combobox")!.options.at(-1)!.label).toBe(
      "Fin del día (05:00)",
    );
  } finally {
    setLocale("en");
  }
});

it.each(["19:00", "20:00"])(
  "says the next period will not run when extending until %s",
  async (until) => {
    const el = await mount({
      period: {
        ...period,
        dayEndsAt: "05:00",
        choices: ["14:15", "14:30", "19:00", "20:00", "05:00"],
        next: { name: "Afternoon", startsAt: "14:00", endsAt: "19:00" },
      },
    });
    await choose(el, until);
    expect(el.shadowRoot!.querySelector("[data-delay]")!.textContent).toBe(
      "Afternoon will not run today.",
    );
  },
);
it("labels a last available quarter before the actual day end as its clock time", async () => {
  const el = await mount({
    period: { ...period, dayEndsAt: "05:50", choices: ["14:15", "14:30", "05:45"], next: null },
  });
  expect(el.shadowRoot!.querySelector("wt-combobox")!.options.at(-1)!.label).toBe("05:45");
});
it.each([
  ["00:30", "Late service will start at 00:30 instead of 23:30."],
  ["01:00", "Late service will not run today."],
])("uses the next period's end across midnight for %s", async (until, expected) => {
  const el = await mount({
    period: {
      ...period,
      dayEndsAt: "05:00",
      choices: ["23:15", "23:30", "00:30", "01:00", "05:00"],
      next: { name: "Late service", startsAt: "23:30", endsAt: "01:00" },
    },
  });
  await choose(el, until);
  expect(el.shadowRoot!.querySelector("[data-delay]")!.textContent).toBe(expected);
});
it("explains a cancelled next period and non-quarter day end in Spanish", async () => {
  try {
    setLocale("es");
    const el = await mount({
      period: {
        ...period,
        dayEndsAt: "05:50",
        choices: ["14:15", "19:00", "05:45"],
        next: { name: "Cena", startsAt: "14:00", endsAt: "19:00" },
      },
    });
    await choose(el, "19:00");
    expect(el.shadowRoot!.querySelector("[data-delay]")!.textContent).toBe("Hoy no habrá Cena.");
    expect(el.shadowRoot!.querySelector("wt-combobox")!.options.at(-1)!.label).toBe("05:45");
  } finally {
    setLocale("en");
  }
});
