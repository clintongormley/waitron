import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it } from "vitest";
import { html } from "lit";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { PrepStation } from "./routing-client.js";
import "./prep-stations-screen.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  setLocale("en");
});
function station(overrides: Partial<PrepStation> & Pick<PrepStation, "id" | "name">) {
  return {
    active: true,
    isDefault: false,
    colour: "blue",
    ...overrides,
  } as PrepStation;
}
const bar = station({ id: "bar", name: "Bar", isDefault: true });
type StationTable = HTMLElement & {
  stations: readonly PrepStation[];
  statusNotes: Record<string, string>;
  actions: Record<string, unknown>;
  outputs: Record<string, { printedOn: unknown; shownOn: unknown }>;
};
async function mount(stations: readonly PrepStation[] = [bar], theme: "light" | "dark" = "light") {
  const host = document.createElement("div");
  applyTokens(host);
  host.setAttribute("data-theme", theme);
  host.style.background = "var(--wt-color-bg)";
  host.style.color = "var(--wt-color-text)";
  hosts.push(host);
  document.body.append(host);
  const el = document.createElement("prep-station-table") as StationTable;
  el.stations = stations;
  el.statusNotes = { bar: "Closed for today → Grill" };
  host.append(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}
function table(el: HTMLElement) {
  return el.shadowRoot?.querySelector("wt-data-table")?.shadowRoot;
}
it("draws its rows from the stations list, with its daily status beside Name", async () => {
  const el = await mount();
  expect(
    [...(table(el)?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent?.trim()),
  ).toEqual(["Name", "Printed on", "Shown on", "Actions"]);
  const rows = [...(table(el)?.querySelectorAll("tbody tr") ?? [])];
  expect(rows).toHaveLength(1);
  expect(rows[0]!.textContent).toContain("Bar");
  expect(rows[0]!.textContent).toContain("Default");
  expect(rows[0]!.textContent).toContain("Closed for today → Grill");
  expect(table(el)?.querySelector("button")).toBeNull();
  expect(el.shadowRoot?.textContent).not.toContain("Loading station health");
});
it("puts the row menu in its own Actions column, pinned to the end, without a grip", async () => {
  const el = await mount();
  el.actions = { bar: html`<button type="button" data-test="menu-bar">⋮</button>` };
  await new Promise((resolve) => setTimeout(resolve, 0));
  const cells = [...table(el)!.querySelectorAll("tbody tr td")];
  expect(cells[0]!.querySelector("button")).toBeNull();
  expect(cells[0]!.querySelector('[data-test="menu-bar"]')).toBeNull();
  const last = cells.at(-1)!;
  expect(last.getAttribute("data-pinned")).toBe("end");
  expect(last.querySelector('[data-test="menu-bar"]')).not.toBeNull();
  expect(table(el)!.querySelectorAll("tbody tr button")).toHaveLength(1);
});
it("names its columns in Spanish, and says so when there are no stations", async () => {
  setLocale("es");
  const el = await mount();
  expect(
    [...(table(el)?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent?.trim()),
  ).toEqual(["Nombre", "Se imprime en", "Se muestra en", "Acciones"]);
  const empty = await mount([]);
  expect(table(empty)?.textContent).toContain("No hay estaciones de preparación");
});
it("omits deleted stations and their supplied status while preserving Default", async () => {
  const el = await mount([
    station({ id: "disabled", name: "Old kitchen", active: false }),
    station({ id: "bar", name: "Bar", isDefault: true }),
  ]);
  expect(
    [...table(el)!.querySelectorAll("tbody tr")].map((row) => row.textContent?.trim()),
  ).toEqual([expect.stringContaining("Bar")]);
  expect(table(el)?.textContent).toContain("Default");
  el.statusNotes = { disabled: "Switched off" };
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(table(el)?.textContent).not.toContain("Switched off");
  expect(table(el)?.textContent).not.toContain("Old kitchen");
});
it("orders stations by name despite legacy positions", async () => {
  const el = await mount([
    station({ id: "zulu", name: "Zulu" }),
    station({ id: "alpha", name: "Alpha" }),
    station({ id: "first", name: "Yankee" }),
  ]);
  expect(
    [...table(el)!.querySelectorAll("tbody tr")].map((row) => row.textContent?.trim()),
  ).toEqual([
    expect.stringContaining("Alpha"),
    expect.stringContaining("Yankee"),
    expect.stringContaining("Zulu"),
  ]);
});

it.each([
  ["en", "light", 390],
  ["en", "dark", 390],
  ["es", "light", 390],
  ["es", "dark", 390],
  ["en", "light", 1280],
  ["en", "dark", 1280],
  ["es", "light", 1280],
  ["es", "dark", 1280],
] as const)("keeps the table inside %s %s %ipx", async (locale, theme, width) => {
  const frame = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 844);
  try {
    setLocale(locale);
    const el = await mount([bar], theme);
    const summary = el.shadowRoot!.querySelector("wt-data-table")!;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(table(el)!.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(summary.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  } finally {
    await page.viewport(frame.width, frame.height);
  }
});

const outputs = {
  bar: {
    printedOn: "Epson, Star",
    shownOn: html`<span data-test="screen-device">Pantalla Cocina — station screen</span>`,
  },
};
function headings(el: HTMLElement) {
  return [...(table(el)?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent?.trim());
}
it("reads each station's printers and screens in Printed on and Shown on, beside its status", async () => {
  const el = await mount();
  el.outputs = outputs;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(headings(el)).toEqual(["Name", "Printed on", "Shown on", "Actions"]);
  const row = table(el)!.querySelector("tbody tr")!;
  expect(row.querySelector('[data-test="printed-on-bar"]')!.textContent?.trim()).toBe(
    "Epson, Star",
  );
  expect(row.querySelector('[data-test="screens-bar"] [data-test="screen-device"]')).not.toBeNull();
  expect(
    row.querySelectorAll("td")[0]!.querySelector('[part="station-status"]')!.textContent?.trim(),
  ).toBe("Closed for today → Grill");
});
it("names the read-out columns in Spanish", async () => {
  setLocale("es");
  const el = await mount();
  el.outputs = outputs;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(headings(el)).toEqual(["Nombre", "Se imprime en", "Se muestra en", "Acciones"]);
});
it.each([
  ["en", 390],
  ["es", 390],
] as const)("keeps the table with its read-outs inside %s %ipx", async (locale, width) => {
  const frame = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 844);
  try {
    setLocale(locale);
    const el = await mount([bar]);
    el.outputs = outputs;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const summary = el.shadowRoot!.querySelector("wt-data-table")!;
    expect(headings(el)).toHaveLength(4);
    expect(summary.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  } finally {
    await page.viewport(frame.width, frame.height);
  }
});

it.each(["light", "dark"] as const)(
  "A725 paints every station swatch through the table parts in %s",
  async (theme) => {
    const colours = [
      "red",
      "orange",
      "amber",
      "yellow",
      "lime",
      "green",
      "teal",
      "cyan",
      "sky",
      "blue",
      "indigo",
      "purple",
      "magenta",
      "pink",
      "brown",
      "grey",
    ] as const;
    const el = await mount(
      colours.map((colour) => station({ id: colour, name: colour, colour })),
      theme,
    );
    const squares = [...table(el)!.querySelectorAll<HTMLElement>('[part~="station-colour"]')];
    expect(squares).toHaveLength(colours.length);
    for (const colour of colours) {
      const square = squares.find((node) => node.dataset.stationColour === colour)!;
      const probe = document.createElement("span");
      probe.style.backgroundColor =
        colour === "grey"
          ? "var(--wt-color-palette-grey)"
          : `var(--wt-color-station-${colour}-dot)`;
      el.parentElement!.append(probe);
      const actual = getComputedStyle(square);
      expect(actual.backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
      expect(square.getAttribute("aria-hidden")).toBe("true");
      expect(square.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(square.getBoundingClientRect().width).toBe(square.getBoundingClientRect().height);
      expect(square.closest("td")).toBe(square.closest("tr")!.querySelector("td"));
      probe.remove();
    }
  },
);

it("A725 leaves station names and status without a retired Times link", async () => {
  const el = await mount([bar, station({ id: "grill", name: "Grill" })]);
  const rows = [...table(el)!.querySelectorAll("tbody tr")];
  expect(rows).toHaveLength(2);
  expect(rows[0]!.textContent).toContain("Default");
  expect(rows[0]!.textContent).toContain("Closed for today → Grill");
  expect(rows[1]!.textContent).toContain("Grill");
  expect(rows.flatMap((row) => [...row.querySelectorAll('a[href*="/view/times"]')])).toEqual([]);
});
