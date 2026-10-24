import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillKeepOpenDialog } from "./keep-open-dialog.js";
import "./keep-open-dialog.js";
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
const zone = {
  id: "terrace",
  name: "Terrace",
  endsAt: "14:00",
  running: true,
  extendedUntil: null,
  dayEndsAt: "05:00",
  choices: ["14:15", "14:30", "19:00", "19:15", "05:00"],
};
async function mount(props: Partial<TillKeepOpenDialog> = {}) {
  const { el } = await mountWidget<TillKeepOpenDialog>("till-keep-open-dialog", {
    zone,
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
  expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe("Keep Terrace open later today");
  expect(el.shadowRoot!.querySelector("[data-ends]")!.textContent!.trim()).toBe(
    "Terrace closes at 14:00 today.",
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
  expect(heard).toEqual([{ zoneId: "terrace", until: "14:30" }]);
});
it("shows the ended sentence and removes an extension without selecting a new endpoint", async () => {
  const el = await mount({ zone: { ...zone, running: false, extendedUntil: "14:30" } });
  expect(el.shadowRoot!.querySelector("[data-ends]")!.textContent!.trim()).toBe(
    "Terrace is closed now.",
  );
  const heard: unknown[] = [];
  el.addEventListener("keep-open-confirm", (e) => heard.push((e as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>("[data-stop]")!.click();
  expect(heard).toEqual([{ zoneId: "terrace", until: null }]);
});
it("cannot remove an extension that does not exist", async () => {
  expect((await mount()).shadowRoot!.querySelector("[data-stop]")).toBeNull();
});
it("places a refusal carrying until beside that field and a correction above the buttons", async () => {
  const el = await mount({ refusal: "zone_extension.invalid", refusalField: "until" });
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
it("a refusal naming no field does not mark the endpoint", async () => {
  const el = await mount({ refusal: "zone_extension.not_allowed", refusalField: null });
  expect(el.shadowRoot!.querySelector("wt-combobox")!.error).toBe("");
  expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(
    "This area cannot stay open after its department closes, or has no closing time left today.",
  );
});
it("drops a vanished endpoint after a refresh and blocks an invalid host press", async () => {
  const el = await mount();
  await choose(el, "14:30");
  el.zone = { ...zone, choices: ["19:00", "05:00"] };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-combobox")!.value).toBe("");
  const heard: unknown[] = [];
  el.addEventListener("keep-open-confirm", (e) => heard.push(e));
  el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
  expect(heard).toEqual([]);
});
it("busy and disconnected dialogs refuse both save and stop host presses", async () => {
  const el = await mount({ zone: { ...zone, extendedUntil: "14:30" } });
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
      zone: { ...zone, name: "Terraza" },
      refusal: "zone_extension.not_allowed",
    });
    await choose(el, "05:00");
    expect(el.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(
      "Ampliar hoy el horario de Terraza",
    );
    expect(el.shadowRoot!.querySelector("[data-delay]")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-combobox")!.options.at(-1)!.label).toBe(
      "Fin del día (05:00)",
    );
  } finally {
    setLocale("en");
  }
});

it("labels a last available quarter before the actual day end as its clock time", async () => {
  const el = await mount({
    zone: { ...zone, dayEndsAt: "05:50", choices: ["14:15", "14:30", "05:45"] },
  });
  expect(el.shadowRoot!.querySelector("wt-combobox")!.options.at(-1)!.label).toBe("05:45");
});
