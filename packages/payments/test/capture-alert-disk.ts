import type { Database } from "@waitron/db";
import { sql } from "drizzle-orm";

export function fullDiskOnCaptureAlert(db: Database): { lift(): void } {
  db.run(sql.raw("create table if not exists full_disk_pad (body blob)"));
  db.run(
    sql.raw(
      "create trigger full_disk_on_capture_alert before insert on incidents when new.code = 'payment.capture_mismatch' begin insert into full_disk_pad values (zeroblob(16777216)); end",
    ),
  );
  const [row] = db.all<{ page_count: number }>(sql`pragma page_count`);
  db.all(sql.raw(`pragma max_page_count = ${row!.page_count + 128}`));
  return {
    lift() {
      db.all(sql.raw("pragma max_page_count = 4294967294"));
      db.run(sql.raw("drop trigger full_disk_on_capture_alert"));
    },
  };
}
