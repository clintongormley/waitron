import { describe, expect, it } from "vitest";
import { ALL_SYNC_ENROLMENTS, MODULE_BY_TABLE } from "./modules.js";

describe("MODULE_BY_TABLE", () => {
  it("maps every enrolled table to its owning module", () => {
    expect(MODULE_BY_TABLE.get("sales")).toBe("core");
    expect(MODULE_BY_TABLE.get("ticket_items")).toBe("core");
    expect(MODULE_BY_TABLE.get("persons")).toBe("identity");
    expect(MODULE_BY_TABLE.get("webauthn_credentials")).toBe("identity");
    expect(MODULE_BY_TABLE.get("payments")).toBe("payments");
    expect(MODULE_BY_TABLE.get("payment_policy")).toBe("payments");
  });
  it("covers exactly the assembled enrolment's tables", () => {
    expect([...MODULE_BY_TABLE.keys()].sort()).toEqual(
      ALL_SYNC_ENROLMENTS.map((e) => e.table).sort(),
    );
    expect(MODULE_BY_TABLE.size).toBe(ALL_SYNC_ENROLMENTS.length); // 28, no duplicate table
  });
});
