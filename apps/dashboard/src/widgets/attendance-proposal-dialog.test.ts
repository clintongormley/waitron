import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { AttendanceChange } from "@waitron/dashboard-modules";
import type { AttendanceProposalDialog } from "./attendance-proposal-dialog.js";
import "./attendance-proposal-dialog.js";

import { currentLocale, setLocale } from "../i18n/t.js";
let previousLocale: string;
beforeEach(() => {
  previousLocale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(previousLocale);
});
const original: AttendanceChange = {
  target: { entryId: "original-out" },
  at: "2026-10-13T23:30:00.000Z",
  offsetMinutes: 120,
};
const missing: AttendanceChange[] = [
  { target: { missingKind: "in" }, at: "", offsetMinutes: 0 },
  { target: { missingKind: "out" }, at: "", offsetMinutes: 0 },
];
async function mount(props: Partial<AttendanceProposalDialog> = {}) {
  const mounted = await mountWidget<AttendanceProposalDialog>(
    "dashboard-attendance-proposal-dialog",
    { open: true, initialChanges: [original], timeZone: "Europe/Madrid", ...props },
  );
  expect(mounted.el.shadowRoot, "the proposal editor must render its fields").not.toBeNull();
  await mounted.el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return mounted;
}
function field(el: AttendanceProposalDialog, name: string) {
  return el.shadowRoot!.querySelector<HTMLElement>(`[name="${name}"]`)!;
}
async function fill(el: AttendanceProposalDialog, name: string, value: string) {
  const control = field(el, name);
  await (control as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const input = control.shadowRoot!.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  )!;
  await userEvent.fill(page.elementLocator(input), value);
  await el.updateComplete;
}
function save(el: AttendanceProposalDialog) {
  return el.shadowRoot!.querySelector<HTMLElement>("[data-save]")!;
}
function watch(el: AttendanceProposalDialog) {
  const seen: CustomEvent[] = [];
  el.addEventListener("proposal-save", (e) => seen.push(e as CustomEvent));
  return seen;
}

