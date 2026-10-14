import { describe, expect, it } from "vitest";
import { codeMessage } from "@waitron/dashboard-kit";
import { colourName, holderCount, STAFFING_STRINGS, tf } from "./strings.js";

describe("staffing strings", () => {
  it("names the page in both languages", () => {
    expect(STAFFING_STRINGS.en["nav.staff_roles"]).toBe("Staff roles");
    expect(STAFFING_STRINGS.es["nav.staff_roles"]).toBe("Roles de personal");
  });

  it("fills each placeholder, and leaves one with no value as written", () => {
    expect(tf("staffing.role.delete_question", { name: "Waiter" }, "en")).toBe("Delete Waiter?");
    expect(tf("staffing.role.delete_question", {}, "en")).toBe("Delete {name}?");
  });

  it("counts holders in the singular and the plural", () => {
    expect(holderCount(0, "en")).toBe("No people");
    expect(holderCount(1, "en")).toBe("1 person");
    expect(holderCount(3, "en")).toBe("3 people");
    expect(holderCount(0, "es")).toBe("Nadie");
    expect(holderCount(1, "es")).toBe("1 persona");
    expect(holderCount(3, "es")).toBe("3 personas");
  });

  it("names each calendar colour", () => {
    expect(colourName("purple", "en")).toBe("Purple");
    expect(colourName("amber", "es")).toBe("Ámbar");
  });

  it("registers a message for each code the page can meet", () => {
    for (const code of [
      "staff_role.name_taken",
      "staff_role.in_use",
      "staff_role.not_found",
      "staffing.invalid",
    ]) {
      expect(codeMessage(code, "en")).not.toBe(codeMessage("server.internal", "en"));
      expect(codeMessage(code, "es")).not.toBe(codeMessage("server.internal", "es"));
    }
    expect(codeMessage("staff_role.name_taken", "en")).toBe("Another staff role has this name");
  });
});
