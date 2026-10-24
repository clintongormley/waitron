import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import type { WaitronModule } from "./module.js";
import {
  personalDataParts,
  preparePersonalData,
  validatePersonalDataParts,
  type ModulePersonalData,
  type PersonalDataFile,
  type PersonalDataPart,
  type PersonalDataSubject,
} from "./index.js";

const tx = {} as Transaction;
const subject: PersonalDataSubject = {
  personId: "person-1",
  at: new Date("2026-10-24T10:00:00Z"),
  timeZone: "Europe/Madrid",
  locationId: "location-1",
};

const stub = (
  files: readonly string[],
  built: readonly PersonalDataFile[] = files.map((name) => ({ name, content: name })),
): ModulePersonalData => ({
  files,
  prepare: async () => async () => built,
});
const part = (owner: string, value: ModulePersonalData): PersonalDataPart => ({
  owner,
  part: value,
});
const moduleWith = (name: string, value?: ModulePersonalData): WaitronModule => ({
  name,
  version: "0.0.0",
  tier: "toggleable",
  migrations: { name, table: name, from: name },
  ...(value === undefined ? {} : { personalData: value }),
});

describe("personalDataParts", () => {
  it("returns the seat values of the modules that fill it, in module order, owned by name", () => {
    const one = stub(["one.json"]);
    const two = stub(["two.json"]);
    expect(
      personalDataParts([moduleWith("a", one), moduleWith("b"), moduleWith("c", two)]),
    ).toEqual([
      { owner: "a", part: one },
      { owner: "c", part: two },
    ]);
  });
});

describe("validatePersonalDataParts", () => {
  const refused = (parts: readonly PersonalDataPart[]) => {
    expect(() => validatePersonalDataParts(parts)).toThrowError(
      expect.objectContaining({ code: "module.config_invalid" }),
    );
  };

  it("accepts distinct well-formed names across two parts", () => {
    expect(() =>
      validatePersonalDataParts([
        part("identity", stub(["profile.json", "sessions.csv"])),
        part("server", stub(["working-time-2026.pdf"])),
      ]),
    ).not.toThrow();
  });
  it("refuses the same name in two parts", () => {
    refused([part("a", stub(["profile.json"])), part("b", stub(["profile.json"]))]);
  });
  it("refuses the same name twice in one part", () => {
    expect(() =>
      validatePersonalDataParts([part("a", stub(["profile.json", "profile.json"]))]),
    ).toThrowError(
      expect.objectContaining({
        code: "module.config_invalid",
        params: expect.objectContaining({
          reason: 'personal-data file name "profile.json" is declared twice by a',
        }),
      }),
    );
  });
  it.each(["README.txt", "Profile.json", "a/b.json", "café.json", "profile.txt", "-profile.json"])(
    "refuses the malformed name %s",
    (name) => {
      refused([part("a", stub([name]))]);
    },
  );
});

describe("preparePersonalData", () => {
  it("calls every prepare in list order, with its transaction and subject, before any build", async () => {
    const calls: unknown[] = [];
    const recording = (label: string, name: string): ModulePersonalData => ({
      files: [name],
      prepare: async (givenTx, givenSubject) => {
        calls.push([`prepare ${label}`, givenTx, givenSubject]);
        return async () => {
          calls.push(`build ${label}`);
          return [{ name, content: label }];
        };
      },
    });
    const build = await preparePersonalData(
      tx,
      [part("a", recording("a", "a.json")), part("b", recording("b", "b.json"))],
      subject,
    );
    expect(calls).toEqual([
      ["prepare a", tx, subject],
      ["prepare b", tx, subject],
    ]);
    await build();
    expect(calls).toEqual([
      ["prepare a", tx, subject],
      ["prepare b", tx, subject],
      "build a",
      "build b",
    ]);
  });

  it("awaits each prepare before calling the next", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondCalled = false;
    const first: ModulePersonalData = {
      files: ["first.json"],
      prepare: async () => {
        await held;
        return async () => [];
      },
    };
    const second: ModulePersonalData = {
      files: ["second.json"],
      prepare: async () => {
        secondCalled = true;
        return async () => [];
      },
    };
    const pending = preparePersonalData(tx, [part("a", first), part("b", second)], subject);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondCalled).toBe(false);
    release();
    await pending;
    expect(secondCalled).toBe(true);
  });

  it("builds every part's files in list order", async () => {
    const build = await preparePersonalData(
      tx,
      [
        part("a", stub(["one.json", "two.csv"])),
        part("b", stub(["three.pdf"], [{ name: "three.pdf", content: new Uint8Array([1, 2]) }])),
      ],
      subject,
    );
    expect(await build()).toEqual([
      { name: "one.json", content: "one.json" },
      { name: "two.csv", content: "two.csv" },
      { name: "three.pdf", content: new Uint8Array([1, 2]) },
    ]);
  });

  it("validates the parts before calling any prepare", async () => {
    let prepared = false;
    const bad: ModulePersonalData = {
      files: ["Bad.json"],
      prepare: async () => {
        prepared = true;
        return async () => [];
      },
    };
    await expect(preparePersonalData(tx, [part("a", bad)], subject)).rejects.toThrowError(
      expect.objectContaining({ code: "module.config_invalid" }),
    );
    expect(prepared).toBe(false);
  });

  it("throws a plain error when a part builds a name it did not declare", async () => {
    const build = await preparePersonalData(
      tx,
      [part("a", stub(["one.json"], [{ name: "other.json", content: "" }]))],
      subject,
    );
    const error = await build().then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
  });

  it("throws a plain error when a part builds a name twice", async () => {
    const build = await preparePersonalData(
      tx,
      [
        part(
          "a",
          stub(
            ["one.json"],
            [
              { name: "one.json", content: "" },
              { name: "one.json", content: "" },
            ],
          ),
        ),
      ],
      subject,
    );
    const error = await build().then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
  });

  it("builds nothing when there are no parts", async () => {
    const build = await preparePersonalData(tx, [], subject);
    expect(await build()).toEqual([]);
  });
});
