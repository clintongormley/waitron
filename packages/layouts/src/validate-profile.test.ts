// packages/layouts/src/validate-profile.test.ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { MAX_TAB_TITLE_LENGTH, validateProfile } from "./validate-profile.js";

const ok = {
  formFactor: "till",
  capabilities: [],
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
        { type: "total", colSpan: 4, rowSpan: 1, config: {} },
        { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
      ],
    },
  ],
};

function reason(fn: () => unknown): string {
  try {
    fn();
    throw new Error("did not throw");
  } catch (e) {
    if (e instanceof AppError) return String(e.params.reason);
    throw e;
  }
}

describe("validateProfile — structure", () => {
  it("accepts a well-formed till profile", () => {
    expect(validateProfile(ok).formFactor).toBe("till");
  });
  it("returns the tabs it validated", () => {
    const p = validateProfile(ok);
    expect(p.tabs[0].key).toBe("counter");
    expect(p.tabs[0].cards).toHaveLength(4);
    expect(p.capabilities).toEqual([]);
  });
  it("rejects a non-object", () => {
    expect(reason(() => validateProfile(null))).toBe("not_object");
  });
  it("rejects an array (not a plain object)", () => {
    expect(reason(() => validateProfile([]))).toBe("not_object");
  });
  it("rejects an unknown form factor", () => {
    expect(reason(() => validateProfile({ ...ok, formFactor: "watch" }))).toBe("bad_form_factor");
  });
  it("rejects a non-string form factor", () => {
    expect(reason(() => validateProfile({ ...ok, formFactor: 3 }))).toBe("bad_form_factor");
  });
  it("defaults capabilities to [] when omitted", () => {
    const { capabilities: _omit, ...noCaps } = ok;
    void _omit;
    expect(validateProfile(noCaps).capabilities).toEqual([]);
  });
  it("rejects capabilities that are not an array", () => {
    expect(reason(() => validateProfile({ ...ok, capabilities: "act-as-kds" }))).toBe(
      "bad_capabilities",
    );
  });
  it("rejects an unknown capability flag", () => {
    expect(reason(() => validateProfile({ ...ok, capabilities: ["fly"] }))).toBe(
      "bad_capabilities",
    );
  });
  it("rejects a non-array capabilities with bad_capabilities", () => {
    expect(() => validateProfile({ formFactor: "till", capabilities: "x", tabs: [] })).toThrowError(
      expect.objectContaining({ code: "profile.invalid", params: { reason: "bad_capabilities" } }),
    );
  });
  it("rejects an unknown capability flag with bad_capabilities", () => {
    expect(() =>
      validateProfile({ formFactor: "till", capabilities: ["nope"], tabs: [] }),
    ).toThrowError(
      expect.objectContaining({ code: "profile.invalid", params: { reason: "bad_capabilities" } }),
    );
  });
  it("rejects empty tabs", () => {
    expect(reason(() => validateProfile({ ...ok, tabs: [] }))).toBe("no_tabs");
  });
  it("rejects tabs that are not an array", () => {
    expect(reason(() => validateProfile({ ...ok, tabs: "counter" }))).toBe("no_tabs");
  });
  it("rejects a tab that is not an object", () => {
    expect(reason(() => validateProfile({ ...ok, tabs: [null] }))).toBe("bad_tab");
  });
  it("rejects a tab with a missing key", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], key: 3 }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_tab");
  });
  it("rejects a tab with a blank key", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], key: "" }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_tab");
  });
  it("rejects a blank tab title", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], title: "" }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_tab");
  });
  it("rejects a non-string tab title", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], title: 3 }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_tab");
  });
  it("rejects an over-long tab title", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], title: "x".repeat(MAX_TAB_TITLE_LENGTH + 1) }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_tab");
  });
  it("rejects duplicate tab keys", () => {
    const bad = { ...ok, tabs: [ok.tabs[0], { ...ok.tabs[0] }] };
    expect(reason(() => validateProfile(bad))).toBe("duplicate_tab");
  });
  it("rejects columns out of range", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], columns: 99 }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_columns");
  });
  it("rejects columns below 1", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], columns: 0 }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_columns");
  });
  it("rejects a non-integer column count", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], columns: 4.5 }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_columns");
  });
  it("rejects a non-number column count", () => {
    const bad = { ...ok, tabs: [{ ...ok.tabs[0], columns: "12" }] };
    expect(reason(() => validateProfile(bad))).toBe("bad_columns");
  });
  it("locates the offending tab by numeric index, never its key", () => {
    const bad = { ...ok, tabs: [ok.tabs[0], { ...ok.tabs[0], key: "second", title: "" }] };
    try {
      validateProfile(bad);
      throw new Error("did not throw");
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      expect(e.params.tabIndex).toBe(1);
      expect(JSON.stringify(e.params)).not.toContain("second");
    }
  });
});

