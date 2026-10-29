import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { START_AGAIN_ADMIN, startAgainAttempt } from "../test/start-again-attempt.js";
import {
  START_AGAIN_CHOICES_DIR,
  assertStartAgainNotKept,
  readStartAgainChoices,
  startAgainChoiceStem,
  writeStartAgainChoice,
  type StartAgainChoiceRecord,
} from "./first-setup-start-again-choice.js";
import { START_AGAIN_GUESSES_FILE } from "./first-setup-start-again-guesses.js";
import { START_AGAIN_SET_ASIDE_DIR } from "./first-setup-start-again-names.js";
import { readStartAgainMarker } from "./first-setup-start-again-deletion.js";
import { isFirstSetupHostPath } from "./first-setup-state.js";

const dirs: string[] = [];
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "start-again-choice-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function choice(
  overrides: Partial<Omit<StartAgainChoiceRecord, "version">> = {},
): Omit<StartAgainChoiceRecord, "version"> {
  return {
    at: "2026-10-26T10:00:00.000Z",
    attemptId: randomUUID(),
    frozenDigest: HASH_A,
    markerSha256: HASH_B,
    choice: "move",
    administrator: { administratorId: randomUUID(), ...START_AGAIN_ADMIN },
    ownerGeneration: 0,
    listed: {
      digest: HASH_C,
      units: [
        {
          root: "state",
          path: "trading.env",
          why: "not-created",
          pieces: ["trading.env"],
          entries: [
            { path: "trading.env", type: "file", ino: "12", size: "4", mtimeNs: "1700000000000" },
          ],
        },
      ],
    },
    setAside: { state: "first-setup-set-aside/1", venue: "first-setup-set-aside/1" },
    ...overrides,
  };
}
const keep = (overrides: Partial<Omit<StartAgainChoiceRecord, "version">> = {}) =>
  choice({ choice: "keep", setAside: null, ...overrides });

it("a record is written once, with every field, and a second write of the same stem is refused setup.attempt_conflict", async () => {
  const stateDir = await scratch();
  const record = choice();
  const stem = await writeStartAgainChoice(stateDir, record);
  expect(stem).toBe(`${Date.parse(record.at)}-${record.attemptId}`);
  expect(startAgainChoiceStem(record)).toBe(stem);
  expect(
    JSON.parse(await readFile(join(stateDir, START_AGAIN_CHOICES_DIR, `${stem}.json`), "utf8")),
  ).toEqual({ version: 1, ...record });
  await expect(writeStartAgainChoice(stateDir, keep(record))).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(
    JSON.parse(await readFile(join(stateDir, START_AGAIN_CHOICES_DIR, `${stem}.json`), "utf8")),
  ).toEqual({ version: 1, ...record });
});

it("a record that does not hold its shape is not written", async () => {
  const stateDir = await scratch();
  const bad: Partial<Omit<StartAgainChoiceRecord, "version">>[] = [
    { at: "2026-10-26T10:00:00Z" },
    { attemptId: "not-a-uuid" },
    { frozenDigest: "A".repeat(64) },
    { markerSha256: "b".repeat(63) },
    { choice: "delete" as "keep" },
    { administrator: { administratorId: "x", ...START_AGAIN_ADMIN } },
    { administrator: { administratorId: randomUUID(), displayName: " ", email: "e@x.test" } },
    { ownerGeneration: -1 },
    { listed: { digest: HASH_C, units: [{ root: "elsewhere" } as never] } },
    { setAside: null },
    { extra: true } as never,
  ];
  for (const overrides of bad)
    await expect(
      writeStartAgainChoice(stateDir, choice(overrides)),
      JSON.stringify(overrides),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  await expect(readdir(join(stateDir, START_AGAIN_CHOICES_DIR))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("records for another attempt or another frozen digest are not read; the marker's are read by name, oldest first", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  const later = choice({ attemptId, at: "2026-10-26T11:00:00.000Z" });
  const earlier = keep({ attemptId, at: "2026-10-26T09:00:00.000Z" });
  await writeStartAgainChoice(stateDir, later);
  await writeStartAgainChoice(stateDir, earlier);
  await writeStartAgainChoice(stateDir, choice({ at: "2026-10-26T10:00:00.000Z" }));
  await writeStartAgainChoice(
    stateDir,
    choice({ attemptId, frozenDigest: HASH_B, at: "2026-10-26T10:30:00.000Z" }),
  );
  await writeFile(join(stateDir, START_AGAIN_CHOICES_DIR, ".first-setup-left.tmp"), "{");
  expect(await readStartAgainChoices(stateDir, { attemptId, frozenDigest: HASH_A })).toEqual([
    { version: 1, ...earlier },
    { version: 1, ...later },
  ]);
  expect(await readStartAgainChoices(await scratch(), { attemptId, frozenDigest: HASH_A })).toEqual(
    [],
  );
});

it("a damaged record for the marker refuses setup.start_again_incomplete", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  await writeStartAgainChoice(stateDir, choice({ attemptId }));
  const name = `1800000000000-${attemptId}.json`;
  await writeFile(join(stateDir, START_AGAIN_CHOICES_DIR, name), "{");
  await expect(
    readStartAgainChoices(stateDir, { attemptId, frozenDigest: HASH_A }),
  ).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: `choice record damaged: ${name}`,
  });

  const other = await scratch();
  const renamed = `1800000000000-${attemptId}.json`;
  await mkdir(join(other, START_AGAIN_CHOICES_DIR));
  await writeFile(
    join(other, START_AGAIN_CHOICES_DIR, renamed),
    JSON.stringify({ version: 1, ...choice({ at: "2027-01-15T08:00:00.000Z" }) }),
  );
  await expect(
    readStartAgainChoices(other, { attemptId, frozenDigest: HASH_A }),
  ).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: `choice record damaged: ${renamed}`,
  });
});

