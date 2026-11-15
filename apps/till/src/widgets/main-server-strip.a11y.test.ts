import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./main-server-strip.js";
import type { TillMainServerStrip } from "./main-server-strip.js";

let originalLocale = currentLocale();

beforeEach(() => {
  originalLocale = currentLocale();
  setLocale("en");
});

afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

const STATES: [string, Partial<TillMainServerStrip>][] = [
  ["the spare answers", { spareAnswering: true, showSwitch: true }],
  ["the switch was refused", { spareAnswering: true, showSwitch: true, refused: true }],
  ["no server answers", { spareAnswering: false, showSwitch: true }],
];

describe.each(["light", "dark"] as const)("till-main-server-strip a11y (%s theme)", (theme) => {
  it.each(STATES)("has no violations while %s", async (_name, props) => {
    const { host } = await mountWidget<TillMainServerStrip>("till-main-server-strip", props, theme);
    await expectNoA11yViolations(host);
  });
});
