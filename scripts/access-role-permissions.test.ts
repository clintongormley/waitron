import { expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { CORE_PERMISSIONS } from "../packages/identity/src/permissions.js";
import { PERMISSION_TEXT } from "../apps/dashboard/src/i18n/permissions.js";
import { en, es } from "../apps/dashboard/src/i18n/strings.js";

it("gives every declared permission an area and a label in both interface languages", () => {
  const declarations = [
    ...CORE_PERMISSIONS,
    ...ALL_MODULES.flatMap((module) => module.permissions ?? []),
  ];
  expect(declarations.length).toBeGreaterThan(21);
  for (const { permission } of declarations) {
    const text = PERMISSION_TEXT[permission];
    expect(text, permission).toBeDefined();
    expect(["sales", "reports", "people", "venue"]).toContain(text!.area);
    expect(en[text!.label], permission).toBeTruthy();
    expect(es[text!.label], permission).toBeTruthy();
  }
});
