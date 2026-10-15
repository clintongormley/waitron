import { describe, expect, it } from "vitest";
import { roleInitials } from "./role-initials.js";

describe("roleInitials", () => {
  it("takes the first letter of the first and last words, in capitals", () => {
    expect(roleInitials("Head chef")).toBe("HC");
    expect(roleInitials("sous chef")).toBe("SC");
    expect(roleInitials("Jefe de cocina")).toBe("JC");
  });

  it("takes the first two letters of a one-word name, capitalising only the first", () => {
    expect(roleInitials("Dishwasher")).toBe("Di");
    expect(roleInitials("barman")).toBe("Ba");
    expect(roleInitials("BBQ")).toBe("BB");
    expect(roleInitials("Sous-chef")).toBe("So");
  });

  it("keeps accented letters whole, whether written as one character or a letter and a mark", () => {
    expect(roleInitials("élan")).toBe("Él");
    expect(roleInitials("ñoño ayudante")).toBe("ÑA");
    expect(roleInitials("éclair")).toBe("Éc");
  });

  it("ignores spacing around and between words", () => {
    expect(roleInitials("  Head   chef ")).toBe("HC");
    expect(roleInitials("   ")).toBe("");
    expect(roleInitials("W")).toBe("W");
  });

  it("gives two roles the same initials when their words start alike", () => {
    expect(roleInitials("Sous chef")).toBe(roleInitials("Senior cook"));
  });
});
