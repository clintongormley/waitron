-- `bill_payment_refunds_guard_update` again, now holding the `refs_before_send` column 0026 added:
-- it may be written only while the refund has no `sent_at` (with the first send's stamp), and never
-- after. Every other rule is 0023's, unchanged.
DROP TRIGGER bill_payment_refunds_guard_update;
--> statement-breakpoint
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
        AND new.refs_before_send IS old.refs_before_send
        AND new.attested_by IS old.attested_by
        AND new.attestation_note IS old.attestation_note
        AND new.completed_at IS old.completed_at
        AND new.failed_at IS old.failed_at)
      OR (old.state = 'pending'
        AND (old.sent_at IS NULL OR new.sent_at IS old.sent_at)
        AND (old.sent_at IS NULL OR new.refs_before_send IS old.refs_before_send)
        AND new.send_count IN (old.send_count, old.send_count + 1)
        AND (old.provider_refund_ref IS NULL OR new.provider_refund_ref IS old.provider_refund_ref))
    )
  );
END;
