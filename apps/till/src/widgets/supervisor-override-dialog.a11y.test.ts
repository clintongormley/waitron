import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./supervisor-override-dialog.js";
import type { TillSupervisorOverrideDialog } from "./supervisor-override-dialog.js";
import type { StaffMember } from "../api/client.js";

const authorizers: StaffMember[] = [
  { personId: "sup-1", displayName: "Responsable" },
  { personId: "adm-1", displayName: "Administradora" },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)(
  "till-supervisor-override-dialog a11y (%s theme)",
  (theme) => {
    it("has no violations in the supervisor picker", async () => {
      setLocale("es-ES");
      const { host } = await mountWidget<TillSupervisorOverrideDialog>(
        "till-supervisor-override-dialog",
        { authorizers },
        theme,
      );
      await expectNoA11yViolations(host);
    });

    it("has no violations in PIN mode with a retry error shown", async () => {
      setLocale("es-ES");
      const { el, host } = await mountWidget<TillSupervisorOverrideDialog>(
        "till-supervisor-override-dialog",
        { authorizers },
        theme,
      );
      // Enter PIN mode for a supervisor, then surface a retry error (the failed-attempt state).
      el.shadowRoot!.querySelector<HTMLElement>('[data-person="sup-1"]')!.click();
      await el.updateComplete;
      el.error = "pin.invalid";
      await el.updateComplete;
      await expectNoA11yViolations(host);
    });
  },
);
