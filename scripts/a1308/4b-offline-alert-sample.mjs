import { readFileSync, writeFileSync } from "node:fs";

const files = [
  "apps/server/src/alerts-api.test.ts",
  "apps/server/src/alerts.test.ts",
  "apps/dashboard/src/dashboard-app.a11y.test.ts",
  "apps/dashboard/src/dashboard-app.help.test.ts",
  "apps/dashboard/src/dashboard-app.test.ts",
  "apps/dashboard/src/screens/alerts-screen.test.ts",
  "apps/dashboard/src/screens/box-status-screen.test.ts",
  "apps/dashboard/src/widgets/alerts-bell.test.ts",
];
const oldCode = "payment.offline_forward_declined";
for (const file of files) {
  const before = readFileSync(file, "utf8");
  const count = before.split(oldCode).length - 1;
  if (count) writeFileSync(file, before.replaceAll(oldCode, "payment.refund_unresolved"));
  console.log(`${file}: ${count}`);
}
