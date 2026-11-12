import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import type { WtModal } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./about-button.js";
import type { TillAboutButton } from "./about-button.js";
import type { TillGuideSheet } from "./guide-sheet.js";

const originalLocale = currentLocale();

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanupWidgets();
  setLocale(originalLocale);
});

describe.each(["light", "dark"] as const)("till-about-button a11y (%s theme)", (theme) => {
  it("has no violations while closed", async () => {
    const { host } = await mountWidget<TillAboutButton>("till-about-button", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with its sheet open", async () => {
    const { el, host } = await mountWidget<TillAboutButton>("till-about-button", {}, theme);
    const info = el.shadowRoot!.querySelector<HTMLElement & LitElement>("wt-button.about")!;
    info.shadowRoot!.querySelector("button")!.click();
    await el.updateComplete;
    const sheet = el.shadowRoot!.querySelector<TillGuideSheet>("till-guide-sheet")!;
    await sheet.updateComplete;
    const modal = sheet.shadowRoot!.querySelector<WtModal>("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await expectNoA11yViolations(host);
  });
});
