import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { WtModal } from "@waitron/ui";
import type { LegalAbout } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./about-button.js";
import type { TillAboutButton } from "./about-button.js";
import type { TillGuideSheet } from "./guide-sheet.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { aboutHeading } from "../legal-about.js";

type Lit = HTMLElement & LitElement;

const RELEASED: LegalAbout = {
  release: { version: "1.2.3", releasedOn: "2026-10-22" },
  build: "test-build",
};

let originalLocale = currentLocale();
/** Settles the stubbed `/legal/about` read; each case calls it when it wants the answer. */
let answerAbout: (ok: boolean) => void = () => {};

beforeEach(() => {
  originalLocale = currentLocale();
  setLocale("en-GB");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      (input) =>
        new Promise<Response>((resolve, reject) => {
          if (String(input) !== "/legal/about")
            reject(new TypeError(`unexpected ${String(input)}`));
          answerAbout = (ok) =>
            ok ? resolve(Response.json(RELEASED)) : reject(new TypeError("offline"));
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanupWidgets();
  setLocale(originalLocale);
});

const infoOf = (el: TillAboutButton) => el.shadowRoot!.querySelector<Lit>("wt-button.about")!;
const inner = (button: Lit) => button.shadowRoot!.querySelector("button")!;
const sheetOf = (el: TillAboutButton) =>
  el.shadowRoot!.querySelector<TillGuideSheet>("till-guide-sheet")!;
const modalOf = (sheet: TillGuideSheet) => sheet.shadowRoot!.querySelector<WtModal>("wt-modal")!;
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const heading = (sheet: TillGuideSheet) => sheet.shadowRoot!.querySelector("h2")!.textContent;

/** `focused: false` clicks without focusing the ⓘ, as Safari does on a tap. */
async function open(el: TillAboutButton, focused = true): Promise<TillGuideSheet> {
  if (focused) await userEvent.click(inner(infoOf(el)));
  else inner(infoOf(el)).click();
  await el.updateComplete;
  const sheet = sheetOf(el);
  await sheet.updateComplete;
  await modalOf(sheet).updateComplete;
  return sheet;
}

it("draws the ⓘ labelled About Waitron", async () => {
  const { el } = await mountWidget<TillAboutButton>("till-about-button", {});
  const info = infoOf(el);
  expect(info.getAttribute("aria-label")).toBe(t("about.title"));
  expect(info.querySelector('span[aria-hidden="true"]')!.textContent).toBe("ⓘ");
  expect(modalOf(sheetOf(el)).open).toBe(false);
});

it("opens its own sheet on /legal/declaration, headed with the version", async () => {
  const { el } = await mountWidget<TillAboutButton>("till-about-button", {});
  const sheet = await open(el);
  expect(modalOf(sheet).open).toBe(true);
  expect(sheet.href).toBe("/legal/declaration");
  expect(heading(sheet)).toBe(aboutHeading(null));

  answerAbout(true);
  await vi.waitFor(() => expect(sheet.heading).toBe(aboutHeading(RELEASED)));
  await sheet.updateComplete;
  expect(heading(sheet)).toBe(aboutHeading(RELEASED));
});

it("stays headed aboutHeading(null) when the read fails", async () => {
  const { el } = await mountWidget<TillAboutButton>("till-about-button", {});
  const sheet = await open(el);
  answerAbout(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await sheet.updateComplete;
  expect(sheet.heading).toBe(aboutHeading(null));
  expect(heading(sheet)).toBe(aboutHeading(null));
});

it("a read that answers after the sheet closed heads nothing", async () => {
  const { el } = await mountWidget<TillAboutButton>("till-about-button", {});
  const sheet = await open(el);
  const closed = new Promise((resolve) =>
    sheet.addEventListener("guide-close", resolve, { once: true }),
  );
  await userEvent.click(inner(sheet.shadowRoot!.querySelector<Lit>('wt-button[slot="footer"]')!));
  await closed;
  answerAbout(true);
  await frame();
  await frame();
  await el.updateComplete;
  expect(sheet.href).toBe("");
  expect(sheet.heading).toBe("");
});

it.each([
  [
    "Close",
    (sheet: TillGuideSheet) =>
      userEvent.click(inner(sheet.shadowRoot!.querySelector<Lit>('wt-button[slot="footer"]')!)),
  ],
  ["Escape", () => userEvent.keyboard("{Escape}")],
] as const)(
  "%s returns focus to the ⓘ, even when the tap did not focus it",
  async (_name, close) => {
    const { el } = await mountWidget<TillAboutButton>("till-about-button", {});
    const sheet = await open(el, false);
    const closed = new Promise((resolve) =>
      sheet.addEventListener("guide-close", resolve, { once: true }),
    );
    await close(sheet);
    await closed;
    await el.updateComplete;
    expect(modalOf(sheet).open).toBe(false);
    expect(sheet.href).toBe("");
    const info = infoOf(el);
    expect(info.shadowRoot!.activeElement).toBe(inner(info));
  },
);

it.each([
  ["once the read has answered", true],
  ["while the read is still waiting", false],
] as const)("an open heading follows a language change, %s", async (_name, answered) => {
  const { el } = await mountWidget<TillAboutButton>("till-about-button", {});
  const sheet = await open(el);
  const release = answered ? RELEASED : null;
  if (answered) {
    answerAbout(true);
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
