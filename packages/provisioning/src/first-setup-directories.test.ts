import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  canonicalFirstSetupDirectory,
  canonicalFirstSetupRoots,
} from "./first-setup-directories.js";

const invalid = { code: "setup.attempt_invalid" };
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => filesystem.rm(root, { recursive: true, force: true })),
  );
});
async function temporary() {
  const root = await filesystem.realpath(
    await filesystem.mkdtemp(join(tmpdir(), "first-setup-directories-")),
  );
  roots.push(root);
  return root;
}

it("keeps a missing nested path canonical and refuses file or symlink directory components", async () => {
  const root = await temporary();
  const absent = join(root, "missing", "nested");
  expect(await canonicalFirstSetupDirectory(absent)).toBe(absent);
  await filesystem.mkdir(absent, { recursive: true });
  expect(await canonicalFirstSetupDirectory(absent)).toBe(absent);
  const file = join(root, "file");
  await filesystem.writeFile(file, "retained");
  const link = join(root, "link");
  await filesystem.symlink(absent, link);
  for (const path of [file, link]) {
    await expect(canonicalFirstSetupDirectory(path)).rejects.toMatchObject(invalid);
  }
  expect(await filesystem.readFile(file, "utf8")).toBe("retained");
});

it("canonicalises both roots of a first setup", async () => {
  const root = await temporary();
  const state = join(root, "state");
  const venue = join(root, "venue");
  await filesystem.mkdir(state);
  expect(await canonicalFirstSetupRoots({ stateDir: state, venueDir: venue })).toEqual({
    stateDir: state,
    venueDir: venue,
  });
});

it("does not hide a failure other than a missing path when canonicalising", async () => {
  const root = await temporary();
  const file = join(root, "file");
  await filesystem.writeFile(file, "retained");
  await expect(canonicalFirstSetupDirectory(join(file, "child"))).rejects.toMatchObject({
    code: "ENOTDIR",
  });
});
