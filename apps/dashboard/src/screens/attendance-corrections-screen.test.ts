import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createRequest, LiveData } from "@waitron/dashboard-kit";
import type {
  AttendanceCommand,
  AttendanceDayView,
  AttendanceLookups,
  CorrectionItem,
} from "@waitron/dashboard-modules";
import type { LitElement } from "lit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./attendance-corrections-screen.js";

const item: CorrectionItem = {
  id: "request-1",
  requestEntryIds: ["request-1"],
  personId: "worker",
  locationId: "shop",
  direction: "worker_request",
  status: "waiting-manager",
  readyToApply: true,
  responseEntryIds: [],
  changes: [{ target: { entryId: "out-1" }, at: "2026-10-14T16:30:00.000Z", offsetMinutes: 120 }],
  reason: "Closed the shop late",
  requestedByPersonId: "worker",
  selfApproved: false,
  history: [
    {
      entryId: "request-1",
      personId: "worker",
      locationId: "shop",
      nodeId: "node",
      entryKind: "correction",
      eventAt: "2026-10-14T16:30:00.000Z",
      recordedAt: "2026-10-15T04:00:00.000Z",
      offsetMinutes: 120,
      sequenceNo: 3,
      recordedByPersonId: "worker",
      correctionReason: "Closed the shop late",
      correctsEntryId: "out-1",
      correctionStatus: "requested",
      extension: {
        authorKind: "worker",
        direction: "worker_request",
        missingEntryKind: null,
        respondsToEntryId: null,
        payPeriodClosureId: null,
      },
    },
  ],
};
const day: AttendanceDayView = {
  personId: "worker",
  locationId: "shop",
  date: "2026-10-14",
  timeZone: "Europe/Madrid",
  revision: "revision-1",
  items: [item],
  record: {
    sessions: [],
    closures: [],
    closedPeriodImpacts: [],
    entries: [
      {
        entry: {
          entryId: "out-1",
          personId: "worker",
          locationId: "shop",
          nodeId: "node",
          entryKind: "out",
          eventAt: "2026-10-14T16:00:00.000Z",
          recordedAt: "2026-10-14T16:00:00.000Z",
          offsetMinutes: 120,
          sequenceNo: 2,
          recordedByPersonId: null,
          extension: {
            authorKind: "automatic",
            direction: null,
            missingEntryKind: null,
            respondsToEntryId: null,
            payPeriodClosureId: null,
          },
        },
        author: { kind: "automatic", personId: null },
        effective: true,
        confirmed: true,
        confirmedByWorker: false,
        selfApproved: false,
        corrected: false,
        disputed: false,
        closedPeriodIds: [],
      },
    ],
  },
};
const lookups: AttendanceLookups = {
  viewer: { personId: "manager", canSelfApprove: false },
  locations: [
    { id: "shop", name: "Deli", timeZone: "Europe/Madrid" },
    { id: "bar", name: "Bar", timeZone: "Europe/Madrid" },
  ],
  people: [
    { personId: "worker", displayName: "Ana Worker" },
    { personId: "manager", displayName: "Morgan Manager" },
  ],
};
type Screen = LitElement & { request: ReturnType<typeof createRequest>; liveData?: LiveData };
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function mount(
  options: {
    own?: boolean;
    admin?: boolean;
    empty?: boolean;
    live?: boolean;
    lookupFailure?: boolean;
  } = {},
) {
  const data = {
    lookups: structuredClone(lookups),
    day: structuredClone(day),
    items: options.empty ? [] : structuredClone([item]),
  };
  if (options.empty)
    data.day = { ...data.day, items: [], record: { ...data.day.record, entries: [] } };
  if (options.own) data.lookups.viewer.personId = "worker";
  if (options.admin) data.lookups.viewer.canSelfApprove = true;
  const commands: AttendanceCommand[] = [];
  const reads: { path: string; passive: string | null }[] = [];
  let lookupFailure = options.lookupFailure ?? false;
  let failRead = false;
  let failWrite: string | null = null;
  let receipt: unknown = null;
  let receiptFails = false;
  let heldPost: Promise<unknown> | null = null;
  let refusalField: string | undefined;
  let held: { path: string; promise: Promise<unknown> } | null = null;
  const request = createRequest({
    fetchImpl: async (path, init) => {
      if (init.method === "POST") {
        const command = JSON.parse(init.body as string) as AttendanceCommand;
        commands.push(command);
        if (heldPost) return Response.json(await heldPost);
        if (failWrite === "lost") throw new Error("response lost");
        if (failWrite === "invalid-json") return new Response("{broken", { status: 200 });
        if (failWrite === "after-commit-error")
          return Response.json({ error: { code: "server.internal" } }, { status: 500 });
        if (failWrite)
          return Response.json(
            {
              error: {
                code: failWrite,
                params: refusalField ? { field: refusalField } : undefined,
              },
            },
            { status: 409 },
          );
        data.items = data.items.map((row) =>
          row.id === ("itemId" in command ? command.itemId : "")
            ? {
                ...row,
                status:
                  command.action === "decline" ? ("declined" as const) : ("approved" as const),
              }
            : row,
        );
        data.day = { ...data.day, revision: "revision-2", items: data.items };
        return Response.json({
          commandId: command.commandId,
          entryIds: ["approved-1"],
          replayed: false,
        });
      }
      reads.push({ path, passive: new Headers(init.headers).get("x-waitron-live") });
      if (held && path.includes(held.path)) return Response.json(await held.promise);
      if (path.includes("/commands/")) {
        if (receiptFails) throw new Error("offline");
        return Response.json(receipt);
      }
      if (failRead && !path.endsWith("lookups")) throw new Error("offline");
      if (path.endsWith("lookups")) {
        if (lookupFailure) throw new Error("lookup offline");
        return Response.json(data.lookups);
      }
      if (path.includes("/queue?"))
        return Response.json({
          locationId: new URL(path, location.origin).searchParams.get("locationId"),
          items: data.items.filter((row) =>
            ["waiting-manager", "waiting-worker", "disputed"].includes(row.status),
          ),
        });
      if (path.includes("/day?")) {
        const args = new URL(path, location.origin).searchParams;
        return Response.json({
          ...data.day,
          personId: args.get("personId"),
          locationId: args.get("locationId"),
          date: args.get("date"),
          ...(args.get("personId") === "manager"
            ? { items: [], record: { ...data.day.record, entries: [] } }
            : {}),
        });
      }
      throw new Error(`Unexpected ${path}`);
    },
  });
  const liveData = options.live ? new LiveData() : undefined;
  const mounted = await mountWidget<Screen>("dashboard-attendance-corrections-screen", {
    request,
    liveData,
  });
  expect(
    mounted.el.shadowRoot,
    "the correction screen must render the manager queue",
  ).not.toBeNull();
  const root = mounted.el.shadowRoot!;
  if (lookupFailure)
    await expect.poll(() => root.querySelector("[data-read-error]")).not.toBeNull();
  else
    await expect
      .poll(
        () =>
          (root.querySelector("[name=attendancePerson]") as HTMLElement & { options: unknown[] })
            .options.length,
      )
      .toBe(2);
  return {
    ...mounted,
    root,
    data,
    commands,
    reads,
    liveData,
    failReads: () => {
      failRead = true;
    },
    allowReads: () => {
      failRead = false;
      lookupFailure = false;
    },
    refuse: (code: string | null, field?: string) => {
      failWrite = code;
      refusalField = field;
    },
    receipt: (value: unknown, fails = false) => {
      receipt = value;
      receiptFails = fails;
    },
    holdPost: (promise: Promise<unknown>) => {
      heldPost = promise;
    },
    hold: (path: string, promise: Promise<unknown>) => {
      held = { path, promise };
    },
  };
}
async function click(root: ParentNode, selector: string) {
  const button = root.querySelector<HTMLElement>(selector);
  expect(button, selector).not.toBeNull();
  await userEvent.click(button!);
}
async function change(root: ParentNode, name: string, value: string) {
  const field = root.querySelector<HTMLElement>(`[name=${name}]`)!;
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await (field.getRootNode() as ShadowRoot & { host: LitElement }).host.updateComplete;
}
async function details(root: ParentNode) {
  await expect.poll(() => root.querySelector("[data-detail]")).not.toBeNull();
  await click(root, "[data-detail]");
  await expect.poll(() => root.querySelector("[data-day]")?.textContent).toContain("2026-10-14");
}

