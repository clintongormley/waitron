import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import { staffRoleDeleteCopy } from "./staff-role-delete-copy.js";
import { STAFFING_STRINGS } from "./strings.js";

const before = currentLocale();
afterEach(() => setLocale(before));
it.each(["en", "es"] as const)("confirms the holder count without a preview in %s", (locale) => {
  setLocale(locale);
  const copy = staffRoleDeleteCopy(3);
  expect(copy.irreversible).toBe(
    STAFFING_STRINGS[locale]["staffing.role.delete_question"].replace("{count}", "3"),
  );
  expect(copy.confirm).toBe(STAFFING_STRINGS[locale]["staffing.role.delete"]);
});
