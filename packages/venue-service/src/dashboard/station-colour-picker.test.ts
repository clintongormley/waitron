import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { STATION_COLOURS, type StationColour } from "@waitron/shared";
import { cleanup, mount } from "@waitron/ui/src/test-helpers.js";
import type { StationColourPicker } from "./station-colour-picker.js";
import "./station-colour-picker.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const OTHERS = [
  { id: "kitchen", name: "Kitchen", colour: "orange" as const },
  { id: "bar", name: "Bar", colour: "blue" as const },
  { id: "coffee", name: "Coffee", colour: "blue" as const },
];

async function picker(
  value: StationColour = "purple",
  stations = OTHERS,
  locale: "en" | "es" = "en",
) {
  setLocale(locale);
  const el = (await mount(
    "<station-colour-picker></station-colour-picker>",
  )) as StationColourPicker;
  el.value = value;
  el.stations = stations;
  await el.updateComplete;
  return el;
}
const radios = (el: StationColourPicker) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("[role=radio]"),
];
const radio = (el: StationColourPicker, colour: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`[role=radio][data-station-colour="${colour}"]`)!;
const checked = (el: StationColourPicker) =>
  radios(el)
    .filter((button) => button.getAttribute("aria-checked") === "true")
    .map((button) => button.dataset.stationColour);
function changes(el: StationColourPicker) {
  const seen: string[] = [];
  el.addEventListener("station-colour-change", (event) =>
    seen.push((event as CustomEvent<{ colour: string }>).detail.colour),
  );
  return seen;
}

it("offers the twelve colours in four columns, the chosen one checked", async () => {
  const el = await picker("purple");
  const legend = el.shadowRoot!.querySelector("fieldset[name=colour] > legend")!;
  expect(legend.textContent!.replace(/\s+/g, "")).toBe("Colour*");
  expect(legend.querySelector("[aria-hidden=true]")!.textContent).toBe("*");
  expect(radios(el).map((button) => button.dataset.stationColour)).toEqual([...STATION_COLOURS]);
  expect(radios(el).map((button) => button.querySelector(".colour-name")!.textContent)).toEqual([
    "Red",
    "Orange",
    "Amber",
    "Lime",
    "Green",
    "Teal",
    "Cyan",
    "Blue",
    "Indigo",
    "Purple",
    "Pink",
    "Brown",
  ]);
  expect(checked(el)).toEqual(["purple"]);
  const tops = new Set(radios(el).map((button) => Math.round(button.getBoundingClientRect().top)));
  const lefts = new Set(
    radios(el).map((button) => Math.round(button.getBoundingClientRect().left)),
  );
  expect([tops.size, lefts.size]).toEqual([3, 4]);
});

it("names under each colour the other stations that have it", async () => {
  const el = await picker();
  const used = (colour: string) =>
    radio(el, colour).querySelector(".used-by")?.textContent?.trim() ?? null;
  expect(used("orange")).toBe("Kitchen");
  expect(used("blue")).toBe("Bar, Coffee");
  expect(used("red")).toBeNull();
  expect(radio(el, "blue").getAttribute("aria-label")).toBe("Blue, used by Bar, Coffee");
  expect(radio(el, "red").getAttribute("aria-label")).toBe("Red");
});

it("moves the choice with the arrow keys, wrapping at both ends, keeping one tab stop", async () => {
  const el = await picker("brown");
  const seen = changes(el);
  const focused = () => el.shadowRoot!.activeElement?.getAttribute("data-station-colour") ?? null;
  expect(radios(el).map((button) => button.tabIndex)).toEqual([
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0,
  ]);
  radio(el, "brown").focus();
  await userEvent.keyboard("{ArrowRight}");
  await el.updateComplete;
  expect([checked(el), focused()]).toEqual([["red"], "red"]);
  expect(radio(el, "red").tabIndex).toBe(0);
  expect(radio(el, "brown").tabIndex).toBe(-1);
  await userEvent.keyboard("{ArrowLeft}");
  await el.updateComplete;
  expect([checked(el), focused()]).toEqual([["brown"], "brown"]);
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;
  await userEvent.keyboard("{ArrowDown}");
  await el.updateComplete;
  expect([checked(el), focused()]).toEqual([["brown"], "brown"]);
  expect(seen).toEqual(["red", "brown", "pink", "brown"]);
  await userEvent.tab();
  expect(el.shadowRoot!.activeElement?.getAttribute("role")).not.toBe("radio");
});

it("sends station-colour-change on a click", async () => {
  const el = await picker("purple");
  const events: CustomEvent[] = [];
  el.addEventListener("station-colour-change", (event) => events.push(event as CustomEvent));
  radio(el, "teal").click();
  await el.updateComplete;
  expect(events.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
    [{ colour: "teal" }, true, true],
  ]);
  expect(checked(el)).toEqual(["teal"]);
});

it("draws an error under the group and disables the tiles while busy", async () => {
  const el = await picker();
  el.error = "Choose one of these colours.";
  await el.updateComplete;
  const group = el.shadowRoot!.querySelector("[role=radiogroup]")!;
  const message = el.shadowRoot!.getElementById(group.getAttribute("aria-describedby")!)!;
  expect(message.textContent).toBe("Choose one of these colours.");
  expect(group.getAttribute("aria-invalid")).toBe("true");
  el.busy = true;
  await el.updateComplete;
  expect(radios(el).every((button) => button.disabled)).toBe(true);
});

it("reads in Spanish", async () => {
  try {
    const el = await picker("purple", OTHERS, "es");
    const legend = el.shadowRoot!.querySelector("fieldset[name=colour] > legend")!;
    expect(legend.textContent!.replace(/\s+/g, "")).toBe("Color*");
    expect(radio(el, "blue").getAttribute("aria-label")).toBe("Azul, en uso por Bar, Coffee");
    expect(radio(el, "brown").getAttribute("aria-label")).toBe("Marrón");
  } finally {
    setLocale("en");
  }
});
