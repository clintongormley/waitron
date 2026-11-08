import { describe, expect, it } from "vitest";
import { AppError, readSoftwareProducer } from "./index.js";

const NAME = "PRODUCER PERSON";
const TAX_ID = "00000000T";
const ADDRESS = "1 Example Street, 00000 Nowhere (Province), Spain";

const ALL_SET = {
  WAITRON_PRODUCER_NAME: NAME,
  WAITRON_PRODUCER_TAX_ID: TAX_ID,
  WAITRON_PRODUCER_ADDRESS: ADDRESS,
};

function refusal(env: Readonly<Record<string, string | undefined>>): AppError {
  try {
    readSoftwareProducer(env);
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected readSoftwareProducer to throw");
}

function expectRefusal(
  env: Readonly<Record<string, string | undefined>>,
  params: { setting: string; reason: string },
  value?: string,
): void {
  const error = refusal(env);
  expect(error.code).toBe("software_producer.invalid");
  expect(error.params).toStrictEqual(params);
  const serialised = JSON.stringify({ ...error, message: error.message });
  for (const made of [NAME, TAX_ID, ADDRESS, value].filter((v) => v !== undefined)) {
    expect(serialised).not.toContain(made);
  }
}

describe("readSoftwareProducer", () => {
  it("answers null when none of the three is set", () => {
    expect(readSoftwareProducer({})).toBeNull();
    expect(
      readSoftwareProducer({
        WAITRON_PRODUCER_NAME: undefined,
        WAITRON_PRODUCER_TAX_ID: undefined,
        WAITRON_PRODUCER_ADDRESS: undefined,
      }),
    ).toBeNull();
  });

  it("counts an empty value as unset", () => {
    expect(
      readSoftwareProducer({
        WAITRON_PRODUCER_NAME: "",
        WAITRON_PRODUCER_TAX_ID: "",
        WAITRON_PRODUCER_ADDRESS: "",
      }),
    ).toBeNull();
  });

  it("answers the three values, trimmed, and nothing else", () => {
    expect(
      readSoftwareProducer({
        WAITRON_PRODUCER_NAME: `  ${NAME} `,
        WAITRON_PRODUCER_TAX_ID: `\t${TAX_ID}`,
        WAITRON_PRODUCER_ADDRESS: `${ADDRESS}  `,
        UNRELATED: "x",
      }),
    ).toStrictEqual({ name: NAME, taxId: TAX_ID, address: ADDRESS });
  });

  it.each([
    [{ WAITRON_PRODUCER_NAME: NAME }, "WAITRON_PRODUCER_TAX_ID"],
    [{ WAITRON_PRODUCER_TAX_ID: TAX_ID }, "WAITRON_PRODUCER_NAME"],
    [{ WAITRON_PRODUCER_ADDRESS: ADDRESS }, "WAITRON_PRODUCER_NAME"],
    [{ ...ALL_SET, WAITRON_PRODUCER_NAME: undefined }, "WAITRON_PRODUCER_NAME"],
    [{ ...ALL_SET, WAITRON_PRODUCER_TAX_ID: "" }, "WAITRON_PRODUCER_TAX_ID"],
    [{ ...ALL_SET, WAITRON_PRODUCER_ADDRESS: undefined }, "WAITRON_PRODUCER_ADDRESS"],
  ])("refuses a partial set %j, naming %s", (env, setting) => {
    expectRefusal(env, { setting, reason: "partial" });
  });

  it.each(["WAITRON_PRODUCER_NAME", "WAITRON_PRODUCER_TAX_ID", "WAITRON_PRODUCER_ADDRESS"])(
    "refuses a 201-character %s as too long",
    (setting) => {
      const value = "A".repeat(201);
      expectRefusal({ ...ALL_SET, [setting]: value }, { setting, reason: "too_long" }, value);
    },
  );

  it("takes a 200-character value, measured after trimming", () => {
    const value = "A".repeat(200);
    expect(readSoftwareProducer({ ...ALL_SET, WAITRON_PRODUCER_ADDRESS: ` ${value} ` })).toEqual({
      name: NAME,
      taxId: TAX_ID,
      address: value,
    });
  });

  it.each([
    ["WAITRON_PRODUCER_ADDRESS", "1 Example Street,\n00000 Nowhere (Province), Spain"],
    ["WAITRON_PRODUCER_ADDRESS", "1 Example Street,\r00000 Nowhere (Province), Spain"],
    ["WAITRON_PRODUCER_NAME", `${NAME}\n`],
    ["WAITRON_PRODUCER_TAX_ID", `\n${TAX_ID}`],
  ])("refuses %s holding a line break", (setting, value) => {
    expectRefusal({ ...ALL_SET, [setting]: value }, { setting, reason: "line_break" }, value);
  });

  it.each(["WAITRON_PRODUCER_NAME", "WAITRON_PRODUCER_TAX_ID", "WAITRON_PRODUCER_ADDRESS"])(
    "counts a whitespace-only %s as missing",
    (setting) => {
      expectRefusal({ ...ALL_SET, [setting]: " \t " }, { setting, reason: "missing" });
    },
  );

  it("names the first missing setting when one is unset and another whitespace-only", () => {
    expectRefusal(
      { WAITRON_PRODUCER_NAME: "   ", WAITRON_PRODUCER_ADDRESS: ADDRESS },
      { setting: "WAITRON_PRODUCER_TAX_ID", reason: "partial" },
    );
  });

  it("treats three whitespace-only values as set, and refuses the first", () => {
    expectRefusal(
      {
        WAITRON_PRODUCER_NAME: " ",
        WAITRON_PRODUCER_TAX_ID: " ",
        WAITRON_PRODUCER_ADDRESS: " ",
      },
      { setting: "WAITRON_PRODUCER_NAME", reason: "missing" },
    );
  });
});
