import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import { currentHelpMode, setHelpMode, type WtModal } from "@waitron/ui";
import type { LegalAbout } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";
import type { TillGuideSheet } from "./guide-sheet.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { aboutHeading } from "../legal-about.js";
import { KITCHEN_HELP_IDLE_MS } from "../state/help-idle.js";

type Lit = HTMLElement & LitElement;

const RELEASED: LegalAbout = {
  release: { version: "1.2.3", releasedOn: "2026-10-22" },
  build: "test-build",
};

const loadLocales = async () => [
  { code: "en-GB", label: "English" },
  { code: "es-ES", label: "Spanish" },
];

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

let originalLocale = currentLocale();
let originalViewport = { width: 0, height: 0 };
/** Answers the stubbed `/legal/about` read; each case calls it when it wants the answer. */
let answerAbout: () => void = () => {};

beforeEach(() => {
  originalLocale = currentLocale();
  originalViewport = { width: window.innerWidth, height: window.innerHeight };
  setLocale("en-GB");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      (input) =>
        new Promise<Response>((resolve, reject) => {
          if (String(input) !== "/legal/about")
            reject(new TypeError(`unexpected ${String(input)}`));
          answerAbout = () => resolve(Response.json(RELEASED));
        }),
    ),
  );
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setHelpMode(false);
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(originalViewport.width, originalViewport.height);
});

const till: Partial<TillShell> = {
  formFactor: "till",
  activeScreen: "counter",
  operatorName: "Ana",
  affordances: ["find-bill", "schedule"],
  canSwitchProfile: true,
  loadLocales,
};

const handheld = (formFactor: "phone-portrait" | "tablet-landscape"): Partial<TillShell> => ({
  formFactor,
  activeScreen: "floor",
  operatorName: "Ana",
  affordances: ["find-bill", "schedule"],
  canSwitchProfile: true,
  loadLocales,
});

async function mountShell(props: Partial<TillShell>, width: number): Promise<TillShell> {
  await page.viewport(width, 844);
  const { el } = await mountWidget<TillShell>("till-shell", props);
  await frame();
  await frame();
  await el.updateComplete;
  return el;
}

const moreOf = (el: TillShell) =>
  el.shadowRoot!.querySelector<Lit>('header [data-test="more-menu"]')!;
const triggerOf = (menu: Lit) => menu.shadowRoot!.querySelector("button")!;
const popupOf = (menu: Lit) => menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
const inner = (button: Lit) => button.shadowRoot!.querySelector("button")!;
const sheetOf = (el: TillShell) =>
  el.shadowRoot!.querySelector<TillGuideSheet>("till-guide-sheet")!;
const modalOf = (sheet: TillGuideSheet) => sheet.shadowRoot!.querySelector<WtModal>("wt-modal")!;

/** The classes of More's buttons, in the order it draws them. */
const buttonsOf = (menu: Lit) =>
  [...menu.querySelectorAll<Lit>("wt-button")].map((button) => button.className);

async function openMenu(menu: Lit): Promise<void> {
  await menu.updateComplete;
  await userEvent.click(triggerOf(menu));
  await vi.waitFor(() => expect(popupOf(menu).matches(":popover-open")).toBe(true));
}

async function openAboutFromMore(el: TillShell): Promise<TillGuideSheet> {
  const more = moreOf(el);
  await openMenu(more);
  await userEvent.click(inner(more.querySelector<Lit>("wt-button.about")!));
  await el.updateComplete;
  const sheet = sheetOf(el);
  await sheet.updateComplete;
  await modalOf(sheet).updateComplete;
  return sheet;
}

async function closeSheet(el: TillShell, sheet: TillGuideSheet): Promise<void> {
  const closed = new Promise((resolve) =>
    sheet.addEventListener("guide-close", resolve, { once: true }),
  );
  const close = sheet.shadowRoot!.querySelector<Lit>('wt-button[slot="footer"]')!;
  await userEvent.click(inner(close));
  await closed;
  await el.updateComplete;
}

const heading = (sheet: TillGuideSheet) => sheet.shadowRoot!.querySelector("h2")!.textContent;

