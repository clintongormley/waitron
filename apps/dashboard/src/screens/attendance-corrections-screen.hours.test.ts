import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { attendanceEntry } from "../../test/attendance-fixtures.js";
import {
  change,
  click,
  deferred,
  managerHours,
  mountManagerHours,
  openDay,
  record,
} from "../../test/manager-hours-fixtures.js";
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

it("opens the configured pay period, counted automatic hours and retained workers without reading the correction queue", async () => {
  const m = await mountManagerHours();
  const view = await record(m.root);
  expect(m.root.querySelector("h1")!.textContent).toBe("Hours");
  expect(view.shadowRoot!.textContent).toContain("2026-01-01 · 2026-01-31");
  expect(view.shadowRoot!.querySelector("[data-total]")!.textContent).toContain("8 h 00 min");
  expect(view.shadowRoot!.textContent).toContain("already counts");
  expect(view.shadowRoot!.textContent).toContain("Waiting for the worker’s acknowledgement.");
  expect(m.root.textContent).toContain("Old pending hours");
  expect(m.reads.some((r) => r.path.includes("/hours?locationId=shop&kind=pay-period"))).toBe(true);
  expect(m.reads.some((r) => r.path.includes("/queue?"))).toBe(false);
  expect(m.reads.every((r) => r.passive === "1")).toBe(true);
  await change(m.root, "attendancePerson", "retained");
  await expect.poll(() => view.view?.personId).toBe("retained");
  expect(view.shadowRoot!.querySelector("[data-total]")!.textContent).toContain("0 h 00 min");
  await openDay(m.root);
  expect(m.root.querySelector("[data-day]")!.textContent).toContain("Retained worker");
  expect(m.root.querySelector("[data-add-shift]")).toBeTruthy();
});

it.each(["approve", "decline"])(
  "%s reads the current day before using the existing command owner and rereads Hours with a silent feed",
  async (action) => {
    const m = await mountManagerHours();
    await record(m.root);
    await click(m.root, "[data-detail]");
    await expect.poll(() => m.root.querySelector(`[data-${action}]`)).toBeTruthy();
    expect(
      m.reads.some((r) => r.path.includes("/day?personId=worker&locationId=shop&date=2026-01-05")),
    ).toBe(true);
    await click(m.root, `[data-${action}]`);
    await expect.poll(() => m.commands.length).toBe(1);
    expect(m.commands[0]).toEqual({
      action,
      commandId: expect.any(String),
      itemId: "request",
      expectedRevision: "authoritative-day",
    });
    await expect
      .poll(() => m.reads.filter((r) => r.path.includes("/hours?")).length)
      .toBeGreaterThan(1);
  },
);

it("uses the returned period bounds for previous and next, and ignores an old period reply", async () => {
  const m = await mountManagerHours();
  await record(m.root);
  const old = deferred<ReturnType<typeof managerHours>>();
  m.hold("date=2025-12-31", old.promise);
  await click(m.root, "[data-hours-previous]");
  await expect.poll(() => m.reads.some((r) => r.path.endsWith("date=2025-12-31"))).toBe(true);
  m.release();
  m.data.hours.period = { start: "2026-02-01", end: "2026-03-01" };
  await change(m.root, "hoursPeriodDate", "2026-02-10");
  await expect
    .poll(() => m.root.querySelector("dashboard-hours-record")?.view?.period.start)
    .toBe("2026-02-01");
  old.resolve(managerHours());
  await m.el.updateComplete;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(m.root.querySelector("dashboard-hours-record")?.view?.period.start).toBe("2026-02-01");
  await click(m.root, "[data-hours-next]");
  await expect.poll(() => m.reads.some((r) => r.path.endsWith("date=2026-03-01"))).toBe(true);
});

