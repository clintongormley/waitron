import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteIdentityChangeNote, readIdentityChangeNote } from "./identity-change-note.js";

const FILE = "identity-change.json";
const WELL_FORMED = {
  version: 1,
  release: "1.4.0",
  producerTaxId: "11111111H",
  fromProducerTaxId: "00000000T",
};

let stateDir: string;
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "identity-change-note-"));
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

const write = (text: string) => writeFile(join(stateDir, FILE), text);

describe("readIdentityChangeNote", () => {
  it("answers the release and the two producers of a well-formed note", async () => {
    await write(JSON.stringify(WELL_FORMED));

    expect(await readIdentityChangeNote(stateDir)).toEqual({
      release: "1.4.0",
      producerTaxId: "11111111H",
      fromProducerTaxId: "00000000T",
    });
  });

  it("takes the keys in any order, across lines", async () => {
    await write(JSON.stringify(Object.fromEntries(Object.entries(WELL_FORMED).reverse()), null, 2));

    expect(await readIdentityChangeNote(stateDir)).toEqual({
      release: "1.4.0",
      producerTaxId: "11111111H",
      fromProducerTaxId: "00000000T",
    });
  });

  it("answers null when there is no note", async () => {
    expect(await readIdentityChangeNote(stateDir)).toBeNull();
  });

  it.each([
    ["an empty file", ""],
    ["text that is not JSON", JSON.stringify(WELL_FORMED).slice(0, -1)],
    ["null", "null"],
    ["a number", "1"],
    ["a string", '"1.4.0"'],
    ["a list", JSON.stringify([WELL_FORMED])],
    ["an extra key", JSON.stringify({ ...WELL_FORMED, extra: 1 })],
    ["a __proto__ key", `{"__proto__":{},${JSON.stringify(WELL_FORMED).slice(1)}`],
    ["version 2", JSON.stringify({ ...WELL_FORMED, version: 2 })],
    ["version as text", JSON.stringify({ ...WELL_FORMED, version: "1" })],
    ["no version", JSON.stringify({ ...WELL_FORMED, version: undefined })],
    ["no release", JSON.stringify({ ...WELL_FORMED, release: undefined })],
    ["no producer", JSON.stringify({ ...WELL_FORMED, producerTaxId: undefined })],
    ["no earlier producer", JSON.stringify({ ...WELL_FORMED, fromProducerTaxId: undefined })],
    ["a release that is not text", JSON.stringify({ ...WELL_FORMED, release: 1 })],
    ["a producer that is not text", JSON.stringify({ ...WELL_FORMED, producerTaxId: null })],
    [
      "an earlier producer that is not text",
      JSON.stringify({ ...WELL_FORMED, fromProducerTaxId: ["00000000T"] }),
    ],
    ["an empty release", JSON.stringify({ ...WELL_FORMED, release: "" })],
    ["an empty producer", JSON.stringify({ ...WELL_FORMED, producerTaxId: "" })],
    ["an empty earlier producer", JSON.stringify({ ...WELL_FORMED, fromProducerTaxId: "" })],
  ])("answers null for %s", async (_label, text) => {
    await write(text);

    expect(await readIdentityChangeNote(stateDir)).toBeNull();
  });

  it("answers null when the note's name is a folder", async () => {
    await mkdir(join(stateDir, FILE));

    expect(await readIdentityChangeNote(stateDir)).toBeNull();
  });

  it.skipIf(process.getuid?.() === 0)("answers null when the note may not be opened", async () => {
    await write(JSON.stringify(WELL_FORMED));
    await chmod(join(stateDir, FILE), 0);

    expect(await readIdentityChangeNote(stateDir)).toBeNull();
  });
});

describe("deleteIdentityChangeNote", () => {
  it("removes the note and nothing else", async () => {
    await write(JSON.stringify(WELL_FORMED));
    await writeFile(join(stateDir, "secrets.env"), "");

    await deleteIdentityChangeNote(stateDir);

    expect(await readdir(stateDir)).toEqual(["secrets.env"]);
  });

  it("finds nothing to do when there is no note", async () => {
    await expect(deleteIdentityChangeNote(stateDir)).resolves.toBeUndefined();
  });
});
