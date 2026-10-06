import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { TabDef } from "../layout.js";
import { chooserFaces, cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./tab-shell.js";
import type { TillTabShell } from "./tab-shell.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";

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

  it("offers Find a bill from the header when the operator can collect a debt", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      affordances: ["find-bill"],
    });
    const seen: string[] = [];
    el.addEventListener("find-bill", () => seen.push("find-bill"));
    el.shadowRoot!.querySelector<HTMLElement>(".find-bill")!.click();
    expect(seen).toEqual(["find-bill"]);
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

  it("offers Printers beside Allergens, emitting open-printers", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", { tabs });
    const printers = el.shadowRoot!.querySelector<HTMLElement>("wt-button.printers")!;
    expect(printers.textContent).toContain(t("printers.open"));
    expect(printers.nextElementSibling).toBe(el.shadowRoot!.querySelector("wt-button.allergens"));
    let fired = 0;
    el.addEventListener("open-printers", () => (fired += 1));
    printers.click();
    expect(fired).toBe(1);
  });

  it("offers Profile before Printers only when the device can switch profile, emitting open-profile", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", { tabs });
    expect(el.shadowRoot!.querySelector("wt-button.profile")).toBeNull();
    el.canSwitchProfile = true;
    await el.updateComplete;
    const profile = el.shadowRoot!.querySelector<HTMLElement>("wt-button.profile")!;
    expect(profile.textContent).toContain(t("profile.open"));
    expect(profile.nextElementSibling).toBe(el.shadowRoot!.querySelector("wt-button.printers"));
    let fired = 0;
    el.addEventListener("open-profile", () => (fired += 1));
    profile.click();
    expect(fired).toBe(1);
  });

  it("shows the operator name in the header", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
      operatorName: "Ana",
    });
    expect(el.shadowRoot!.querySelector<HTMLElement>(".operator")!.textContent).toContain("Ana");
  });

  it("places the language chooser in the bar, just before the operator's name", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "floor",
      operatorName: "Ana",
      loadLocales: async () => [{ code: "es-ES", label: "Español" }],
    });
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    expect(chooser).not.toBeNull();
    expect(chooser.parentElement).toBe(el.shadowRoot!.querySelector("header .session"));
    expect(chooser.nextElementSibling).toBe(el.shadowRoot!.querySelector(".operator"));
    expect(chooser.getAttribute("active")).toBe(currentLocale());
  });

  it("shows the language's full name at 1280 wide and its short code at 390, always named in full", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      loadLocales: async () => [{ code: "es-ES", label: "Español" }],
    });
    const faces = await chooserFaces(el.shadowRoot!.querySelector("wt-language-chooser")!);
    expect(faces.wide).toEqual({ shown: ["Español"], name: "Español" });
    expect(faces.phone).toEqual({ shown: ["ES"], name: "Español" });
  });

  it("updates the chooser's active language when the till locale changes", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
        tabs,
        loadLocales: async () => [],
      });
      setLocale("en-GB");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("wt-language-chooser")!.getAttribute("active")).toBe(
        "en-GB",
      );
    } finally {
      setLocale("es-ES");
    }
  });

  it("lets one composed chooser selection reach its parent", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
      loadLocales: async () => [
        { code: "en-GB", label: "English" },
        { code: "es-ES", label: "Español" },
      ],
    });
    const details: { code: string }[] = [];
    el.addEventListener("wt-locale-selected", (e) =>
      details.push((e as CustomEvent<{ code: string }>).detail),
    );
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    chooser.dispatchEvent(
      new CustomEvent("wt-locale-selected", {
        detail: { code: "en-GB" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(details).toEqual([{ code: "en-GB" }]);
  });

  it("omits the language chooser when loadLocales is not supplied (no throw-on-open surface)", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      activeTabKey: "counter",
    });
    expect(el.shadowRoot!.querySelector("wt-language-chooser")).toBeNull();
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

  it("keeps a drill-in over a long tab after the tab is scrolled", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs,
      loadLocales: async () => [{ code: "en-GB", label: "English" }],
    });
    const content = document.createElement("div");
    content.style.height = "3000px";
    el.appendChild(content);
    await el.updateComplete;
    const region = el.shadowRoot!.querySelector<HTMLElement>(".region")!;
    const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBeGreaterThan(0);
    const drillContent = document.createElement("div");
    drillContent.slot = "drill";
    drillContent.textContent = "Order details";
    el.appendChild(drillContent);
    await el.updateComplete;
    await el.updateComplete;
    const drill = el.shadowRoot!.querySelector<HTMLElement>(".drill")!;
    expect(drill.getBoundingClientRect().top).toBeCloseTo(region.getBoundingClientRect().top, 0);
    expect(drill.getBoundingClientRect().bottom).toBeCloseTo(
      region.getBoundingClientRect().bottom,
      0,
    );
    expect(el.shadowRoot!.querySelector<HTMLElement>("main.body")!.inert).toBe(true);
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

  const sixTabs: TabDef[] = [
    ...tabs,
    { key: "takeaway", title: "Takeaway", columns: 12, cards: [] },
    { key: "terrace", title: "Terrace", columns: 12, cards: [] },
    { key: "bar", title: "Bar", columns: 12, cards: [] },
    { key: "deliveries", title: "Deliveries", columns: 12, cards: [] },
  ];

  it.each([
    ["en-GB", "two tabs", tabs],
    ["es-ES", "two tabs", tabs],
    ["en-GB", "six tabs", sixTabs],
  ] as const)(
    "fits the header, every button on screen, at phone width in %s with %s",
    async (locale, _label, shellTabs) => {
      const before = currentLocale();
      setLocale(locale);
      const width = window.innerWidth;
      const height = window.innerHeight;
      await page.viewport(390, 844);
      try {
        const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
          tabs: [...shellTabs],
          activeTabKey: "counter",
          operatorName: "Ana Fernández",
          affordances: ["find-bill", "station", "expo", "schedule"],
          loadLocales: async () => [{ code: locale, label: locale }],
        });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        expect(window.innerWidth).toBe(390);
        const header = el.shadowRoot!.querySelector("header")!;
        const controls = [
          ...header.querySelectorAll<HTMLElement>(
            ".brand, .tab, wt-button, wt-language-chooser, .operator",
          ),
        ];
        expect(controls.length).toBe(10 + shellTabs.length);
        const offScreen = controls
          .map((c) => ({ c: c.className || c.localName, r: c.getBoundingClientRect() }))
          .filter(({ r }) => r.left < 0 || r.right > 390)
          .map(({ c }) => c);
        expect(offScreen).toEqual([]);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
        // Laid out in rows, not squeezed into narrow columns beside the brand.
        const top = (selector: string): number =>
          header.querySelector(selector)!.getBoundingClientRect().top;
        expect(top(".tab:nth-child(2)")).toBe(top(".tab:first-child"));
        expect(top(".station")).toBe(top(".find-bill"));
      } finally {
        await page.viewport(width, height);
        setLocale(before);
      }
    },
  );

  it("renders the full header when not in kiosk mode (default)", async () => {
    const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
      tabs: [{ key: "counter", title: "Counter", columns: 12, cards: [] }],
      activeTabKey: "counter",
    });
    expect(el.shadowRoot!.querySelector("header")).not.toBeNull();
  });
});

it("keeps the language chooser on a kitchen display, at the top right on its own, above the body", async () => {
  const { el } = await mountWidget<TillTabShell>("till-tab-shell", {
    kiosk: true,
    loadLocales: async () => [{ code: "en-GB", label: "English" }],
  });
  expect(el.shadowRoot!.querySelector("header")).toBeNull();
  const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
  expect(chooser).not.toBeNull();
  const own = chooser.getBoundingClientRect();
  const shell = el.getBoundingClientRect();
  const region = el.shadowRoot!.querySelector(".region")!.getBoundingClientRect();
  expect(own.bottom).toBeLessThanOrEqual(region.top);
  expect(own.top - shell.top).toBeLessThanOrEqual(32);
  expect(shell.right - own.right).toBeLessThanOrEqual(32);
  expect(own.left).toBeGreaterThan(shell.left + shell.width / 2);
});
