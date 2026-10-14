import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, type WtDataTable } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi, type PeriodDeleteImpact } from "./opening-hours-client.js";
import type { PeriodDeleteDialog } from "./period-delete-dialog.js";
import type { PeriodDialog } from "./period-dialog.js";
import type { PeriodRow, PeriodsScreen } from "./periods-screen.js";

import "./periods-screen.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

type Period = OpeningHoursModel["departments"][number]["periods"][number];
const lunch = (): Period => ({
  id: "p1",
  name: "Lunch",
  colour: "green",
  menuId: "lunch",
  staffMenuIds: [],
  endOffsetMinutes: 0,
  weekdays: [],
  routingUses: [],
});
const dinner = (): Period => ({ ...lunch(), id: "p2", name: "Dinner", colour: "red" });

function model(periods: Period[] = [lunch()]): OpeningHoursModel {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 0,
    currentBusinessDay: "2026-10-12",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [{ id: "lunch", name: "Lunch menu", active: true, includes: [] }],
    seasons: [{ id: "winter", name: "Winter", startsOn: "12-01" }],
    currentSeasonId: "winter",
    departments: [
      { id: "restaurant", name: "Restaurant", active: true, zones: [], periods, seasonWeeks: [] },
    ],
  };
}
function impactOf(overrides: Partial<PeriodDeleteImpact> = {}): PeriodDeleteImpact {
  return {
    seasons: 0,
    specialDays: 0,
    routingUses: [],
    keptOpenToday: false,
    replacements: [],
    ...overrides,
  };
}

const PAINTED_IN = "/management-api/venue-service/menu-periods/painted-in";
const isImpactRead = (path: string, method: string) =>
  method === "GET" && path.endsWith("/delete-impact");

/** Answers the page's reads from `data`, each impact read from `impact`, and every write with `write`. */
function fake(options: {
  data?: () => OpeningHoursModel;
  impact?: (path: string) => unknown;
  write?: (path: string, method: string, body: unknown) => unknown;
}): DashboardRequest {
  return (async (path, method, body) => {
    if (method === "GET" && path === PAINTED_IN) return [];
    if (isImpactRead(path, method))
      return structuredClone(await (options.impact ?? impactOf)(path));
    if (method === "GET") return structuredClone((options.data ?? model)());
    return options.write?.(path, method, body);
  }) as DashboardRequest;
}

