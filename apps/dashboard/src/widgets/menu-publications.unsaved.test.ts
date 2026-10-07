import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi, MenuPreview, MenuPublicationsAnswer } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import "./menu-publications.js";

const LISTED: MenuPublicationsAnswer = { timeZone: "Europe/Madrid", live: null, editions: [] };

const PREVIEW = {
  clashes: [],
  hash: "d".repeat(64),
  changes: [],
  warnings: [],
  status: { state: "unpublished", clashes: 0 },
  document: {},
  live: null,
} as unknown as MenuPreview;

class PublicationsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api = {
    getMenuPublications: vi.fn().mockResolvedValue(LISTED),
    scheduleMenuPublication: vi.fn().mockResolvedValue({
      versionId: "v-lunch-2",
      number: 2,
      activatesAt: "2026-10-10T10:00:00.000Z",
    }),
  };
  override render() {
    return html`<dashboard-menu-publications
        .api=${this.api as unknown as DashboardApi}
        menuId="menu-lunch"
        menuName="Lunch Menu"
        .preview=${PREVIEW}
      ></dashboard-menu-publications
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("menu-publications-leave-test-app", PublicationsLeaveApp);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mount() {
  setLocale("en-GB");
  const { el: app } = await mountWidget<PublicationsLeaveApp>(
    "menu-publications-leave-test-app",
    {},
  );
  const panel = app.shadowRoot!.querySelector("dashboard-menu-publications")!;
  await vi.waitFor(() =>
    expect(panel.shadowRoot!.querySelector('[data-test="schedule-open"]')).not.toBeNull(),
  );
  panel.shadowRoot!.querySelector<HTMLElement>('[data-test="schedule-open"]')!.click();
  await panel.updateComplete;
  const dialog = panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    '[data-test="schedule-dialog"]',
  )!;
  await dialog.updateComplete;
  return { app, panel, dialog };
}

async function enter(dialog: HTMLElement, name: "date" | "time", value: string) {
  const field = dialog.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  return input;
}

async function question(app: PublicationsLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it("a typed date warns on Escape, keeps the value, then discards once", async () => {
  const { app, dialog } = await mount();
  const input = await enter(dialog, "date", "2026-10-10");
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(dialog.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("2026-10-10");
  expect(dialog.open).toBe(true);
  await userEvent.keyboard("{Escape}");
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!.click();
  await expect.poll(() => dialog.open).toBe(false);
  await closeReportsDelivered();
  expect(unload()).toBe(false);
});

it("a typed date warns on leaving the screen", async () => {
  const { app, dialog } = await mount();
  await enter(dialog, "date", "2026-10-10");
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
  expect(left).toBe(false);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  expect(await leaving).toBe("kept");
  expect(left).toBe(false);
});

it("a clean form closes on Escape without asking", async () => {
  const { app, dialog } = await mount();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
});

it("a scheduled value cleared by success does not warn", async () => {
  const { app, dialog } = await mount();
  await enter(dialog, "date", "2026-10-10");
  await enter(dialog, "time", "12:00");
  dialog.querySelector<HTMLElement>('[data-test="schedule-submit"]')!.click();
  await expect.poll(() => dialog.open).toBe(false);
  expect(app.api.scheduleMenuPublication).toHaveBeenCalledTimes(1);
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

it("a refused schedule keeps the draft protected", async () => {
  const { app, dialog } = await mount();
  app.api.scheduleMenuPublication.mockRejectedValue({
    code: "menu_publication.time_past",
    params: { activatesAt: "2026-10-07T07:59:00.000Z" },
  });
  await enter(dialog, "date", "2026-10-07");
  await enter(dialog, "time", "09:59");
  dialog.querySelector<HTMLElement>('[data-test="schedule-submit"]')!.click();
  await expect
    .poll(() => dialog.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="time"]')!.error)
    .not.toBe("");
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
});