it("drops a held old location summary before displaying the new workplace", async () => {
  const m = await mountManagerHours();
  await record(m.root);
  const late = deferred<ReturnType<typeof managerHours>>();
  m.hold("locationId=shop", late.promise);
  await click(m.root, "[data-hours-refresh]");
  await expect
    .poll(() => m.reads.filter((r) => r.path.includes("locationId=shop")).length)
    .toBeGreaterThan(1);
  m.release();
  await change(m.root, "attendanceLocation", "bar");
  await expect
    .poll(() => m.root.querySelector("dashboard-hours-record")?.view?.locationId)
    .toBe("bar");
  late.resolve(managerHours());
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(m.root.querySelector("dashboard-hours-record")?.view?.locationId).toBe("bar");
});

it("a worker response refreshes counted and frozen changes without replacing a staged manager proposal", async () => {
  const m = await mountManagerHours({ live: true });
  await openDay(m.root);
  await click(m.root, "[data-retime]");
  const editor = m.root.querySelector("dashboard-attendance-proposal-dialog")!;
  await editor.updateComplete;
  await change(editor.shadowRoot!, "attendanceReason", "Keep this proposal");
  await editor.updateComplete;
  m.data.hours.people[0]!.hours.workedMinutes = 540;
  m.data.hours.people[0]!.hours.record.closedPeriodImpacts = [
    {
      closureId: "closed",
      personId: "worker",
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 540,
      deltaWorkedMinutes: 60,
    },
  ];
  m.revision("worker-response");
  m.liveData!.invalidate([{ type: "time_entries" }]);
  const view = await record(m.root);
  await expect
    .poll(() => view.shadowRoot!.querySelector("[data-total]")?.textContent)
    .toContain("9 h 00 min");
  expect(view.shadowRoot!.querySelector("[data-impact]")!.textContent).toContain("+1 h 00 min");
  await expect.poll(() => editor.blocked).toBe(true);
  expect(editor.shadowRoot!.querySelector("wt-textarea")!.value).toBe("Keep this proposal");
  editor.dispatchEvent(
    new CustomEvent("proposal-save", {
      detail: {
        changes: m.data.hours.people[0]!.hours.pending.items[0]!.changes,
        reason: "Keep this proposal",
      },
    }),
  );
  expect(m.commands).toEqual([]);
});

it("summary recovery clears a read failure while an action refusal survives later reads", async () => {
  const m = await mountManagerHours({ live: true });
  await record(m.root);
  m.fail();
  m.liveData!.invalidate([{ type: "time_entries" }]);
  await expect.poll(() => m.root.querySelector("[data-read-error]")).toBeTruthy();
  m.fail(false);
  await click(m.root, "[data-hours-refresh]");
  await expect.poll(() => m.root.querySelector("[data-read-error]")).toBeNull();
  await click(m.root, "[data-detail]");
  await expect.poll(() => m.root.querySelector("[data-approve]")).toBeTruthy();
  m.refuse("correction.not_permitted");
  await click(m.root, "[data-approve]");
  await expect.poll(() => m.root.querySelector("[data-action-error]")).toBeTruthy();
  m.liveData!.invalidate([{ type: "time_entries" }]);
  await click(m.root, "[data-hours-refresh]");
  expect(m.root.querySelector("[data-action-error]")!.textContent).toContain("cannot authorise");
});

it("a lost proposal recovers its receipt, closes the editor and reports a following refresh as a read failure", async () => {
  const m = await mountManagerHours();
  await openDay(m.root);
  await click(m.root, "[data-retime]");
  const editor = m.root.querySelector("dashboard-attendance-proposal-dialog")!;
  await editor.updateComplete;
  await change(editor.shadowRoot!, "attendanceReason", "Closed late");
  await editor.updateComplete;
  const receipt = deferred<unknown>();
  m.refuse("lost");
  m.hold("/commands/", receipt.promise);
  await click(editor.shadowRoot!, "[data-save]");
  await expect.poll(() => m.commands.length).toBe(1);
  m.fail();
  receipt.resolve({ commandId: m.commands[0]!.commandId, entryIds: ["one"], replayed: true });
  await expect.poll(() => editor.open).toBe(false);
  await expect.poll(() => m.root.querySelector("[data-read-error]")).toBeTruthy();
  expect(m.root.querySelector("[data-action-error]")).toBeNull();
  expect(m.commands).toHaveLength(1);
});