describe("attendance correction time and reason", () => {
  it("opens quiet, retains stored date/time/offset in a changed location zone and does not mutate input", async () => {
    const initial = structuredClone([original]);
    const { el } = await mount({ initialChanges: initial, timeZone: "America/New_York" });
    expect((field(el, "attendanceDate0") as unknown as { value: string }).value).toBe("2026-10-14");
    expect((field(el, "attendanceTime0") as unknown as { value: string }).value).toBe("01:30");
    expect(save(el).getAttribute("variant")).toBe("secondary");
    expect(save(el).hasAttribute("disabled")).toBe(true);
    const sent = watch(el);
    await fill(el, "attendanceReason", "  Correct the recorded time  ");
    await userEvent.click(save(el));
    expect(sent.map((e) => [e.detail, e.bubbles, e.composed])).toEqual([
      [{ changes: [original], reason: "Correct the recorded time" }, true, true],
    ]);
    expect(initial).toEqual([original]);
  });

  it("sends a changed time at the location offset rather than the browser offset", async () => {
    const { el } = await mount();
    const sent = watch(el);
    await fill(el, "attendanceTime0", "02:10");
    await fill(el, "attendanceReason", "Counted the delivery");
    await userEvent.click(save(el));
    expect(sent.map((e) => e.detail)).toEqual([
      {
        changes: [
          {
            target: { entryId: "original-out" },
            at: "2026-10-14T00:10:00.000Z",
            offsetMinutes: 120,
          },
        ],
        reason: "Counted the delivery",
      },
    ]);
  });

  it("a missing pair starts blank and submits both explicitly chosen dates and times together", async () => {
    const { el } = await mount({ initialChanges: missing });
    const sent = watch(el);
    for (const name of ["attendanceDate0", "attendanceTime0", "attendanceDate1", "attendanceTime1"])
      expect((field(el, name) as unknown as { value: string }).value).toBe("");
    await fill(el, "attendanceDate0", "2026-10-13");
    await fill(el, "attendanceTime0", "22:00");
    await fill(el, "attendanceDate1", "2026-10-14");
    await fill(el, "attendanceTime1", "01:30");
    await fill(el, "attendanceReason", "Forgot to clock");
    await userEvent.click(save(el));
    expect(sent.map((e) => e.detail)).toEqual([
      {
        changes: [
          { target: { missingKind: "in" }, at: "2026-10-13T20:00:00.000Z", offsetMinutes: 120 },
          { target: { missingKind: "out" }, at: "2026-10-13T23:30:00.000Z", offsetMinutes: 120 },
        ],
        reason: "Forgot to clock",
      },
    ]);
  });

  it("does not guess tomorrow when an end precedes a start, and explains each invalid field at submit", async () => {
    const { el } = await mount({ initialChanges: missing });
    const sent = watch(el);
    await fill(el, "attendanceDate0", "2026-10-13");
    await fill(el, "attendanceTime0", "22:00");
    await fill(el, "attendanceDate1", "2026-10-13");
    await fill(el, "attendanceTime1", "01:30");
    await userEvent.click(save(el));
    expect(sent).toEqual([]);
    expect((field(el, "attendanceTime1") as unknown as { error: string }).error).toContain("after");
    expect((field(el, "attendanceReason") as unknown as { error: string }).error).toContain(
      "reason",
    );
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      "Correct the highlighted fields to continue.",
    );
    expect(save(el).hasAttribute("disabled")).toBe(true);
    await fill(el, "attendanceDate1", "2026-10-14");
    await fill(el, "attendanceReason", "Forgot to clock");
    expect(save(el).hasAttribute("disabled")).toBe(false);
  });

  it("repeated-hour choices show both offsets and require the worker to choose the instant", async () => {
    const { el } = await mount({ initialChanges: [missing[0]!] });
    const sent = watch(el);
    await fill(el, "attendanceDate0", "2026-10-25");
    await fill(el, "attendanceTime0", "02:30");
    await fill(el, "attendanceReason", "Started at the second 02:30");
    await userEvent.click(save(el));
    expect(sent).toEqual([]);
    const chooser = field(el, "attendanceOffset0") as HTMLElement & {
      options: { value: string; label: string }[];
      error: string;
    };
    expect(chooser.options.map((o) => o.label)).toEqual(["02:30 +02:00", "02:30 +01:00"]);
    expect(chooser.error).toContain("Choose");
    await userEvent.click(chooser.shadowRoot!.querySelector<HTMLElement>("button.trigger")!);
    await userEvent.click(
      [...chooser.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find((option) =>
        option.textContent!.includes("+01:00"),
      )!,
    );
    await el.updateComplete;
    await userEvent.click(save(el));
    expect(sent.map((e) => e.detail)).toEqual([
      {
        changes: [
          { target: { missingKind: "in" }, at: "2026-10-25T01:30:00.000Z", offsetMinutes: 60 },
        ],
        reason: "Started at the second 02:30",
      },
    ]);
  });

  it("reopens a repeated original with its saved offset selected and offers the other occurrence", async () => {
    const { el } = await mount({
      initialChanges: [{ ...original, at: "2026-10-25T00:30:00.000Z" }],
    });
    const chooser = field(el, "attendanceOffset0") as HTMLElement & {
      value: string;
      options: { value: string; label: string }[];
    };
    expect(chooser).not.toBeNull();
    expect(chooser.value).toBe("120");
    expect(chooser.options.map((o) => o.label)).toEqual(["02:30 +02:00", "02:30 +01:00"]);
    const sent = watch(el);
    await userEvent.click(chooser.shadowRoot!.querySelector<HTMLElement>("button.trigger")!);
    await userEvent.click(
      [...chooser.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find((option) =>
        option.textContent!.includes("+01:00"),
      )!,
    );
    await fill(el, "attendanceReason", "The second 02:30");
    await userEvent.click(save(el));
    expect(sent.map((e) => e.detail.changes)).toEqual([
      [{ ...original, at: "2026-10-25T01:30:00.000Z", offsetMinutes: 60 }],
    ]);
  });

  it("reverting a repeated stored minute restores its original offset and quiet Save", async () => {
    const { el } = await mount({
      initialChanges: [{ ...original, at: "2026-10-25T00:30:00.000Z" }],
    });
    await fill(el, "attendanceTime0", "03:00");
    expect(save(el).getAttribute("variant")).toBe("primary");
    await fill(el, "attendanceTime0", "02:30");
    expect((field(el, "attendanceOffset0") as unknown as { value: string }).value).toBe("120");
    expect(save(el).getAttribute("variant")).toBe("secondary");
    expect(save(el).hasAttribute("disabled")).toBe(true);
  });

  it("a skipped spring minute is refused without rolling it forward", async () => {
    const { el } = await mount({ initialChanges: [missing[0]!] });
    const sent = watch(el);
    await fill(el, "attendanceDate0", "2026-03-29");
    await fill(el, "attendanceTime0", "02:30");
    await fill(el, "attendanceReason", "Forgot");
    await userEvent.click(save(el));
    expect(sent).toEqual([]);
    expect((field(el, "attendanceTime0") as unknown as { error: string }).error).toContain(
      "does not exist",
    );
    await fill(el, "attendanceTime0", "03:30");
    await userEvent.click(save(el));
    expect(sent.map((e) => e.detail.changes)).toEqual([
      [{ target: { missingKind: "in" }, at: "2026-03-29T01:30:00.000Z", offsetMinutes: 120 }],
    ]);
  });

  it("a write refusal retains the exact draft and permits retry; parent snapshots do not overwrite it", async () => {
    const { el } = await mount();
    await fill(el, "attendanceTime0", "02:15");
    await fill(el, "attendanceReason", "Late close");
    el.error = "The record changed. Read it again.";
    el.initialChanges = [{ ...original, at: "2026-10-13T22:00:00.000Z" }];
    await el.updateComplete;
    expect((field(el, "attendanceTime0") as unknown as { value: string }).value).toBe("02:15");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      "The record changed. Read it again.",
    );
    expect(save(el).hasAttribute("disabled")).toBe(false);
    const sent = watch(el);
    await userEvent.click(save(el));
    expect(sent.map((e) => e.detail)).toEqual([
      { changes: [{ ...original, at: "2026-10-14T00:15:00.000Z" }], reason: "Late close" },
    ]);
  });

  it("busy and detached controls cannot send, and closing then reopening clears prior drafts and errors", async () => {
    const { el, host } = await mount();
    const sent = watch(el);
    await fill(el, "attendanceReason", "Late close");
    el.busy = true;
    await el.updateComplete;
    expect(save(el).hasAttribute("disabled")).toBe(true);
    el.busy = false;
    await el.updateComplete;
    const oldSave = save(el);
    el.remove();
    oldSave.click();
    expect(sent).toEqual([]);
    host.appendChild(el);
    el.busy = false;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    el.initialChanges = [missing[0]!];
    await el.updateComplete;
    expect((field(el, "attendanceReason") as unknown as { value: string }).value).toBe("");
    expect((field(el, "attendanceDate0") as unknown as { value: string }).value).toBe("");
    expect(save(el).hasAttribute("disabled")).toBe(true);
  });

  it("keeps the HTTP reason limit and allows the exact 500-character boundary", async () => {
    const { el } = await mount();
    const sent = watch(el);
    await fill(el, "attendanceReason", "x".repeat(501));
    await userEvent.click(save(el));
    expect(sent).toEqual([]);
    expect((field(el, "attendanceReason") as unknown as { error: string }).error).toContain("500");
    await fill(el, "attendanceReason", "x".repeat(500));
    await userEvent.click(save(el));
    expect(sent.map((e) => e.detail.reason)).toEqual(["x".repeat(500)]);
  });

  it("labels Save and required native fields, and reverting a draft makes Save quiet again", async () => {
    const { el } = await mount();
    expect(save(el).textContent!.trim()).toBe("Save");
    for (const name of ["attendanceDate0", "attendanceTime0", "attendanceReason"]) {
      expect(field(el, name).hasAttribute("required")).toBe(true);
      const native = field(el, name).shadowRoot!.querySelector("input,textarea")!;
      expect(native.getAttribute("name")).toBe(name);
    }
    await fill(el, "attendanceReason", "Changed");
    expect(save(el).getAttribute("variant")).toBe("primary");
    await fill(el, "attendanceReason", "");
    expect(save(el).getAttribute("variant")).toBe("secondary");
    expect(save(el).hasAttribute("disabled")).toBe(true);
  });

  it("a refusal naming the reason marks that field without disabling retry and clears when it changes", async () => {
    const { el } = await mount();
    await fill(el, "attendanceReason", "Closed late");
    el.reasonRefusal = "Check the reason for the change.";
    el.error = "The request was refused";
    await el.updateComplete;
    expect((field(el, "attendanceReason") as unknown as { error: string }).error).toBe(
      "Check the reason for the change.",
    );
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      "Correct the highlighted fields to continue.",
    );
    expect(save(el).hasAttribute("disabled")).toBe(false);
    await fill(el, "attendanceReason", "Closed after the delivery");
    expect((field(el, "attendanceReason") as unknown as { error: string }).error).toBe("");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  });

  it("a reason-only disagreement requires text and emits no invented time changes", async () => {
    const { el } = await mount({ reasonOnly: true, initialChanges: [] });
    const sent = watch(el);
    expect(el.shadowRoot!.querySelector("[name=attendanceDate0]")).toBeNull();
    await fill(el, "attendanceReason", "I finished at the original time");
    await userEvent.click(save(el));
    expect(sent.map((e) => e.detail)).toEqual([
      { changes: [], reason: "I finished at the original time" },
    ]);
  });
});