describe("dashboard attendance corrections", () => {
  it("shows manager, worker and disputed groups with named workers and passively read history", async () => {
    const m = await mount();
    expect(m.root.textContent).toContain("Waiting for a manager");
    expect(m.root.textContent).toContain("Waiting for the worker");
    expect(m.root.textContent).toContain("Disputed");
    await details(m.root);
    expect(m.root.textContent).toContain("2026-10-14 18:00 +02:00");
    expect(m.root.textContent).toContain("2026-10-14 18:30 +02:00");
    expect(m.root.textContent).toContain("Closed the shop late");
    expect(m.root.textContent).toContain("already counts");
    expect(m.reads.every((read) => read.passive === "1")).toBe(true);
  });
  it.each(["approve", "decline"])(
    "%s submits the exact bundle with its day revision and refreshes without a feed",
    async (action) => {
      const m = await mount();
      await details(m.root);
      await click(m.root, `[data-${action}]`);
      await expect.poll(() => m.commands.length).toBe(1);
      expect(m.commands[0]).toEqual({
        action,
        itemId: "request-1",
        expectedRevision: "revision-1",
        commandId: expect.any(String),
      });
      await expect
        .poll(() => m.root.textContent)
        .toContain(action === "approve" ? "Approved" : "Declined");
      expect(m.reads.filter((read) => read.path.includes("/queue?")).length).toBeGreaterThan(1);
    },
  );
  it("an admin can self-approve, a non-admin cannot, and nobody can self-decline", async () => {
    const m = await mount({ own: true });
    await details(m.root);
    expect(m.root.querySelector("[data-approve]")).toBeNull();
    expect(m.root.querySelector("[data-decline]")).toBeNull();
    m.host.remove();
    const admin = await mount({ own: true, admin: true });
    await details(admin.root);
    expect(admin.root.querySelector("[data-decline]")).toBeNull();
    await click(admin.root, "[data-approve]");
    await expect.poll(() => admin.commands.length).toBe(1);
  });
  it("can propose on a chosen empty day, and closes the saved editor before a failed refresh", async () => {
    const m = await mount({ empty: true });
    await change(m.root, "attendancePerson", "worker");
    await change(m.root, "attendanceDay", "2026-10-14");
    await click(m.root, "[data-open-day]");
    await expect.poll(() => m.root.querySelector("[data-day]")).not.toBeNull();
    await click(m.root, "[data-add-shift]");
    const dialog = m.root.querySelector<LitElement & { open: boolean }>(
      "dashboard-attendance-proposal-dialog",
    )!;
    await dialog.updateComplete;
    const event = {
      changes: [
        { target: { missingKind: "in" }, at: "2026-10-14T06:00:00.000Z", offsetMinutes: 120 },
        { target: { missingKind: "out" }, at: "2026-10-14T14:00:00.000Z", offsetMinutes: 120 },
      ],
      reason: "Forgot the whole shift",
    };
    m.failReads();
    dialog.dispatchEvent(
      new CustomEvent("proposal-save", { detail: event, bubbles: true, composed: true }),
    );
    await expect.poll(() => m.commands.length).toBe(1);
    await expect.poll(() => dialog.open).toBe(false);
    expect(m.commands[0]).toEqual({
      ...event,
      action: "propose",
      personId: "worker",
      locationId: "shop",
      expectedRevision: "revision-1",
      commandId: expect.any(String),
    });
    await expect
      .poll(() => m.root.querySelector("[data-read-error]")?.textContent)
      .toContain("connect");
  });
  it("a manager's own day explains the till correction path instead of offering self-proposals", async () => {
    const m = await mount({ own: true });
    await details(m.root);
    expect(m.root.querySelector("[data-add-shift]")).toBeNull();
    expect(m.root.textContent).toContain("Fix my hours");
  });
  it("a refusal survives a later successful passive read", async () => {
    const m = await mount({ live: true });
    await details(m.root);
    m.refuse("attendance.state_changed");
    await click(m.root, "[data-approve]");
    await expect.poll(() => m.root.querySelector("[data-action-error]")?.textContent).toBeTruthy();
    const message = m.root.querySelector("[data-action-error]")!.textContent;
    m.liveData!.invalidate([{ type: "time_entries" }]);
    await expect
      .poll(() => m.reads.filter((r) => r.path.includes("/queue?")).length)
      .toBeGreaterThan(1);
    expect(m.root.querySelector("[data-action-error]")!.textContent).toBe(message);
  });
  it("a lost POST checks its command receipt before any retry and never sends automatically", async () => {
    const m = await mount();
    await details(m.root);
    m.refuse("lost");
    m.receipt(null, true);
    await click(m.root, "[data-approve]");
    await expect.poll(() => m.root.querySelector("[data-retry-read]")).not.toBeNull();
    expect(m.commands).toHaveLength(1);
    m.receipt({ commandId: m.commands[0]!.commandId, entryIds: ["approval"], replayed: true });
    await click(m.root, "[data-retry-read]");
    await expect.poll(() => m.root.querySelector("[data-retry-read]")).toBeNull();
    expect(m.commands).toHaveLength(1);
    expect(m.reads.some((r) => r.path.endsWith(`/commands/${m.commands[0]!.commandId}`))).toBe(
      true,
    );
  });
  it("late day reads for an abandoned selection cannot replace the selected day", async () => {
    const m = await mount();
    const late = deferred<AttendanceDayView>();
    m.hold("personId=worker", late.promise);
    await change(m.root, "attendancePerson", "worker");
    await change(m.root, "attendanceDay", "2026-10-14");
    await click(m.root, "[data-open-day]");
    await change(m.root, "attendancePerson", "manager");
    await click(m.root, "[data-open-day]");
    await expect
      .poll(() => m.root.querySelector("[data-day]")?.textContent)
      .toContain("Morgan Manager");
    late.resolve(day);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await m.el.updateComplete;
    expect(m.root.querySelector("[data-day]")!.textContent).toContain("Morgan Manager");
    expect(m.root.querySelector("[data-day]")!.textContent).not.toContain("Ana Worker");
  });
  it("an overtaken live request loses its settlement controls and shows its history", async () => {
    const m = await mount({ live: true });
    await details(m.root);
    m.data.items[0] = { ...m.data.items[0]!, status: "overtaken", readyToApply: false };
    m.data.day = { ...m.data.day, items: m.data.items, revision: "overtaken" };
    m.liveData!.invalidate([{ type: "time_entries" }]);
    await expect.poll(() => m.root.querySelector("[data-approve]")).toBeNull();
    expect(m.root.textContent).toContain("replaced this request");
  });
});

