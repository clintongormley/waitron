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
  return { active: true, isDefault: false, displayOrder: 0, ...overrides } as PrepStation;
}
const bar = station({ id: "bar", name: "Bar", isDefault: true });
type StationTable = HTMLElement & {
  stations: readonly PrepStation[];
  today: Record<string, string>;
  actions: Record<string, unknown>;
  outputs?: Record<string, { printedOn: unknown; shownOn: unknown }>;
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
  el.today = { bar: "Always open" };
  host.append(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}
function table(el: HTMLElement) {
  return el.shadowRoot?.querySelector("wt-data-table")?.shadowRoot;
}
it("draws its rows from the stations list, with only Name and Today columns", async () => {
  const el = await mount();
  expect(
    [...(table(el)?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent?.trim()),
  ).toEqual(["Name", "Today"]);
  const rows = [...(table(el)?.querySelectorAll("tbody tr") ?? [])];
  expect(rows).toHaveLength(1);
  expect(rows[0]!.textContent).toContain("Bar");
  expect(rows[0]!.textContent).toContain("Default");
  expect(rows[0]!.textContent).toContain("Always open");
  expect(table(el)?.querySelector("button")).toBeNull();
  expect(el.shadowRoot?.textContent).not.toContain("Loading station health");
});
it("puts a manager's row actions before the station's name", async () => {
  const el = await mount();
  el.actions = { bar: html`<button type="button" data-test="menu-bar">⋮</button>` };
  await new Promise((resolve) => setTimeout(resolve, 0));
  const row = table(el)!.querySelector("tbody tr")!;
  expect(row.querySelector('[data-test="menu-bar"]')).not.toBeNull();
  expect(row.querySelectorAll("button")).toHaveLength(1);
});
it("names its columns in Spanish, and says so when there are no stations", async () => {
  setLocale("es");
  const el = await mount();
  expect(
    [...(table(el)?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent?.trim()),
  ).toEqual(["Nombre", "Hoy"]);
  const empty = await mount([]);
  expect(table(empty)?.textContent).toContain("No hay estaciones de preparación");
});
it("keeps disabled stations at the bottom and marks Default and Disabled", async () => {
  const el = await mount([
    station({ id: "disabled", name: "Old kitchen", active: false, displayOrder: 0 }),
    station({ id: "bar", name: "Bar", isDefault: true, displayOrder: 1 }),
  ]);
  expect(
    [...table(el)!.querySelectorAll("tbody tr")].map((row) => row.textContent?.trim()),
  ).toEqual([expect.stringContaining("Bar"), expect.stringContaining("Old kitchen")]);
  expect(table(el)?.textContent).toContain("Default");
  expect(table(el)?.textContent).toContain("Disabled");
});
it("orders tied stations by name", async () => {
  const el = await mount([
    station({ id: "zulu", name: "Zulu", displayOrder: 1 }),
    station({ id: "alpha", name: "Alpha", displayOrder: 1 }),
    station({ id: "first", name: "Yankee", displayOrder: 0 }),
  ]);
  expect(
    [...table(el)!.querySelectorAll("tbody tr")].map((row) => row.textContent?.trim()),
  ).toEqual([
    expect.stringContaining("Yankee"),
    expect.stringContaining("Alpha"),
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
it("reads each station's printers and screens in Printed on and Shown on, before Today", async () => {
  const el = await mount();
  el.outputs = outputs;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(headings(el)).toEqual(["Name", "Printed on", "Shown on", "Today"]);
  const row = table(el)!.querySelector("tbody tr")!;
  expect(row.querySelector('[data-test="printed-on-bar"]')!.textContent?.trim()).toBe(
    "Epson, Star",
  );
  expect(row.querySelector('[data-test="screens-bar"] [data-test="screen-device"]')).not.toBeNull();
  expect(row.querySelectorAll("td")[3]!.textContent?.trim()).toBe("Always open");
  el.outputs = undefined;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(headings(el)).toEqual(["Name", "Today"]);
  expect(table(el)!.querySelector('[data-test="printed-on-bar"]')).toBeNull();
});
it("names the read-out columns in Spanish", async () => {
  setLocale("es");
  const el = await mount();
  el.outputs = outputs;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(headings(el)).toEqual(["Nombre", "Se imprime en", "Se muestra en", "Hoy"]);
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
