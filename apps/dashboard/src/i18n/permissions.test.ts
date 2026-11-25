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

// Cancel and credit on the till names this permission in these words ("issue corrective receipts and
// invoices"), so the two change together.
it("names the permission to correct an issued document as the till does", () => {
  expect(PERMISSION_TEXT["sale.rectify"].label).toBe("permission.sale.rectify");
  expect(en["permission.sale.rectify"]).toBe("Issue corrective receipts and invoices");
  expect(en["permission.sale.rectify.help"]).toContain("a corrective receipt or invoice");
});
