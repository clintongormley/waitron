import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtTabs } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./venue-settings-screen.js";
import type { VenueSettingsPanel, VenueSettingsScreen } from "./venue-settings-screen.js";

const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  history.replaceState(null, "", initialUrl);
  setLocale("es-ES");
});

function panel(key: string, tab: VenueSettingsPanel["tab"]): VenueSettingsPanel {
  return { key, tab, render: () => html`<p data-test=${`panel-${key}`}>${key}</p>` };
}

function navigate(path: string): void {
  const url = new URL(location.href);
  url.pathname = path;
  url.searchParams.set("source", "saved link");
  history.replaceState(null, "", url);
}

async function mount(panels: VenueSettingsPanel[]): Promise<VenueSettingsScreen> {
  const { el } = await mountWidget<VenueSettingsScreen>("dashboard-venue-settings-screen", {
    panels,
  });
  await el.updateComplete;
  const strip = tabs(el);
  if (strip) await strip.updateComplete;
  return el;
}

const tabs = (el: VenueSettingsScreen) => el.shadowRoot!.querySelector<WtTabs>("wt-tabs");
const tabKeys = (el: VenueSettingsScreen) =>
  [...tabs(el)!.shadowRoot!.querySelectorAll('[role="tab"]')].map((tab) =>
    tab.getAttribute("data-key"),
  );
const selected = (el: VenueSettingsScreen) =>
  tabs(el)!
    .shadowRoot!.querySelector('[role="tab"][aria-selected="true"]')
    ?.getAttribute("data-key");

async function select(el: VenueSettingsScreen, key: string): Promise<void> {
  tabs(el)!
    .shadowRoot!.querySelector<HTMLButtonElement>(`[role="tab"][data-key="${key}"]`)!
    .click();
  await el.updateComplete;
  await tabs(el)!.updateComplete;
}

describe("the Venue settings page", () => {
  it("owns the one h1 and shows only the tabs that have a panel, in core's order", async () => {
    setLocale("en-GB");
    navigate("/manage/venue-settings/view/kitchen");
    const el = await mount([panel("k", "kitchen"), panel("r", "receipts")]);
    const h1s = el.shadowRoot!.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent!.trim()).toBe("Venue settings");
    expect(tabKeys(el)).toEqual(["receipts", "kitchen"]);
    expect(tabs(el)!.label).toBe("Venue settings");
  });

  it("restores the tab its address names without writing history", async () => {
    navigate("/manage/venue-settings/view/kitchen");
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const el = await mount([panel("r", "receipts"), panel("k", "kitchen")]);
    expect(selected(el)).toBe("kitchen");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    "/manage/venue-settings",
    "/manage/venue-settings/view/nowhere",
    // The retired Floor tab: an unknown key like any other.
    "/manage/venue-settings/view/floor",
    // A real tab this session has no panel on.
    "/manage/venue-settings/view/adjustment-reasons",
  ])("replaces %s with the first visible tab, keeping the query", async (path) => {
    navigate(path);
    const query = location.search;
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const el = await mount([panel("s", "tables"), panel("k", "kitchen")]);
    expect(selected(el)).toBe("tables");
    expect(location.pathname).toBe("/manage/venue-settings/view/tables");
    expect(location.search).toBe(query);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes one history entry per new tab and follows Back", async () => {
    navigate("/manage/venue-settings/view/receipts");
    const el = await mount([panel("r", "receipts"), panel("k", "kitchen")]);
    const push = vi.spyOn(history, "pushState");
    await select(el, "kitchen");
    expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
    await select(el, "kitchen");
    expect(push).toHaveBeenCalledTimes(1);
    const back = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await back;
    await el.updateComplete;
    await tabs(el)!.updateComplete;
    expect(selected(el)).toBe("receipts");
  });

  it("shows a tab's panels in the order given, and keeps every tab's panels mounted", async () => {
    navigate("/manage/venue-settings/view/receipts");
    const el = await mount([
      panel("r", "receipts"),
      panel("first", "kitchen"),
      panel("second", "kitchen"),
    ]);
    const kitchen = el.shadowRoot!.querySelector('[slot="kitchen"]')!;
    expect(
      [...kitchen.querySelectorAll<HTMLElement>("[data-test]")].map((p) => p.dataset.test),
    ).toEqual(["panel-first", "panel-second"]);
    expect(el.shadowRoot!.querySelector("[data-test=panel-r]")).not.toBeNull();
    expect(kitchen.querySelector("[data-test=panel-first]")!.checkVisibility()).toBe(false);
  });

  it("draws only its heading when no panel is visible", async () => {
    navigate("/manage/venue-settings");
    const el = await mount([]);
    expect(el.shadowRoot!.querySelectorAll("h1")).toHaveLength(1);
    expect(tabs(el)).toBeNull();
  });

  it("ignores a tab change sent from a strip inside a panel", async () => {
    navigate("/manage/venue-settings/view/receipts");
    const el = await mount([panel("r", "receipts"), panel("k", "kitchen")]);
    const inner = el.shadowRoot!.querySelector("[data-test=panel-r]")!;
    inner.dispatchEvent(
      new CustomEvent("wt-tab-change", {
        detail: { value: "kitchen" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(location.pathname).toBe("/manage/venue-settings/view/receipts");
  });

  it("names its tabs in Spanish", async () => {
    setLocale("es-ES");
    navigate("/manage/venue-settings");
    const el = await mount([
      panel("r", "receipts"),
      panel("s", "tables"),
      panel("a", "adjustment-reasons"),
      panel("k", "kitchen"),
    ]);
    expect(el.shadowRoot!.querySelector("h1")!.textContent!.trim()).toBe("Ajustes del local");
    expect(
      [...tabs(el)!.shadowRoot!.querySelectorAll('[role="tab"]')].map((t) => t.textContent!.trim()),
    ).toEqual(["Recibos", "Mesas", "Motivos de ajuste", "Cocina"]);
  });
});
