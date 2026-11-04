import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi, MenuPreview, MenuPublicationsAnswer } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import {
  cleanupWidgets,
  closeReportsDelivered,
  dialogClosed,
  mountWidget,
  putBack,
} from "./test-helpers.js";
import "./menu-publications.js";

const LISTED: MenuPublicationsAnswer = {
  timeZone: "Europe/Madrid",
  live: null,
  editions: [
    {
      versionId: "v-lunch-1",
      number: 1,
      state: "queued",
      activatesAt: "2026-10-08T06:00:00.000Z",
      queuedAt: "2026-10-07T08:00:00.000Z",
      cancelledAt: null,
      contentHash: "1".repeat(64),
      local: { date: "2026-10-08", time: "08:00", offset: "+02:00", repeated: false },
    },
  ],
};

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
    rescheduleMenuPublication: vi.fn().mockResolvedValue({
      versionId: "v-lunch-1",
      number: 1,
      activatesAt: "2026-10-08T07:00:00.000Z",
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

async function mountMove() {
  setLocale("en-GB");
  const { el: app } = await mountWidget<PublicationsLeaveApp>(
    "menu-publications-leave-test-app",
    {},
  );
  const panel = app.shadowRoot!.querySelector("dashboard-menu-publications")!;
  const table = () => panel.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() =>
    expect(table().shadowRoot!.querySelector('[data-test="move-v-lunch-1"]')).not.toBeNull(),
  );
  table().shadowRoot!.querySelector<HTMLElement>('[data-test="move-v-lunch-1"]')!.click();
  await panel.updateComplete;
  const dialog = panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    '[data-test="schedule-dialog"]',
  )!;
  await dialog.updateComplete;
  expect(dialog.open).toBe(true);
  return { app, panel, dialog };
}

it("Change time closes untouched without asking, and warns on Escape once the time changes", async () => {
  const { app, dialog } = await mountMove();
  expect(unload()).toBe(false);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);

  cleanupWidgets();
  const second = await mountMove();
  const input = await enter(second.dialog, "time", "09:00");
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  const q = await question(second.app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("09:00");
  expect(second.dialog.open).toBe(true);
});

it("a moved time cleared by success does not warn", async () => {
  const { app, dialog } = await mountMove();
  await enter(dialog, "time", "09:00");
  dialog.querySelector<HTMLElement>('[data-test="schedule-submit"]')!.click();
  await expect.poll(() => dialog.open).toBe(false);
  expect(app.api.rescheduleMenuPublication).toHaveBeenCalledTimes(1);
  expect(unload()).toBe(false);
});

type Panel = HTMLElementTagNameMap["dashboard-menu-publications"];
type Dialog = HTMLElementTagNameMap["wt-dialog"];
const fieldValue = (dialog: Dialog, name: "date" | "time") =>
  dialog.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!.value;
const submitAction = (dialog: Dialog) =>
  dialog.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="schedule-submit"]')!;
