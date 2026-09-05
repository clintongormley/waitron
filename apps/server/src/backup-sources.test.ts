import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { collectModuleNonDbState } from "./backup-sources.js";

// A non-ENOENT readdir failure (e.g. permission denied) must propagate rather than be swallowed
// as "empty" — only ENOENT means "nothing written here yet". Mocked because staging a genuine
// EACCES deterministically (without running as a different, unprivileged user) isn't practical;
// every other test in this file exercises the real filesystem, the same scoping
// `local-fs-backend.test.ts` uses for its own single mocked case.
const UNREADABLE_DIR_MARKER = "backup-sources-unreadable";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: vi.fn((path: Parameters<typeof actual.readdir>[0], ...rest: unknown[]) => {
      if (typeof path === "string" && path.includes(UNREADABLE_DIR_MARKER)) {
        const err = new Error("EACCES: permission denied, scandir") as NodeJS.ErrnoException;
        err.code = "EACCES";
        return Promise.reject(err);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forwarding varargs to the real fn
      return (actual.readdir as any)(path, ...rest);
    }),
  };
});

// A minimal module descriptor carrying only the fields this suite reads. `migrations`/`version`/
// `tier` are irrelevant to source resolution, but WaitronModule requires them.
function moduleWithBackup(backup: WaitronModule["backup"]): WaitronModule {
  return {
    name: "fake",
    version: "0.0.0",
    tier: "toggleable",
    migrations: { name: "fake", table: "__drizzle_migrations_fake", from: "../fake/drizzle" },
    backup,
  };
}

const CORE = moduleWithBackup({ nonDbState: [{ kind: "content-addressed-dir", source: "media" }] });

describe("collectModuleNonDbState", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "backup-sources-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("emits media/<name> entries for every file under the resolved source dir", async () => {
    await writeFile(join(dir, "b.jpg"), Buffer.from("bee"));
    await writeFile(join(dir, "a.jpg"), Buffer.from("aye"));
    const entries = await collectModuleNonDbState([CORE], { media: dir });
    // Sorted by filename for a deterministic archive, regardless of write/readdir order.
    expect(entries.map((e) => e.name)).toEqual(["media/a.jpg", "media/b.jpg"]);
    expect(Buffer.from(entries[0].bytes).toString()).toBe("aye");
    expect(Buffer.from(entries[1].bytes).toString()).toBe("bee");
  });

  it("throws backup.source_unresolved for a source with no resolver", async () => {
    await expect(collectModuleNonDbState([CORE], {})).rejects.toMatchObject({
      code: "backup.source_unresolved",
      params: { source: "media" },
    });
  });

  it("throws backup.source_unresolved for a source resolving to an empty string, rather than silently emitting nothing", async () => {
    await expect(collectModuleNonDbState([CORE], { media: "" })).rejects.toMatchObject({
      code: "backup.source_unresolved",
      params: { source: "media" },
    });
  });

  it("tolerates a missing source dir as empty — a venue with no images is valid", async () => {
    const entries = await collectModuleNonDbState([CORE], { media: join(dir, "nope") });
    expect(entries).toEqual([]);
  });

  it("a module with no backup declaration contributes nothing", async () => {
    const plain = moduleWithBackup(undefined);
    const entries = await collectModuleNonDbState([plain], { media: dir });
    expect(entries).toEqual([]);
  });

  it("a module with backup but no nonDbState contributes nothing", async () => {
    const noSources = moduleWithBackup({});
    const entries = await collectModuleNonDbState([noSources], { media: dir });
    expect(entries).toEqual([]);
  });

  it("collects across multiple modules and multiple source refs", async () => {
    const secondDir = await mkdtemp(join(tmpdir(), "backup-sources-2-"));
    try {
      await writeFile(join(dir, "one.jpg"), Buffer.from("1"));
      await writeFile(join(secondDir, "two.jpg"), Buffer.from("2"));
      const other = moduleWithBackup({
        nonDbState: [{ kind: "content-addressed-dir", source: "other" }],
      });
      const entries = await collectModuleNonDbState([CORE, other], {
        media: dir,
        other: secondDir,
      });
      expect(entries.map((e) => e.name).sort()).toEqual(["media/one.jpg", "other/two.jpg"]);
    } finally {
      await rm(secondDir, { recursive: true, force: true });
    }
  });

  it("propagates a non-ENOENT readdir failure rather than treating it as empty", async () => {
    const unreadable = join(dir, UNREADABLE_DIR_MARKER);
    await expect(collectModuleNonDbState([CORE], { media: unreadable })).rejects.toMatchObject({
      code: "EACCES",
    });
  });

  it("throws backup.source_kind_unsupported for an unknown source kind", async () => {
    // A future NonDbSource kind added to the type without a capture branch must fail visibly rather
    // than be given flat-dir treatment. Cast a bogus kind past the closed union to simulate that.
    const bogus = moduleWithBackup({
      nonDbState: [{ kind: "gcs-bucket", source: "media" } as unknown as never],
    });
    await expect(collectModuleNonDbState([bogus], { media: dir })).rejects.toMatchObject({
      code: "backup.source_kind_unsupported",
      params: { kind: "gcs-bucket" },
    });
  });

  it("does not read subdirectories as files (content-addressed dirs are flat)", async () => {
    await writeFile(join(dir, "flat.jpg"), Buffer.from("flat"));
    await mkdir(join(dir, "nested"));
    await writeFile(join(dir, "nested", "inner.jpg"), Buffer.from("inner"));
    const entries = await collectModuleNonDbState([CORE], { media: dir });
    expect(entries.map((e) => e.name)).toEqual(["media/flat.jpg"]);
  });
});
