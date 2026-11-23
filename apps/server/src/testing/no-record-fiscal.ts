import type { Database } from "@waitron/db";
import { createTrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { RefundFiscal } from "../tender-refund-reservation.js";

/** What the real backend answers for a hand-inserted sale, which has no filed record, read at `at`. */
export function noRecordFiscal(db: Database, deviceId: string, at: string): RefundFiscal {
  const backend = new FakeFiscalBackend(db);
  backend.setCorrectionAdmission({ eligible: false, reason: "missing" });
  const clock = createTrustedClock({
    deviceId,
    monotonic: () => 0,
    wallClock: () => Date.parse(at),
    degradedAfterSeconds: 300,
  });
  return { backend, reading: clock.now() };
}
