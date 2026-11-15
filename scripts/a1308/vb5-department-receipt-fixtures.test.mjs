import { describe, expect, it } from "vitest";
import { receiptFixtures } from "./vb5-department-receipt-fixtures.mjs";

const path = "apps/server/src/example.test.ts";
describe("department receipt fixture conversion", () => {
  it("rewrites inserts, drops the old timestamp/conflict chain, and imports once", () => {
    const source = `import { departmentReceipts } from "@waitron/db";
await tx.insert(departmentReceipts).values({ departmentId: d, receipt: r, logoRasters: pictures, updatedAt: now }).onConflictDoUpdate({ target: departmentReceipts.departmentId, set: values });
await db.insert(departmentReceipts).values({ departmentId, receipt });`;
    const result = receiptFixtures(source, path);
    expect(result.reports).toEqual([]);
    expect(result.text).toContain("await seedDepartmentReceipt(tx, d, r, pictures)");
    expect(result.text).toContain("await seedDepartmentReceipt(db, departmentId, receipt)");
    expect(result.text).not.toContain("departmentReceipts");
    expect(result.text.match(/import \{ seedDepartmentReceipt \}/g)).toHaveLength(1);
    expect(receiptFixtures(result.text, path)).toEqual({ text: result.text, reports: [] });
  });
  it.each([
    `await tx.insert(departmentReceipts).values({ departmentId: d, ...r });`,
    `await tx.insert(departmentReceipts).values([{ departmentId: d, receipt: r }]);`,
    "await db.execute(sql`insert into department_receipts (department_id, receipt) values (${d}, ${r})`);",
  ])("reports unsupported input with a line and keeps it unchanged: %s", (source) => {
    const result = receiptFixtures(source, path);
    expect(result.text).toBe(source);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatch(/^apps\/server\/src\/example.test.ts:1: /);
  });
});
