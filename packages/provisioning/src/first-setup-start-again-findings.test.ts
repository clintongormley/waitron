import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { verifyPassword } from "@waitron/identity";
import { START_AGAIN_ADMIN_PASSWORD, startAgainAttempt } from "../test/start-again-attempt.js";
import {
  collectStartAgainFindings,
  finishStartAgainDeletion,
} from "./first-setup-start-again-deletion.js";
import { parseState } from "./first-setup-state.js";

vi.mock("node:fs/promises", { spy: true });

const dirs: string[] = [];
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "start-again-findings-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const LOCK = /^venue\.(lock|holder)/;
async function tree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let names: string[];
  try {
    names = await fs.readdir(join(dir, prefix));
  } catch {
    return result;
  }
  for (const name of names.sort()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (prefix === "" && LOCK.test(name)) continue;
    const info = await fs.lstat(join(dir, relative));
    if (info.isDirectory()) {
      result[`${relative}/`] = "";
      Object.assign(result, await tree(dir, relative));
    } else if (info.isSymbolicLink())
      result[relative] = `-> ${await fs.readlink(join(dir, relative))}`;
    else result[relative] = sha(await readFile(join(dir, relative)));
  }
  return result;
}
const snapshot = async (roots: { venueDir: string; stateDir: string }) => ({
  venue: await tree(roots.venueDir),
  state: await tree(roots.stateDir),
});

it("the shared fixture is a real setup a Start again left: its record parses, its password verifies, the finisher finishes it, and a venue.db written after it is refused unlisted", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  const record = JSON.parse(await readFile(join(roots.stateDir, "first-setup.json"), "utf8"));
  const parsed = parseState(record, roots.venueDir, roots.stateDir);
  expect(parsed.frozen.attemptId).toBe(attempt.attemptId);
  expect(parsed.frozen.administratorId).toBe(attempt.administratorId);
  expect(parsed.frozenDigest).toBe(attempt.frozenDigest);
  expect(await verifyPassword(START_AGAIN_ADMIN_PASSWORD, parsed.ownerVerifier)).toBe(true);
  expect(await verifyPassword("not-the-password", parsed.ownerVerifier)).toBe(false);
  await finishStartAgainDeletion(roots);
  expect((await fs.readdir(roots.venueDir)).sort()).toEqual(["venue.lock"]);

  const other = (await startAgainAttempt(await scratch())).roots;
  await writeFile(join(other.venueDir, "venue.db"), "found later");
  await expect(finishStartAgainDeletion(other)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "unlisted file: venue/venue.db",
  });
});

async function fourFindings() {
  const attempt = await startAgainAttempt(await scratch(), {
    before: async (roots) => writeFile(join(roots.venueDir, "venue.db"), "attempt database"),
  });
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "a different database");
  await mkdir(join(roots.stateDir, "first-fiscal-documents"), { recursive: true });
  await writeFile(join(roots.stateDir, "first-fiscal-documents", "extra.json"), "{}");
  await writeFile(join(roots.venueDir, "venue.db-wal"), "pages");
  return attempt;
}

it("collects every finding of a box, in the finisher's order", async () => {
  const { roots } = await fourFindings();
  const collected = await collectStartAgainFindings(roots);
  expect(collected).not.toBeNull();
  expect(collected!.findings).toEqual([
    { kind: "refused-artifact", root: "state", name: "trading.env" },
    { kind: "changed", root: "venue", name: "venue.db" },
    { kind: "unlisted", root: "state", name: "first-fiscal-documents/extra.json" },
    { kind: "wal", name: "venue.db-wal" },
  ]);
  expect(collected!.blocker).toBeNull();
  expect(collected!.markerSha256).toBe(
    sha(await readFile(join(roots.venueDir, "first-setup-deleting.json"))),
  );
});

it("a link among the attempt's files is a blocker, after the findings before it", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await mkdir(join(roots.stateDir, "first-fiscal-documents"), { recursive: true });
  await symlink("/etc/hosts", join(roots.stateDir, "first-fiscal-documents", "link.json"));
  const collected = await collectStartAgainFindings(roots);
  expect(collected!.findings).toEqual([
    { kind: "refused-artifact", root: "state", name: "trading.env" },
  ]);
  expect(collected!.blocker).toMatchObject({ code: "setup.start_again_incomplete" });
  expect(collected!.blocker!.reason).toMatch(/^layout unexpected:/);

  const before = await snapshot(roots);
  await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "refused artifact present: state/trading.env",
  });
  expect(await snapshot(roots)).toEqual(before);
});

it("the finisher still refuses with the first finding's reason", async () => {
  const { roots } = await fourFindings();
  const before = await snapshot(roots);
  await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "refused artifact present: state/trading.env",
  });
  expect(await snapshot(roots)).toEqual(before);
});

it("the collector refuses a marker naming other folders", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  const path = join(roots.venueDir, "first-setup-deleting.json");
  const marker = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...marker, stateDir: await scratch() }));
  await expect(collectStartAgainFindings(roots)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "marker folders differ",
  });
});

it.skipIf(process.getuid?.() === 0)("the collector refuses a marker it cannot read", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  await fs.chmod(join(roots.venueDir, "first-setup-deleting.json"), 0o000);
  await expect(collectStartAgainFindings(roots)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "marker unreadable",
  });
});

it("the marker's hash is of the bytes its marker was parsed from, even when the file is replaced after its first read", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  const path = join(roots.venueDir, "first-setup-deleting.json");
  const original = await readFile(path);
  const replacement = JSON.stringify(JSON.parse(original.toString("utf8")), null, 2);
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  let reads = 0;
  const replaceAfterFirstRead = async (target: unknown) => {
    if (!String(target).endsWith("/first-setup-deleting.json")) return;
    if (++reads === 2) await actual.writeFile(path, replacement);
  };
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    await replaceAfterFirstRead(args[0]);
    return actual.open(...args);
  });
  vi.mocked(fs.readFile).mockImplementation(async (...args) => {
    await replaceAfterFirstRead(args[0]);
    return actual.readFile(...(args as Parameters<typeof actual.readFile>));
  });
  try {
    const collected = await collectStartAgainFindings(roots);
    expect(collected!.markerSha256).toBe(sha(original));
  } finally {
    vi.mocked(fs.open).mockReset();
    vi.mocked(fs.readFile).mockReset();
  }
});
