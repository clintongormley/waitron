import { describe, expect, it } from "vitest";
import { ANSWER_REFUSALS, UNLISTED_ERROR_NAME, loggableErrorName } from "./bucket-error-names.js";

const REFUSALS = [
  "IncompleteDeleteResult",
  "IncompleteListing",
  "IncompleteResponse",
  "MissingContinuationToken",
  "MissingETag",
  "RepeatedContinuationToken",
];

describe("loggableErrorName", () => {
  it("holds exactly the six answer-refusal names", () => {
    expect([...ANSWER_REFUSALS]).toEqual(REFUSALS);
  });

  it.each(REFUSALS)("logs the refusal name %s as itself", (name) => {
    expect(loggableErrorName(name)).toBe(name);
  });

  it.each(["AccessDenied", "NoSuchKey", "SlowDown", "ConditionalRequestConflict"])(
    "logs the S3 error name %s as itself",
    (name) => {
      expect(loggableErrorName(name)).toBe(name);
    },
  );

  it.each([
    "",
    "__proto__",
    "constructor",
    "toString",
    "accessdenied",
    "AccessDenied ",
    "NoSuch",
    "AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  ])("logs the unlisted name %j as other", (name) => {
    expect(loggableErrorName(name)).toBe(UNLISTED_ERROR_NAME);
  });

  it("names the unlisted value other", () => {
    expect(UNLISTED_ERROR_NAME).toBe("other");
  });
});
