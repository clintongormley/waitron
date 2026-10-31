import { expect, it } from "vitest";
import { startAgainRefusalCause } from "./first-setup-session.js";

it.each([
  {
    name: "an unknown cause",
    error: { code: "setup.start_again_refused", params: { cause: "x" } },
  },
  { name: "no cause", error: { code: "setup.start_again_refused", params: {} } },
  { name: "no params", error: { code: "setup.start_again_refused" } },
  {
    name: "a cause on another code",
    error: { code: "setup.not_ready", params: { cause: "kept-records" } },
  },
  {
    name: "a cause that is not a string",
    error: { code: "setup.start_again_refused", params: { cause: 1 } },
  },
  {
    name: "a cause inherited, not its own",
    error: {
      code: "setup.start_again_refused",
      params: Object.create({ cause: "kept-records" }) as object,
    },
  },
  { name: "a thrown Error", error: new Error("no") },
  { name: "null", error: null },
  { name: "a string", error: "setup.start_again_refused" },
])(
  "names no Start again refusal cause for $name, so the page shows a generic refusal",
  ({ error }) => {
    expect(startAgainRefusalCause(error)).toBeUndefined();
  },
);
