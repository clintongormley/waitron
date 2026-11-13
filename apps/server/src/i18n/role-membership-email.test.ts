import { expect, it } from "vitest";
import { ROLE_MEMBERSHIP_EMAIL_WORDS } from "./role-membership-email.js";

it("names built-in roles in Spanish", () => {
  expect(ROLE_MEMBERSHIP_EMAIL_WORDS.es.roles).toEqual({
    staff: "Empleado",
    supervisor: "Supervisor",
    manager: "Encargado",
    admin: "Administrador",
  });
});

it("words additions and removals in Spanish, preserving a custom role's name", () => {
  const copy = ROLE_MEMBERSHIP_EMAIL_WORDS.es;
  expect(copy.added.subject("Night service")).toBe("Rol añadido: Night service");
  expect(copy.added.text("Editor", "Night service", "13 nov 2026, 13:00")).toBe(
    "Editor te añadió al rol Night service el 13 nov 2026, 13:00.",
  );
  expect(copy.removed.subject("Administrador")).toBe("Rol quitado: Administrador");
  expect(copy.removed.text("Editor", "Administrador", "13 nov 2026, 13:00")).toBe(
    "Editor te quitó del rol Administrador el 13 nov 2026, 13:00.",
  );
});