describe("validateProfile — cards", () => {
  const withCards = (cards: unknown[]) => ({
    formFactor: "kds",
    capabilities: [],
    tabs: [{ key: "t", title: "T", columns: 12, cards }],
  });
  it("rejects cards that are not an array", () => {
    const bad = {
      formFactor: "kds",
      capabilities: [],
      tabs: [{ key: "t", title: "T", columns: 12, cards: "x" }],
    };
    expect(reason(() => validateProfile(bad))).toBe("bad_tab");
  });
  it("rejects a card that is not an object", () => {
    expect(reason(() => validateProfile(withCards([null])))).toBe("unknown_card");
  });
  it("rejects an unknown card type", () => {
    expect(
      reason(() =>
        validateProfile(withCards([{ type: "nope", colSpan: 1, rowSpan: 1, config: {} }])),
      ),
    ).toBe("unknown_card");
  });
  it("rejects a colSpan wider than the tab", () => {
    expect(
      reason(() =>
        validateProfile(withCards([{ type: "kds-board", colSpan: 13, rowSpan: 1, config: {} }])),
      ),
    ).toBe("bad_span");
  });
  it("rejects a colSpan below 1", () => {
    expect(
      reason(() =>
        validateProfile(withCards([{ type: "kds-board", colSpan: 0, rowSpan: 1, config: {} }])),
      ),
    ).toBe("bad_span");
  });
  it("rejects a non-integer colSpan", () => {
    expect(
      reason(() =>
        validateProfile(withCards([{ type: "kds-board", colSpan: 1.5, rowSpan: 1, config: {} }])),
      ),
    ).toBe("bad_span");
  });
  it("rejects a non-number colSpan", () => {
    expect(
      reason(() =>
        validateProfile(withCards([{ type: "kds-board", colSpan: "1", rowSpan: 1, config: {} }])),
      ),
    ).toBe("bad_span");
  });
  it("rejects a rowSpan below 1", () => {
    expect(
      reason(() =>
        validateProfile(withCards([{ type: "kds-board", colSpan: 1, rowSpan: 0, config: {} }])),
      ),
    ).toBe("bad_span");
  });
  it("rejects a non-integer rowSpan", () => {
    expect(
      reason(() =>
        validateProfile(withCards([{ type: "kds-board", colSpan: 1, rowSpan: 2.5, config: {} }])),
      ),
    ).toBe("bad_span");
  });
  it("rejects a non-number rowSpan", () => {
    expect(
      reason(() =>
        validateProfile(withCards([{ type: "kds-board", colSpan: 1, rowSpan: "1", config: {} }])),
      ),
    ).toBe("bad_span");
  });
  it("rejects a config that is not an object", () => {
    expect(
      reason(() =>
        validateProfile(withCards([{ type: "kds-board", colSpan: 1, rowSpan: 1, config: 3 }])),
      ),
    ).toBe("bad_config");
  });
  it("rejects a config key outside the contract", () => {
    expect(
      reason(() =>
        validateProfile(
          withCards([{ type: "product-grid", colSpan: 1, rowSpan: 1, config: { nope: 1 } }]),
        ),
      ),
    ).toBe("bad_config");
  });
  it("rejects a bad config value", () => {
    expect(
      reason(() =>
        validateProfile(
          withCards([{ type: "product-grid", colSpan: 1, rowSpan: 1, config: { columns: 99 } }]),
        ),
      ),
    ).toBe("bad_config");
  });
  it("accepts a valid config value", () => {
    const p = validateProfile(
      withCards([{ type: "product-grid", colSpan: 1, rowSpan: 1, config: { columns: 6 } }]),
    );
    expect(p.tabs[0].cards[0].config).toEqual({ columns: 6 });
  });
  it("names the offending config key, never its value", () => {
    try {
      validateProfile(
        withCards([{ type: "product-grid", colSpan: 1, rowSpan: 1, config: { columns: 99 } }]),
      );
      throw new Error("did not throw");
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      expect(e.params.configKey).toBe("columns");
      expect(e.params.card).toBe("product-grid");
      expect(JSON.stringify(e.params)).not.toContain("99");
    }
  });
  it("rejects visibleWhen outside the card's declared states", () => {
    expect(
      reason(() =>
        validateProfile(
          withCards([
            { type: "notifications", colSpan: 1, rowSpan: 1, config: {}, visibleWhen: ["nope"] },
          ]),
        ),
      ),
    ).toBe("bad_visible_when");
  });
  it("rejects a visibleWhen that is not an array", () => {
    expect(
      reason(() =>
        validateProfile(
          withCards([
            { type: "notifications", colSpan: 1, rowSpan: 1, config: {}, visibleWhen: "unread" },
          ]),
        ),
      ),
    ).toBe("bad_visible_when");
  });
  it("rejects a non-string visibleWhen entry", () => {
    expect(
      reason(() =>
        validateProfile(
          withCards([
            { type: "notifications", colSpan: 1, rowSpan: 1, config: {}, visibleWhen: [3] },
          ]),
        ),
      ),
    ).toBe("bad_visible_when");
  });
  it("accepts a valid visibleWhen subset", () => {
    const p = validateProfile(
      withCards([
        { type: "notifications", colSpan: 1, rowSpan: 1, config: {}, visibleWhen: ["unread"] },
      ]),
    );
    expect(p.tabs[0].cards[0].visibleWhen).toEqual(["unread"]);
  });
  it("omits visibleWhen on the result when absent", () => {
    const p = validateProfile(
      withCards([{ type: "kds-board", colSpan: 1, rowSpan: 1, config: {} }]),
    );
    expect(p.tabs[0].cards[0].visibleWhen).toBeUndefined();
  });
  it("normalises an empty visibleWhen to omitted (absent or empty ⇒ always render)", () => {
    const p = validateProfile(
      withCards([{ type: "notifications", colSpan: 1, rowSpan: 1, config: {}, visibleWhen: [] }]),
    );
    // Empty must NOT survive as `[]` — a renderer would misread it as "no state matches ⇒ never render".
    expect(p.tabs[0].cards[0].visibleWhen).toBeUndefined();
  });
  it("copies a kept visibleWhen so the result does not alias the input", () => {
    const input = ["unread"];
    const p = validateProfile(
      withCards([
        { type: "notifications", colSpan: 1, rowSpan: 1, config: {}, visibleWhen: input },
      ]),
    );
    expect(p.tabs[0].cards[0].visibleWhen).toEqual(["unread"]);
    expect(p.tabs[0].cards[0].visibleWhen).not.toBe(input);
  });
  it("does not alias the input card config", () => {
    // kds (non-selling) so a single product-grid card is enough — a till would throw missing_required
    // before returning, never reaching the aliasing assertion (assertSaleCritical fires only for till).
    const input = {
      formFactor: "kds",
      capabilities: [],
      tabs: [
        {
          key: "t",
          title: "T",
          columns: 12,
          cards: [{ type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } }],
        },
      ],
    };
    const out = validateProfile(input);
    expect(out.tabs[0].cards[0].config).not.toBe(input.tabs[0].cards[0].config);
    (input.tabs[0].cards[0].config as Record<string, unknown>).columns = 999;
    expect(out.tabs[0].cards[0].config.columns).toBe(4);
  });
});

