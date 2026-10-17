import { afterEach, describe, expect, it } from "vitest";
import { codeMessage, setLocale } from "@waitron/dashboard-kit";
import { droppedNotice } from "./painter-parts.js";
import { colourName, holderNames, peopleNeeded, STAFFING_STRINGS, tf } from "./strings.js";

afterEach(() => setLocale("en"));

describe("staffing strings", () => {
  it("names the page in both languages", () => {
    expect(STAFFING_STRINGS.en["nav.staff_roles"]).toBe("Staff roles");
    expect(STAFFING_STRINGS.es["nav.staff_roles"]).toBe("Roles de personal");
  });

  it("fills each placeholder, and leaves one with no value as written", () => {
    expect(tf("staffing.role.actions", { name: "Waiter" }, "en")).toBe("Actions for Waiter");
    expect(tf("staffing.role.actions", {}, "en")).toBe("Actions for {name}");
  });

  it("names the holders, and past the cut-off says how many more", () => {
    const names = (count: number) => Array.from({ length: count }, (_, index) => `P${index + 1}`);
    expect(holderNames([], 5, "en")).toBe("No people");
    expect(holderNames([], 5, "es")).toBe("Nadie");
    expect(holderNames(["Ana", "Marc"], 5, "en")).toBe("Ana, Marc");
    expect(holderNames(names(5), 5, "en")).toBe("P1, P2, P3, P4, P5");
    expect(holderNames(names(6), 5, "en")).toBe("P1, P2, P3, P4, P5 plus 1 more");
    expect(holderNames(names(12), 5, "en")).toBe("P1, P2, P3, P4, P5 plus 7 more");
    expect(holderNames(names(12), 5, "es")).toBe("P1, P2, P3, P4, P5 y 7 más");
  });

  it("says how many people a block needs in the singular and the plural", () => {
    expect(peopleNeeded(1, "en")).toBe("1 person");
    expect(peopleNeeded(3, "en")).toBe("3 people");
    expect(peopleNeeded(1, "es")).toBe("1 persona");
    expect(peopleNeeded(3, "es")).toBe("3 personas");
  });

  it("says one or several areas and dates were removed", () => {
    setLocale("en");
    expect(droppedNotice(["Bar"], ["Fri 25 Dec"])).toBe(
      "Bar was removed; its changes were dropped. Fri 25 Dec was removed from this special day; its changes were dropped.",
    );
    expect(droppedNotice(["Bar", "Kitchen"], ["Thu 24 Dec", "Fri 25 Dec"])).toBe(
      "Bar and Kitchen were removed; their changes were dropped. Thu 24 Dec and Fri 25 Dec were removed from this special day; their changes were dropped.",
    );
    setLocale("es");
    expect(droppedNotice(["Barra", "Cocina"], ["jue 24 dic", "vie 25 dic"])).toBe(
      "Barra y Cocina se eliminaron; sus cambios se descartaron. jue 24 dic y vie 25 dic se quitaron de este día especial; sus cambios se descartaron.",
    );
  });

  it("names each calendar colour", () => {
    expect(colourName("purple", "en")).toBe("Purple");
    expect(colourName("amber", "es")).toBe("Ámbar");
    expect(colourName("teal", "en")).toBe("Teal");
    expect(colourName("teal", "es")).toBe("Turquesa");
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
