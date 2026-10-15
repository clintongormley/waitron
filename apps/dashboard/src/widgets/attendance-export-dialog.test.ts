import { afterEach, expect, it, vi } from "vitest";
import type { WtButton, WtCombobox, WtDialog, WtInput } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { AttendanceExportDialog } from "./attendance-export-dialog.js";
const modules = import.meta.glob<typeof import("./attendance-export-dialog.js")>(
  "./attendance-export-dialog.ts",
);
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture(
  props: Partial<AttendanceExportDialog> = {},
  file: () => Promise<Blob> = async () => new Blob(["record"]),
) {
  setLocale("en-GB");
  const load = modules["./attendance-export-dialog.ts"];
  expect(load, "export dialog exists").toBeTypeOf("function");
  await load!();
  const request = vi.fn(async (path: string) =>
    path.includes("export-options") ? { available: true, canExportAll: true } : file(),
  ) as unknown as DashboardRequest;
  const { el } = await mountWidget<AttendanceExportDialog>("dashboard-attendance-export-dialog", {
    request,
    open: true,
    scopeKey: "worker:1",
    mode: "own",
    locationId: "place",
    period: { start: "2026-01-01", end: "2026-02-01" },
    ...props,
  });
  await expect
    .poll(() => el.shadowRoot!.querySelector<WtButton>("[data-test=export-download]")?.disabled)
    .toBe(false);
  const created: Blob[] = [],
    clicked: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    created.push(blob as Blob);
    return `blob:record-${created.length}`;
  });
  const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this.download);
  });
  return { el, request: vi.mocked(request), created, clicked, revoked };
}
function field(el: AttendanceExportDialog, name: string) {
  return el.shadowRoot!.querySelector<WtInput | WtCombobox>(`[name=${name}]`)!;
}
async function change(el: AttendanceExportDialog, name: string, value: string) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function send(el: AttendanceExportDialog) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=export-download]")!.click();
  await el.updateComplete;
}

