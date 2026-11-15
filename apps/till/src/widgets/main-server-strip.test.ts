import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
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

const button = (el: TillMainServerStrip) =>
  el.shadowRoot!.querySelector<HTMLElement & LitElement>("wt-button[data-switch-to-spare]");

it("says the main server is silent and offers the switch only with showSwitch", async () => {
  const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
    spareAnswering: true,
    showSwitch: false,
  });
  expect(el.shadowRoot!.textContent).toContain(t("server.main_silent"));
  expect(button(el)).toBeNull();
  el.showSwitch = true;
  await el.updateComplete;
  expect(button(el)!.textContent).toContain(t("server.switch_to_spare"));
});

it("dispatches switch-to-spare, bubbling and composed, when its button is pressed", async () => {
  const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
    spareAnswering: true,
    showSwitch: true,
  });
  const pressed = vi.fn<(event: Event) => void>();
  document.addEventListener("switch-to-spare", pressed);
  try {
    await button(el)!.updateComplete;
    button(el)!.shadowRoot!.querySelector("button")!.click();
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(pressed.mock.calls[0]![0].composed).toBe(true);
  } finally {
    document.removeEventListener("switch-to-spare", pressed);
  }
});

it("says the main server still answers once refused", async () => {
  const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
    spareAnswering: true,
    showSwitch: true,
    refused: true,
  });
  expect(el.shadowRoot!.textContent).toContain(t("server.main_still_answering"));
});

it("says no server answers, with no button, while the spare is silent too", async () => {
  const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
    spareAnswering: false,
    showSwitch: true,
  });
  expect(el.shadowRoot!.textContent).toContain(t("server.none_answering"));
  expect(el.shadowRoot!.textContent).not.toContain(t("server.main_silent"));
  expect(button(el)).toBeNull();
});

it("paints with the danger colour", async () => {
  const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
    spareAnswering: true,
  });
  const probe = document.createElement("div");
  probe.style.color = "var(--wt-color-danger)";
  el.parentElement!.append(probe);
  const danger = getComputedStyle(probe).color;
  probe.remove();
  const strip = el.shadowRoot!.querySelector<HTMLElement>("[data-main-server-strip]")!;
  expect(getComputedStyle(strip).backgroundColor).toBe(danger);
  expect(danger).not.toBe("rgba(0, 0, 0, 0)");
});
