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
  ["Cloud is offered without a spare", { showCloud: true }],
  ["Cloud is checking", { showCloud: true, cloudBusy: true }],
  ["Cloud found the main", { showCloud: true, cloudRefused: true }],
  ["spare and Cloud are both offered", { spareAnswering: true, showSwitch: true, showCloud: true }],
  ["the spare answers", { spareAnswering: true, showSwitch: true }],
  ["the switch was refused", { spareAnswering: true, showSwitch: true, refused: true }],
  ["no server answers", { spareAnswering: false, showSwitch: true }],
  ["the spare answers but the switch is not offered", { spareAnswering: true, showSwitch: false }],
  [
    "the last contact is counted",
    { spareAnswering: true, showSwitch: true, silentSince: Date.now() - 22_000 },
  ],
  [
    "it fills the sign-in screen",
    { spareAnswering: true, showSwitch: true, panel: true, silentSince: Date.now() - 22_000 },
  ],
  [
    "it fills the signed-in till while the switch is checking",
    { spareAnswering: true, showSwitch: true, switchBusy: true, panel: true, modal: true },
  ],
  [
    "it fills the sign-in screen and no box answers",
    { spareAnswering: false, showSwitch: true, panel: true, silentSince: Date.now() - 22_000 },
  ],
];

describe.each(["light", "dark"] as const)("till-main-server-strip a11y (%s theme)", (theme) => {
  it.each(STATES)("has no violations while %s", async (_name, props) => {
    const { host } = await mountWidget<TillMainServerStrip>("till-main-server-strip", props, theme);
    await expectNoA11yViolations(host);
  });
});
