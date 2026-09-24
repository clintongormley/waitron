import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./index.js"; // loads the barrel, which loads errors.ts

describe("stream error registry", () => {
  it("constructs each code with its params", () => {
    const cases = [
      new AppError("backup.stream_precondition_failed", { key: "k" }),
      new AppError("backup.stream_request_failed", {
        operation: "get",
        key: "k",
        status: null,
        name: "Error",
      }),
      new AppError("backup.stream_pointer_invalid", { reason: "shape" }),
      new AppError("backup.stream_name_invalid", { field: "term", value: "-1" }),
    ];
    expect(cases.map((error) => error.code)).toEqual([
      "backup.stream_precondition_failed",
      "backup.stream_request_failed",
      "backup.stream_pointer_invalid",
      "backup.stream_name_invalid",
    ]);
  });
});
