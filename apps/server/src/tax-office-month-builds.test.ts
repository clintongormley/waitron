import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { TaxOfficeMonth } from "./tax-office-export.js";
import {
  createTaxOfficeMonthBuilds,
  TAX_OFFICE_KEEP_MS,
  type TaxOfficeMonthBuilds,
} from "./tax-office-month-builds.js";

const ANA = "00000000-0000-4000-8000-0000000000a1";
const BEA = "00000000-0000-4000-8000-0000000000b2";

function input(month: string): TaxOfficeMonth {
  return {
    month,
    issued: { from: `${month}-01`, to: `${month}-28`, timeZone: "Europe/Madrid" },
    language: "en",
    venue: null,
    at: new Date("2026-02-01T10:00:00.000Z"),
  };
}

type Entries = Parameters<typeof createTaxOfficeMonthBuilds>[0]["entries"];

async function* stubEntries(): AsyncGenerator<{ name: string; content: string | Uint8Array }> {
  yield await Promise.resolve({ name: "README.txt", content: "hello" });
  yield { name: "invoices.csv", content: new Uint8Array([1, 2, 3]) };
}

function setup(entries: Entries = () => stubEntries(), controller = new AbortController()) {
  const dir = join(mkdtempSync(join(tmpdir(), "tax-office-builds-")), "tax-office");
  let now = new Date("2026-02-01T10:00:00.000Z");
  const changed = vi.fn();
  const wake = vi.fn();
  const log = vi.fn();
  const builds = createTaxOfficeMonthBuilds({
    dir,
    now: () => now,
    entries,
    changed,
    wake,
    log,
  });
  const pass = () => builds.job().pass({ now, signal: controller.signal });
  return {
    dir,
    builds,
    changed,
    wake,
    log,
    controller,
    pass,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    files: () => (existsSync(dir) ? readdirSync(dir) : []),
  };
}

async function readyFor(t: ReturnType<typeof setup>, person: string, month: string) {
  const { view } = t.builds.claim(person, month);
  t.builds.begin(person, input(month));
  await t.pass();
  return view;
}

function idOf(builds: TaxOfficeMonthBuilds, person: string): string {
  const view = builds.view(person);
  if (view.status === "none") throw new Error("no record");
  return view.id;
}

it("builds a claimed and begun month into a ready file holding the entries", async () => {
  const t = setup();
  expect(t.builds.view(ANA)).toEqual({ status: "none" });
  const { claimed, view } = t.builds.claim(ANA, "2026-01");
  expect(claimed).toBe(true);
  expect(view).toEqual({ status: "building", id: expect.any(String), month: "2026-01" });
  expect(t.changed).toHaveBeenCalledTimes(1);
  t.builds.begin(ANA, input("2026-01"));
  expect(t.wake).toHaveBeenCalledTimes(1);
  if (view.status !== "building") throw new Error("not building");
  const result = await t.pass();
  const file = t.builds.file(ANA);
  expect(file).not.toBeNull();
  expect(file!.path).toBe(join(t.dir, `${view.id}.zip`));
  expect(file!.bytes).toBe(statSync(file!.path).size);
  const expiresAt = new Date(
    Date.parse("2026-02-01T10:00:00.000Z") + TAX_OFFICE_KEEP_MS,
  ).toISOString();
  expect(t.builds.view(ANA)).toEqual({
    status: "ready",
    id: view.id,
    month: "2026-01",
    bytes: file!.bytes,
    expiresAt,
  });
  expect(t.changed).toHaveBeenCalledTimes(2);
  expect(result.nextDueAt?.toISOString()).toBe(expiresAt);
  const files = unzipSync(new Uint8Array(readFileSync(file!.path)));
  expect(Object.keys(files)).toEqual(["README.txt", "invoices.csv"]);
  expect(strFromU8(files["README.txt"]!)).toBe("hello");
  expect([...files["invoices.csv"]!]).toEqual([1, 2, 3]);
});

it("refuses another person's claim while one builds and gives the same person the running build", async () => {
  const t = setup();
  const first = t.builds.claim(ANA, "2026-01");
  expect(() => t.builds.claim(BEA, "2026-01")).toThrow(
    expect.objectContaining({ code: "tax_office.export_running" }),
  );
  expect(() => t.builds.claim(ANA, "2025-12")).toThrow(
    expect.objectContaining({ code: "tax_office.export_running" }),
  );
  expect(t.builds.claim(ANA, "2026-01")).toEqual({ claimed: false, view: first.view });
  expect(t.changed).toHaveBeenCalledTimes(1);
});

it("deletes a person's ready file when they claim again", async () => {
  const t = setup();
  await readyFor(t, ANA, "2026-01");
  const old = t.builds.file(ANA)!;
  expect(existsSync(old.path)).toBe(true);
  const again = t.builds.claim(ANA, "2025-12");
  expect(again.claimed).toBe(true);
  expect(existsSync(old.path)).toBe(false);
  expect(t.builds.file(ANA)).toBeNull();
  expect(t.builds.view(ANA)).toMatchObject({ status: "building", month: "2025-12" });
});

