import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { mountThemed } from "../a11y-helpers.js";
import { topModal } from "../modal-layer.js";
import { cleanup, mount } from "../test-helpers.js";
import "../index.js";
import type { WtDialog } from "./wt-dialog.js";
import type { WtStopScreen } from "./wt-stop-screen.js";

afterEach(cleanup);

test.each(["light", "dark"] as const)(
  "covers the viewport in danger colors (%s)",
  async (theme) => {
    const stop = await mountThemed(
      '<wt-stop-screen open heading="Disk full"><p>Tell a manager.</p></wt-stop-screen>',
      theme,
    );
    const modal = () => stop.shadowRoot?.querySelector<HTMLDialogElement>("dialog:modal");
    await vi.waitFor(() => expect(modal()).toBeTruthy());
    const dialog = modal()!;
    const danger = getComputedStyle(dialog).getPropertyValue("--wt-color-danger").trim();
    const control = document.createElement("div");
    control.style.backgroundColor = danger;
    stop.append(control);
    expect(getComputedStyle(dialog).backgroundColor).toBe(
      getComputedStyle(control).backgroundColor,
    );
    const box = dialog.getBoundingClientRect();
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, innerWidth, innerHeight]);
  },
);

async function stopAndDialog() {
  const host = await mount(
    `<div><button id="before">Before</button><wt-stop-screen heading="Disk full"></wt-stop-screen
    ><wt-dialog heading="Refund"><button id="inside">Refund</button></wt-dialog></div>`,
  );
  const stop = host.querySelector<WtStopScreen>("wt-stop-screen")!;
  const dialog = host.querySelector<WtDialog>("wt-dialog")!;
  const before = host.querySelector<HTMLButtonElement>("#before")!;
  await stop.updateComplete;
  await dialog.updateComplete;
  return { host, stop, dialog, before };
}

const nativeOf = (el: HTMLElement) => el.shadowRoot!.querySelector("dialog")!;

test("Escape leaves the stop screen open", async () => {
  const { stop } = await stopAndDialog();
  let closes = 0;
  stop.addEventListener("wt-close", () => closes++);
  stop.open = true;
  await stop.updateComplete;
  await userEvent.keyboard("{Escape}");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(stop.open).toBe(true);
  expect(nativeOf(stop).matches(":modal")).toBe(true);
  expect(closes).toBe(0);
});

test("stays above a dialog opened after it", async () => {
  const { stop, dialog } = await stopAndDialog();
  stop.open = true;
  await stop.updateComplete;
  dialog.open = true;
  await dialog.updateComplete;
  await vi.waitFor(() => expect(topModal()).toBe(stop));
  expect(nativeOf(stop).matches(":modal")).toBe(true);
  expect(nativeOf(dialog).matches(":modal")).toBe(true);
  // The browser draws the last dialog shown on top; the stop screen covers the whole viewport.
  const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  expect(hit).toBe(stop);
});

test("taking an open stop screen off the page drops it from the modals and returns focus", async () => {
  const { stop, dialog, before } = await stopAndDialog();
  before.focus();
  stop.open = true;
  await stop.updateComplete;
  expect(topModal()).toBe(stop);
  stop.remove();
  expect(topModal()).toBeUndefined();
  expect(document.activeElement).toBe(before);
  dialog.open = true;
  await dialog.updateComplete;
  expect(topModal()).toBe(dialog);
});

test("taking a closed stop screen off the page leaves focus where it is", async () => {
  const { stop, before } = await stopAndDialog();
  before.focus();
  stop.open = true;
  await stop.updateComplete;
  stop.open = false;
  await stop.updateComplete;
  before.blur();
  expect(document.activeElement).toBe(document.body);
  stop.remove();
  expect(document.activeElement).toBe(document.body);
});

test("put on the page open just after another dialog opens, it is drawn above it", async () => {
  const { host, stop, dialog } = await stopAndDialog();
  stop.remove();
  const late = document.createElement("wt-stop-screen");
  late.heading = "Disk full";
  dialog.open = true;
  late.open = true;
  host.append(late);
  await dialog.updateComplete;
  await late.updateComplete;
  await vi.waitFor(() => expect(topModal()).toBe(late));
  expect(document.elementFromPoint(innerWidth / 2, innerHeight / 2)).toBe(late);
});
