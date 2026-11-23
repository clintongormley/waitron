import { expect, it } from "vitest";
import { FISCAL_SERVER_KEY_AS_TYPED } from "./recovery-key-code.js";

const secret = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const printed = "06R9 T4FH M4H3 599J EEMM 5D5D ABTV 2RSX 6QDQ WE8M C";
const code = printed.replaceAll(" ", "");

it.each([printed, printed.toLowerCase(), code, `  ${printed.replaceAll(" ", "   ")} `])(
  "reads a server key typed as printed, in any case and spacing, as its secret %#",
  (typed) => {
    expect(FISCAL_SERVER_KEY_AS_TYPED(typed)).toBe(secret);
  },
);
it.each([secret, "", code.slice(1), code.replace("M", "U")])(
  "reads text that is not a printed server key as no key %#",
  (typed) => {
    expect(FISCAL_SERVER_KEY_AS_TYPED(typed)).toBeUndefined();
  },
);
