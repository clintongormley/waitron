-- The state rules of a bill payment and of a refund of one (bill payments design §2.1, §2.3, §6b).
-- Both tables are `ledger` but not append-only, because an outcome arrives after the row is written;
-- these triggers are what stops anything else about a row changing. The refusal texts are declared
-- once in `packages/db/src/trigger-refusals.ts`.
--
-- A column added to either table later is writable until it joins the column list of its table's
-- guard here: each guard names every column it holds fixed.

-- A bill payment moves only pending → received, pending → failed, and received → declined while no
-- tender names it; an update that changes nothing is let through. `received_at` and `failed_at`
-- follow the state by the table's own checks, so only a move of one already set is refused here.
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
        AND new.failed_at IS old.failed_at)
      OR (old.state = 'pending' AND new.state IN ('received', 'failed'))
      OR (old.state = 'received' AND new.state = 'declined'
        AND new.received_at IS old.received_at
        AND NOT exists (SELECT 1 FROM tenders WHERE bill_payment_id = old.id))
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER bill_payments_no_delete
BEFORE DELETE ON bill_payments
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a bill payment is never deleted');
END;
--> statement-breakpoint
-- While a refund is pending: `sent_at` may be set once, `send_count` raised by one per send, the
-- provider's refund id set once, and the state moved to `completed` or `failed`, with the
-- attestation the table's check allows only alongside an outcome. After the outcome, an update that
-- changes nothing is the only one let through.
CREATE TRIGGER bill_payment_refunds_guard_update
BEFORE UPDATE ON bill_payment_refunds
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'bill payment refund cannot make that change')
  WHERE NOT (
    new.id IS old.id
    AND new.bill_payment_id IS old.bill_payment_id
    AND new.submission_id IS old.submission_id
    AND new.fingerprint IS old.fingerprint
    AND new.applied_amount IS old.applied_amount
    AND new.tip_amount IS old.tip_amount
    AND new.reason IS old.reason
    AND new.authorized_by IS old.authorized_by
    AND new.requested_by IS old.requested_by
    AND new.till_id IS old.till_id
    AND new.created_at IS old.created_at
    AND (
      (new.state IS old.state
        AND new.sent_at IS old.sent_at
        AND new.send_count IS old.send_count
        AND new.provider_refund_ref IS old.provider_refund_ref
        AND new.attested_by IS old.attested_by
        AND new.attestation_note IS old.attestation_note
        AND new.completed_at IS old.completed_at
        AND new.failed_at IS old.failed_at)
      OR (old.state = 'pending'
        AND (old.sent_at IS NULL OR new.sent_at IS old.sent_at)
        AND new.send_count IN (old.send_count, old.send_count + 1)
        AND (old.provider_refund_ref IS NULL OR new.provider_refund_ref IS old.provider_refund_ref))
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER bill_payment_refunds_no_delete
BEFORE DELETE ON bill_payment_refunds
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a bill payment refund is never deleted');
END;
