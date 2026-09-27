-- `bill_payments_guard_update` again, now holding the two attestation columns 0024 added: a manager's
-- name and note arrive together, with a non-blank note, only with the move out of `pending`, and never
-- change after. Every other rule is 0023's, unchanged. The `coalesce` is load-bearing: without it a
-- null note makes the whole condition NULL, which `WHERE NOT (…)` reads as "let it through" (the
-- "only the person" case in `src/schema/bill-payments.test.ts`).
DROP TRIGGER bill_payments_guard_update;
--> statement-breakpoint
CREATE TRIGGER bill_payments_guard_update
BEFORE UPDATE ON bill_payments
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'bill payment cannot make that change')
  WHERE NOT (
    new.id IS old.id
    AND new.working_order_id IS old.working_order_id
    AND new.submission_id IS old.submission_id
    AND new.fingerprint IS old.fingerprint
    AND new.kind IS old.kind
    AND new.share_of IS old.share_of
    AND new.method IS old.method
    AND new.applied IS old.applied
    AND new.tip IS old.tip
    AND new.tendered IS old.tendered
    AND new.requested_by IS old.requested_by
    AND new.till_id IS old.till_id
    AND new.created_at IS old.created_at
    AND (
      (new.state IS old.state
        AND new.received_at IS old.received_at
        AND new.failed_at IS old.failed_at
        AND new.attested_by IS old.attested_by
        AND new.attestation_note IS old.attestation_note)
      OR (old.state = 'pending' AND new.state IN ('received', 'failed')
        AND ((new.attested_by IS NULL AND new.attestation_note IS NULL)
          OR (new.attested_by IS NOT NULL AND coalesce(length(trim(new.attestation_note)), 0) > 0)))
      OR (old.state = 'received' AND new.state = 'declined'
        AND new.received_at IS old.received_at
        AND new.attested_by IS old.attested_by
        AND new.attestation_note IS old.attestation_note
        AND NOT exists (SELECT 1 FROM tenders WHERE bill_payment_id = old.id))
    )
  );
END;