it("uses a detached range and own PDF defaults, sends no roster and revokes the exact downloaded URL", async () => {
  const { el, request, clicked, revoked } = await fixture();
  expect(field(el, "exportFrom").value).toBe("2026-01-01");
  expect(field(el, "exportBefore").value).toBe("2026-02-01");
  expect(field(el, "exportFormat").value).toBe("pdf");
  expect(field(el, "exportAudience").value).toBe("standard");
  expect(field(el, "exportPerson")).toBeNull();
  await change(el, "exportFrom", "2020-01-01");
  await send(el);
  await expect.poll(() => clicked).toEqual(["time-record-2020-01-01-2026-02-01-standard.pdf"]);
  expect(request.mock.calls[1]).toEqual([
    "/management-api/me/attendance/export?locationId=place&from=2020-01-01&before=2026-02-01&format=pdf&audience=standard&locale=en",
    "GET",
    undefined,
    { as: "blob" },
  ]);
  expect(revoked).toHaveBeenCalledExactlyOnceWith("blob:record-1");
});
it("offers manager Everyone or one person and representatives CSV", async () => {
  const { el, request, clicked } = await fixture({
    mode: "manager",
    people: [
      { personId: "one", displayName: "María" },
      { personId: "two", displayName: "José" },
    ],
    personId: "two",
  });
  expect(field(el, "exportPerson").value).toBe("two");
  await change(el, "exportPerson", "");
  await change(el, "exportAudience", "representatives");
  await change(el, "exportFormat", "csv");
  await send(el);
  await expect.poll(() => clicked).toHaveLength(1);
  expect(request.mock.calls[1]![0]).toBe(
    "/management-api/attendance/export?locationId=place&from=2026-01-01&before=2026-02-01&format=csv&audience=representatives&locale=en",
  );
  expect(clicked).toEqual(["time-record-2026-01-01-2026-02-01-representatives.csv"]);
});
it("marks every invalid field only after submission and focuses the first, then allows correction", async () => {
  const { el, clicked } = await fixture();
  await change(el, "exportFrom", "");
  await change(el, "exportBefore", "2026-02-30");
  expect(field(el, "exportFrom").error).toBe("");
  await send(el);
  await expect.poll(() => field(el, "exportFrom").error).not.toBe("");
  expect(field(el, "exportBefore").error).not.toBe("");
  expect(el.shadowRoot!.querySelector<WtButton>("[data-test=export-download]")!.disabled).toBe(
    true,
  );
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  await expect
    .poll(
      () =>
        el
          .shadowRoot!.querySelector<WtDialog>("wt-dialog")!
          .querySelector<WtInput>("[name=exportFrom]")!.shadowRoot!.activeElement?.tagName,
    )
    .toBe("INPUT");
  await change(el, "exportFrom", "2026-01-01");
  await change(el, "exportBefore", "2026-02-01");
  await send(el);
  await expect.poll(() => clicked).toHaveLength(1);
});
it.each(["2026-99-99", "2026-00-01", "2026-01-00"])(
  "explains the impossible date %s without breaking the form",
  async (date) => {
    const { el, clicked } = await fixture();
    await change(el, "exportFrom", date);
    await send(el);
    await expect.poll(() => field(el, "exportFrom").error).not.toBe("");
    expect(clicked).toEqual([]);
  },
);
it("keeps a refused action retryable and puts a named refusal beside the field", async () => {
  let attempts = 0;
  const { el, clicked } = await fixture({}, async () => {
    if (attempts++ === 0) throw { code: "management.request_invalid", params: { field: "from" } };
    return new Blob(["retry"]);
  });
  await send(el);
  await expect.poll(() => field(el, "exportFrom").error).not.toBe("");
  expect(el.shadowRoot!.querySelector<WtButton>("[data-test=export-download]")!.disabled).toBe(
    false,
  );
  await send(el);
  await expect.poll(() => clicked).toHaveLength(1);
});
it.each([
  "scopeKey",
  "request",
  "mode",
  "locationId",
  "period",
  "personId",
  "locale",
  "exportFrom",
  "exportBefore",
  "exportAudience",
  "exportFormat",
  "close",
  "disconnect",
])("suppresses an old download after %s changes", async (kind) => {
  const held = deferred<Blob>();
  const blob = new Blob(["old"]);
  const { el, created, clicked } = await fixture({}, () => held.promise);
  await send(el);
  if (kind === "scopeKey") el.scopeKey = "other:2";
  else if (kind === "request")
    el.request = vi.fn(async () => ({
      available: true,
      canExportAll: true,
    })) as unknown as DashboardRequest;
  else if (kind === "mode") el.mode = "manager";
  else if (kind === "locationId") el.locationId = "other-place";
  else if (kind === "period") el.period = { start: "2027-01-01", end: "2027-02-01" };
  else if (kind === "personId") el.personId = "other-person";
  else if (kind === "locale") setLocale("es-ES");
  else if (kind === "close") el.open = false;
  else if (kind === "disconnect") el.remove();
  else {
    field(el, kind).dispatchEvent(
      new CustomEvent("wt-change", {
        detail: {
          value: kind.includes("From")
            ? "2020-01-01"
            : kind.includes("Before")
              ? "2027-01-01"
              : kind.includes("Audience")
                ? "representatives"
                : "csv",
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
  await el.updateComplete;
  held.resolve(blob);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  expect(created).toEqual([]);
  expect(clicked).toEqual([]);
});
it.each(["success", "refusal"])(
  "reopened B downloads once while a late A %s cannot act or replace B's message",
  async (outcome) => {
    const a = deferred<Blob>(),
      b = new Blob(["B"]);
    let attempts = 0;
    const { el, created, clicked } = await fixture({}, () =>
      attempts++ === 0 ? a.promise : Promise.resolve(b),
    );
    await send(el);
    el.open = false;
    await el.updateComplete;
    el.scopeKey = "B:2";
    el.open = true;
    await el.updateComplete;
    await expect
      .poll(() => el.shadowRoot!.querySelector<WtButton>("[data-test=export-download]")!.disabled)
      .toBe(false);
    await send(el);
    await expect.poll(() => clicked).toHaveLength(1);
    if (outcome === "success") a.resolve(new Blob(["A"]));
    else a.reject({ code: "authorization.not_permitted" });
    await new Promise(requestAnimationFrame);
    await el.updateComplete;
    expect(created).toEqual([b]);
    expect(clicked).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  },
);

it("waits quietly for an options read and keeps manager export disabled without export permission", async () => {
  const load = modules["./attendance-export-dialog.ts"]!;
  await load();
  const options = deferred<{ available: boolean; canExportAll: boolean }>();
  const request = vi.fn(() => options.promise) as unknown as DashboardRequest;
  const { el } = await mountWidget<AttendanceExportDialog>("dashboard-attendance-export-dialog", {
    request,
    open: true,
    scopeKey: "viewer:1",
    mode: "manager",
    locationId: "place",
    period: { start: "2026-01-01", end: "2026-02-01" },
  });
  const button = () => el.shadowRoot!.querySelector<WtButton>("[data-test=export-download]")!;
  expect(button().variant).toBe("secondary");
  expect(button().disabled).toBe(true);
  options.resolve({ available: true, canExportAll: false });
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  expect(button().variant).toBe("secondary");
  expect(button().disabled).toBe(true);
  expect(vi.mocked(request)).toHaveBeenCalledTimes(1);
});

it("does not read or submit until its session scope exists", async () => {
  const load = modules["./attendance-export-dialog.ts"]!;
  await load();
  const request = vi.fn(async () => ({
    available: true,
    canExportAll: true,
  })) as unknown as DashboardRequest;
  const { el } = await mountWidget<AttendanceExportDialog>("dashboard-attendance-export-dialog", {
    request,
    open: true,
    scopeKey: "",
    locationId: "place",
    period: { start: "2026-01-01", end: "2026-02-01" },
  });
  await new Promise(requestAnimationFrame);
  expect(request).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector<WtButton>("[data-test=export-download]")!.disabled).toBe(
    true,
  );
  el.scopeKey = "person:1";
  await el.updateComplete;
  await expect.poll(() => vi.mocked(request).mock.calls.length).toBe(1);
});

it("does not download a selected person removed from the supplied scope while the request waits", async () => {
  const held = deferred<Blob>();
  const { el, created, clicked } = await fixture(
    { mode: "manager", personId: "one", people: [{ personId: "one", displayName: "María" }] },
    () => held.promise,
  );
  await send(el);
  el.people = [];
  await el.updateComplete;
  held.resolve(new Blob(["removed-person"]));
  await new Promise(requestAnimationFrame);
  expect(created).toEqual([]);
  expect(clicked).toEqual([]);
});

it("revokes a created URL even when the browser rejects the download", async () => {
  const { el, revoked } = await fixture();
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
    throw new Error("Cannot start download");
  });
  await send(el);
  await expect.poll(() => revoked.mock.calls.length).toBe(1);
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  expect(el.shadowRoot!.querySelector<WtButton>("[data-test=export-download]")!.disabled).toBe(
    false,
  );
});
it("a reopened identical scope downloads B once and ignores a late A with the same binding", async () => {
  const a = deferred<Blob>();
  const b = new Blob(["current B"]);
  let attempts = 0;
  const { el, created, clicked } = await fixture({}, () =>
    attempts++ === 0 ? a.promise : Promise.resolve(b),
  );
  await send(el);
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  await expect
    .poll(() => el.shadowRoot!.querySelector<WtButton>("[data-test=export-download]")!.disabled)
    .toBe(false);
  await send(el);
  await expect.poll(() => clicked).toHaveLength(1);
  a.resolve(new Blob(["stale A"]));
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  expect(created).toEqual([b]);
  expect(clicked).toHaveLength(1);
});
