import { expect } from "vitest";

import { equalBytes } from "./byte-equality.js";

expect.addEqualityTesters([equalBytes]);