it("a changed live day preserves an edited proposal, blocks its stale submission, and retains the new history", async () => {
  const m = await mount({ live: true });
  await details(m.root);
  await click(m.root, "[data-retime]");
  const dialog = m.root.querySelector<LitElement>("dashboard-attendance-proposal-dialog")!;
  await dialog.updateComplete;
  await change(dialog.shadowRoot!, "attendanceReason", "Count the actual finish");
  m.data.day = {
    ...m.data.day,
    revision: "external-change",
    items: [{ ...item, status: "disputed" }],
  };
  m.liveData!.invalidate([{ type: "time_entries" }]);
  await expect.poll(() => m.root.querySelector("[data-day]")?.textContent).toContain("Disputed");
  await dialog.updateComplete;
  expect(
    (dialog.shadowRoot!.querySelector("[name=attendanceReason]") as HTMLElement & { value: string })
      .value,
  ).toBe("Count the actual finish");
  expect(
    (dialog.shadowRoot!.querySelector("[data-save]") as HTMLElement & { disabled: boolean })
      .disabled,
  ).toBe(true);
  dialog.dispatchEvent(
    new CustomEvent("proposal-save", {
      detail: { changes: item.changes, reason: "Count the actual finish" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(m.commands).toEqual([]);
});
it("a known absent receipt offers an explicit retry of only the original command", async () => {
  const m = await mount();
  await details(m.root);
  m.refuse("lost");
  m.receipt(null);
  await click(m.root, "[data-approve]");
  await expect.poll(() => m.root.querySelector("[data-retry-command]")).not.toBeNull();
  expect(m.commands).toHaveLength(1);
  await expect
    .poll(
      () =>
        m.root.querySelector<HTMLElement & { disabled: boolean }>("[data-retry-command]")?.disabled,
    )
    .toBe(false);
  const original = structuredClone(m.commands[0]);
  expect(
    (m.root.querySelector("[data-decline]") as HTMLElement & { disabled: boolean }).disabled,
  ).toBe(true);
  expect(
    (m.root.querySelector("[name=attendancePerson]") as HTMLElement & { disabled: boolean })
      .disabled,
  ).toBe(true);
  await click(m.root, "[data-decline]");
  expect(m.commands).toHaveLength(1);
  m.refuse(null);
  await click(m.root, "[data-retry-command]");
  await expect.poll(() => m.commands.length).toBe(2);
  expect(m.commands[1]).toEqual(original);
  await expect.poll(() => m.root.querySelector("[data-retry-command]")).toBeNull();
});
it("a receipt naming another command remains uncertain and never unlocks another write", async () => {
  const m = await mount();
  await details(m.root);
  m.refuse("lost");
  m.receipt({ commandId: "somebody-else", entryIds: ["wrong"], replayed: true });
  await click(m.root, "[data-approve]");
  await expect.poll(() => m.root.querySelector("[data-retry-read]")).not.toBeNull();
  expect(m.root.querySelector("[data-retry-command]")).toBeNull();
  await click(m.root, "[data-decline]");
  expect(m.commands).toHaveLength(1);
});
it("a late successful write from a disconnected screen cannot close the next opening or replace its state", async () => {
  const m = await mount();
  await details(m.root);
  const late = deferred<unknown>();
  m.holdPost(late.promise);
  await click(m.root, "[data-approve]");
  await expect.poll(() => m.commands.length).toBe(1);
  m.el.remove();
  await m.el.updateComplete;
  m.host.append(m.el);
  await m.el.updateComplete;
  await details(m.root);
  await click(m.root, "[data-retime]");
  const dialog = m.root.querySelector<LitElement & { open: boolean }>(
    "dashboard-attendance-proposal-dialog",
  )!;
  await dialog.updateComplete;
  await change(dialog.shadowRoot!, "attendanceReason", "New opening");
  const count = m.reads.length;
  late.resolve({ commandId: m.commands[0]!.commandId, entryIds: ["done"], replayed: false });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await m.el.updateComplete;
  expect(dialog.open).toBe(true);
  expect(
    (dialog.shadowRoot!.querySelector("[name=attendanceReason]") as HTMLElement & { value: string })
      .value,
  ).toBe("New opening");
  expect(m.reads).toHaveLength(count);
});
it("a refused proposal naming reason marks the field and retains the draft for a retry", async () => {
  const m = await mount();
  await details(m.root);
  await click(m.root, "[data-retime]");
  const dialog = m.root.querySelector<LitElement>("dashboard-attendance-proposal-dialog")!;
  await dialog.updateComplete;
  await change(dialog.shadowRoot!, "attendanceReason", "The real end");
  m.refuse("management.request_invalid", "reason");
  await click(dialog.shadowRoot!, "[data-save]");
  await expect
    .poll(
      () =>
        (
          dialog.shadowRoot!.querySelector("[name=attendanceReason]") as HTMLElement & {
            error: string;
          }
        ).error,
    )
    .toBe("Check the reason for the change.");
  expect(
    (dialog.shadowRoot!.querySelector("[data-save]") as HTMLElement & { disabled: boolean })
      .disabled,
  ).toBe(false);
  m.refuse(null);
  await click(dialog.shadowRoot!, "[data-save]");
  await expect.poll(() => (dialog as LitElement & { open: boolean }).open).toBe(false);
  expect(m.commands).toHaveLength(2);
});
it("a worker's dispute delivered by the live feed updates the mounted manager detail", async () => {
  const m = await mount({ live: true });
  m.data.items = [
    {
      ...item,
      direction: "manager_proposal",
      status: "waiting-worker",
      requestedByPersonId: "manager",
    },
  ];
  m.data.day = { ...m.data.day, items: m.data.items };
  m.liveData!.invalidate([{ type: "time_entries" }]);
  await expect
    .poll(() => m.reads.filter((r) => r.path.includes("/queue?")).length)
    .toBeGreaterThan(1);
  await details(m.root);
  expect(m.root.querySelector("[data-approve]")).toBeNull();
  expect(m.root.querySelector("[data-decline]")).toBeNull();
  m.data.items = [
    {
      ...m.data.items[0]!,
      status: "disputed",
      history: [
        ...item.history,
        {
          ...item.history[0]!,
          entryId: "worker-response",
          correctionStatus: "disputed",
          recordedAt: "2026-10-15T06:00:00Z",
          correctionReason: "I left at the original time",
          extension: { ...item.history[0]!.extension!, respondsToEntryId: "request-1" },
        },
      ],
    },
  ];
  m.data.day = { ...m.data.day, revision: "worker-response", items: m.data.items };
  m.liveData!.invalidate([{ type: "time_entries" }]);
  await expect
    .poll(() => m.root.querySelector("[data-day]")?.textContent)
    .toContain("I left at the original time");
  expect(m.root.querySelector("[data-day]")!.textContent).toContain("Recorded response");
  expect(m.root.textContent).toContain("Disputed");
});

it("names the recorded event kind and can propose one missing clock-out without inventing a clock-in", async () => {
  const m = await mount();
  await details(m.root);
  expect(m.root.querySelector("[data-entry-kind]")?.textContent).toBe("Clock out");
  await click(m.root, '[data-add-kind="out"]');
  const form = m.root.querySelector<LitElement>("dashboard-attendance-proposal-dialog")!;
  await form.updateComplete;
  expect(form.shadowRoot!.querySelectorAll("wt-input[type=date]")).toHaveLength(1);
  await change(form.shadowRoot!, "attendanceDate0", "2026-10-14");
  await change(form.shadowRoot!, "attendanceTime0", "20:30");
  await change(form.shadowRoot!, "attendanceReason", "Missed the finish");
  await click(form.shadowRoot!, "[data-save]");
  await expect.poll(() => m.commands.length).toBe(1);
  expect(m.commands[0]).toEqual({
    action: "propose",
    personId: "worker",
    locationId: "shop",
    expectedRevision: "revision-1",
    commandId: expect.any(String),
    changes: [
      { target: { missingKind: "out" }, at: "2026-10-14T18:30:00.000Z", offsetMinutes: 120 },
    ],
    reason: "Missed the finish",
  });
});

it("a POST that never answers reaches receipt recovery at the deadline and late success cannot create a new command", async () => {
  const m = await mount();
  await details(m.root);
  const late = deferred<unknown>();
  m.holdPost(late.promise);
  vi.useFakeTimers();
  try {
    m.root.querySelector<HTMLElement>("[data-approve]")!.click();
    await vi.advanceTimersByTimeAsync(25_000);
  } finally {
    vi.useRealTimers();
  }
  await expect.poll(() => m.root.querySelector("[data-retry-command]")).not.toBeNull();
  expect(m.commands).toHaveLength(1);
  expect(m.reads.some((read) => read.path.endsWith(`/commands/${m.commands[0]!.commandId}`))).toBe(
    true,
  );
  late.resolve({ commandId: m.commands[0]!.commandId, entryIds: ["late"], replayed: false });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await m.el.updateComplete;
  expect(m.commands).toHaveLength(1);
  expect(m.root.querySelector("[data-retry-command]")).not.toBeNull();
});

it("a failed lookup can be retried and does not keep announcing a load while showing its refusal", async () => {
  const m = await mount({ lookupFailure: true });
  expect(m.root.textContent).not.toContain("Reading attendance");
  m.allowReads();
  await click(m.root, "[data-retry-read]");
  await expect.poll(() => m.root.textContent).toContain("Ana Worker");
  expect(m.root.querySelector("[data-read-error]")).toBeNull();
});

it.each([
  [
    "attendance.state_changed",
    "The attendance record changed. Read its latest history before responding.",
  ],
  [
    "correction.not_pending",
    "This request has changed. Read its latest history before responding.",
  ],
  ["correction.not_permitted", "You cannot authorise this change. Ask another eligible manager."],
  [
    "correction.invalid",
    "These times cannot be applied to the current attendance record. Check the day and times.",
  ],
])("explains the refused %s action without losing the selected history", async (code, message) => {
  const m = await mount();
  await details(m.root);
  m.refuse(code);
  await click(m.root, "[data-approve]");
  await expect.poll(() => m.root.querySelector("[data-action-error]")?.textContent).toBe(message);
  expect(m.root.querySelector("[data-day]")!.textContent).toContain("Closed the shop late");
});

it("changing location replaces its queue and removes the prior day before another read", async () => {
  const m = await mount();
  await details(m.root);
  await change(m.root, "attendanceLocation", "bar");
  await expect
    .poll(() => m.reads.some((read) => read.path.includes("queue?locationId=bar")))
    .toBe(true);
  expect(m.root.querySelector("[data-day]")).toBeNull();
});
it("a pending day's late answer stays hidden when the selection changes without opening another day", async () => {
  const m = await mount();
  const late = deferred<AttendanceDayView>();
  m.hold("personId=worker", late.promise);
  await change(m.root, "attendanceDay", "2026-10-14");
  await click(m.root, "[data-open-day]");
  await change(m.root, "attendanceDay", "2026-10-15");
  late.resolve(day);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await m.el.updateComplete;
  expect(m.root.querySelector("[data-day]")).toBeNull();
});
it("a missing selected location blocks an edited proposal without overwriting its draft", async () => {
  const m = await mount({ live: true });
  await details(m.root);
  await click(m.root, "[data-retime]");
  const form = m.root.querySelector<LitElement>("dashboard-attendance-proposal-dialog")!;
  await form.updateComplete;
  await change(form.shadowRoot!, "attendanceReason", "Preserve my draft");
  m.data.lookups.locations = [];
  m.data.lookups.people = [];
  m.liveData!.invalidate([{ type: "locations" }]);
  await expect
    .poll(
      () =>
        (m.root.querySelector("[name=attendanceLocation]") as HTMLElement & { options: unknown[] })
          .options.length,
    )
    .toBe(0);
  await form.updateComplete;
  expect(
    (form.shadowRoot!.querySelector("[name=attendanceReason]") as HTMLElement & { value: string })
      .value,
  ).toBe("Preserve my draft");
  expect(
    (form.shadowRoot!.querySelector("[data-save]") as HTMLElement & { disabled: boolean }).disabled,
  ).toBe(true);
  form.dispatchEvent(
    new CustomEvent("proposal-save", {
      detail: { changes: item.changes, reason: "Preserve my draft" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(m.commands).toEqual([]);
});
it("a passive read's recovery clears its own failure and leaves a completed selected day", async () => {
  const m = await mount({ live: true });
  await details(m.root);
  m.failReads();
  m.liveData!.invalidate([{ type: "time_entries" }]);
  await expect.poll(() => m.root.querySelector("[data-read-error]")).not.toBeNull();
  m.allowReads();
  await click(m.root, "[data-retry-read]");
  await expect.poll(() => m.root.querySelector("[data-read-error]")).toBeNull();
  expect(m.root.querySelector("[data-day]")).not.toBeNull();
});
it("a day for the wrong person is refused without exposing its history", async () => {
  const m = await mount();
  m.hold("/day?", Promise.resolve({ ...day, personId: "foreign" }));
  await change(m.root, "attendanceDay", "2026-10-14");
  await click(m.root, "[data-open-day]");
  await expect.poll(() => m.root.querySelector("[data-read-error]")).not.toBeNull();
  expect(m.root.querySelector("[data-day]")).toBeNull();
});
it("a busy write rejects double clicks and departed controls cannot start another action", async () => {
  const m = await mount();
  await details(m.root);
  const late = deferred<unknown>();
  m.holdPost(late.promise);
  const approve = m.root.querySelector<HTMLElement>("[data-approve]")!;
  const decline = m.root.querySelector<HTMLElement>("[data-decline]")!;
  const detail = m.root.querySelector<HTMLElement>("[data-detail]")!;
  const retime = m.root.querySelector<HTMLElement>("[data-retime]")!;
  approve.click();
  approve.click();
  decline.click();
  detail.click();
  retime.click();
  await change(m.root, "attendancePerson", "manager");
  expect(m.commands).toHaveLength(1);
  expect(m.root.querySelector("[data-day]")!.textContent).toContain("Ana Worker");
  m.el.remove();
  approve.click();
  decline.click();
  detail.click();
  retime.click();
  expect(m.commands).toHaveLength(1);
  late.resolve({ commandId: m.commands[0]!.commandId, entryIds: ["one"], replayed: false });
});
it("shows recorded negative offsets, automatic authors, worker acknowledgment and stored self-approval", async () => {
  const m = await mount();
  const automatic = {
    ...day.record.entries[0]!,
    entry: {
      ...day.record.entries[0]!.entry,
      recordedByPersonId: null,
      offsetMinutes: -240,
      extension: {
        authorKind: "automatic" as const,
        direction: null,
        missingEntryKind: null,
        respondsToEntryId: null,
        payPeriodClosureId: null,
      },
    },
    confirmedByWorker: true,
    selfApproved: true,
  };
  m.data.day = {
    ...m.data.day,
    record: {
      ...m.data.day.record,
      entries: [
        automatic,
        {
          ...automatic,
          effective: false,
          author: { kind: "manager", personId: "retired-manager" },
          entry: {
            ...item.history[0]!,
            recordedByPersonId: "retired-manager",
            extension: {
              ...item.history[0]!.extension!,
              missingEntryKind: "out",
              selfApproved: true,
            },
          },
        },
      ],
    },
  };
  await details(m.root);
  const text = m.root.querySelector("[data-day]")!.textContent!;
  expect(text).toContain("2026-10-14 12:00 -04:00");
  expect(text).toContain("Automatic");
  expect(text).toContain("Confirmed by the worker");
  expect(text).toContain("Self-approved by an admin");
  expect(text).toContain("retired-manager");
});

it("a replaced automatic finish remains visible as history but is not described as still counting", async () => {
  const m = await mount();
  m.data.day = {
    ...m.data.day,
    record: { ...m.data.day.record, entries: [{ ...day.record.entries[0]!, effective: false }] },
  };
  await details(m.root);
  expect(m.root.querySelector("[data-day]")!.textContent).toContain("2026-10-14 18:00 +02:00");
  expect(m.root.querySelector("[data-day]")!.textContent).not.toContain("already counts");
});
it("the proposal's own recovery controls check a lost command before explicitly resending the same body", async () => {
  const m = await mount();
  await details(m.root);
  await click(m.root, "[data-retime]");
  const form = m.root.querySelector<LitElement & { open: boolean }>(
    "dashboard-attendance-proposal-dialog",
  )!;
  await form.updateComplete;
  await change(form.shadowRoot!, "attendanceReason", "Late close");
  m.refuse("lost");
  m.receipt(null, true);
  await click(form.shadowRoot!, "[data-save]");
  await expect.poll(() => form.shadowRoot!.querySelector("[data-retry-read]")).not.toBeNull();
  await expect
    .poll(
      () =>
        (form.shadowRoot!.querySelector("[data-retry-read]") as HTMLElement & { disabled: boolean })
          .disabled,
    )
    .toBe(false);
  m.receipt(null);
  await click(form.shadowRoot!, "[data-retry-read]");
  await expect.poll(() => form.shadowRoot!.querySelector("[data-retry-command]")).not.toBeNull();
  const original = structuredClone(m.commands[0]);
  m.refuse(null);
  await click(form.shadowRoot!, "[data-retry-command]");
  await expect.poll(() => form.open).toBe(false);
  expect(m.commands).toEqual([original, original]);
});

it("proposes an explicit missing break pair as one command", async () => {
  const m = await mount();
  await details(m.root);
  await click(m.root, "[data-add-break]");
  const form = m.root.querySelector<LitElement>("dashboard-attendance-proposal-dialog")!;
  await form.updateComplete;
  for (const [name, value] of [
    ["attendanceDate0", "2026-10-14"],
    ["attendanceTime0", "12:00"],
    ["attendanceDate1", "2026-10-14"],
    ["attendanceTime1", "12:30"],
    ["attendanceReason", "Forgot the break"],
  ])
    await change(form.shadowRoot!, name!, value!);
  await click(form.shadowRoot!, "[data-save]");
  await expect.poll(() => m.commands.length).toBe(1);
  expect(m.commands[0]).toEqual({
    action: "propose",
    personId: "worker",
    locationId: "shop",
    expectedRevision: "revision-1",
    commandId: expect.any(String),
    changes: [
      {
        target: { missingKind: "break_start" },
        at: "2026-10-14T10:00:00.000Z",
        offsetMinutes: 120,
      },
      { target: { missingKind: "break_end" }, at: "2026-10-14T10:30:00.000Z", offsetMinutes: 120 },
    ],
    reason: "Forgot the break",
  });
});
it("a failed newly selected queue can be reread before choosing a date, and passive lookup refresh keeps the current day", async () => {
  const m = await mount({ live: true });
  m.failReads();
  await change(m.root, "attendanceLocation", "bar");
  await expect.poll(() => m.root.querySelector("[data-read-error]")).not.toBeNull();
  m.allowReads();
  await click(m.root, "[data-retry-read]");
  await expect.poll(() => m.root.querySelector("[data-read-error]")).toBeNull();
  expect(m.commands).toEqual([]);
  await details(m.root);
  const view = m.root.querySelector("[data-day]")!.textContent;
  const count = m.reads.filter((read) => read.path.endsWith("lookups")).length;
  m.liveData!.invalidate([{ type: "persons" }]);
  await expect
    .poll(() => m.reads.filter((read) => read.path.endsWith("lookups")).length)
    .toBeGreaterThan(count);
  expect(m.root.querySelector("[data-day]")!.textContent).toBe(view);
});

it("a receipt read from a departed opening cannot close the new proposal", async () => {
  const m = await mount();
  await details(m.root);
  const late = deferred<unknown>();
  m.refuse("lost");
  m.hold("/commands/", late.promise);
  m.root.querySelector<HTMLElement>("[data-approve]")!.click();
  await expect.poll(() => m.reads.some((read) => read.path.includes("/commands/"))).toBe(true);
  m.el.remove();
  await m.el.updateComplete;
  m.host.append(m.el);
  await m.el.updateComplete;
  await details(m.root);
  await click(m.root, "[data-retime]");
  const form = m.root.querySelector<LitElement & { open: boolean }>(
    "dashboard-attendance-proposal-dialog",
  )!;
  await form.updateComplete;
  await change(form.shadowRoot!, "attendanceReason", "New proposal");
  late.resolve({ commandId: m.commands[0]!.commandId, entryIds: ["saved"], replayed: true });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await m.el.updateComplete;
  expect(form.open).toBe(true);
  expect(
    (form.shadowRoot!.querySelector("wt-textarea") as HTMLElement & { value: string }).value,
  ).toBe("New proposal");
});

it("a request that no longer fits the record explains the refusal, blocks an old Approve control and still allows decline", async () => {
  const m = await mount({ live: true });
  await details(m.root);
  const oldApprove = m.root.querySelector<HTMLElement>("[data-approve]")!;
  m.data.day = {
    ...m.data.day,
    revision: "incompatible",
    items: [{ ...item, readyToApply: false }],
  };
  m.liveData!.invalidate([{ type: "time_entries" }]);
  await expect.poll(() => m.root.querySelector("[data-approve]")).toBeNull();
  expect(m.root.querySelector("[data-day]")!.textContent).toContain(
    "These times cannot be applied",
  );
  oldApprove.click();
  expect(m.commands).toEqual([]);
  await click(m.root, "[data-decline]");
  await expect.poll(() => m.commands.length).toBe(1);
  expect(m.commands[0]!.action).toBe("decline");
});

it.each(["invalid-json", "after-commit-error"])(
  "an unreadable or failed successful write (%s) checks the receipt before allowing another command",
  async (failure) => {
    const m = await mount();
    await details(m.root);
    const receipt = deferred<unknown>();
    m.hold("/commands/", receipt.promise);
    m.refuse(failure);
    await click(m.root, "[data-approve]");
    await expect.poll(() => m.reads.some((read) => read.path.includes("/commands/"))).toBe(true);
    expect(m.commands).toHaveLength(1);
    receipt.resolve({
      commandId: m.commands[0]!.commandId,
      entryIds: ["recorded"],
      replayed: true,
    });
    await expect
      .poll(
        () =>
          (m.root.querySelector("[data-add-shift]") as HTMLElement & { disabled: boolean })
            .disabled,
      )
      .toBe(false);
    expect(m.root.querySelector("[data-action-error]")).toBeNull();
    expect(m.commands).toHaveLength(1);
  },
);

it("in Spanish an incompatible manager request directs review before the available Decline action", async () => {
  setLocale("es-ES");
  const m = await mount();
  m.data.day = { ...m.data.day, items: [{ ...item, readyToApply: false }] };
  await details(m.root);
  expect(m.root.querySelector("[data-approve]")).toBeNull();
  expect(m.root.querySelector("[data-decline]")!.textContent).toBe("Rechazar");
  expect(m.root.querySelector("[data-day]")!.textContent).toContain(
    "Revisa el historial antes de rechazar la solicitud.",
  );
});
