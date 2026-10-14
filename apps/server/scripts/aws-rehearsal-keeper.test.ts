import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEEPER_SCRIPT } from "../src/testing/aws-rehearsal-keeper-start.js";
import { parseKeeperArgs } from "./aws-rehearsal-keeper.js";

describe("aws-rehearsal-keeper script", () => {
  it.each([
    ["no arguments", []],
    ["a missing value", ["--journal"]],
    ["an empty value", ["--journal", ""]],
    ["an extra argument", ["--journal", "/tmp/j.json", "--force"]],
    ["--launch after the journal", ["--journal", "/tmp/j.json", "--launch"]],
    ["another flag", ["--receipt", "/tmp/j.json"]],
    ["--launch without --journal", ["--launch"]],
    ["--launch with a missing value", ["--launch", "--journal"]],
    ["--launch with an empty value", ["--launch", "--journal", ""]],
    ["--launch twice", ["--launch", "--launch", "--journal", "/tmp/j.json"]],
  ])("refuses %s", (_label, argv) => {
    expect(parseKeeperArgs(argv)).toBeNull();
  });

  it("accepts exactly [--launch] --journal <path>", () => {
    expect(parseKeeperArgs(["--journal", "/tmp/j.json"])).toEqual({
      launch: false,
      journal: "/tmp/j.json",
    });
    expect(parseKeeperArgs(["--launch", "--journal", "/tmp/j.json"])).toEqual({
      launch: true,
      journal: "/tmp/j.json",
    });
  });

  it("is the script the runner starts", () => {
    expect(realpathSync(KEEPER_SCRIPT)).toBe(
      realpathSync(fileURLToPath(new URL("./aws-rehearsal-keeper.ts", import.meta.url))),
    );
  });
});
