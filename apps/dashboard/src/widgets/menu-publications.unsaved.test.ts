import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LiveData } from "@waitron/dashboard-kit";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi, MenuPreview, MenuPublicationsAnswer } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
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
    liveData: undefined as LiveData | undefined,
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

const tableCell = (panel: Panel, name: string) =>
  panel
    .shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector(`[data-test="${name}"]`);
const scheduleOpen = (panel: Panel) =>
  panel.shadowRoot!.querySelector('[data-test="schedule-open"]');
const fieldError = (dialog: Dialog, name: "date" | "time") =>
  dialog.querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!.error;

const SCHEDULE_ACCEPTED: MenuPublicationsAnswer = {
  ...LISTED,
  editions: [
    ...LISTED.editions,
    {
      ...LISTED.editions[0]!,
      versionId: "v-lunch-2",
      number: 2,
      contentHash: PREVIEW.hash,
      local: { date: "2026-10-10", time: "12:00", offset: "+02:00", repeated: false },
    },
  ],
};
const MOVE_ACCEPTED: MenuPublicationsAnswer = {
  ...LISTED,
  editions: [
    {
      ...LISTED.editions[0]!,
      local: { date: "2026-10-09", time: "09:00", offset: "+02:00", repeated: false },
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
    acceptedList: SCHEDULE_ACCEPTED,
    acceptedCell: "time-v-lunch-2",
    acceptedTime: "12:00",
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
    acceptedList: MOVE_ACCEPTED,
    acceptedCell: "time-v-lunch-1",
    acceptedTime: "09:00",
  },
] as const;

const WRITE_ANSWERS = [
  { outcome: "accepted", answered: "while it is out" },
  { outcome: "refused", answered: "while it is out" },
  { outcome: "accepted", answered: "once it is back" },
  { outcome: "refused", answered: "once it is back" },
  { outcome: "accepted", answered: "once a fresh window is open" },
  { outcome: "refused", answered: "once a fresh window is open" },
  { outcome: "unanswered", answered: "throughout" },
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
        else await userEvent.keyboard("{Escape}");
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
    for (const { outcome, answered } of WRITE_ANSWERS) {
      // answer() waits between the removal and the put-back, so this repeats "after a detached update".
      if (answered === "while it is out" && how === "at once") continue;
      it(`${p.path}: a write ${outcome} ${answered} (put back ${how}): the window it was sent from closes, and nothing more is sent`, async () => {
        const { app, panel, dialog } = await p.mountPath();
        app.api.liveData = new LiveData();
        let stored: MenuPublicationsAnswer = LISTED;
        app.api.getMenuPublications.mockImplementation(async () => stored);
        const write = deferred();
        p.writeOf(app).mockReturnValueOnce(write.promise as never);
        await enter(dialog, p.edited, p.editedValue);
        await enter(dialog, p.other, p.otherEdit);
        submitAction(dialog).click();
        await expect.poll(() => p.writeOf(app).mock.calls.length).toBe(1);
        const reads = app.api.getMenuPublications.mock.calls.length;
        const answer = async () => {
          if (outcome === "accepted") {
            stored = p.acceptedList;
            write.resolve({ versionId: "v", number: 2, activatesAt: "" });
          } else write.reject({ code: "menu_publication.time_past", params: {} });
          await closeReportsDelivered();
          await panel.updateComplete;
        };

        const parent = panel.parentNode!;
        const next = panel.nextSibling;
        panel.remove();
        if (answered === "while it is out") await answer();
        if (how === "after a detached update") await panel.updateComplete;
        parent.insertBefore(panel, next);
        await panel.updateComplete;
        await dialog.updateComplete;
        await closeReportsDelivered();

        submitAction(dialog).click();
        await panel.updateComplete;
        expect(p.writeOf(app)).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(editionRow(panel)).not.toBeNull());
        expect(app.api.getMenuPublications).toHaveBeenCalledTimes(reads + 1);
        const expectClosed = async () => {
          await panel.updateComplete;
          expect(dialog.open).toBe(false);
          expect(app.leave.coordinator.isDirty()).toBe(false);
          expect(submitAction(dialog).loading).toBe(false);
          expect(fieldError(dialog, "time")).toBe("");
          expect((await question(app)).open).toBe(false);
          expect(p.writeOf(app)).toHaveBeenCalledTimes(1);
        };
        await expectClosed();

        if (answered === "once it is back") {
          await answer();
          await expectClosed();
          await expect
            .poll(() => app.api.getMenuPublications.mock.calls.length)
            .toBe(outcome === "refused" ? reads + 2 : reads + 1);
          if (outcome === "accepted") {
            expect(tableCell(panel, p.acceptedCell)?.textContent ?? "").not.toContain(
              p.acceptedTime,
            );
            app.api.liveData.invalidate([{ type: "menu_scheduled_publications" }]);
            await vi.waitFor(() =>
              expect(app.api.getMenuPublications).toHaveBeenCalledTimes(reads + 2),
            );
          }
        }

        const accepted = outcome === "accepted" && answered !== "once a fresh window is open";
        if (accepted) {
          await expect
            .poll(() => tableCell(panel, p.acceptedCell)?.textContent)
            .toContain(p.acceptedTime);
        } else {
          await expect
            .poll(() => tableCell(panel, "time-v-lunch-1")?.textContent)
            .toContain("08:00");
          expect(tableCell(panel, "version-v-lunch-2")).toBeNull();
        }

        if (accepted && p.path === "Schedule") {
          await expect.poll(() => scheduleOpen(panel)).toBeNull();
          return;
        }
        await p.reopen(panel);
        await expectUnchangedOpen(app, panel, dialog);
        expect(fieldValue(dialog, p.edited)).toBe(accepted ? p.editedValue : p.openedValue);
        expect(fieldValue(dialog, p.other)).toBe(accepted ? p.otherEdit : p.otherOpened);
        submitAction(dialog).click();
        await panel.updateComplete;
        expect(p.writeOf(app)).toHaveBeenCalledTimes(1);

        if (answered === "once a fresh window is open") {
          await enter(dialog, p.edited, p.editAfter);
          await answer();
          expect(dialog.open).toBe(true);
          expect(fieldValue(dialog, p.edited)).toBe(p.editAfter);
          expect(fieldError(dialog, "time")).toBe("");
          expect(submitAction(dialog).loading).toBe(false);
          expect(app.leave.coordinator.isDirty()).toBe(true);
          expect(p.writeOf(app)).toHaveBeenCalledTimes(1);
          await expect
            .poll(() => app.api.getMenuPublications.mock.calls.length)
            .toBe(outcome === "refused" ? reads + 2 : reads + 1);
        }
      });
    }
    it(`${p.path}: a window reopened after a write closed it keeps its own edit when put back ${how}`, async () => {
      const { app, panel, dialog } = await p.mountPath();
      p.writeOf(app).mockReturnValueOnce(deferred().promise as never);
      await enter(dialog, p.edited, p.editedValue);
      await enter(dialog, p.other, p.otherEdit);
      submitAction(dialog).click();
      await expect.poll(() => p.writeOf(app).mock.calls.length).toBe(1);
      await putBack(panel, how);
      await closeReportsDelivered();
      await vi.waitFor(() => expect(editionRow(panel)).not.toBeNull());
      await p.reopen(panel);
      await expectUnchangedOpen(app, panel, dialog);
      await enter(dialog, p.edited, p.editedValue);
      await putBack(panel, how);
      expect(dialog.open).toBe(true);
      expect(fieldValue(dialog, p.edited)).toBe(p.editedValue);
      expect(app.leave.coordinator.isDirty()).toBe(true);
      expect(submitAction(dialog).disabled).toBe(false);
    });
    it(`${p.path}: a write refused before being taken out keeps the edit when put back ${how}, and can be sent again`, async () => {
      const { app, panel, dialog } = await p.mountPath();
      p.writeOf(app).mockRejectedValueOnce({ code: "menu_publication.time_past", params: {} });
      await enter(dialog, p.edited, p.editedValue);
      await enter(dialog, p.other, p.otherEdit);
      submitAction(dialog).click();
      await expect.poll(() => fieldError(dialog, "time")).not.toBe("");
      await expect.poll(() => submitAction(dialog).loading).toBe(false);
      await putBack(panel, how);
      expect(dialog.open).toBe(true);
      expect(fieldValue(dialog, p.edited)).toBe(p.editedValue);
      expect(app.leave.coordinator.isDirty()).toBe(true);
      expect(submitAction(dialog).disabled).toBe(false);
      const closed = dialogClosed(dialog);
      submitAction(dialog).click();
      await closed;
      expect(p.writeOf(app)).toHaveBeenCalledTimes(2);
    });
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

const lateRefusal = (panel: Panel) =>
  panel.shadowRoot!.querySelector<HTMLElement>('[data-test="late-refusal"]');
const lateText = (panel: Panel) => lateRefusal(panel)?.textContent?.trim();
const LATE_WORDS =
  "An earlier schedule change may not have gone through. Check Scheduled versions and make the change again if it is not there.";
const footerMessage = (dialog: Dialog) =>
  dialog.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!.error;
const occurrenceField = (dialog: Dialog) => dialog.querySelector('[name="occurrence"]');

const REPEATED = {
  code: "menu_publication.time_repeated",
  params: {
    date: "2026-10-25",
    time: "02:30",
    occurrences: [{ offset: "+02:00" }, { offset: "+01:00" }],
  },
};
const PAST = { code: "menu_publication.time_past", params: {} };
const EVERY_REFUSAL = [
  REPEATED,
  PAST,
  { code: "menu_publication.time_skipped", params: {} },
  { code: "menu_publication.overtakes_queued", params: {} },
  {
    code: "menu_publication.overtakes_queued",
    params: { overtaken: [{ versionId: "v-lunch-1" }] },
  },
  { code: "menu_publication.not_queued", params: {} },
  { code: "menu_publication.not_found", params: {} },
  { code: "menu.changed_since_preview", params: {} },
  { code: "management.request_invalid", params: { field: "activatesAt.occurrence" } },
  { code: "connection.failed", params: {} },
  { code: "server.internal", params: {} },
];

async function sentAndWaiting(p: (typeof SCHEDULE_PATHS)[number]) {
  const { app, panel, dialog } = await p.mountPath();
  const write = deferred();
  p.writeOf(app).mockReturnValueOnce(write.promise as never);
  await enter(dialog, p.edited, p.editedValue);
  await enter(dialog, p.other, p.otherEdit);
  submitAction(dialog).click();
  await expect.poll(() => p.writeOf(app).mock.calls.length).toBe(1);
  return { app, panel, dialog, write };
}

async function settled(panel: Panel) {
  await closeReportsDelivered();
  await panel.updateComplete;
}

for (const p of SCHEDULE_PATHS) {
  for (const answered of ["while it is out", "after being put back"] as const) {
    const refusals = answered === "after being put back" ? EVERY_REFUSAL : [REPEATED, PAST];
    for (const [index, refusal] of refusals.entries()) {
      it(`${p.path}: ${refusal.code} (${index}) arriving ${answered} says one sentence on the panel until a reopening`, async () => {
        const { app, panel, dialog, write } = await sentAndWaiting(p);
        const retries = vi.fn();
        panel.addEventListener("wt-preview-retry", retries);
        const parent = panel.parentNode!;
        const next = panel.nextSibling;
        panel.remove();
        if (answered === "while it is out") {
          write.reject(refusal);
          await settled(panel);
        }
        parent.insertBefore(panel, next);
        await settled(panel);
        if (answered === "after being put back") {
          expect(lateRefusal(panel)).toBeNull();
          write.reject(refusal);
          await settled(panel);
        }
        await expect.poll(() => lateText(panel)).toBe(LATE_WORDS);
        expect(lateRefusal(panel)!.getAttribute("role")).toBe("alert");

        await panel.updateComplete;
        expect(dialog.open).toBe(false);
        expect(submitAction(dialog).loading).toBe(false);
        expect(footerMessage(dialog)).toBe("");
        expect(fieldError(dialog, "time")).toBe("");
        expect(occurrenceField(dialog)).toBeNull();
        expect(app.leave.coordinator.isDirty()).toBe(false);
        expect(retries).not.toHaveBeenCalled();
        expect(p.writeOf(app)).toHaveBeenCalledTimes(1);

        await putBack(panel, "at once");
        expect(lateText(panel)).toBe(LATE_WORDS);

        await vi.waitFor(() => expect(editionRow(panel)).not.toBeNull());
        await p.reopen(panel);
        await expectUnchangedOpen(app, panel, dialog);
        expect(lateRefusal(panel)).toBeNull();
        expect(occurrenceField(dialog)).toBeNull();
        expect(fieldError(dialog, "time")).toBe("");
        expect(footerMessage(dialog)).toBe("");
        expect(p.writeOf(app)).toHaveBeenCalledTimes(1);
      });
    }
  }

  it(`${p.path}: a late refusal on the panel re-reads the list, so what it says to check is current`, async () => {
    const { app, panel, write } = await sentAndWaiting(p);
    app.api.getMenuPublications.mockResolvedValue(LATER_LISTED);
    await putBack(panel, "at once");
    await vi.waitFor(() => expect(editionRow(panel)).not.toBeNull());
    const reads = app.api.getMenuPublications.mock.calls.length;
    app.api.getMenuPublications.mockResolvedValue(LISTED);
    write.reject(PAST);
    await expect.poll(() => lateRefusal(panel)).not.toBeNull();
    await expect.poll(() => app.api.getMenuPublications.mock.calls.length).toBe(reads + 1);
    expect(app.api.getMenuPublications).toHaveBeenLastCalledWith("menu-lunch");
    await expect.poll(() => tableCell(panel, "time-v-lunch-1")?.textContent).toContain("08:00");
  });

  it(`${p.path}: a window taken out while its overtake refusal reads the list says so on the panel`, async () => {
    const { app, panel, dialog, write } = await sentAndWaiting(p);
    const read = deferred();
    app.api.getMenuPublications.mockReturnValueOnce(read.promise as never);
    write.reject({
      code: "menu_publication.overtakes_queued",
      params: { overtaken: [{ versionId: "v-lunch-1" }] },
    });
    await closeReportsDelivered();
    await putBack(panel, "at once");
    await settled(panel);
    read.resolve(LISTED);
    await expect.poll(() => lateText(panel)).toBe(LATE_WORDS);
    expect(dialog.open).toBe(false);
    expect(fieldError(dialog, "time")).toBe("");
  });

  it(`${p.path}: a late refusal arriving while out reads nothing until put back, then once`, async () => {
    const { app, panel, write } = await sentAndWaiting(p);
    const parent = panel.parentNode!;
    const next = panel.nextSibling;
    panel.remove();
    const reads = app.api.getMenuPublications.mock.calls.length;
    write.reject(PAST);
    await settled(panel);
    expect(app.api.getMenuPublications).toHaveBeenCalledTimes(reads);
    parent.insertBefore(panel, next);
    await settled(panel);
    expect(app.api.getMenuPublications).toHaveBeenCalledTimes(reads + 1);
  });

  for (const refusal of [REPEATED, PAST]) {
    it(`${p.path}: ${refusal.code} arriving once a fresh window is open leaves that window alone`, async () => {
      const { app, panel, dialog, write } = await sentAndWaiting(p);
      await putBack(panel, "at once");
      await settled(panel);
      await p.reopen(panel);
      await expectUnchangedOpen(app, panel, dialog);
      await enter(dialog, p.edited, p.editAfter);

      write.reject(refusal);
      await expect.poll(() => lateText(panel)).toBe(LATE_WORDS);

      expect(dialog.open).toBe(true);
      expect(fieldValue(dialog, p.edited)).toBe(p.editAfter);
      expect(fieldError(dialog, "time")).toBe("");
      expect(footerMessage(dialog)).toBe("");
      expect(occurrenceField(dialog)).toBeNull();
      expect(submitAction(dialog).loading).toBe(false);
      expect(submitAction(dialog).disabled).toBe(false);
      expect(app.leave.coordinator.isDirty()).toBe(true);
      expect(p.writeOf(app)).toHaveBeenCalledTimes(1);
    });

    it(`${p.path}: ${refusal.code} arriving while a fresh window's own write is out leaves it busy`, async () => {
      const { app, panel, dialog, write } = await sentAndWaiting(p);
      await putBack(panel, "at once");
      await settled(panel);
      await p.reopen(panel);
      await expectUnchangedOpen(app, panel, dialog);
      const second = deferred();
      p.writeOf(app).mockReturnValueOnce(second.promise as never);
      await enter(dialog, p.edited, p.editedValue);
      await enter(dialog, p.other, p.otherEdit);
      submitAction(dialog).click();
      await expect.poll(() => p.writeOf(app).mock.calls.length).toBe(2);

      write.reject(refusal);
      await expect.poll(() => lateText(panel)).toBe(LATE_WORDS);
      await panel.updateComplete;
      expect(submitAction(dialog).loading).toBe(true);
      expect(occurrenceField(dialog)).toBeNull();
      expect(fieldError(dialog, "time")).toBe("");

      const closed = dialogClosed(dialog);
      second.resolve({ versionId: "v", number: 2, activatesAt: "" });
      await closed;
      expect(p.writeOf(app)).toHaveBeenCalledTimes(2);
    });
  }

  it(`${p.path}: a refusal for a menu the panel has moved away from shows nothing`, async () => {
    const { panel, write } = await sentAndWaiting(p);
    panel.remove();
    panel.menuId = "menu-dinner";
    await panel.updateComplete;
    write.reject(PAST);
    await settled(panel);
    expect(lateRefusal(panel)).toBeNull();
  });

  it(`${p.path}: a refusal shown on the panel goes when the panel is put back on a different menu`, async () => {
    const { app, panel, write } = await sentAndWaiting(p);
    const parent = panel.parentNode!;
    const next = panel.nextSibling;
    panel.remove();
    write.reject(PAST);
    await settled(panel);
    expect(lateRefusal(panel)).not.toBeNull();
    panel.menuId = "menu-dinner";
    parent.insertBefore(panel, next);
    await settled(panel);
    expect(lateRefusal(panel)).toBeNull();
    expect(app.api.getMenuPublications).toHaveBeenLastCalledWith("menu-dinner");
  });

  it(`${p.path}: a refusal shown on the panel goes when the panel follows a different menu`, async () => {
    const { panel, write } = await sentAndWaiting(p);
    await putBack(panel, "at once");
    write.reject(PAST);
    await expect.poll(() => lateRefusal(panel)).not.toBeNull();
    panel.menuId = "menu-dinner";
    await settled(panel);
    expect(lateRefusal(panel)).toBeNull();
  });

  it(`${p.path}: a refusal for the menu the panel has come back to shows`, async () => {
    const { panel, write } = await sentAndWaiting(p);
    panel.menuId = "menu-dinner";
    await panel.updateComplete;
    panel.menuId = "menu-lunch";
    await panel.updateComplete;
    write.reject(PAST);
    await expect.poll(() => lateText(panel)).toBe(LATE_WORDS);
  });

  for (const answered of ["while it is out", "after being put back"] as const) {
    it(`${p.path}: a write accepted ${answered} shows no refusal`, async () => {
      const { app, panel, dialog, write } = await sentAndWaiting(p);
      const parent = panel.parentNode!;
      const next = panel.nextSibling;
      panel.remove();
      if (answered === "while it is out") {
        write.resolve({ versionId: "v", number: 2, activatesAt: "" });
        await settled(panel);
      }
      parent.insertBefore(panel, next);
      await settled(panel);
      if (answered === "after being put back") {
        write.resolve({ versionId: "v", number: 2, activatesAt: "" });
        await settled(panel);
      }
      expect(lateRefusal(panel)).toBeNull();
      expect(dialog.open).toBe(false);
      expect(p.writeOf(app)).toHaveBeenCalledTimes(1);
    });
  }

  it(`${p.path}: a refusal of the window still open stays in that window`, async () => {
    const { app, panel, dialog, write } = await sentAndWaiting(p);
    write.reject(PAST);
    await expect.poll(() => fieldError(dialog, "time")).toBe(codeMessage(PAST.code));
    expect(lateRefusal(panel)).toBeNull();
    expect(dialog.open).toBe(true);
    expect(app.leave.coordinator.isDirty()).toBe(true);
  });

  it(`${p.path}: a repeated time refused in the window still open asks which one, in that window`, async () => {
    const { panel, dialog, write } = await sentAndWaiting(p);
    write.reject(REPEATED);
    await expect.poll(() => occurrenceField(dialog)).not.toBeNull();
    expect(lateRefusal(panel)).toBeNull();
    expect(dialog.open).toBe(true);
  });
}

it("the late refusal names the panel's own heading, in the screen's language", async () => {
  const { panel, write } = await sentAndWaiting(SCHEDULE_PATHS[0]);
  await putBack(panel, "at once");
  write.reject(PAST);
  await expect.poll(() => lateText(panel)).toBe(LATE_WORDS);
  expect(lateText(panel)).toContain(t("menu_publications.heading"));
  setLocale("es");
  await panel.updateComplete;
  const spanish = t("menu_publications.late_refusal");
  expect(spanish).not.toBe(LATE_WORDS);
  expect(spanish).toContain(t("menu_publications.heading"));
  await expect.poll(() => lateText(panel)).toBe(spanish);
});
