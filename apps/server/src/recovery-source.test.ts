import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as source from "./recovery-source.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function database(bytes = "database") {
  const dir = await mkdtemp(join(tmpdir(), "recovery-source-"));
  dirs.push(dir);
  const file = join(dir, "venue.db");
  await writeFile(file, bytes);
  return file;
}

it("uses the archive's exact encrypted bytes as its source", () => {
  expect(source.recoveryArchiveSourceId(Buffer.from("abc"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
it("binds a stream to its database bytes and metadata rather than a generation locator", async () => {
  const file = await database();
  expect(await source.recoveryStreamSourceId(file, [])).toBe(
    "stream-sha256:54b2b3d6fbc5b6f8bd2e4e71d9eb088ca223ce356df90279aaba7eeb0fb6fbc9",
  );
  const first = await source.recoveryStreamSourceId(file, []);
  await writeFile(file, "different backup in the same generation");
  expect(await source.recoveryStreamSourceId(file, [])).not.toBe(first);
  await writeFile(file, "database");
  expect(
    await source.recoveryStreamSourceId(file, [
      { name: "manifest.json", bytes: Buffer.from("new metadata") },
    ]),
  ).not.toBe(first);
});
it("canonicalises entry order but retains names, lengths and raw bytes", async () => {
  const file = await database();
  const first = { name: "secrets/a", bytes: Buffer.from("a") };
  const second = { name: "secrets/b", bytes: Buffer.from("bc") };
  const digest = await source.recoveryStreamSourceId(file, [first, second]);
  expect(await source.recoveryStreamSourceId(file, [second, first])).toBe(digest);
  expect(
    await source.recoveryStreamSourceId(file, [
      { ...first, bytes: Buffer.from("ab") },
      { ...second, bytes: Buffer.from("c") },
    ]),
  ).not.toBe(digest);
  expect(
    await source.recoveryStreamSourceId(file, [{ ...first, name: "secrets/z" }, second]),
  ).not.toBe(digest);
});

it("hashes an archive file with the same byte identity without reading it as one buffer", async () => {
  const file = await database("abc");
  expect(source.recoveryArchiveFileSourceId).toBeTypeOf("function");
  expect(await source.recoveryArchiveFileSourceId(file)).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
