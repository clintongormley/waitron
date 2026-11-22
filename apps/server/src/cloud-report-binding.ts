import { createHash } from "node:crypto";
import type { Database } from "@waitron/db";
import { sql } from "drizzle-orm";
import { venueDbIdentity } from "./backup-room-note.js";

export interface CloudReportBinding {
  venue: string;
  database: string;
  registration?: string | null;
}

export function cloudReportBinding(
  db: Database,
  venueDir: string,
  environment: string,
  registration: () => Promise<string | undefined>,
) {
  function venue(): string | undefined {
    const taxpayer = db.get<{ country: string; tax_id: string; created_at: string }>(sql`
      select country, tax_id, created_at from taxpayer where id = 1
    `);
    if (!taxpayer) return undefined;
    // A restored venue retains its taxpayer row, while a fresh setup gives it a new creation time.
    return createHash("sha256")
      .update(JSON.stringify([environment, taxpayer.country, taxpayer.tax_id, taxpayer.created_at]))
      .digest("hex");
  }
  return {
    venue,
    async current(includeRegistration = true) {
      return {
        venue: venue(),
        database: JSON.stringify(await venueDbIdentity(venueDir)),
        registration: includeRegistration ? await registration() : undefined,
      };
    },
  };
}

export function sameCloudReportBinding(
  saved: CloudReportBinding,
  current: { venue: string | undefined; database: string; registration?: string | null },
): boolean {
  return (
    saved.venue === current.venue &&
    saved.database === current.database &&
    (saved.registration === undefined || saved.registration === (current.registration ?? null))
  );
}
