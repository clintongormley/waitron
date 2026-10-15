import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import type { AttendanceDayView, OwnAttendanceCommand } from "@waitron/dashboard-modules";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { hoursView, hoursWithPending } from "../../test/hours-fixtures.js";
import { attendanceInbox, attendancePrompt } from "../../test/attendance-fixtures.js";
import type { MyHoursPanel } from "./my-hours-panel.js";
const modules = import.meta.glob<typeof import("./my-hours-panel.js")>("./my-hours-panel.ts");
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const inbox = () => ({
  ...attendanceInbox(
    [attendancePrompt({ personId: "p1", locationId: "venue", businessDay: "2026-01-05" })],
    [],
  ),
  personId: "p1",
  revision: "inbox-current",
  locations: [
    { id: "venue", name: "Deli", timeZone: "Europe/Madrid" },
    { id: "old", name: "Old workplace", timeZone: "UTC" },
  ],
});
const day = (): AttendanceDayView => ({
  personId: "p1",
  locationId: "venue",
  date: "2026-01-05",
  timeZone: "Europe/Madrid",
  revision: "day-current",
  record: hoursView().record,
  items: [],
});
async function mount(
  options: {
    active?: boolean;
    live?: boolean;
    fetch?: (url: string, method: string, body: unknown) => Promise<unknown>;
  } = {},
) {
  const sent: OwnAttendanceCommand[] = [];
  const paths: string[] = [];
  const request: DashboardRequest = async <T>(url: string, method = "GET", body?: unknown) => {
    paths.push(url);
    if (method === "POST") sent.push(body as OwnAttendanceCommand);
    if (options.fetch) return (await options.fetch(url, method, body)) as T;
    return (
      url.endsWith("/inbox")
        ? inbox()
        : url.includes("/hours?")
          ? hoursView({ selection: { kind: "week" } })
          : url.includes("/day?")
            ? day()
            : {
                commandId: (body as OwnAttendanceCommand).commandId,
                entryIds: ["requested"],
                replayed: false,
              }
    ) as T;
  };
  const load = modules["./my-hours-panel.ts"];
  expect(load, "own hours panel").toBeTypeOf("function");
  await load!();
  setLocale("en-GB");
  const liveData = options.live ? new LiveData() : undefined;
  const result = await mountWidget<MyHoursPanel>("dashboard-my-hours-panel", {
    request,
    liveData,
    personId: "p1",
    active: options.active ?? true,
  });
  return { ...result, sent, paths, request, liveData };
}
async function ready(el: MyHoursPanel) {
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-hours-record")?.view).not.toBeNull(),
  );
}
async function click(el: MyHoursPanel, selector: string) {
  await userEvent.click(el.shadowRoot!.querySelector(selector)!);
  await el.updateComplete;
}
async function openDay(el: MyHoursPanel) {
  await ready(el);
  el.shadowRoot!.querySelector("dashboard-hours-record")!.dispatchEvent(
    new CustomEvent("hours-day", {
      detail: { date: "2026-01-05", locationId: "venue" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-day]")).not.toBeNull());
}
function save(el: MyHoursPanel) {
  el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!.dispatchEvent(
    new CustomEvent("proposal-save", {
      detail: {
        changes: [
          {
            target: { entryId: "automatic-out" },
            at: "2026-01-05T18:00:00.000Z",
            offsetMinutes: 60,
          },
        ],
        reason: "Finished stock count",
      },
      bubbles: true,
      composed: true,
    }),
  );
}
it("makes zero reads while inactive, starts lazily and releases private content on deactivation", async () => {
  const { el, paths } = await mount({ active: false });
  expect(paths).toEqual([]);
  el.active = true;
  await el.updateComplete;
  await ready(el);
  expect(paths.filter((p) => p.endsWith("/inbox"))).toHaveLength(1);
  el.active = false;
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).not.toContain("2026-01-05");
  el.active = true;
  await el.updateComplete;
  await ready(el);
  expect(paths.filter((p) => p.endsWith("/inbox"))).toHaveLength(2);
});
it("reads the current own day before fixing and sends a reasoned request without person or manager authority", async () => {
  const { el, sent, paths } = await mount();
  await openDay(el);
  await click(el, "[data-retime]");
  save(el);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(paths).toContain("/management-api/me/attendance/day?locationId=venue&date=2026-01-05");
  expect(sent[0]).toEqual({
    commandId: expect.any(String),
    expectedRevision: "day-current",
    action: "request",
    questionId: null,
    locationId: "venue",
    changes: [
      { target: { entryId: "automatic-out" }, at: "2026-01-05T18:00:00.000Z", offsetMinutes: 60 },
    ],
    reason: "Finished stock count",
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!.open).toBe(false),
  );
  expect(el.shadowRoot!.querySelector("[data-approve]")).toBeNull();
});
it("offers a blank missing shift through the reused worker request form", async () => {
  const { el } = await mount();
  await openDay(el);
  await click(el, "[data-add-shift]");
  const editor = el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!;
  expect(editor.purpose).toBe("request");
  expect(editor.initialChanges).toEqual([
    { target: { missingKind: "in" }, at: "", offsetMinutes: 0 },
    { target: { missingKind: "out" }, at: "", offsetMinutes: 0 },
  ]);
});
it("does not authorise a forged summary target and uses only the current inbox revision for confirmation", async () => {
  const { el, sent } = await mount();
  await ready(el);
  save(el);
  expect(sent).toEqual([]);
  await click(el, '[data-prompt-action="confirm"]');
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toMatchObject({
    action: "confirm",
    questionId: "question",
    expectedRevision: "inbox-current",
  });
});
it("retires a held old person's read and never publishes it in a new owner", async () => {
  const held = deferred<unknown>();
  const { el } = await mount({
    fetch: async (url) => (url.endsWith("/inbox") ? held.promise : hoursView()),
  });
  el.personId = "other";
  el.active = false;
  await el.updateComplete;
  held.resolve(inbox());
  await new Promise((r) => requestAnimationFrame(r));
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).not.toContain("Deli");
  expect(el.shadowRoot!.querySelector("dashboard-hours-record")).toBeNull();
});
it("rejects a mismatched private summary", async () => {
  const { el } = await mount({
    fetch: async (url) =>
      url.endsWith("/inbox")
        ? inbox()
        : hoursView({ personId: "other", selection: { kind: "week" } }),
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-read-error]")).not.toBeNull());
  expect(el.shadowRoot!.querySelector("dashboard-hours-record")?.view).toBeFalsy();
});
it("retains an action refusal and edited form when read refresh recovers", async () => {
  const { el, sent, liveData } = await mount({
    live: true,
    fetch: async (url, method) => {
      if (method === "POST") throw { status: 409, code: "correction.stale" };
      return url.endsWith("/inbox")
        ? inbox()
        : url.includes("/day?")
          ? day()
          : hoursView({ selection: { kind: "week" } });
    },
  });
  await openDay(el);
  await click(el, "[data-retime]");
  save(el);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-action-error]")).not.toBeNull(),
  );
  liveData!.invalidate([{ type: "time_entries" }]);
  await new Promise((r) => requestAnimationFrame(r));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!.open).toBe(true);
  expect(el.shadowRoot!.querySelector("[data-action-error]")).not.toBeNull();
});
it("recovers a lost POST by receipt, closes the editor before a failed refresh and keeps it a read error", async () => {
  let written = false;
  const { el, sent } = await mount({
    fetch: async (url, method) => {
      if (method === "POST") {
        written = true;
        throw { code: "connection.lost" };
      }
      if (url.includes("/commands/"))
        return { commandId: url.split("/").at(-1), entryIds: ["saved"], replayed: true };
      if (written) throw { code: "connection.lost" };
      return url.endsWith("/inbox")
        ? inbox()
        : url.includes("/day?")
          ? day()
          : hoursView({ selection: { kind: "week" } });
    },
  });
  await openDay(el);
  await click(el, "[data-retime]");
  save(el);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!.open).toBe(false),
  );
  expect(el.shadowRoot!.querySelector("[data-read-error]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-action-error]")).toBeNull();
});
it("keeps the exact UUID/payload/revision after a known absent receipt", async () => {
  let attempts = 0;
  const { el, sent } = await mount({
    fetch: async (url, method, body) => {
      if (method === "POST") {
        if (++attempts === 1) throw { code: "connection.lost" };
        return {
          commandId: (body as OwnAttendanceCommand).commandId,
          entryIds: ["saved"],
          replayed: false,
        };
      }
      return url.includes("/commands/")
        ? null
        : url.endsWith("/inbox")
          ? inbox()
          : url.includes("/day?")
            ? day()
            : hoursView({ selection: { kind: "week" } });
    },
  });
  await openDay(el);
  await click(el, "[data-retime]");
  save(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-retry-command]")).not.toBeNull(),
  );
  save(el);
  expect(sent).toHaveLength(1);
  await userEvent.click(
    el
      .shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!
      .shadowRoot!.querySelector("[data-retry-command]")!,
  );
  await vi.waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]).toEqual(sent[0]);
});
it("makes one passive summary read on first entry rather than fetching it twice", async () => {
  const { el, paths } = await mount();
  await ready(el);
  await new Promise((r) => requestAnimationFrame(r));
  expect(paths.filter((p) => p.includes("/hours?"))).toHaveLength(1);
});
it("month and historical-location selections retire a held older summary", async () => {
  const held = deferred<unknown>();
  const { el } = await mount({
    fetch: async (url) => {
      if (url.endsWith("/inbox")) return inbox();
      const params = new URL(url, location.origin).searchParams;
      if (params.get("kind") === "month" && params.get("locationId") === "venue")
        return held.promise;
      return hoursView({
        locationId: params.get("locationId")!,
        selection: { kind: params.get("kind") as "week" | "month" },
        workedMinutes: params.get("locationId") === "old" ? 123 : 480,
      });
    },
  });
  await ready(el);
  const change = async (name: string, value: string) => {
    el.shadowRoot!.querySelector(`[name="${name}"]`)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
  };
  await change("hoursWindow", "month");
  await change("hoursLocation", "old");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-hours-record")!.view?.workedMinutes).toBe(123),
  );
  held.resolve(hoursView({ selection: { kind: "month" }, workedMinutes: 999 }));
  await new Promise((r) => requestAnimationFrame(r));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-hours-record")!.view?.locationId).toBe("old");
  expect(el.shadowRoot!.querySelector("dashboard-hours-record")!.view?.workedMinutes).toBe(123);
});
it("uses only a current proposal for acceptance or reasoned disagreement", async () => {
  const current = inbox();
  const item = hoursWithPending().pending.items[0]!;
  item.direction = "manager_proposal";
  item.status = "waiting-worker";
  current.items = [item];
  current.prompts = [
    attendancePrompt({
      id: "current-proposal",
      personId: "p1",
      locationId: "venue",
      businessDay: "2026-01-05",
      kind: "proposal",
      questionId: null,
      itemId: item.id,
    }),
  ];
  const { el, sent } = await mount({
    fetch: async (url, method, body) =>
      method === "POST"
        ? {
            commandId: (body as OwnAttendanceCommand).commandId,
            entryIds: ["response"],
            replayed: false,
          }
        : url.endsWith("/inbox")
          ? current
          : url.includes("/day?")
            ? day()
            : hoursView({ selection: { kind: "week" } }),
  });
  await ready(el);
  await click(el, '[data-prompt-action="disagree"]');
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!.open).toBe(true),
  );
  expect(el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!.reasonOnly).toBe(
    true,
  );
  save(el);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toEqual({
    commandId: expect.any(String),
    expectedRevision: "inbox-current",
    action: "disagree",
    itemId: item.id,
    reason: "Finished stock count",
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!.open).toBe(false),
  );
  await click(el, '[data-prompt-action="accept"]');
  await vi.waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]).toMatchObject({
    action: "accept",
    itemId: item.id,
    expectedRevision: "inbox-current",
  });
});
it("owns one recovery read at a time while an unknown receipt is being checked", async () => {
  let lookups = 0;
  const held = deferred<unknown>();
  const { el } = await mount({
    fetch: async (url, method) => {
      if (method === "POST") throw { code: "connection.lost" };
      if (url.includes("/commands/")) {
        if (++lookups === 1) throw { code: "connection.lost" };
        return held.promise;
      }
      return url.endsWith("/inbox")
        ? inbox()
        : url.includes("/day?")
          ? day()
          : hoursView({ selection: { kind: "week" } });
    },
  });
  await openDay(el);
  await click(el, "[data-retime]");
  save(el);
  const editor = el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!;
  await vi.waitFor(() => expect(editor.recovery).toBe("uncertain"));
  await vi.waitFor(() => expect(editor.busy).toBe(false));
  await userEvent.click(editor.shadowRoot!.querySelector("[data-retry-read]")!);
  await vi.waitFor(() => expect(lookups).toBe(2));
  expect(editor.busy).toBe(true);
  held.resolve(null);
  await vi.waitFor(() => expect(editor.recovery).toBe("retry"));
});
it("moves by calendar weeks and months from the server's business date", async () => {
  const { el, paths } = await mount({
    fetch: async (url) => {
      if (url.endsWith("/inbox")) return inbox();
      const q = new URL(url, location.origin).searchParams;
      return hoursView({
        selection: {
          kind: q.get("kind") as "week" | "month",
          ...(q.has("date") ? { date: q.get("date")! } : {}),
        },
      });
    },
  });
  await ready(el);
  expect(el.shadowRoot!.querySelector("[data-next]")).not.toBeNull();
  await click(el, "[data-next]");
  await vi.waitFor(() =>
    expect(paths.some((p) => p.endsWith("kind=week&date=2026-01-13"))).toBe(true),
  );
  el.shadowRoot!.querySelector('[name="hoursWindow"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "month" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  await ready(el);
  await click(el, "[data-previous]");
  await vi.waitFor(() =>
    expect(paths.some((p) => p.endsWith("kind=month&date=2025-12-01"))).toBe(true),
  );
});
it("retires a failed day's load message when its location is left", async () => {
  const { el } = await mount({
    fetch: async (url) => {
      if (url.endsWith("/inbox")) return inbox();
      if (url.includes("/day?")) throw { code: "connection.lost" };
      const q = new URL(url, location.origin).searchParams;
      return hoursView({ locationId: q.get("locationId")!, selection: { kind: "week" } });
    },
  });
  await ready(el);
  el.shadowRoot!.querySelector("dashboard-hours-record")!.dispatchEvent(
    new CustomEvent("hours-day", {
      detail: { date: "2026-01-05", locationId: "venue" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-read-error]")).not.toBeNull());
  el.shadowRoot!.querySelector('[name="hoursLocation"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "old" }, bubbles: true, composed: true }),
  );
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-hours-record")!.view?.locationId).toBe("old"),
  );
  expect(el.shadowRoot!.querySelector("[data-read-error]")).toBeNull();
});
it("does not attach a refreshed inbox revision to a prompt removed while its day was loading", async () => {
  let current = inbox();
  const held = deferred<unknown>();
  const { el, liveData } = await mount({
    live: true,
    fetch: async (url) =>
      url.endsWith("/inbox")
        ? current
        : url.includes("/day?")
          ? held.promise
          : hoursView({ selection: { kind: "week" } }),
  });
  await ready(el);
  await click(el, '[data-prompt-action="edit"]');
  current = { ...inbox(), revision: "new-inbox", prompts: [] };
  liveData!.invalidate([{ type: "attendance_questions" }]);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-prompt-action="edit"]')).toBeNull(),
  );
  held.resolve(day());
  await new Promise((r) => requestAnimationFrame(r));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!.open).toBe(false);
});
it("a successful summary read does not clear an inbox read failure", async () => {
  let failInbox = false;
  const { el, liveData } = await mount({
    live: true,
    fetch: async (url) => {
      if (url.endsWith("/inbox")) {
        if (failInbox) throw { code: "connection.lost" };
        return inbox();
      }
      const q = new URL(url, location.origin).searchParams;
      return hoursView({
        selection: { kind: "week", ...(q.has("date") ? { date: q.get("date")! } : {}) },
      });
    },
  });
  await ready(el);
  failInbox = true;
  liveData!.invalidate([{ type: "attendance_questions" }]);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-read-error]")).not.toBeNull());
  el.shadowRoot!.querySelector('[name="hoursDate"]')!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "2026-01-07" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-hours-record")!.view?.selection.date).toBe(
      "2026-01-07",
    ),
  );
  expect(el.shadowRoot!.querySelector("[data-read-error]")).not.toBeNull();
});
