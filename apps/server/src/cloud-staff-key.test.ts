import { expect, it, vi } from "vitest";
import { mkdtemp, open, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStaffCsr } from "./cloud-remote.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

it("an interrupted initial key write leaves no published partial key and can be retried", async () => {
  const root = await mkdtemp(join(tmpdir(), "waitron-staff-key-write-"));
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const failure = new Error("write interrupted");
  vi.mocked(open).mockImplementation(async (...args) => {
    const file = await actual.open(...args);
    if (args[1] !== "wx") return file;
    vi.mocked(open).mockImplementation(actual.open);
    const write = file.writeFile.bind(file);
    file.writeFile = async () => {
      await write("partial");
      throw failure;
    };
    return file;
  });
  try {
    await expect(createStaffCsr(root, "staff.example.test")).rejects.toBe(failure);
    await expect(readFile(join(root, "cloud/staff.key"))).rejects.toMatchObject({ code: "ENOENT" });
    const first = await createStaffCsr(root, "staff.example.test");
    expect(await createStaffCsr(root, "staff.example.test")).toBe(first);
    expect(await readdir(join(root, "cloud"))).toEqual(["staff.key"]);
  } finally {
    vi.mocked(open).mockReset();
    await rm(root, { recursive: true, force: true });
  }
});