it("assertStartAgainNotKept refuses setup.start_again_kept with a keep record for the marker, and passes with only a move record or none", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots, attemptId, frozenDigest } = attempt;
  await expect(assertStartAgainNotKept(roots)).resolves.toBeUndefined();
  await writeStartAgainChoice(
    roots.stateDir,
    choice({ attemptId, frozenDigest, at: "2026-10-26T09:00:00.000Z" }),
  );
  await writeStartAgainChoice(roots.stateDir, keep({ frozenDigest }));
  await writeStartAgainChoice(
    roots.stateDir,
    keep({ attemptId, frozenDigest: HASH_C, at: "2026-10-26T09:30:00.000Z" }),
  );
  await expect(assertStartAgainNotKept(roots)).resolves.toBeUndefined();
  await writeStartAgainChoice(
    roots.stateDir,
    keep({ attemptId, frozenDigest, at: "2026-10-26T10:00:00.000Z" }),
  );
  await expect(assertStartAgainNotKept(roots)).rejects.toMatchObject({
    code: "setup.start_again_kept",
  });
});

it("assertStartAgainNotKept passes when there is no marker", async () => {
  const base = await scratch();
  const roots = { venueDir: join(base, "venue"), stateDir: join(base, "state") };
  await mkdir(roots.venueDir);
  await writeStartAgainChoice(roots.stateDir, keep());
  await expect(assertStartAgainNotKept(roots)).resolves.toBeUndefined();
});

it("a marker naming the choices folder, the set-aside folder or the counter is refused as damaged", async () => {
  for (const name of [
    `${START_AGAIN_CHOICES_DIR}/1-${randomUUID()}.json`,
    START_AGAIN_CHOICES_DIR,
    `${START_AGAIN_SET_ASIDE_DIR}/1/trading.env`,
    START_AGAIN_SET_ASIDE_DIR,
    START_AGAIN_GUESSES_FILE,
  ]) {
    const { roots } = await startAgainAttempt(await scratch());
    const path = join(roots.venueDir, "first-setup-deleting.json");
    const marker = JSON.parse(await readFile(path, "utf8"));
    const named = { root: "state", name, size: 2, sha256: HASH_A };
    await writeFile(path, JSON.stringify({ ...marker, files: [...marker.files, named] }));
    await expect(readStartAgainMarker(roots.venueDir), name).rejects.toMatchObject({
      code: "setup.start_again_incomplete",
      reason: "marker damaged",
    });
  }
});

it("isFirstSetupHostPath names all three", () => {
  expect(START_AGAIN_SET_ASIDE_DIR).toBe("first-setup-set-aside");
  for (const name of [
    START_AGAIN_CHOICES_DIR,
    START_AGAIN_SET_ASIDE_DIR,
    START_AGAIN_GUESSES_FILE,
  ]) {
    expect(isFirstSetupHostPath(name), name).toBe(true);
    expect(isFirstSetupHostPath(`${name}/retained/entry.json`), name).toBe(true);
    expect(isFirstSetupHostPath(`${name}-venue-copy`), name).toBe(false);
  }
});

it("a choices folder that is not a folder refuses both the write and the read", async () => {
  const stateDir = await scratch();
  await writeFile(join(stateDir, START_AGAIN_CHOICES_DIR), "");
  await expect(writeStartAgainChoice(stateDir, keep())).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  await expect(
    readStartAgainChoices(stateDir, { attemptId: randomUUID(), frozenDigest: HASH_A }),
  ).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "choice records unreadable",
  });
});

