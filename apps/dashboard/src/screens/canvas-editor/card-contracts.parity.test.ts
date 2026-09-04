// card-contracts.parity.test.ts — the mirror must equal the @waitron/layouts source (drift guard,
// CLAUDE.md §2 hardcoded-cross-package-list trap). Deep-imports the PURE source modules only
// (card-contract.js + canvas.js are DB-free, so they load in headless Chromium); NEVER the barrel.
import { describe, expect, it } from "vitest";
import {
  CARD_CONTRACTS as SRC,
  GRID_MAX_COLUMNS as SRC_MAX,
  SALE_CRITICAL_CARDS as SRC_SALE,
} from "@waitron/layouts/src/card-contract.js";
import {
  CARD_TYPES as SRC_TYPES,
  CAPABILITY_FLAGS as SRC_CAPS,
  FORM_FACTORS as SRC_FF,
} from "@waitron/layouts/src/canvas.js";
import {
  MAX_TAB_TITLE_LENGTH as SRC_TITLE,
  SELLING_FORM_FACTORS as SRC_SELLING,
} from "@waitron/layouts/src/validate-canvas.js";
import { DEFAULT_CANVASES as SRC_DEF } from "@waitron/layouts/src/default-canvases.js";
import {
  CARD_CONTRACTS,
  CARD_TYPES,
  CAPABILITY_FLAGS,
  DEFAULT_CANVASES,
  FORM_FACTORS,
  GRID_MAX_COLUMNS,
  MAX_TAB_TITLE_LENGTH,
  SALE_CRITICAL_CARDS,
  SELLING_FORM_FACTORS,
} from "./card-contracts.js";

describe("card-contracts mirror parity", () => {
  it("mirrors the constant tuples and scalars", () => {
    expect([...CARD_TYPES]).toEqual([...SRC_TYPES]);
    expect([...CAPABILITY_FLAGS]).toEqual([...SRC_CAPS]);
    expect([...FORM_FACTORS]).toEqual([...SRC_FF]);
    expect(GRID_MAX_COLUMNS).toBe(SRC_MAX);
    expect(MAX_TAB_TITLE_LENGTH).toBe(SRC_TITLE);
    expect([...SALE_CRITICAL_CARDS]).toEqual([...SRC_SALE]);
    expect([...SELLING_FORM_FACTORS]).toEqual([...SRC_SELLING]);
  });

  it("mirrors each card's contract fields (spans, states, permission, capability, saleCritical, config keys)", () => {
    for (const type of SRC_TYPES) {
      const src = SRC[type];
      const mirror = CARD_CONTRACTS[type];
      expect(mirror.defaultColSpan).toBe(src.defaultColSpan);
      expect(mirror.defaultRowSpan).toBe(src.defaultRowSpan);
      expect([...mirror.visibilityStates]).toEqual([...src.visibilityStates]);
      expect(mirror.requiredPermission).toBe(src.requiredPermission);
      expect(mirror.requiredCapability).toBe(src.requiredCapability);
      expect(mirror.saleCritical).toBe(src.saleCritical);
      expect([...mirror.configFields].sort()).toEqual(Object.keys(src.configSchema).sort());
    }
  });

  it("mirrors the built-in default canvases (one profile per form factor)", () => {
    expect(DEFAULT_CANVASES).toEqual(SRC_DEF);
  });
});
