CREATE TRIGGER payments_guard_update
BEFORE UPDATE ON payments
FOR EACH ROW
BEGIN
  -- Resolving an attempt first records requested_amount; confirmed capture may change amount.
  SELECT raise(abort, 'a payment cannot make that change')
  WHERE NOT (
    new.id IS old.id
    AND new.working_order_id IS old.working_order_id
    AND new.source IS old.source
    AND new.device_id IS old.device_id
    AND new.node_id IS old.node_id
    AND new.provider IS old.provider
    AND new.payment_ref IS old.payment_ref
    AND (old.requested_amount IS NULL OR new.requested_amount IS old.requested_amount)
    AND new.created_at IS old.created_at
    AND new.requested_by IS old.requested_by
    -- Short-capture recovery first links a whole-order payment to its bill contribution.
    AND (old.bill_payment_id IS NULL OR new.bill_payment_id IS old.bill_payment_id)
    AND (old.sale_id IS NULL OR new.sale_id IS old.sale_id)
    AND (old.reader_id IS NULL OR new.reader_id IS old.reader_id)
    AND (old.reconcile_remediated_at IS NULL
      OR new.reconcile_remediated_at IS old.reconcile_remediated_at)
    AND (old.provider_checkout_started_at IS NULL
      OR new.provider_checkout_started_at IS old.provider_checkout_started_at)
    AND (old.resolution_outcome IS NULL OR (
      new.resolution_outcome IS old.resolution_outcome
      AND new.resolution_cancelled_at_provider IS old.resolution_cancelled_at_provider
      AND new.resolution_provider_status IS old.resolution_provider_status
      AND new.resolved_by IS old.resolved_by
      AND new.resolved_at IS old.resolved_at))
    AND (old.held_at IS NULL OR (
      new.held_at IS old.held_at AND new.hold_provider_amount IS old.hold_provider_amount))
    AND (old.hold_outcome IS NULL OR (
      new.hold_outcome IS old.hold_outcome AND new.hold_note IS old.hold_note
      AND new.hold_decided_by IS old.hold_decided_by
      AND new.hold_decided_at IS old.hold_decided_at))
  );
END;
--> statement-breakpoint
CREATE TRIGGER payments_no_delete
BEFORE DELETE ON payments
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a payment is never deleted');
END;