describe("About Waitron in the till's More", () => {
  it("a counter till's More offers About Waitron just above Log out", async () => {
    const el = await mountShell(till, 1280);
    const more = moreOf(el);
    expect(buttonsOf(more).slice(-2)).toEqual(["about", "logout"]);
    expect(more.querySelector("wt-button.about")!.textContent!.trim()).toBe(t("about.title"));
  });

  it.each([
    ["phone-portrait", 320],
    ["tablet-landscape", 1024],
  ] as const)(
    "a handheld's More offers it just above Log out, at phone and tablet width (%s, %ipx)",
    async (formFactor, width) => {
      const el = await mountShell(handheld(formFactor), width);
      const more = moreOf(el);
      expect(buttonsOf(more).slice(-2)).toEqual(["about", "logout"]);
      expect(more.querySelector("wt-button.about")!.textContent!.trim()).toBe(t("about.title"));
    },
  );

  it.each([
    ["a counter till", till, 1280],
    ["a handheld", handheld("phone-portrait"), 320],
  ] as const)(
    "About Waitron opens the sheet at once, then heads it with the version (%s)",
    async (_name, props, width) => {
      const el = await mountShell(props, width);
      const sheet = await openAboutFromMore(el);
      expect(modalOf(sheet).open).toBe(true);
      expect(sheet.href).toBe("/legal/declaration");
      expect(sheet.heading).toBe(aboutHeading(null));
      expect(heading(sheet)).toBe(aboutHeading(null));

      answerAbout();
      await vi.waitFor(() => expect(sheet.heading).toBe(aboutHeading(RELEASED)));
      await sheet.updateComplete;
      expect(heading(sheet)).toBe(aboutHeading(RELEASED));
    },
  );

  it("a read that answers after the sheet closed heads nothing", async () => {
    const el = await mountShell(till, 1280);
    const sheet = await openAboutFromMore(el);
    await closeSheet(el, sheet);
    answerAbout();
    await frame();
    await el.updateComplete;
    expect(sheet.href).toBe("");
    expect(sheet.heading).toBe("");
  });

  it("a touch inside the framed page still counts as activity", async () => {
    const el = await mountShell(till, 1280);
    const sheet = await openAboutFromMore(el);
    const seen: string[] = [];
    for (const type of ["pointerdown", "keydown"])
      el.addEventListener(type, (event) => {
        if (event.bubbles && event.composed) seen.push(event.type);
      });
    const iframe = sheet.shadowRoot!.querySelector("iframe")!;
    iframe.srcdoc = `<body tabindex="0" data-page="about">Declaration</body>`;
    await vi.waitFor(() => {
      expect(iframe.contentDocument?.body?.dataset.page).toBe("about");
      expect(iframe.contentDocument!.readyState).toBe("complete");
    });
    const framed = iframe.contentDocument!;
    framed.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    framed.body.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(seen).toEqual(["pointerdown", "keydown"]);
  });

  it.each([
    ["a counter till", till, 1280],
    ["a handheld", handheld("phone-portrait"), 320],
  ] as const)("closing returns focus to More's button (%s)", async (_name, props, width) => {
    const el = await mountShell(props, width);
    const sheet = await openAboutFromMore(el);
    await closeSheet(el, sheet);
    const more = moreOf(el);
    expect(more.shadowRoot!.activeElement).toBe(triggerOf(more));
    expect(sheet.href).toBe("");
    expect(sheet.heading).toBe("");
    expect(modalOf(sheet).open).toBe(false);
  });
  it.each([
    ["once the read has answered", true],
    ["while the read is still waiting", false],
  ] as const)("an open heading follows a language change, %s", async (_name, answered) => {
    const el = await mountShell(till, 1280);
    const sheet = await openAboutFromMore(el);
    const release = answered ? RELEASED : null;
    if (answered) {
      answerAbout();
      await vi.waitFor(() => expect(sheet.heading).toBe(aboutHeading(RELEASED)));
    }
    const english = aboutHeading(release);
    setLocale("es-ES");
    expect(aboutHeading(release)).not.toBe(english);
    await el.updateComplete;
    await sheet.updateComplete;
    expect(sheet.heading).toBe(aboutHeading(release));
    expect(heading(sheet)).toBe(aboutHeading(release));
  });
});

const corners = [
  ["kiosk", { formFactor: "phone-portrait", kiosk: true, loadLocales }],
  ["kitchen screen", { formFactor: "kds", loadLocales }],
] as const;

