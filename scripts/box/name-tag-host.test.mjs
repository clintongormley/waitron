import { Buffer } from "node:buffer";
import { expect, it, vi } from "vitest";
import { handleTagWrite, tagCommand } from "./name-tag-host.mjs";

const device = "/dev/disk/by-uuid/aa-bb";
const line =
  'tag.write {"tag":{"name":"Harbour Restaurant Ltd","live":false},"actor":{"source":"server"}}';
const foreign = { type: "systemd-tpm2", keyslots: ["1"], "tpm2-pcrs": [5, 7, 8, 9, 15] };
const wanted = {
  type: "waitron-name-tag",
  keyslots: [],
  version: 1,
  name: "Harbour Restaurant Ltd",
  live: false,
};
const inspect = async () => ({ diskUuid: "aa-bb" });
it("executes the tag plan on the inspected device, preserving the chip token", async () => {
  const tokens = { 0: foreign };
  const run = vi.fn(async (command, args, input) => {
    expect(command).toBe("cryptsetup");
    expect(args.at(-1)).toBe(device);
    if (args[0] === "luksDump") return JSON.stringify({ tokens });
    expect(args).toEqual(["token", "import", "--token-id", "1", "--json-file", "-", device]);
    tokens[1] = JSON.parse(Buffer.from(input).toString());
    return "";
  });
  expect(await handleTagWrite(line, { inspect, run })).toBe('{"ok":true,"tag":"written"}\n');
  expect(tokens).toEqual({ 0: foreign, 1: wanted });
  run.mockClear();
  expect(await handleTagWrite(line, { inspect, run })).toBe('{"ok":true,"tag":"unchanged"}\n');
  expect(run).toHaveBeenCalledTimes(1);
});
it("executes removal of its existing tag without naming a keyslot", async () => {
  const run = vi.fn(async (_command, args) =>
    args[0] === "luksDump" ? JSON.stringify({ tokens: { 0: foreign, 2: wanted } }) : "",
  );
  expect(
    await handleTagWrite('tag.write {"tag":null,"actor":{"source":"server"}}', { inspect, run }),
  ).toBe('{"ok":true,"tag":"removed"}\n');
  expect(run.mock.calls[1][1]).toEqual(["token", "remove", "--token-id", "2", device]);
});
it("refuses a full token area without issuing a write", async () => {
  const run = vi.fn(async () =>
    JSON.stringify({
      tokens: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i, foreign])),
    }),
  );
  expect(await handleTagWrite(line, { inspect, run })).toBe(
    '{"ok":false,"reason":"no_free_token"}\n',
  );
  expect(run).toHaveBeenCalledTimes(1);
});
it("refuses an unverified host before any disk command", async () => {
  const run = vi.fn();
  expect(
    await handleTagWrite(line, {
      inspect: async () => {
        throw new Error("wrong root");
      },
      run,
    }),
  ).toBe('{"ok":false,"reason":"header_unreadable"}\n');
  expect(run).not.toHaveBeenCalled();
});
it("keeps request validation ahead of inspection", async () => {
  const inspect = vi.fn();
  expect(await handleTagWrite(line.replace('"server"', '"person"'), { inspect })).toBe(
    '{"ok":false,"reason":"actor_invalid"}\n',
  );
  expect(inspect).not.toHaveBeenCalled();
});

it("gives inspection and token commands one shared twelve-second budget", () => {
  let time = 0;
  const exec = vi.fn(() => "metadata");
  const run = tagCommand({ now: () => time, exec });
  expect(run("findmnt", ["--json"])).toBe("metadata");
  time = 9000;
  run("cryptsetup", ["luksDump"]);
  expect(exec.mock.calls.map((call) => call[2].timeout)).toEqual([12000, 3000]);
  time = 12000;
  expect(() => run("cryptsetup", ["token", "import"])).toThrow("tag deadline");
  expect(exec).toHaveBeenCalledTimes(2);
});