it("uses the selected day view's zone when constructing a missing-time proposal", async () => {
  const view = {
    personId: "worker",
    locationId: "shop",
    date: "2026-10-14",
    timeZone: "America/New_York",
    revision: "rev",
    items: [],
    record: { sessions: [], entries: [], closures: [], closedPeriodImpacts: [] },
  };
  const { el } = await mount({ initialChanges: [missing[0]!], ...{ view } });
  const sent = watch(el);
  await fill(el, "attendanceDate0", "2026-10-14");
  await fill(el, "attendanceTime0", "09:00");
  await fill(el, "attendanceReason", "Missed clock-in");
  await userEvent.click(save(el));
  expect(sent.map((event) => event.detail.changes)).toEqual([
    [{ target: { missingKind: "in" }, at: "2026-10-14T13:00:00.000Z", offsetMinutes: -240 }],
  ]);
});

it("busy, blocked and departed recovery controls cannot edit, save, close or retry", async () => {
  const { el } = await mount({ recovery: "retry" });
  await fill(el, "attendanceReason", "Keep this reason");
  const retries: string[] = [];
  for (const type of ["retry-attendance", "retry-attendance-command"])
    el.addEventListener(type, () => retries.push(type));
  const read = el.shadowRoot!.querySelector<HTMLElement>("[data-retry-read]")!;
  const command = el.shadowRoot!.querySelector<HTMLElement>("[data-retry-command]")!;
  const cancel = el.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!;
  el.busy = true;
  await el.updateComplete;
  read.click();
  command.click();
  cancel.click();
  field(el, "attendanceReason").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Wrong" } }),
  );
  await el.updateComplete;
  expect((field(el, "attendanceReason") as HTMLElement & { value: string }).value).toBe(
    "Keep this reason",
  );
  expect(el.open).toBe(true);
  expect(retries).toEqual([]);
  el.busy = false;
  el.blocked = true;
  await el.updateComplete;
  field(el, "attendanceReason").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Wrong again" } }),
  );
  await el.updateComplete;
  expect((field(el, "attendanceReason") as HTMLElement & { value: string }).value).toBe(
    "Keep this reason",
  );
  read.click();
  command.click();
  expect(retries).toEqual(["retry-attendance", "retry-attendance-command"]);
  el.remove();
  read.click();
  command.click();
  cancel.click();
  expect(retries).toHaveLength(2);
});

it("an unchanged disabled host click leaves a pristine form unsubmitted", async () => {
  const { el } = await mount();
  const sent = watch(el);
  save(el).click();
  await el.updateComplete;
  expect(sent).toEqual([]);
  expect((field(el, "attendanceReason") as HTMLElement & { error: string }).error).toBe("");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
});
