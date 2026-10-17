import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { parseBillEditExpected } from "./bill-editing.js";

const billId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const draftId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const current = { billId, editorVersion: 3, draftId, draftRevision: 7 };

describe("bill edit expectation input", () => {
  it("accepts explicit released and owned states without trusting extra identity fields", () => {
    expect(
      parseBillEditExpected({ billId, editorVersion: 0, draftId: null, draftRevision: null }),
    ).toEqual({ billId, editorVersion: 0, draftId: null, draftRevision: null });
    expect(parseBillEditExpected({ ...current, ownerId: "another person" })).toEqual(current);
  });

  it("normalises UUID case without changing versions", () => {
    expect(
      parseBillEditExpected({
        ...current,
        billId: billId.toUpperCase(),
        draftId: draftId.toUpperCase(),
      }),
    ).toEqual(current);
  });

  it.each([
    { input: undefined },
    { input: null },
    { input: [] },
    { input: "" },
    { input: 0 },
    { input: true },
  ])("refuses a non-object expectation $input", ({ input }) => {
    expect(() => parseBillEditExpected(input)).toThrowError(AppError);
    try {
      parseBillEditExpected(input);
    } catch (error) {
      expect(error).toMatchObject({
        code: "management.request_invalid",
        params: { field: "expectedEdit" },
      });
    }
  });

  it.each([
    ["billId", undefined],
    ["billId", null],
    ["billId", ""],
    ["billId", "wrong"],
    ["billId", [billId]],
    ["editorVersion", undefined],
    ["editorVersion", null],
    ["editorVersion", "3"],
    ["editorVersion", -1],
    ["editorVersion", 0.5],
    ["editorVersion", NaN],
    ["editorVersion", Infinity],
    ["editorVersion", Number.MAX_SAFE_INTEGER + 1],
    ["draftId", undefined],
    ["draftId", ""],
    ["draftId", "wrong"],
    ["draftId", [draftId]],
    ["draftRevision", undefined],
    ["draftRevision", "7"],
    ["draftRevision", -1],
    ["draftRevision", 0.5],
    ["draftRevision", NaN],
    ["draftRevision", Infinity],
    ["draftRevision", Number.MAX_SAFE_INTEGER + 1],
  ])("refuses malformed %s: %j without defaulting it", (field, value) => {
    const parse = () => parseBillEditExpected({ ...current, [field as string]: value });
    expect(parse).toThrowError(AppError);
    try {
      parse();
    } catch (error) {
      expect(error).toMatchObject({
        code: "management.request_invalid",
        params: { field: `expectedEdit.${field as string}` },
      });
    }
  });

  it.each([
    { ...current, draftId: null },
    { ...current, draftRevision: null },
  ])("refuses an incomplete draft identity %j", (input) => {
    expect(() => parseBillEditExpected(input)).toThrowError(AppError);
    try {
      parseBillEditExpected(input);
    } catch (error) {
      expect(error).toMatchObject({
        code: "management.request_invalid",
        params: { field: "expectedEdit.draftRevision" },
      });
    }
  });
});
