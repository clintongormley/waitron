DROP TRIGGER working_orders_enforce_transition;
--> statement-breakpoint
CREATE TRIGGER working_orders_enforce_transition
BEFORE UPDATE ON working_orders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'working order cannot make that transition')
  WHERE NOT (
    old.status = 'open'
    OR (old.status = 'placed' AND new.status IN ('settled', 'abandoned')
        AND new.invoice_type IS old.invoice_type
        AND new.recipient_tax_id IS old.recipient_tax_id
        AND new.recipient_legal_name IS old.recipient_legal_name
        AND new.recipient_address IS old.recipient_address
        AND new.recipient_country_code IS old.recipient_country_code)
    OR (old.status = 'placed' AND new.status = 'placed'
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.location_id IS old.location_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.collected_at IS old.collected_at
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND ((new.invoice_type IS old.invoice_type
          AND new.recipient_tax_id IS old.recipient_tax_id
          AND new.recipient_legal_name IS old.recipient_legal_name
          AND new.recipient_address IS old.recipient_address
          AND new.recipient_country_code IS old.recipient_country_code)
          OR (new.revision = old.revision + 1
               AND new.invoice_type IN ('F1', 'F2')
               AND NOT EXISTS (SELECT 1 FROM sales WHERE working_order_id = old.id))))
    OR (old.status = 'placed' AND new.status = 'placed'
        AND old.collected_at IS NULL AND new.collected_at IS NOT NULL
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.location_id IS old.location_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.delivery_table_id IS old.delivery_table_id
        AND new.revision IS old.revision
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND new.invoice_type IS old.invoice_type
        AND new.recipient_tax_id IS old.recipient_tax_id
        AND new.recipient_legal_name IS old.recipient_legal_name
        AND new.recipient_address IS old.recipient_address
        AND new.recipient_country_code IS old.recipient_country_code
        AND new."party_id" IS old."party_id")
    OR (old.status = 'settled' AND new.status = 'settled'
        AND old.collected_at IS NULL AND new.collected_at IS NOT NULL
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.location_id IS old.location_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.delivery_table_id IS old.delivery_table_id
        AND new.revision IS old.revision
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND new.invoice_type IS old.invoice_type
        AND new.recipient_tax_id IS old.recipient_tax_id
        AND new.recipient_legal_name IS old.recipient_legal_name
        AND new.recipient_address IS old.recipient_address
        AND new.recipient_country_code IS old.recipient_country_code
        AND new."party_id" IS old."party_id")
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_invoice_type_insert
BEFORE INSERT ON working_orders
FOR EACH ROW
WHEN new.invoice_type NOT IN ('F1', 'F2')
BEGIN
  SELECT raise(abort, 'invoice type must be F1 or F2');
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_invoice_type_update
BEFORE UPDATE OF invoice_type ON working_orders
FOR EACH ROW
WHEN old.status = 'open' AND new.invoice_type NOT IN ('F1', 'F2')
BEGIN
  SELECT raise(abort, 'invoice type must be F1 or F2');
END;