async function expectUnchangedOpen(app: PublicationsLeaveApp, panel: Panel, dialog: Dialog) {
  await panel.updateComplete;
  expect(dialog.open).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(submitAction(dialog).disabled).toBe(true);
  expect(submitAction(dialog).variant).toBe("secondary");
}
async function choose(app: PublicationsLeaveApp, decision: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const editionRow = (panel: Panel) =>
  panel
    .shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>('[data-test="move-v-lunch-1"]');
const LATER_LISTED: MenuPublicationsAnswer = {
  ...LISTED,
  editions: [
    {
      ...LISTED.editions[0]!,
      local: { date: "2026-10-08", time: "09:30", offset: "+02:00", repeated: false },
    },
  ],
};

const SCHEDULE_PATHS = [
  {
    path: "Schedule",
    mountPath: mount,
    edited: "date",
    editedValue: "2026-10-10",
    openedValue: "",
    other: "time",
    otherOpened: "",
    otherEdit: "12:00",
    reopen: async (panel: Panel) => {
      panel.shadowRoot!.querySelector<HTMLElement>('[data-test="schedule-open"]')!.click();
    },
    writeOf: (app: PublicationsLeaveApp) => app.api.scheduleMenuPublication,
    sent: [
      "menu-lunch",
      { expectedHash: PREVIEW.hash, activatesAt: { date: "2026-10-12", time: "12:00" } },
    ],
    afterUndo: "2026-10-12",
    editAfter: "2026-10-12",
  },
  {
    path: "Change time",
    mountPath: mountMove,
    edited: "time",
    editedValue: "09:00",
    openedValue: "08:00",
    other: "date",
    otherOpened: "2026-10-08",
    otherEdit: "2026-10-09",
    reopen: async (panel: Panel) => {
      await vi.waitFor(() => expect(editionRow(panel)).not.toBeNull());
      editionRow(panel)!.click();
    },
    writeOf: (app: PublicationsLeaveApp) => app.api.rescheduleMenuPublication,
    sent: ["menu-lunch", "v-lunch-1", { activatesAt: { date: "2026-10-09", time: "09:15" } }],
    afterUndo: "09:15",
    editAfter: "09:15",
  },
] as const;

for (const p of SCHEDULE_PATHS) {
  for (const how of ["at once", "after a detached update"] as const) {
    for (const route of ["close", "escape"] as const) {
      it(`${p.path}: an edit made before being taken out counts when put back ${how}, and ${route} asks`, async () => {
        const { app, panel, dialog } = await p.mountPath();
        await enter(dialog, p.edited, p.editedValue);
        await putBack(panel, how);
        expect(dialog.open).toBe(true);
        expect(fieldValue(dialog, p.edited)).toBe(p.editedValue);
        expect(app.leave.coordinator.isDirty()).toBe(true);
        expect(submitAction(dialog).disabled).toBe(false);
        expect(submitAction(dialog).variant).toBe("primary");
        expect(dialog.querySelector('[data-test="schedule-intro"]')!.textContent).toContain(
          LISTED.timeZone,
        );
        if (route === "close")
          dialog.querySelector<HTMLElement>('[data-test="schedule-close"]')!.click();
        else {
          dialog.querySelector(`[name="${p.edited}"]`)!.shadowRoot!.querySelector("input")!.focus();
          await userEvent.keyboard("{Escape}");
        }
        expect((await question(app)).open).toBe(true);
        expect(dialog.open).toBe(true);
        const closed = dialogClosed(dialog);
        await choose(app, "discard");
        await closed;
        await panel.updateComplete;
        expect(dialog.open).toBe(false);
        expect(fieldValue(dialog, p.edited)).toBe(p.openedValue);
        expect(app.leave.coordinator.isDirty()).toBe(false);
        await p.reopen(panel);
        await expectUnchangedOpen(app, panel, dialog);
        expect(fieldValue(dialog, p.edited)).toBe(p.openedValue);
      });
    }
    it(`${p.path}: an edit made after being put back ${how} is what the action sends`, async () => {
      const { app, panel, dialog } = await p.mountPath();
      await enter(dialog, p.edited, p.editedValue);
      await enter(dialog, p.other, p.otherEdit);
      await putBack(panel, how);
      await enter(dialog, p.edited, p.editAfter);
      expect(app.leave.coordinator.isDirty()).toBe(true);
      const closed = dialogClosed(dialog);
      submitAction(dialog).click();
      await closed;
      expect(p.writeOf(app)).toHaveBeenCalledExactlyOnceWith(...p.sent);
    });
    it(`${p.path}: an edit undone after being put back ${how} is unchanged again`, async () => {
      const { app, panel, dialog } = await p.mountPath();
      await enter(dialog, p.edited, p.editedValue);
      await putBack(panel, how);
      await enter(dialog, p.edited, p.openedValue);
      await expectUnchangedOpen(app, panel, dialog);
    });
    it(`${p.path}: put back onto a different menu ${how} closes and is not changed`, async () => {
      const { app, panel, dialog } = await p.mountPath();
      await enter(dialog, p.edited, p.editedValue);
      panel.remove();
      panel.menuId = "menu-dinner";
      if (how === "after a detached update") await panel.updateComplete;
      app.shadowRoot!.prepend(panel);
      await panel.updateComplete;
      expect(dialog.open).toBe(false);
      expect(app.leave.coordinator.isDirty()).toBe(false);
      expect(app.api.getMenuPublications).toHaveBeenLastCalledWith("menu-dinner");
      expect((await question(app)).open).toBe(false);
      await p.reopen(panel);
      await expectUnchangedOpen(app, panel, dialog);
      expect(fieldValue(dialog, p.edited)).toBe(p.openedValue);
    });
    for (const answered of ["while it is out", "once it is back"] as const) {
      for (const outcome of ["accepted", "refused"] as const) {
        it(`${p.path}: a write ${outcome} ${answered} (put back ${how}) neither saves nor closes it`, async () => {
          const { app, panel, dialog } = await p.mountPath();
          const write = deferred();
          p.writeOf(app).mockReturnValueOnce(write.promise as never);
          await enter(dialog, p.edited, p.editedValue);
          await enter(dialog, p.other, p.otherEdit);
          submitAction(dialog).click();
          await expect.poll(() => p.writeOf(app).mock.calls.length).toBe(1);
          const settle = () =>
            outcome === "accepted"
              ? write.resolve({ versionId: "v", number: 2, activatesAt: "" })
              : write.reject({ code: "menu_publication.time_past", params: {} });
          const parent = panel.parentNode!;
          const next = panel.nextSibling;
          panel.remove();
          if (answered === "while it is out") {
            settle();
            await closeReportsDelivered();
          }
          if (how === "after a detached update") await panel.updateComplete;
          parent.insertBefore(panel, next);
          await panel.updateComplete;
          if (answered === "once it is back") {
            settle();
            await closeReportsDelivered();
          }
          await panel.updateComplete;
          expect(dialog.open).toBe(true);
          expect(fieldValue(dialog, p.edited)).toBe(p.editedValue);
          expect(app.leave.coordinator.isDirty()).toBe(true);
          expect(submitAction(dialog).loading).toBe(false);
          expect(
            dialog.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="time"]')!.error,
          ).toBe("");
          dialog.querySelector<HTMLElement>('[data-test="schedule-close"]')!.click();
          expect((await question(app)).open).toBe(true);
        });
      }
    }
  }
  it(`${p.path}: reopening after a save starts unchanged from the stored value`, async () => {
    const { app, panel, dialog } = await p.mountPath();
    app.api.getMenuPublications.mockResolvedValue(LATER_LISTED);
    await enter(dialog, p.edited, p.editedValue);
    await enter(dialog, p.other, p.otherEdit);
    await putBack(panel, "at once");
    const closed = dialogClosed(dialog);
    submitAction(dialog).click();
    await closed;
    await vi.waitFor(() => expect(editionRow(panel)).not.toBeNull());
    await p.reopen(panel);
    await expectUnchangedOpen(app, panel, dialog);
    expect(fieldValue(dialog, "time")).toBe(p.path === "Schedule" ? "" : "09:30");
  });
}
