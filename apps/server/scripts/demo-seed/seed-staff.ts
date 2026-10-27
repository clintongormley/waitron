// Inserts directly: a seed script has no management session.

import type { Transaction } from "@waitron/db";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { DEMO_PIN, DEMO_DASHBOARD_PASSWORD } from "./credentials.js";
import type { DemoDataSet } from "./data-set.js";

export interface SeedStaffInput {
  dataSet: DemoDataSet;
}

export async function seedStaff(tx: Transaction, { dataSet }: SeedStaffInput): Promise<void> {
  const pinHash = hashPin(DEMO_PIN);
  for (const person of dataSet.staff) {
    const passwordHash = person.dashboardLogin ? hashPassword(DEMO_DASHBOARD_PASSWORD) : null;
    await tx.insert(persons).values({
      displayName: person.displayName,
      pinHash,
      passwordHash,
      email: person.email,
      role: person.role,
    });
  }
}
