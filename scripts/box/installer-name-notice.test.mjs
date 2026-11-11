import { expect, it, vi } from "vitest";
import { installerNameNotice } from "./installer-name-notice.mjs";

const target = "/dev/vdb";
const partition = {
  node: "/dev/vdb3",
  type: "a8aaea61-baef-47f4-9cff-c4c967ee12c7",
  name: "waitron-box",
};
const token = {
  type: "waitron-name-tag",
  keyslots: [],
  version: 1,
  name: "Harbour Restaurant Ltd",
  live: false,
};
function reader({
  marked = true,
  type = partition.type,
  diagnostic = "",
  tokens = { 2: token },
  failed = false,
} = {}) {
  return vi.fn(async (command, args) => {
    if (command === "sfdisk")
      return JSON.stringify({
        partitiontable: {
          label: "gpt",
          partitions: [{}, {}, { ...partition, type, name: marked ? "waitron-box" : "other" }],
        },
      });
    expect(command).toBe("cryptsetup");
    expect(args).toContain("--disable-locks");
    expect(args.at(-1)).toBe("/dev/vdb3");
    if (failed) throw new Error("unreadable");
    return args.includes("--debug")
      ? `Version: 2\nSubsystem: waitron-box-1\n${diagnostic}`
      : JSON.stringify({ tokens });
  });
}
it("reads the stored legal name without unlocking or writing the disk", async () => {
  const run = reader();
  expect(await installerNameNotice(target, run)).toBe(
    "This box already has Waitron (Harbour Restaurant Ltd).",
  );
  expect(run.mock.calls.map(([command, args]) => [command, ...args])).toEqual([
    ["sfdisk", "--json", target],
    ["cryptsetup", "--disable-locks", "--debug", "luksDump", "/dev/vdb3"],
    ["cryptsetup", "--disable-locks", "luksDump", "--dump-json-metadata", "/dev/vdb3"],
  ]);
});
it("names a recognised disk even when its tag is absent or unusable", async () => {
  for (const tokens of [{}, { 2: { ...token, name: "bad\nname" } }])
    expect(await installerNameNotice(target, reader({ tokens }))).toBe(
      "This box already has Waitron (Venue name unavailable).",
    );
});
it("leaves foreign disks at the occupied refusal without reading their encryption header", async () => {
  const run = reader({ marked: false });
  expect(await installerNameNotice(target, run)).toBeNull();
  expect(run).toHaveBeenCalledTimes(1);
});
it.each([
  "# Primary LUKS2 header requires recovery.",
  "# Secondary LUKS2 header requires recovery.",
])("refuses a degraded header: %s", async (diagnostic) => {
  const run = reader({ diagnostic });
  expect(await installerNameNotice(target, run)).toBeNull();
  expect(run).toHaveBeenCalledTimes(2);
});
it("keeps the occupied refusal when cryptsetup cannot read the header", async () => {
  expect(await installerNameNotice(target, reader({ failed: true }))).toBeNull();
});

it("recognises the uppercase partition GUID emitted by sfdisk", async () => {
  expect(await installerNameNotice(target, reader({ type: partition.type.toUpperCase() }))).toBe(
    "This box already has Waitron (Harbour Restaurant Ltd).",
  );
});