it("does not invent completed minutes for an open break and keeps stored self-approval after a role change", async () => {
  const m = await mountManagerHours({ live: true });
  await record(m.root);
  const hours = m.data.hours.people[0]!.hours;
  hours.openShifts = [
    {
      start: attendanceEntry({ entryKind: "in" }),
      breakStart: attendanceEntry({ entryKind: "break_start" }),
    },
  ];
  hours.record.entries[0]!.selfApproved = true;
  m.liveData!.invalidate([{ type: "time_entries" }]);
  const view = await record(m.root);
  await expect
    .poll(() => view.shadowRoot!.querySelector("[data-open-shift]")?.textContent)
    .toContain("On a break");
  expect(view.shadowRoot!.querySelector("[data-total]")!.textContent).toContain("8 h 00 min");
  expect(view.shadowRoot!.textContent).toContain("Self-approved by an admin");
});

it.each(["light", "dark"] as const)(
  "keeps long names, selectors and day controls inside the phone panel in %s",
  async (theme) => {
    const viewport = { width: innerWidth, height: innerHeight };
    await page.viewport(390, 950);
    try {
      const m = await mountManagerHours({ live: true, theme });
      m.host.style.width = "310px";
      m.data.hours.people[0]!.displayName =
        "Diego Molina de los Olivos y Fernández — Turno de terraza";
      m.liveData!.invalidate([{ type: "time_entries" }]);
      await openDay(m.root);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const boundary = m.el.getBoundingClientRect();
      for (const element of m.root.querySelectorAll<HTMLElement>(
        ".selectors, section, article, wt-button, wt-input, wt-combobox, dashboard-hours-record",
      )) {
        const rect = element.getBoundingClientRect();
        if (!rect.width) continue;
        expect(rect.left, element.outerHTML).toBeGreaterThanOrEqual(boundary.left - 1);
        expect(rect.right, element.outerHTML).toBeLessThanOrEqual(boundary.right + 1);
      }
      expect(m.el.scrollWidth).toBeLessThanOrEqual(m.el.clientWidth);
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  },
);

it("retries an absent proposal receipt with the original UUID and body", async () => {
  const m = await mountManagerHours();
  await openDay(m.root);
  await click(m.root, "[data-retime]");
  const editor = m.root.querySelector("dashboard-attendance-proposal-dialog")!;
  await editor.updateComplete;
  await change(editor.shadowRoot!, "attendanceReason", "Finish was later");
  await editor.updateComplete;
  m.refuse("lost");
  await click(editor.shadowRoot!, "[data-save]");
  await expect.poll(() => editor.shadowRoot!.querySelector("[data-retry-command]")).toBeTruthy();
  const original = structuredClone(m.commands[0]);
  m.refuse("");
  await click(editor.shadowRoot!, "[data-retry-command]");
  await expect.poll(() => editor.open).toBe(false);
  expect(m.commands).toEqual([original, original]);
});
it("a replacement session cannot receive a prior session's held Hours", async () => {
  const pending = deferred<ReturnType<typeof managerHours>>();
  const m = await mountManagerHours({ held: pending.promise });
  await expect.poll(() => m.reads.some((r) => r.path.includes("/hours?"))).toBe(true);
  const { createRequest } = await import("@waitron/dashboard-kit");
  m.el.request = createRequest({
    fetchImpl: async () => Response.json({ error: { code: "permission.denied" } }, { status: 403 }),
  });
  await m.el.updateComplete;
  await expect.poll(() => m.root.querySelector("[data-read-error]")).toBeTruthy();
  pending.resolve(managerHours());
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(m.root.querySelector("dashboard-hours-record")).toBeNull();
  expect(m.root.textContent).not.toContain("Old pending hours");
  expect(m.root.querySelector("[data-day]")).toBeNull();
});
