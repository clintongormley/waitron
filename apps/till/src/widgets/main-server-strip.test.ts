import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, tokenColour } from "./test-helpers.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
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
  expect(el.shadowRoot!.textContent).not.toContain(t("server.main_silent"));
  expect(button(el)).not.toBeNull();
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

it("keeps the spare first and offers Cloud independently of the spare permission", async () => {
  const { el, host } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
    spareAnswering: true,
    showSwitch: true,
    showCloud: true,
  });
  expect(
    [...el.shadowRoot!.querySelectorAll("wt-button")].map((b) =>
      b.getAttribute("data-start-in-cloud") !== null ? "cloud" : "spare",
    ),
  ).toEqual(["spare", "cloud"]);
  el.showSwitch = false;
  await el.updateComplete;
  const cloud = el.shadowRoot!.querySelector<HTMLElement & LitElement>("[data-start-in-cloud]")!;
  expect(cloud).not.toBeNull();
  const started = vi.fn();
  host.addEventListener("start-in-cloud", started);
  await cloud.updateComplete;
  cloud.shadowRoot!.querySelector("button")!.click();
  expect(started).toHaveBeenCalledOnce();
});

it("shows the Cloud check's busy state and neutral refusal even without a spare", async () => {
  const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
    showCloud: true,
    cloudBusy: true,
    cloudRefused: true,
  });
  const cloud = el.shadowRoot!.querySelector<HTMLElement & { loading: boolean }>(
    "[data-start-in-cloud]",
  )!;
  expect(cloud).not.toBeNull();
  expect(cloud.loading).toBe(true);
  expect(el.shadowRoot!.textContent).toContain("The main box is answering again.");
  expect(el.shadowRoot!.textContent).not.toContain(t("server.main_still_answering"));
});

it("words the silence as the owner asked: the main box, the switch and carrying on by itself", async () => {
  const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
    spareAnswering: true,
    showSwitch: true,
    silentSince: Date.now() - 22_000,
  });
  const text = el.shadowRoot!.textContent!.replace(/\s+/g, " ");
  expect(text).toContain("The main box is not answering.");
  expect(text).toContain("Last contact: 22 seconds ago.");
  expect(button(el)!.textContent).toContain("Switch to the spare box");
  expect(text).toContain("If the main box answers again, the till carries on by itself.");
});

it("counts the last contact up once a second, in seconds and then in minutes", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  try {
    const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
      spareAnswering: true,
      silentSince: Date.now() - 22_000,
    });
    const line = () =>
      el.shadowRoot!.querySelector("[data-last-contact]")!.textContent!.replace(/\s+/g, " ").trim();
    expect(line()).toBe("Last contact: 22 seconds ago.");
    vi.advanceTimersByTime(1_000);
    await el.updateComplete;
    expect(line()).toBe("Last contact: 23 seconds ago.");
    vi.advanceTimersByTime(37_000);
    await el.updateComplete;
    expect(line()).toBe("Last contact: 1 minute ago.");
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(line()).toBe("Last contact: 2 minutes ago.");
    setLocale("es");
    vi.advanceTimersByTime(1_000);
    await el.updateComplete;
    expect(line()).toBe(fill(t("server.last_contact_minutes", "es"), { n: "2" }));
    expect(line()).not.toBe("Last contact: 2 minutes ago.");
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("counts the last contact from the main box's last answer, not from when its silence began", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  try {
    const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
      spareAnswering: true,
      silentSince: Date.now() - 20_000,
      lastAnsweredAt: Date.now() - 25_000,
    });
    const line = () =>
      el.shadowRoot!.querySelector("[data-last-contact]")!.textContent!.replace(/\s+/g, " ").trim();
    expect(line()).toBe("Last contact: 25 seconds ago.");
    vi.advanceTimersByTime(1_000);
    await el.updateComplete;
    expect(line()).toBe("Last contact: 26 seconds ago.");
    el.lastAnsweredAt = null;
    await el.updateComplete;
    expect(line()).toBe("Last contact: 21 seconds ago.");
  } finally {
    vi.useRealTimers();
  }
});

it("draws no last contact or carrying-on line once the main box answered a check", async () => {
  for (const props of [
    { spareAnswering: true, showSwitch: true, refused: true },
    { showCloud: true, cloudRefused: true },
  ]) {
    const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
      ...props,
      silentSince: Date.now() - 30_000,
    });
    expect(el.shadowRoot!.querySelector("[data-last-contact]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-carries-on]")).toBeNull();
    cleanupWidgets();
  }
});

it("as a panel fills the screen in the danger colour, its button the other way round", async () => {
  const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
    spareAnswering: true,
    showSwitch: true,
    panel: true,
    silentSince: Date.now() - 22_000,
  });
  const probe = document.createElement("div");
  probe.style.color = "var(--wt-color-danger)";
  probe.style.backgroundColor = "var(--wt-color-on-danger)";
  el.parentElement!.append(probe);
  const { color: danger, backgroundColor: onDanger } = getComputedStyle(probe);
  probe.remove();
  const panel = el.shadowRoot!.querySelector<HTMLElement>("[data-main-server-strip]")!;
  const box = panel.getBoundingClientRect();
  expect([box.left, box.top, box.width, box.height]).toEqual([
    0,
    0,
    document.documentElement.clientWidth,
    document.documentElement.clientHeight,
  ]);
  expect(getComputedStyle(panel).backgroundColor).toBe(danger);
  await button(el)!.updateComplete;
  const inner = button(el)!.shadowRoot!.querySelector("button")!;
  expect(getComputedStyle(inner).backgroundColor).toBe(onDanger);
  expect(getComputedStyle(inner).color).toBe(danger);
});

it("as a panel gives each of its buttons a hover cue that keeps the label's colours", async () => {
  const { el } = await mountWidget<TillMainServerStrip>("till-main-server-strip", {
    spareAnswering: true,
    showSwitch: true,
    showCloud: true,
    panel: true,
  });
  const danger = tokenColour(el.shadowRoot!, "--wt-color-danger");
  for (const host of el.shadowRoot!.querySelectorAll<HTMLElement & LitElement>("wt-button")) {
    await host.updateComplete;
    const inner = host.shadowRoot!.querySelector("button")!;
    const resting = getComputedStyle(inner);
    const before = [resting.borderTopColor, resting.backgroundColor, resting.color];
    await userEvent.hover(inner);
    const hovered = getComputedStyle(inner);
    expect(hovered.borderTopColor).not.toBe(before[0]);
    expect(hovered.borderTopColor).toBe(danger);
    expect([hovered.backgroundColor, hovered.color]).toEqual(before.slice(1));
  }
});