it("a unit or an entry that does not hold its shape is not written", async () => {
  const stateDir = await scratch();
  const [unit] = choice().listed.units;
  const [entry] = unit!.entries;
  const units = [
    { ...unit, why: "lost" },
    { ...unit, path: "" },
    { ...unit, pieces: [""] },
    { ...unit, entries: "none" },
    { ...unit, extra: 1 },
    { ...unit, entries: [{ ...entry, path: "" }] },
    { ...unit, entries: [{ ...entry, type: "link" }] },
    { ...unit, entries: [{ ...entry, ino: 12 }] },
    { ...unit, entries: [{ ...entry, ino: "-1" }] },
    { ...unit, entries: [{ ...entry, size: "4.5" }] },
    { ...unit, entries: [{ ...entry, mtimeNs: 1 }] },
    { ...unit, entries: [{ ...entry, size: "-4" }] },
    { ...unit, entries: [{ ...entry, mtimeNs: "-" }] },
    { ...unit, entries: [{ ...entry, mtimeNs: "1-2" }] },
  ];
  for (const bad of units)
    await expect(
      writeStartAgainChoice(
        stateDir,
        choice({ listed: { digest: HASH_C, units: [bad as never] } }),
      ),
      JSON.stringify(bad),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  const folder = { ...entry, type: "folder", size: null, mtimeNs: null };
  const stem = await writeStartAgainChoice(
    stateDir,
    choice({ listed: { digest: HASH_C, units: [{ ...unit!, entries: [folder as never] }] } }),
  );
  expect(stem).not.toMatch(/\.json$/);
});

it("a record written with an upper-case attempt id is stored lower-cased and seen by assertStartAgainNotKept", async () => {
  const { roots, attemptId, frozenDigest } = await startAgainAttempt(await scratch());
  const upper = attemptId.toUpperCase();
  const stem = await writeStartAgainChoice(
    roots.stateDir,
    keep({ attemptId: upper, frozenDigest }),
  );
  expect(stem).toBe(startAgainChoiceStem({ at: keep().at, attemptId }));
  expect(
    JSON.parse(
      await readFile(join(roots.stateDir, START_AGAIN_CHOICES_DIR, `${stem}.json`), "utf8"),
    ),
  ).toMatchObject({ attemptId });
  for (const id of [attemptId, upper])
    expect(
      await readStartAgainChoices(roots.stateDir, { attemptId: id, frozenDigest }),
      id,
    ).toHaveLength(1);
  await expect(assertStartAgainNotKept(roots)).rejects.toMatchObject({
    code: "setup.start_again_kept",
  });
});

it("a record on disk spelling its attempt id in upper case, in its name or inside it, refuses as damaged", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  const record = { version: 1, ...keep({ attemptId }) };
  const ms = Date.parse(record.at);
  for (const [name, body] of [
    [`${ms}-${attemptId.toUpperCase()}.json`, record],
    [`${ms}-${attemptId}.json`, { ...record, attemptId: attemptId.toUpperCase() }],
  ] as const) {
    const folder = join(stateDir, START_AGAIN_CHOICES_DIR);
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder);
    await writeFile(join(folder, name), JSON.stringify(body));
    await expect(
      readStartAgainChoices(stateDir, { attemptId, frozenDigest: HASH_A }),
      name,
    ).rejects.toMatchObject({
      code: "setup.start_again_incomplete",
      reason: `choice record damaged: ${name}`,
    });
  }
});

it("paths in a record stay inside their folders", async () => {
  const stateDir = await scratch();
  const [unit] = choice().listed.units;
  const [entry] = unit!.entries;
  const bad: Partial<Omit<StartAgainChoiceRecord, "version">>[] = [
    { setAside: { state: "../../etc", venue: "first-setup-set-aside/1" } },
    { setAside: { state: "first-setup-set-aside/1", venue: "/abs" } },
    { setAside: { state: "first-setup-set-aside/../x", venue: "first-setup-set-aside/1" } },
    { setAside: { state: "first-setup-set-aside", venue: "first-setup-set-aside/1" } },
    { setAside: { state: "first-setup-set-aside/1", venue: "elsewhere/1" } },
    ...[
      { ...unit!, path: "../x" },
      { ...unit!, path: "/abs" },
      { ...unit!, path: "a/./b" },
      { ...unit!, pieces: ["/abs"] },
      { ...unit!, pieces: ["a/../../b"] },
      { ...unit!, entries: [{ ...entry!, path: "../x" }] },
    ].map((bent) => ({ listed: { digest: HASH_C, units: [bent] } })),
  ];
  for (const overrides of bad)
    await expect(
      writeStartAgainChoice(stateDir, choice(overrides)),
      JSON.stringify(overrides),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  await expect(writeStartAgainChoice(stateDir, choice())).resolves.toBeTypeOf("string");
});