describe("validateProfile — sale-critical", () => {
  it("rejects a till profile missing a sale-critical card", () => {
    const bad = {
      formFactor: "till",
      capabilities: [],
      tabs: [
        {
          key: "c",
          title: "C",
          columns: 12,
          cards: [
            { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
            { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
            { type: "total", colSpan: 4, rowSpan: 1, config: {} },
            // tender-pay missing
          ],
        },
      ],
    };
    expect(reason(() => validateProfile(bad))).toBe("missing_required");
  });
  it("names the missing sale-critical card", () => {
    const bad = {
      formFactor: "till",
      capabilities: [],
      tabs: [
        {
          key: "c",
          title: "C",
          columns: 12,
          cards: [
            { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
            { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
            { type: "total", colSpan: 4, rowSpan: 1, config: {} },
          ],
        },
      ],
    };
    try {
      validateProfile(bad);
      throw new Error("did not throw");
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      expect(e.params.card).toBe("tender-pay");
    }
  });
  it("allows a kds profile with none of the sale cards", () => {
    const p = validateProfile({
      formFactor: "kds",
      capabilities: ["act-as-kds"],
      tabs: [
        {
          key: "k",
          title: "Kitchen",
          columns: 24,
          cards: [{ type: "kds-board", colSpan: 24, rowSpan: 12, config: {} }],
        },
      ],
    });
    expect(p.formFactor).toBe("kds");
  });
});
