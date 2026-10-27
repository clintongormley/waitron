import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, currentContentLanguages, setContentLanguages } from "@waitron/ui";
import type { DashboardApi, LiveMenu, MenuPatchResult } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";
import "./menu-patch-dialog.js";
import type { MenuPatchDialog } from "./menu-patch-dialog.js";

const LIVE: LiveMenu = {
  versionId: "v-3",
  number: 3,
  since: "2026-10-27T09:00:00.000Z",
  document: menuDocument(
    [documentSection("sec-starters", "Starters", [documentProduct("mi-soup", "p-soup")])],
    { "p-soup": "Soup" },
  ),
};

const PATCHED: MenuPatchResult = { versionId: "v-4", number: 4, requeued: [] };

class PatchLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api = {
    getLiveMenu: vi.fn(async () => LIVE),
    getMenuPublications: vi.fn(async () => ({
      timeZone: "Europe/Madrid",
      live: null,
      editions: [],
    })),
    patchLiveMenu: vi.fn(async () => PATCHED),
    imageLibraryRequest: vi.fn(),
  };
  override render() {
    return html`<dashboard-menu-patch-dialog
        .api=${this.api as unknown as DashboardApi}
        menuId="menu-lunch"
        menuName="Lunch Menu"
        open
      ></dashboard-menu-patch-dialog
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("menu-patch-leave-test-app", PatchLeaveApp);

const savedLanguages = currentContentLanguages();

beforeEach(() => {
  setLocale("en-GB");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  setContentLanguages(savedLanguages);
});

async function mount() {
  const { el: app } = await mountWidget<PatchLeaveApp>("menu-patch-leave-test-app", {});
  const dialog = app.shadowRoot!.querySelector<MenuPatchDialog>("dashboard-menu-patch-dialog")!;
  await vi.waitFor(() =>
    expect(dialog.shadowRoot!.querySelector('[data-test="tree"] button')).not.toBeNull(),
  );
  const modal = dialog.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  return { app, dialog, modal };
}

async function stagePrice(dialog: MenuPatchDialog, value: string) {
  [...dialog.shadowRoot!.querySelectorAll<HTMLElement>('[data-test="tree"] button')]
    .find((button) => button.textContent!.trim() === "Soup")!
    .click();
  await dialog.updateComplete;
  const host = dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
    'wt-price-input[name="price"]',
  )!;
  await host.updateComplete;
  const input = host.shadowRoot!.querySelector("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await dialog.updateComplete;
  return host;
}

async function press(dialog: MenuPatchDialog, name: string) {
  dialog.shadowRoot!.querySelector<HTMLElement>(`wt-form-actions [data-test="${name}"]`)!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await dialog.updateComplete;
}

async function question(app: PatchLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}

function closed(modal: HTMLElement) {
  return new Promise<void>((resolve) =>
    modal.addEventListener("wt-close", () => resolve(), { once: true }),
  );
}

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

const ways = {
  Close: (dialog: MenuPatchDialog) => press(dialog, "close"),
  Escape: () => userEvent.keyboard("{Escape}"),
} as const;

it.each(Object.keys(ways) as (keyof typeof ways)[])(
  "asks before %s throws away a staged change on the edit step; Keep keeps it, Discard closes",
  async (way) => {
    const { app, dialog, modal } = await mount();
    const price = await stagePrice(dialog, "4");
    expect(unload()).toBe(true);
    await ways[way](dialog);
    const q = await question(app);
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(dialog.open).toBe(true);
    expect(price.value).toBe("4");
    expect(dialog.changes).toHaveLength(1);

    await ways[way](dialog);
    await question(app);
    const closing = closed(modal);
    q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
    await closing;
    expect(dialog.open).toBe(false);
    await closeReportsDelivered();
    expect(unload()).toBe(false);
  },
);

it("asks before Escape throws away the changes on the review step, and after Keep editing; Keep stays put", async () => {
  const { app, dialog, modal } = await mount();
  await stagePrice(dialog, "4");
  await press(dialog, "review");
  expect(dialog.shadowRoot!.querySelector('[data-test="review-step"]')).not.toBeNull();
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(dialog.open).toBe(true);
  expect(dialog.shadowRoot!.querySelector('[data-test="review-step"]')).not.toBeNull();

  await press(dialog, "keep-editing");
  await userEvent.keyboard("{Escape}");
  await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  await expect.poll(() => q.open).toBe(false);
  await press(dialog, "review");

  await userEvent.keyboard("{Escape}");
  await question(app);
  const closing = closed(modal);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
  await closing;
  expect(dialog.open).toBe(false);
  expect(app.api.patchLiveMenu).not.toHaveBeenCalled();
});

it("asks before leaving the screen with a staged change", async () => {
  const { app, dialog } = await mount();
  await stagePrice(dialog, "4");
  let left = false;
  const leaving = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {
      left = true;
    },
  });
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  expect(await leaving).toBe("kept");
  expect(left).toBe(false);
});

it.each(Object.keys(ways) as (keyof typeof ways)[])(
  "closes on %s without asking when nothing is staged",
  async (way) => {
    const { app, dialog, modal } = await mount();
    expect(unload()).toBe(false);
    const closing = closed(modal);
    await ways[way](dialog);
    await closing;
    expect(dialog.open).toBe(false);
    expect((await question(app)).open).toBe(false);
  },
);

it("asks nothing once the patch is live", async () => {
  const { app, dialog, modal } = await mount();
  await stagePrice(dialog, "4");
  await press(dialog, "review");
  const closing = closed(modal);
  await press(dialog, "put-live");
  await closing;
  expect(app.api.patchLiveMenu).toHaveBeenCalledTimes(1);
  expect(dialog.open).toBe(false);
  expect(unload()).toBe(false);
  let left = false;
  const leaving = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {
      left = true;
    },
  });
  expect(await leaving).toBe("proceeded");
  expect(left).toBe(true);
  expect((await question(app)).open).toBe(false);
});
