import { expect, it } from "vitest";
import { PERMISSION_TEXT } from "./permissions.js";
import { en, es } from "./strings.js";

it.each(["sales", "reports", "people", "venue"])(
  "explains every %s permission in both interface languages",
  (area) => {
    const permissions = Object.entries(PERMISSION_TEXT).filter(([, text]) => text.area === area);
    expect(permissions.length).toBeGreaterThan(0);
    for (const [permission, text] of permissions) {
      expect(text.help, permission).toBeTruthy();
      expect(en[text.help!], permission).toBeTruthy();
      expect(es[text.help!], permission).toBeTruthy();
    }
  },
);
