CREATE TRIGGER tender_refunds_guard_update
BEFORE UPDATE ON tender_refunds
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'tender refund cannot make that change')
  WHERE NOT (
    new.id IS old.id
    AND new.sale_id IS old.sale_id
    AND new.tender_id IS old.tender_id
    AND new.submission_id IS old.submission_id
    AND new.fingerprint IS old.fingerprint
    AND new.applied_amount IS old.applied_amount
    AND new.tip_amount IS old.tip_amount
    AND new.reason IS old.reason
    AND new.authorized_by IS old.authorized_by
    AND new.requested_by IS old.requested_by
    AND new.source IS old.source
    AND new.device_id IS old.device_id
    AND new.node_id IS old.node_id
    AND new.location_id IS old.location_id
    AND new.method IS old.method
    AND new.manual IS old.manual
    AND new.provider IS old.provider
    AND new.provider_payment_ref IS old.provider_payment_ref
    AND new.created_at IS old.created_at
    AND (
      (new.state IS old.state
        AND new.sent_at IS old.sent_at
        AND new.send_count IS old.send_count
        AND new.refs_before_send IS old.refs_before_send
        AND new.provider_refund_ref IS old.provider_refund_ref
        AND new.provider_status IS old.provider_status
        AND new.last_lookup_at IS old.last_lookup_at
        AND new.next_retry_at IS old.next_retry_at
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
--> statement-breakpoint
CREATE TRIGGER tender_refunds_no_delete
BEFORE DELETE ON tender_refunds
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a tender refund is never deleted');
END;
