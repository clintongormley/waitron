import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { STATION_COLOURS, type StationColour } from "@waitron/shared";
import { cleanup, host, mount } from "@waitron/ui/src/test-helpers.js";
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
/** A host that accepts every change, as both dialogs do while their draft is current. */
function follow(el: StationColourPicker) {
  el.addEventListener("station-colour-change", (event) => {
    el.value = (event as CustomEvent<{ colour: StationColour }>).detail.colour;
  });
}
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

it("draws its required star in the danger colour, as every field's label does", async () => {
  const el = await picker();
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-danger)";
  host.append(probe);
  const star = el.shadowRoot!.querySelector("legend .required")!;
  expect(getComputedStyle(star).color).toBe(getComputedStyle(probe).color);
});

it("is no wider than the field cap a dialog sets, and as wide as its container without one", async () => {
  const el = await picker();
  host.style.width = "600px";
  expect(el.getBoundingClientRect().width).toBe(600);
  host.style.setProperty("--wt-field-max-width", "300px");
  expect(el.getBoundingClientRect().width).toBe(300);
  const tiles = radios(el).map((button) => button.getBoundingClientRect().right);
  expect(Math.max(...tiles)).toBeLessThanOrEqual(el.getBoundingClientRect().right);
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
  follow(el);
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
  follow(el);
  const events: CustomEvent[] = [];
  el.addEventListener("station-colour-change", (event) => events.push(event as CustomEvent));
  const clicks: EventTarget[] = [];
  el.addEventListener("click", (event) => clicks.push(event.target!));
  el.parentElement!.addEventListener("click", (event) => clicks.push(event.target!));
  radio(el, "teal").click();
  await el.updateComplete;
  expect(events.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
    [{ colour: "teal" }, true, true],
  ]);
  expect(clicks).toEqual([]);
  expect(checked(el)).toEqual(["teal"]);
});

it("keeps showing its value when the host ignores the change", async () => {
  const el = await picker("purple");
  const seen = changes(el);
  const focused = () => el.shadowRoot!.activeElement?.getAttribute("data-station-colour") ?? null;
  radio(el, "teal").click();
  await el.updateComplete;
  expect([seen, checked(el), el.value]).toEqual([["teal"], ["purple"], "purple"]);
  radio(el, "purple").focus();
  await userEvent.keyboard("{ArrowRight}");
  await el.updateComplete;
  expect([seen, checked(el), focused()]).toEqual([["teal", "pink"], ["purple"], "pink"]);
  expect(
    radios(el)
      .filter((button) => button.tabIndex === 0)
      .map((b) => b.dataset.stationColour),
  ).toEqual(["pink"]);
  el.value = "lime";
  await el.updateComplete;
  expect(checked(el)).toEqual(["lime"]);
  expect(
    radios(el)
      .filter((button) => button.tabIndex === 0)
      .map((b) => b.dataset.stationColour),
  ).toEqual(["lime"]);
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