it("forgets a sent file and its record, but not a newer record than the one sent", async () => {
  const t = setup();
  await readyFor(t, ANA, "2026-01");
  const first = t.builds.file(ANA)!;
  t.builds.sent(ANA, first.id);
  expect(existsSync(first.path)).toBe(false);
  expect(t.builds.view(ANA)).toEqual({ status: "none" });
  expect(t.changed).toHaveBeenCalledTimes(3);

  await readyFor(t, ANA, "2026-01");
  const second = t.builds.file(ANA)!;
  expect(second.id).not.toBe(first.id);
  t.builds.sent(ANA, first.id);
  expect(existsSync(second.path)).toBe(true);
  expect(t.builds.view(ANA)).toMatchObject({ status: "ready", id: second.id });
});

it("records a build whose entries throw as failed, logs once, and accepts the next claim", async () => {
  const t = setup(async function* () {
    yield { name: "README.txt", content: "hello" };
    throw new AppError("storage.disk_full", {});
  });
  t.builds.claim(ANA, "2026-01");
  const id = idOf(t.builds, ANA);
  t.builds.begin(ANA, input("2026-01"));
  await expect(t.pass()).resolves.toEqual({
    nextDueAt: new Date(Date.parse("2026-02-01T10:00:00.000Z") + TAX_OFFICE_KEEP_MS),
  });
  expect(t.changed).toHaveBeenCalledTimes(2);
  expect(t.builds.view(ANA)).toEqual({ status: "failed", id, month: "2026-01" });
  expect(t.builds.file(ANA)).toBeNull();
  expect(t.files()).toEqual([]);
  expect(t.log.mock.calls).toEqual([
    [
      "error",
      "tax_office.build_failed",
      { errorCode: "storage.disk_full", errorClass: "AppError" },
    ],
  ]);
  expect(t.builds.claim(BEA, "2026-01").claimed).toBe(true);
});

it("leaves no record and no file when the job is stopped mid-build", async () => {
  const controller = new AbortController();
  const t = setup(async function* (_month, stopIfAsked) {
    yield { name: "README.txt", content: "hello" };
    controller.abort();
    stopIfAsked();
    yield { name: "invoices.csv", content: "never" };
  }, controller);
  t.builds.claim(ANA, "2026-01");
  t.builds.begin(ANA, input("2026-01"));
  await t.pass();
  expect(t.builds.view(ANA)).toEqual({ status: "none" });
  expect(t.files()).toEqual([]);
  expect(t.changed).toHaveBeenCalledTimes(2);
  expect(t.log).not.toHaveBeenCalledWith("error", "tax_office.build_failed", expect.anything());
});

it("deletes an unsaved file and its record once it has been kept long enough", async () => {
  const t = setup();
  await readyFor(t, ANA, "2026-01");
  const path = t.builds.file(ANA)!.path;
  t.advance(TAX_OFFICE_KEEP_MS - 1);
  expect((await t.pass()).nextDueAt).not.toBeNull();
  expect(existsSync(path)).toBe(true);
  expect(t.changed).toHaveBeenCalledTimes(2);
  t.advance(1);
  expect(await t.pass()).toEqual({ nextDueAt: null });
  expect(t.changed).toHaveBeenCalledTimes(3);
  expect(existsSync(path)).toBe(false);
  expect(t.builds.view(ANA)).toEqual({ status: "none" });
});

it("frees the claim on release", async () => {
  const t = setup();
  t.builds.claim(ANA, "2026-01");
  t.builds.release(ANA);
  expect(t.builds.view(ANA)).toEqual({ status: "none" });
  expect(t.builds.claim(BEA, "2026-01").claimed).toBe(true);
  expect(t.changed).toHaveBeenCalledTimes(3);
});

it("offers no file and shows no record once the hour has ended, before any pass", async () => {
  const t = setup();
  await readyFor(t, ANA, "2026-01");
  t.advance(TAX_OFFICE_KEEP_MS - 1);
  expect(t.builds.file(ANA)).not.toBeNull();
  expect(t.builds.view(ANA)).toMatchObject({ status: "ready" });
  t.advance(1);
  expect(t.builds.file(ANA)).toBeNull();
  expect(t.builds.view(ANA)).toEqual({ status: "none" });
});

it("logs the system's error code of a failed build beside its error code and class", async () => {
  const t = setup(async function* () {
    yield { name: "README.txt", content: "hello" };
    throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
  });
  t.builds.claim(ANA, "2026-01");
  t.builds.begin(ANA, input("2026-01"));
  await t.pass();
  expect(t.log.mock.calls).toEqual([
    [
      "error",
      "tax_office.build_failed",
      { errorCode: "unknown", errorClass: "Error", systemCode: "ENOSPC" },
    ],
  ]);
});

it.skipIf(process.getuid?.() === 0)(
  "frees the claim when a failed build's file cannot be deleted",
  async () => {
    let dir = "";
    const t = setup(async function* () {
      yield { name: "README.txt", content: "hello" };
      while (!existsSync(dir) || readdirSync(dir).length === 0)
        await new Promise((resolve) => setImmediate(resolve));
      chmodSync(dir, 0o500);
      throw new AppError("storage.disk_full", {});
    });
    dir = t.dir;
    try {
      t.builds.claim(ANA, "2026-01");
      t.builds.begin(ANA, input("2026-01"));
      await expect(t.pass()).resolves.toMatchObject({ nextDueAt: expect.any(Date) });
      expect(t.files()).toHaveLength(1);
      expect(t.builds.view(ANA)).toMatchObject({ status: "failed" });
      expect(t.builds.claim(BEA, "2026-01").claimed).toBe(true);
    } finally {
      chmodSync(dir, 0o700);
    }
  },
);
