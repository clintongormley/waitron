import { afterEach, describe, expect, it } from "vitest";
import type { TabDef } from "../layout.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./tab-shell.js";
import type { TillTabShell } from "./tab-shell.js";

afterEach(cleanupWidgets);

const tabs: TabDef[] = [
  { key: "counter", title: "Counter", columns: 12, cards: [] },
  { key: "floor", title: "Floor", columns: 12, cards: [] },
];

describe("till-tab-shell", () => {
  it("renders one tab button per profile tab and marks the active one", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "floor",
    });
    const buttons = el.shadowRoot!.querySelectorAll<HTMLElement>(".tab");
    expect(buttons.length).toBe(2);
    const active = el.shadowRoot!.querySelector<HTMLElement>('.tab[aria-selected="true"]')!;
    expect(active.textContent).toContain("Floor");
  });

  it("marks the first tab active when activeTabKey is unset or unknown, and tabs are type=button", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", { tabs }); // no activeTabKey
    const active = el.shadowRoot!.querySelectorAll<HTMLElement>('.tab[aria-selected="true"]');
    // Exactly one tab is selected — the first — mirroring the app's #activeTab() fallback body.
    expect(active.length).toBe(1);
    expect(active[0]!.textContent).toContain("Counter");
    // Native tab buttons are type=button so they never submit an enclosing form.
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>(".tab")!.type).toBe("button");
  });

  it("emits tab-select when a tab is tapped", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
    });
    let key: string | undefined;
    el.addEventListener(
      "tab-select",
      (e) => (key = (e as CustomEvent<{ key: string }>).detail.key),
    );
    el.shadowRoot!.querySelectorAll<HTMLElement>(".tab")[1]!.click();
    expect(key).toBe("floor");
  });

  it("emits show-station only when the station affordance is present", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
      affordances: ["station"],
    });
    let fired = false;
    el.addEventListener("show-station", () => (fired = true));
    el.shadowRoot!.querySelector<HTMLElement>(".station")!.click();
    expect(fired).toBe(true);
  });

  it("omits an affordance button that is not in affordances", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
      affordances: ["station"],
    });
    expect(el.shadowRoot!.querySelector(".station")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".expo")).toBeNull();
    expect(el.shadowRoot!.querySelector(".schedule")).toBeNull();
  });

  it("emits show-expo, show-schedule, open-allergens and logout from the header chrome", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
      affordances: ["expo", "schedule"],
    });
    const fired: string[] = [];
    for (const type of ["show-expo", "show-schedule", "open-allergens", "logout"]) {
      el.addEventListener(type, () => fired.push(type));
    }
    el.shadowRoot!.querySelector<HTMLElement>(".expo")!.click();
    el.shadowRoot!.querySelector<HTMLElement>(".schedule")!.click();
    el.shadowRoot!.querySelector<HTMLElement>(".allergens")!.click();
    el.shadowRoot!.querySelector<HTMLElement>(".logout")!.click();
    expect(fired).toEqual(["show-expo", "show-schedule", "open-allergens", "logout"]);
  });

  it("shows the operator name in the header", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
      operatorName: "Ana",
    });
    expect(el.shadowRoot!.querySelector<HTMLElement>(".operator")!.textContent).toContain("Ana");
  });

  it("re-emits the chooser's locale-selected (stopping the inner event)", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
      // The chooser only renders when loadLocales is supplied (guards a throw on open without it).
      loadLocales: async () => [
        { code: "en-GB", label: "English" },
        { code: "es-ES", label: "Español" },
      ],
    });
    let detail: { code: string } | undefined;
    el.addEventListener(
      "locale-selected",
      (e) => (detail = (e as CustomEvent<{ code: string }>).detail),
    );
    const chooser = el.shadowRoot!.querySelector("till-language-chooser")!;
    chooser.dispatchEvent(
      new CustomEvent("locale-selected", {
        detail: { code: "en-GB" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(detail).toEqual({ code: "en-GB" });
  });

  it("omits the language chooser when loadLocales is not supplied (no throw-on-open surface)", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
    });
    expect(el.shadowRoot!.querySelector("till-language-chooser")).toBeNull();
  });

  it("makes the body inert while a drill-in is slotted", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
    });
    expect(el.shadowRoot!.querySelector<HTMLElement>("main.body")!.hasAttribute("inert")).toBe(
      false,
    );
    const drill = document.createElement("div");
    drill.slot = "drill";
    el.appendChild(drill);
    // `slotchange` fires on a microtask AFTER the assignment, then re-renders — the first
    // `updateComplete` lets that fire, the second awaits the slotchange-driven re-render.
    await el.updateComplete;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLElement>("main.body")!.hasAttribute("inert")).toBe(
      true,
    );
    expect(el.shadowRoot!.querySelector<HTMLElement>(".drill")!.hasAttribute("hidden")).toBe(false);
  });

  it("suppresses the whole operator header in kiosk mode, rendering only the body", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs: [{ key: "kitchen", title: "Kitchen", columns: 24, cards: [] }],
      activeTabKey: "kitchen",
      operatorName: "Ana",
      affordances: [],
      kiosk: true,
    });
    expect(el.shadowRoot!.querySelector(".tab")).toBeNull(); // no tab bar
    expect(el.shadowRoot!.querySelector(".logout")).toBeNull(); // no session chrome
    expect(el.shadowRoot!.querySelector("header")).toBeNull(); // header gone entirely
    expect(el.shadowRoot!.querySelector("slot:not([name])")).not.toBeNull(); // body slot stays
  });

  it("renders the full header when not in kiosk mode (default)", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs: [{ key: "counter", title: "Counter", columns: 12, cards: [] }],
      activeTabKey: "counter",
    });
    expect(el.shadowRoot!.querySelector("header")).not.toBeNull();
  });
});

it("keeps the language chooser available on a kitchen display without operator chrome", async () => {
  const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
    kiosk: true,
    loadLocales: async () => [{ code: "en-GB", label: "English" }],
  });
  expect(el.shadowRoot!.querySelector("header")).toBeNull();
  expect(el.shadowRoot!.querySelector("till-language-chooser")).not.toBeNull();
});