describe("About Waitron in the kiosk and kitchen corner", () => {
  it.each(corners)(
    "a %s's corner has the ⓘ, and two idle minutes close what it opened",
    async (_name, props) => {
      const el = await mountShell(props as Partial<TillShell>, 1280);
      const corner = el.shadowRoot!.querySelector(".language-corner")!;
      const info = corner.querySelector<Lit>("wt-button.about")!;
      expect(info.getAttribute("aria-label")).toBe(t("about.title"));
      expect(info.querySelector('span[aria-hidden="true"]')!.textContent).toBe("ⓘ");

      setHelpMode(true);
      await el.updateComplete;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await userEvent.click(inner(info));
      await el.updateComplete;
      const sheet = sheetOf(el);
      await sheet.updateComplete;
      expect(sheet.href).toBe("/legal/declaration");
      expect(sheet.heading).toBe(aboutHeading(null));

      const closes: Event[] = [];
      sheet.addEventListener("guide-close", (event) => closes.push(event));
      vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS);
      vi.useRealTimers();
      await el.updateComplete;
      await sheet.updateComplete;
      expect(sheet.href).toBe("");
      expect(sheet.heading).toBe("");
      expect(modalOf(sheet).open).toBe(false);
      // The closed dialog reports its close later; the late read is answered after that.
      await vi.waitFor(() => expect(closes).toHaveLength(1));

      answerAbout();
      await frame();
      await frame();
      await el.updateComplete;
      expect(sheet.heading).toBe("");
    },
  );

  it("closing the corner's sheet returns focus to the ⓘ", async () => {
    const el = await mountShell({ formFactor: "kds", loadLocales }, 1280);
    const info = el.shadowRoot!.querySelector<Lit>(".language-corner wt-button.about")!;
    await userEvent.click(inner(info));
    await el.updateComplete;
    const sheet = sheetOf(el);
    await sheet.updateComplete;
    await modalOf(sheet).updateComplete;
    await closeSheet(el, sheet);
    expect(info.shadowRoot!.activeElement).toBe(inner(info));
  });
});

async function openFromCorner(props: Partial<TillShell>): Promise<[TillShell, TillGuideSheet]> {
  const el = await mountShell(props, 1280);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await userEvent.click(
    inner(el.shadowRoot!.querySelector<Lit>(".language-corner wt-button.about")!),
  );
  await el.updateComplete;
  const sheet = sheetOf(el);
  await sheet.updateComplete;
  expect(sheet.href).toBe("/legal/declaration");
  return [el, sheet];
}

describe("About Waitron from the corner with Help off", () => {
  it.each(corners)(
    "on a %s, two idle minutes close it and Help stays off",
    async (_name, props) => {
      const [el, sheet] = await openFromCorner(props as Partial<TillShell>);
      vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS - 1);
      await el.updateComplete;
      expect(sheet.href).toBe("/legal/declaration");
      vi.advanceTimersByTime(1);
      await el.updateComplete;
      await sheet.updateComplete;
      expect(sheet.href).toBe("");
      expect(sheet.heading).toBe("");
      expect(currentHelpMode()).toBe(false);
    },
  );

  it.each(corners)(
    "on a %s, a touch relayed from the sheet starts the two minutes again",
    async (_name, props) => {
      const [el, sheet] = await openFromCorner(props as Partial<TillShell>);
      vi.advanceTimersByTime(100_000);
      sheet.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
      vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS - 1);
      await el.updateComplete;
      expect(sheet.href).toBe("/legal/declaration");
      sheet.dispatchEvent(new Event("keydown", { bubbles: true, composed: true }));
      vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS - 1);
      await el.updateComplete;
      expect(sheet.href).toBe("/legal/declaration");
      vi.advanceTimersByTime(1);
      await el.updateComplete;
      expect(sheet.href).toBe("");
    },
  );

  it("closed by hand, the sheet leaves no clock running to close the next one early", async () => {
    const [el, sheet] = await openFromCorner({ formFactor: "kds", loadLocales });
    vi.advanceTimersByTime(100_000);
    sheet.dispatchEvent(new CustomEvent("guide-close"));
    await el.updateComplete;
    expect(sheet.href).toBe("");
    el.shadowRoot!.querySelector<Lit>(".language-corner wt-button.about")!.click();
    await el.updateComplete;
    expect(sheet.href).toBe("/legal/declaration");
    vi.advanceTimersByTime(KITCHEN_HELP_IDLE_MS - 1);
    await el.updateComplete;
    expect(sheet.href).toBe("/legal/declaration");
    vi.advanceTimersByTime(1);
    await el.updateComplete;
    expect(sheet.href).toBe("");
  });
});