async function mount(request: DashboardRequest = fake({}), into: HTMLElement = document.body) {
  const el = document.createElement("dashboard-periods-screen") as PeriodsScreen;
  el.api = new OpeningHoursApi(request);
  applyTokens(el);
  if (into === document.body) hosts.push(el);
  into.append(el);
  await expect.poll(() => table(el)).not.toBeNull();
  await table(el)!.updateComplete;
  return el;
}
function table(el: PeriodsScreen) {
  return el.shadowRoot!.querySelector<WtDataTable<PeriodRow>>("wt-data-table");
}
function rowButton(el: PeriodsScreen, test: string, id = "p1") {
  const row = table(el)!.shadowRoot!.querySelector(`tr[data-row-key="period:${id}"]`);
  const button = row?.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${test}]`);
  expect(button, `${test} on ${id}`).not.toBeNull();
  return button!;
}
const deleteDialog = (el: PeriodsScreen) =>
  el.shadowRoot!.querySelector<PeriodDeleteDialog>("period-delete-dialog");
const periodDialog = (el: PeriodsScreen) =>
  el.shadowRoot!.querySelector<PeriodDialog>("period-dialog");
async function removePeriod(el: PeriodsScreen, id = "p1") {
  await table(el)!.updateComplete;
  rowButton(el, "delete-period", id).click();
  await el.updateComplete;
  const dialog = deleteDialog(el);
  expect(dialog, "delete asks for confirmation").not.toBeNull();
  await dialog!.updateComplete;
  return dialog!;
}
const confirm = (dialog: PeriodDeleteDialog) =>
  dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=confirm-delete]",
  )!;
const cancel = (dialog: PeriodDeleteDialog) =>
  dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=cancel-delete]",
  )!;
const retry = (dialog: PeriodDeleteDialog) =>
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-delete]");
const heading = (dialog: PeriodDeleteDialog) =>
  dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")?.heading;
const body = (dialog: PeriodDeleteDialog) =>
  (dialog.shadowRoot!.querySelector("[data-test=body]")?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const bottom = (dialog: PeriodDeleteDialog) =>
  dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")
    ?.error ?? "";
/** The routing cells the body's "Named in …" sentence lists, in order. */
function cells(dialog: PeriodDeleteDialog) {
  const match = /Named in \d+ routing cells?: (.*?)\./.exec(body(dialog));
  return match ? match[1]!.split(", ") : [];
}
async function impactShown(dialog: PeriodDeleteDialog) {
  await expect.poll(() => confirm(dialog).disabled).toBe(false);
}
async function choose(dialog: PeriodDeleteDialog, value: string) {
  dialog
    .shadowRoot!.querySelector("wt-combobox[name=replacementPeriodId]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await dialog.updateComplete;
}
const DELETE_P1 = "/management-api/venue-service/menu-periods/p1/delete";

it("asks before deleting, reads the impact, sends the delete with no replacement and the revision the model had, and refreshes after it", async () => {
  const writes: unknown[] = [];
  const impactReads: string[] = [];
  const data = model();
  data.clockRevision = 3;
  const el = await mount(
    fake({
      data: () => data,
      impact: (path) => {
        impactReads.push(path);
        return impactOf();
      },
      write: (path, method, sent) => {
        writes.push({ path, method, body: sent });
        data.departments[0]!.periods = [];
      },
    }),
  );
  const dialog = await removePeriod(el);
  expect(heading(dialog)).toBe("Delete Lunch?");
  await impactShown(dialog);
  expect(impactReads).toEqual(["/management-api/venue-service/menu-periods/p1/delete-impact"]);
  expect(writes).toEqual([]);
  expect(body(dialog)).not.toContain("routing");
  confirm(dialog).click();
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: DELETE_P1,
        method: "POST",
        body: { replacementPeriodId: null, expectedClockRevision: 3 },
      },
    ]);
  await expect.poll(() => deleteDialog(el)).toBeNull();
  await expect.poll(() => table(el)!.rows.length).toBe(1);
});

it("a replacement chosen is sent, and the dialog says the routing lines go and today's opening moves", async () => {
  const writes: unknown[] = [];
  const el = await mount(
    fake({
      data: () => model([lunch(), dinner()]),
      impact: () =>
        impactOf({
          seasons: 1,
          routingUses: [{ rowKind: "category", rowLabel: "Cocktails", zoneName: null }],
          keptOpenToday: true,
          replacements: [{ id: "p2", name: "Dinner" }],
        }),
      write: (path, method, sent) => {
        writes.push({ path, method, body: sent });
      },
    }),
  );
  const dialog = await removePeriod(el);
  await impactShown(dialog);
  expect(body(dialog)).toContain("Its routing lines are deleted.");
  expect(body(dialog)).toContain("Today's later opening of it ends.");
  await choose(dialog, "p2");
  expect(body(dialog)).toContain("Dinner takes its painted time.");
  expect(body(dialog)).toContain("Its routing lines are deleted.");
  expect(body(dialog)).toContain("Today's later opening moves to Dinner.");
  confirm(dialog).click();
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: DELETE_P1,
        method: "POST",
        body: { replacementPeriodId: "p2", expectedClockRevision: 0 },
      },
    ]);
  await expect.poll(() => deleteDialog(el)).toBeNull();
});

it("lists each routing cell from the impact, keeps the list current, and deletes on confirming", async () => {
  const writes: unknown[] = [];
  let uses: PeriodDeleteImpact["routingUses"] = [
    { rowKind: "all", rowLabel: null, zoneName: "Terrace" },
    { rowKind: "category", rowLabel: "Cocktails", zoneName: null },
  ];
  const el = await mount(
    fake({
      impact: () => impactOf({ routingUses: uses }),
      write: (path, method, sent) => {
        writes.push({ path, method, body: sent });
      },
    }),
  );
  const dialog = await removePeriod(el);
  expect(heading(dialog)).toBe("Delete Lunch?");
  await impactShown(dialog);
  expect(body(dialog)).toContain("Named in 2 routing cells:");
  expect(cells(dialog)).toEqual(["All categories · Terrace", "Cocktails · Every zone"]);

  uses = [{ rowKind: "product", rowLabel: "Mojito", zoneName: "Bar" }];
  el.api.rereadWatches();
  await expect.poll(() => cells(dialog)).toEqual(["Mojito · Bar"]);
  expect(body(dialog)).toContain("Named in 1 routing cell:");
  expect(body(dialog)).toContain("Its routing lines are deleted.");

  confirm(dialog).click();
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: DELETE_P1,
        method: "POST",
        body: { replacementPeriodId: null, expectedClockRevision: 0 },
      },
    ]);
  await expect.poll(() => deleteDialog(el)).toBeNull();
});

it("ignores an impact read that answers after a newer one, and keeps the shown impact until the new one answers", async () => {
  const answers: ((impact: PeriodDeleteImpact) => void)[] = [];
  const el = await mount(
    fake({
      impact: () =>
        new Promise<PeriodDeleteImpact>((done) => {
          answers.push(done);
        }),
    }),
  );
  const dialog = await removePeriod(el);
  await expect.poll(() => answers.length).toBe(1);
  answers[0]!(impactOf({ seasons: 1 }));
  await impactShown(dialog);
  expect(body(dialog)).toContain("Painted in 1 season.");
  el.api.rereadWatches();
  await expect.poll(() => answers.length).toBeGreaterThanOrEqual(2);
  await new Promise((done) => setTimeout(done, 50));
  const reads = answers.length;
  await dialog.updateComplete;
  expect(body(dialog)).toContain("Painted in 1 season.");
  answers[reads - 1]!(impactOf({ seasons: 3 }));
  await expect.poll(() => body(dialog)).toContain("Painted in 3 seasons.");
  for (const answer of answers.slice(1, reads - 1)) answer(impactOf({ seasons: 2 }));
  await new Promise((done) => setTimeout(done, 0));
  await dialog.updateComplete;
  expect(body(dialog)).toContain("Painted in 3 seasons.");
  expect(reads, "both watches re-read").toBe(3);
});

it("a failed impact read shows Retry, and Retry reads it again; a failed re-read keeps the shown impact and offers Retry", async () => {
  let fail = true;
  let reads = 0;
  const el = await mount(
    fake({
      impact: () => {
        reads++;
        if (fail) throw new Error("offline");
        return impactOf({ seasons: reads });
      },
    }),
  );
  const dialog = await removePeriod(el);
  await expect.poll(() => bottom(dialog)).toBe("What deleting it changes could not be read.");
  expect(confirm(dialog).disabled).toBe(true);
  fail = false;
  retry(dialog)!.click();
  await impactShown(dialog);
  expect(reads).toBe(2);
  expect(body(dialog)).toContain("Painted in 2 seasons.");
  expect(bottom(dialog)).toBe("");
  expect(retry(dialog)).toBeNull();

  fail = true;
  el.api.rereadWatches();
  await expect.poll(() => bottom(dialog)).toBe("What deleting it changes could not be read.");
  expect(body(dialog)).toContain("Painted in 2 seasons.");
  expect(confirm(dialog).disabled).toBe(false);
  fail = false;
  const before = reads;
  retry(dialog)!.click();
  await expect.poll(() => bottom(dialog)).toBe("");
  expect(reads).toBe(before + 1);
  expect(body(dialog)).toContain(`Painted in ${before + 1} seasons.`);
});

it("a failed then recovered page read leaves the delete dialog's refusal in place", async () => {
  let data = model();
  let failRead = false;
  const el = await mount(
    fake({
      data: () => {
        if (failRead) throw new Error("offline");
        return data;
      },
      write: () => {
        throw { code: "hours.clock_changed" };
      },
    }),
  );
  const dialog = await removePeriod(el);
  await impactShown(dialog);
  confirm(dialog).click();
  await expect.poll(() => bottom(dialog)).toBe("The business-day start changed. Reload hours.");
  failRead = true;
  el.api.rereadWatches();
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=read-error]")).not.toBeNull();
  expect(bottom(dialog)).toBe("The business-day start changed. Reload hours.");
  failRead = false;
  data = model([{ ...lunch(), name: "Renamed lunch" }]);
  el.api.rereadWatches();
  await expect
    .poll(() => table(el)!.rows.find((row) => row.kind === "period")?.name)
    .toBe("Renamed lunch");
  expect(el.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
  await dialog.updateComplete;
  expect(deleteDialog(el)).toBe(dialog);
  expect(bottom(dialog)).toBe("The business-day start changed. Reload hours.");
});

it("ignores a departed delete confirmation after another period's dialog opened", async () => {
  const writes: string[] = [];
  const el = await mount(
    fake({
      data: () => model([lunch(), dinner()]),
      write: (path) => {
        writes.push(path);
      },
    }),
  );
  const first = await removePeriod(el, "p1");
  await impactShown(first);
  const oldConfirm = confirm(first);
  const closed = new Promise((done) => first.addEventListener("period-delete-close", done));
  await cancel(first).updateComplete;
  cancel(first).click();
  await closed;
  await el.updateComplete;
  expect(deleteDialog(el)).toBeNull();
  const second = await removePeriod(el, "p2");
  expect(heading(second)).toBe("Delete Dinner?");
  await impactShown(second);
  oldConfirm.click();
  await el.updateComplete;
  expect(writes).toEqual([]);
  expect(deleteDialog(el)).toBe(second);
  expect(heading(second)).toBe("Delete Dinner?");
  expect(second.busy).toBe(false);
});

it("ignores a departed delete confirmation after the same period's dialog reopened", async () => {
  const writes: string[] = [];
  const el = await mount(
    fake({
      write: (path) => {
        writes.push(path);
      },
    }),
  );
  const first = await removePeriod(el);
  await impactShown(first);
  const oldConfirm = confirm(first);
  const closed = new Promise((done) => first.addEventListener("period-delete-close", done));
  await cancel(first).updateComplete;
  cancel(first).click();
  await closed;
  await el.updateComplete;
  const second = await removePeriod(el);
  expect(second).not.toBe(first);
  await impactShown(second);
  oldConfirm.click();
  await el.updateComplete;
  expect(writes).toEqual([]);
  expect(second.busy).toBe(false);
});

it.each([
  [{ code: "menu_period.not_found" }, "This period no longer exists."],
  [new Error("offline"), "This could not be saved. Try again."],
])("keeps a refused deletion's dialog open for retry (%j)", async (error, message) => {
  let writes = 0;
  const el = await mount(
    fake({
      write: () => {
        writes++;
        throw error;
      },
    }),
  );
  const dialog = await removePeriod(el);
  await impactShown(dialog);
  confirm(dialog).click();
  await expect.poll(() => bottom(dialog)).toBe(message);
  expect(deleteDialog(el)).toBe(dialog);
  expect(confirm(dialog).disabled).toBe(false);
  confirm(dialog).click();
  await expect.poll(() => writes).toBe(2);
});

it("cancels deletion without writing and ignores the departed cancel control", async () => {
  let writes = 0;
  const el = await mount(
    fake({
      write: () => {
        writes++;
      },
    }),
  );
  const dialog = await removePeriod(el);
  const oldCancel = cancel(dialog);
  await oldCancel.updateComplete;
  oldCancel.click();
  await expect.poll(() => deleteDialog(el)).toBeNull();
  const again = await removePeriod(el);
  oldCancel.click();
  await el.updateComplete;
  expect(deleteDialog(el)).toBe(again);
  expect(again.open).toBe(true);
  expect(writes).toBe(0);
});

it("offers a visible native Cancel button in the delete dialog", async () => {
  const el = await mount();
  const dialog = await removePeriod(el);
  await impactShown(dialog);
  expect(confirm(dialog).variant).toBe("danger");
  const button = cancel(dialog);
  expect(button.variant).toBe("secondary");
  await button.updateComplete;
  const native = button.shadowRoot!.querySelector("button")!;
  expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
  await userEvent.click(native);
  await expect.poll(() => deleteDialog(el)).toBeNull();
});

it("does not show a late deletion refusal on a disconnected screen", async () => {
  let reject!: (error: unknown) => void;
  const el = await mount(
    fake({
      write: () =>
        new Promise<void>((_done, fail) => {
          reject = fail;
        }),
    }),
  );
  const dialog = await removePeriod(el);
  await impactShown(dialog);
  confirm(dialog).click();
  await expect.poll(() => reject).toBeDefined();
  el.remove();
  reject({ code: "menu_period.not_found" });
  await new Promise((done) => setTimeout(done, 0));
  await el.updateComplete;
  await dialog.updateComplete;
  expect(dialog.refusal).toBeUndefined();
  expect(bottom(dialog)).toBe("");
});

it("a model in which the period is gone closes its delete dialog", async () => {
  let data = model([lunch(), dinner()]);
  const el = await mount(fake({ data: () => data }));
  const dialog = await removePeriod(el);
  await impactShown(dialog);
  data = model([dinner()]);
  el.api.rereadWatches();
  await expect.poll(() => deleteDialog(el)).toBeNull();
  await expect.poll(() => table(el)!.rows.length).toBe(2);
});

it("blocks opening a period dialog while a delete dialog is open, and the other way round", async () => {
  const el = await mount(fake({ data: () => model([lunch(), dinner()]) }));
  const add = el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-period]")!;
  rowButton(el, "edit-period", "p1").click();
  await el.updateComplete;
  const editor = periodDialog(el)!;
  expect(editor).not.toBeNull();
  rowButton(el, "delete-period", "p2").click();
  await el.updateComplete;
  expect(periodDialog(el)).toBe(editor);
  expect(deleteDialog(el)).toBeNull();
  editor.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(periodDialog(el)).toBeNull();

  const deletion = await removePeriod(el, "p1");
  add.click();
  rowButton(el, "edit-period", "p2").click();
  rowButton(el, "delete-period", "p2").click();
  await el.updateComplete;
  expect(periodDialog(el)).toBeNull();
  expect(el.shadowRoot!.querySelectorAll("period-delete-dialog")).toHaveLength(1);
  expect(deleteDialog(el)).toBe(deletion);
  expect(deletion.period?.id).toBe("p1");

  el.remove();
  add.click();
  await el.updateComplete;
  expect(periodDialog(el)).toBeNull();
});

class LeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("periods-delete-leave-app", LeaveApp);
async function inLeaveApp(request: DashboardRequest = fake({})) {
  const app = document.createElement("periods-delete-leave-app") as LeaveApp;
  applyTokens(app);
  hosts.push(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = await mount(request, app);
  const question = () =>
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  return { app, screen, question };
}

it("Cancel and native Escape close a deletion without a draft or a write", async () => {
  let writes = 0;
  const { app, screen, question } = await inLeaveApp(
    fake({
      write: () => {
        writes++;
      },
    }),
  );
  for (const reason of ["cancel", "escape"] as const) {
    const dialog = await removePeriod(screen);
    await impactShown(dialog);
    expect(dialog.open).toBe(true);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    const modal = dialog.shadowRoot!.querySelector("wt-modal")!;
    const closed = new Promise((done) => modal.addEventListener("wt-close", done, { once: true }));
    if (reason === "cancel") cancel(dialog).click();
    else await userEvent.keyboard("{Escape}");
    await closed;
    await screen.updateComplete;
    expect(deleteDialog(screen)).toBeNull();
    expect(question().open).toBe(false);
  }
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(writes).toBe(0);
});

it("Delete… in the Edit dialog, after its own question, opens the delete dialog for that period", async () => {
  const { screen, question } = await inLeaveApp();
  const openEdit = async () => {
    rowButton(screen, "edit-period", "p1").click();
    await screen.updateComplete;
    const dialog = periodDialog(screen)!;
    expect(dialog, "period dialog opens").not.toBeNull();
    await dialog.updateComplete;
    expect(dialog.deletable).toBe(true);
    return dialog;
  };
  const deleteButton = (dialog: PeriodDialog) =>
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-period]")!;

  const clean = await openEdit();
  deleteButton(clean).click();
  await expect.poll(() => deleteDialog(screen)?.period?.id).toBe("p1");
  expect(periodDialog(screen)).toBeNull();
  expect(question().open).toBe(false);
  const first = deleteDialog(screen)!;
  await impactShown(first);
  const closed = new Promise((done) => first.addEventListener("period-delete-close", done));
  cancel(first).click();
  await closed;
  await screen.updateComplete;
  expect(deleteDialog(screen)).toBeNull();

  const changed = await openEdit();
  changed
    .shadowRoot!.querySelector("[name=name]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Brunch" }, bubbles: true, composed: true }),
    );
  await changed.updateComplete;
  deleteButton(changed).click();
  await expect.poll(() => question().open).toBe(true);
  await question().updateComplete;
  question().shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => question().open).toBe(false);
  await screen.updateComplete;
  expect(deleteDialog(screen)).toBeNull();
  expect(periodDialog(screen)).toBe(changed);
  expect(changed.open).toBe(true);

  deleteButton(changed).click();
  await expect.poll(() => question().open).toBe(true);
  await question().updateComplete;
  question().shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => deleteDialog(screen)?.period?.id).toBe("p1");
  expect(periodDialog(screen)).toBeNull();
});

it("keeps the delete dialog on a phone, with its native Confirm visible", async () => {
  const initial = { width: window.innerWidth, height: window.innerHeight };
  try {
    await page.viewport(390, 844);
    const el = await mount();
    const dialog = await removePeriod(el);
    await impactShown(dialog);
    const native = confirm(dialog).shadowRoot!.querySelector("button")!;
    const at = native.getBoundingClientRect();
    expect(at.width).toBeGreaterThan(0);
    expect(at.right).toBeLessThanOrEqual(window.innerWidth);
  } finally {
    await page.viewport(initial.width, initial.height);
  }
});
