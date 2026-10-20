import { expect, it } from "vitest";
import { firstFiscalPublicDigest, firstFiscalPublicJson } from "./first-setup-public-digest.js";

it("serializes public delivery evidence with sorted object keys and unchanged array order", () => {
  const value = { z: { b: 2, a: false }, a: [1, null, "x"] };
  expect(firstFiscalPublicJson(value)).toBe('{"a":[1,null,"x"],"z":{"a":false,"b":2}}');
  expect(firstFiscalPublicDigest(value)).toBe(
    "0abc570b0b69d1d6f1394ca1c8cbe11d48650529578ff0e03e71832881532f1b",
  );
  expect(firstFiscalPublicJson({ a: ["x", null, 1], z: { a: false, b: 2 } })).toBe(
    '{"a":["x",null,1],"z":{"a":false,"b":2}}',
  );
});

it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date(0), { secret: undefined }])(
  "refuses public evidence that JSON cannot represent without loss: %s",
  (value) => {
    expect(() => firstFiscalPublicJson(value)).toThrow(
      expect.objectContaining({ code: "setup.attempt_invalid" }),
    );
    expect(() => firstFiscalPublicDigest(value)).toThrow(
      expect.objectContaining({ code: "setup.attempt_invalid" }),
    );
  },
);

it("bounds recursive evidence before serializing or hashing it", () => {
  let value: unknown = "leaf";
  for (let depth = 0; depth < 34; depth++) value = { nested: value };
  expect(() => firstFiscalPublicJson(value)).toThrow(
    expect.objectContaining({ code: "setup.attempt_invalid" }),
  );
  expect(() => firstFiscalPublicDigest(value)).toThrow(
    expect.objectContaining({ code: "setup.attempt_invalid" }),
  );
});
