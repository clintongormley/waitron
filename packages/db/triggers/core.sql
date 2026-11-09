CREATE TRIGGER tenders_reject_post_settlement
BEFORE INSERT ON tenders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'tender rejected: the sale is already settled')
  WHERE exists (SELECT 1 FROM sale_settlements WHERE sale_id = new.sale_id);
END;
--> statement-breakpoint
CREATE TRIGGER products_variant_one_level_insert
BEFORE INSERT ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a variant''s parent must be a product with no parent, and a variant cannot have variants of its own')
  WHERE new.parent_id IS NOT NULL
    AND (new.parent_id = new.id
      OR (SELECT parent_id FROM products WHERE id = new.parent_id) IS NOT NULL
      OR exists (SELECT 1 FROM products WHERE parent_id = new.id));
  SELECT raise(abort, 'a variant''s parent is fixed when it is created')
  WHERE exists (SELECT 1 FROM products WHERE id = new.id AND parent_id IS NOT new.parent_id);
END;
--> statement-breakpoint
CREATE TRIGGER products_variant_parent_fixed_update
BEFORE UPDATE OF parent_id ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a variant''s parent is fixed when it is created')
  WHERE new.parent_id IS NOT old.parent_id;
END;
--> statement-breakpoint
CREATE TRIGGER products_id_fixed_update
BEFORE UPDATE OF id ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a product''s id never changes')
  WHERE new.id IS NOT old.id;
END;
--> statement-breakpoint
CREATE TRIGGER products_ordering_check_insert
BEFORE INSERT ON products
FOR EACH ROW
WHEN new.ordering NOT IN ('public', 'staff_only', 'not_sold_separately')
BEGIN
  SELECT raise(abort, 'a product''s ordering must be public, staff_only or not_sold_separately');
END;
--> statement-breakpoint
CREATE TRIGGER products_ordering_check_update
BEFORE UPDATE OF ordering ON products
FOR EACH ROW
WHEN new.ordering NOT IN ('public', 'staff_only', 'not_sold_separately')
BEGIN
  SELECT raise(abort, 'a product''s ordering must be public, staff_only or not_sold_separately');
END;
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
    AND new.source IS old.source
    AND new.device_id IS old.device_id
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
--> statement-breakpoint
CREATE TRIGGER bill_payment_refunds_no_delete
BEFORE DELETE ON bill_payment_refunds
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a bill payment refund is never deleted');
END;
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
    AND ((new.applied IS old.applied AND new.tip IS old.tip)
      OR (old.state = 'pending' AND new.state = 'received' AND old.method = 'card'))
    AND new.tendered IS old.tendered
    AND new.requested_by IS old.requested_by
    AND new.source IS old.source
    AND new.device_id IS old.device_id
    AND new.created_at IS old.created_at
    AND (
      (new.state IS old.state
        AND new.received_at IS old.received_at
        AND new.failed_at IS old.failed_at
        AND new.attested_by IS old.attested_by
        AND new.attestation_note IS old.attestation_note)
      OR (old.state = 'pending' AND new.state IN ('received', 'failed'))
      OR (old.state = 'received' AND new.state = 'declined'
        AND new.received_at IS old.received_at
        AND new.attested_by IS old.attested_by
        AND new.attestation_note IS old.attestation_note
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
CREATE TRIGGER sale_settlements_check_coverage
BEFORE INSERT ON sale_settlements
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'tenders do not cover the sale')
  WHERE exists (SELECT 1 FROM sales WHERE id = new.sale_id)
    AND (SELECT coalesce(sum(amount), 0) FROM tenders WHERE sale_id = new.sale_id)
        <> (SELECT total FROM sales WHERE id = new.sale_id)
           + (SELECT coalesce(sum(total), 0) FROM sales WHERE corrects_sale_id = new.sale_id)
           + (SELECT coalesce(sum(tip_amount), 0) FROM tenders WHERE sale_id = new.sale_id);
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_delete
BEFORE DELETE ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT exists (
    SELECT 1 FROM working_orders WHERE id = old.working_order_id AND status = 'open'
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT exists (
    SELECT 1 FROM working_orders WHERE id = new.working_order_id AND status = 'open'
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
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_locales_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'descriptions must carry exactly the venue locales')
  WHERE NOT exists (
      SELECT 1 FROM working_orders wo
        JOIN locations l ON l.id = wo.location_id
       WHERE wo.id = new.working_order_id
    )
    OR exists (
      SELECT 1 FROM json_each(new.descriptions) supplied
       WHERE supplied."key" NOT IN (
         SELECT configured.value FROM working_orders wo
           JOIN locations l ON l.id = wo.location_id
           JOIN json_each(l.invoice_locales) configured
          WHERE wo.id = new.working_order_id
       )
    )
    OR exists (
      SELECT 1 FROM working_orders wo
        JOIN locations l ON l.id = wo.location_id
        JOIN json_each(l.invoice_locales) configured
       WHERE wo.id = new.working_order_id
         AND configured.value NOT IN (SELECT supplied."key" FROM json_each(new.descriptions) supplied)
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_locales_update
BEFORE UPDATE OF descriptions, working_order_id ON working_order_lines
FOR EACH ROW
WHEN new.descriptions IS NOT old.descriptions OR new.working_order_id IS NOT old.working_order_id
BEGIN
  SELECT raise(abort, 'descriptions must carry exactly the venue locales')
  WHERE NOT exists (
      SELECT 1 FROM working_orders wo
        JOIN locations l ON l.id = wo.location_id
       WHERE wo.id = new.working_order_id
    )
    OR exists (
      SELECT 1 FROM json_each(new.descriptions) supplied
       WHERE supplied."key" NOT IN (
         SELECT configured.value FROM working_orders wo
           JOIN locations l ON l.id = wo.location_id
           JOIN json_each(l.invoice_locales) configured
          WHERE wo.id = new.working_order_id
       )
    )
    OR exists (
      SELECT 1 FROM working_orders wo
        JOIN locations l ON l.id = wo.location_id
        JOIN json_each(l.invoice_locales) configured
       WHERE wo.id = new.working_order_id
         AND configured.value NOT IN (SELECT supplied."key" FROM json_each(new.descriptions) supplied)
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_variant_locales_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'variant_descriptions must carry exactly the venue locales')
  WHERE new.variant_descriptions IS NOT NULL
    AND (
      NOT exists (
        SELECT 1 FROM working_orders wo
          JOIN locations l ON l.id = wo.location_id
         WHERE wo.id = new.working_order_id
      )
      OR exists (
        SELECT 1 FROM json_each(new.variant_descriptions) supplied
         WHERE supplied."key" NOT IN (
           SELECT configured.value FROM working_orders wo
             JOIN locations l ON l.id = wo.location_id
             JOIN json_each(l.invoice_locales) configured
            WHERE wo.id = new.working_order_id
         )
      )
      OR exists (
        SELECT 1 FROM working_orders wo
          JOIN locations l ON l.id = wo.location_id
          JOIN json_each(l.invoice_locales) configured
         WHERE wo.id = new.working_order_id
           AND configured.value NOT IN (
             SELECT supplied."key" FROM json_each(new.variant_descriptions) supplied
           )
      )
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_variant_locales_update
BEFORE UPDATE OF variant_descriptions, working_order_id ON working_order_lines
FOR EACH ROW
WHEN new.variant_descriptions IS NOT old.variant_descriptions OR new.working_order_id IS NOT old.working_order_id
BEGIN
  SELECT raise(abort, 'variant_descriptions must carry exactly the venue locales')
  WHERE new.variant_descriptions IS NOT NULL
    AND (
      NOT exists (
        SELECT 1 FROM working_orders wo
          JOIN locations l ON l.id = wo.location_id
         WHERE wo.id = new.working_order_id
      )
      OR exists (
        SELECT 1 FROM json_each(new.variant_descriptions) supplied
         WHERE supplied."key" NOT IN (
           SELECT configured.value FROM working_orders wo
             JOIN locations l ON l.id = wo.location_id
             JOIN json_each(l.invoice_locales) configured
            WHERE wo.id = new.working_order_id
         )
      )
      OR exists (
        SELECT 1 FROM working_orders wo
          JOIN locations l ON l.id = wo.location_id
          JOIN json_each(l.invoice_locales) configured
         WHERE wo.id = new.working_order_id
           AND configured.value NOT IN (
             SELECT supplied."key" FROM json_each(new.variant_descriptions) supplied
           )
      )
    );
END;
--> statement-breakpoint
CREATE TRIGGER device_profile_form_factor_locked
BEFORE UPDATE ON device_profiles
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'cannot change form factor of a profile in use by an active device')
  WHERE new.form_factor <> old.form_factor
    AND exists (
      SELECT 1 FROM devices d WHERE d.device_profile_id = new.id AND d.active <> 0
    );
END;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_update
BEFORE UPDATE ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT (
    (
      exists (SELECT 1 FROM working_orders WHERE id = new.working_order_id AND status = 'open')
      AND exists (SELECT 1 FROM working_orders WHERE id = old.working_order_id AND status = 'open')
    )
    OR (
      exists (SELECT 1 FROM working_orders WHERE id = old.working_order_id)
      AND NOT (new.served_quantity IS old.served_quantity AND new.served_at IS old.served_at)
      AND new.id IS old.id
      AND new.working_order_id IS old.working_order_id
      AND new.line_no IS old.line_no
      AND new.name IS old.name
      AND new.product_id IS old.product_id
      AND new.variant_name IS old.variant_name
      AND new.variant_descriptions IS old.variant_descriptions
      AND new.variant_kitchen_name IS old.variant_kitchen_name
      AND new.kitchen_name IS old.kitchen_name
      AND new.descriptions IS old.descriptions
      AND new.option_snapshots IS old.option_snapshots
      AND new.unit_name IS old.unit_name
      AND new.unit_precision IS old.unit_precision
      AND new.quantity IS old.quantity
      AND new.price_quantity IS old.price_quantity
      AND new.unit_price_gross IS old.unit_price_gross
      AND new.vat_class IS old.vat_class
      AND new.line_total IS old.line_total
      AND new.category IS old.category
      AND new.course_id IS old.course_id
      AND new.make_at_station_id IS old.make_at_station_id
      AND new.parent_line_id IS old.parent_line_id
      AND new.note IS old.note
      AND new.sent_at IS old.sent_at
      AND new.extra_list_id IS old.extra_list_id
      AND new.classification IS old.classification
      AND new.group_id IS old.group_id
      AND new.credited_to IS old.credited_to
      AND new.list_unit_price_gross IS old.list_unit_price_gross
    )
    OR (
      exists (
        SELECT 1 FROM working_orders
        WHERE id = old.working_order_id
          AND (status = 'placed' OR (status = 'settled' AND new.group_id IS NOT old.group_id))
      )
      AND new.id IS old.id
      AND new.working_order_id IS old.working_order_id
      AND new.line_no IS old.line_no
      AND new.name IS old.name
      AND new.product_id IS old.product_id
      AND new.variant_name IS old.variant_name
      AND new.variant_descriptions IS old.variant_descriptions
      AND new.variant_kitchen_name IS old.variant_kitchen_name
      AND new.kitchen_name IS old.kitchen_name
      AND new.descriptions IS old.descriptions
      AND new.option_snapshots IS old.option_snapshots
      AND new.unit_name IS old.unit_name
      AND new.unit_precision IS old.unit_precision
      AND new.quantity IS old.quantity
      AND new.price_quantity IS old.price_quantity
      AND new.unit_price_gross IS old.unit_price_gross
      AND new.vat_class IS old.vat_class
      AND new.line_total IS old.line_total
      AND new.category IS old.category
      AND new.served_at IS old.served_at
      AND new.course_id IS old.course_id
      AND new.make_at_station_id IS old.make_at_station_id
      AND new.parent_line_id IS old.parent_line_id
      AND new.note IS old.note
      AND new.sent_at IS old.sent_at
      AND new.extra_list_id IS old.extra_list_id
      AND new.classification IS old.classification
      AND new.credited_to IS old.credited_to
      AND new.served_quantity IS old.served_quantity
      AND new.list_unit_price_gross IS old.list_unit_price_gross
    )
    OR (
      exists (
        SELECT 1 FROM working_orders
        WHERE id = old.working_order_id AND status IN ('placed', 'settled')
      )
      AND old.sent_at IS NULL
      AND new.sent_at IS NOT NULL
      AND new.id IS old.id
      AND new.working_order_id IS old.working_order_id
      AND new.line_no IS old.line_no
      AND new.name IS old.name
      AND new.product_id IS old.product_id
      AND new.variant_name IS old.variant_name
      AND new.variant_descriptions IS old.variant_descriptions
      AND new.variant_kitchen_name IS old.variant_kitchen_name
      AND new.kitchen_name IS old.kitchen_name
      AND new.descriptions IS old.descriptions
      AND new.option_snapshots IS old.option_snapshots
      AND new.unit_name IS old.unit_name
      AND new.unit_precision IS old.unit_precision
      AND new.quantity IS old.quantity
      AND new.price_quantity IS old.price_quantity
      AND new.unit_price_gross IS old.unit_price_gross
      AND new.vat_class IS old.vat_class
      AND new.line_total IS old.line_total
      AND new.category IS old.category
      AND new.served_at IS old.served_at
      AND new.served_quantity IS old.served_quantity
      AND new.course_id IS old.course_id
      AND new.make_at_station_id IS old.make_at_station_id
      AND new.parent_line_id IS old.parent_line_id
      AND new.note IS old.note
      AND new.extra_list_id IS old.extra_list_id
      AND new.classification IS old.classification
      AND new.group_id IS old.group_id
      AND new.credited_to IS old.credited_to
      AND new.list_unit_price_gross IS old.list_unit_price_gross
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_recipient_identity_insert
BEFORE INSERT ON working_orders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'recipient identity is incomplete')
  WHERE NOT (
    (new.recipient_identifier_type IS NULL AND new.recipient_identifier_country_code IS NULL)
    OR (new.recipient_identifier_type IS NOT NULL AND new.recipient_identifier_country_code IS NOT NULL
      AND new.recipient_identifier_type IN ('vat-number', 'passport', 'residence-country-id', 'residence-certificate', 'other-document')
      AND new.recipient_identifier_country_code GLOB '[A-Z][A-Z]'
      AND new.recipient_tax_id IS NOT NULL
      AND length(trim(new.recipient_tax_id, char(9, 10, 11, 12, 13, 32))) > 0
      AND new.invoice_type = 'F1')
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_recipient_identity_update
BEFORE UPDATE ON working_orders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'recipient identity is incomplete')
  WHERE NOT (
    (new.recipient_identifier_type IS NULL AND new.recipient_identifier_country_code IS NULL)
    OR (new.recipient_identifier_type IS NOT NULL AND new.recipient_identifier_country_code IS NOT NULL
      AND new.recipient_identifier_type IN ('vat-number', 'passport', 'residence-country-id', 'residence-certificate', 'other-document')
      AND new.recipient_identifier_country_code GLOB '[A-Z][A-Z]'
      AND new.recipient_tax_id IS NOT NULL
      AND length(trim(new.recipient_tax_id, char(9, 10, 11, 12, 13, 32))) > 0
      AND new.invoice_type = 'F1')
  );
END;
--> statement-breakpoint
CREATE TRIGGER sales_recipient_identity_insert
BEFORE INSERT ON sales
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'recipient identity is incomplete')
  WHERE NOT (
    (new.counterparty_identifier_type IS NULL AND new.counterparty_identifier_country_code IS NULL)
    OR (new.counterparty_identifier_type IS NOT NULL AND new.counterparty_identifier_country_code IS NOT NULL
      AND new.counterparty_identifier_type IN ('vat-number', 'passport', 'residence-country-id', 'residence-certificate', 'other-document')
      AND new.counterparty_identifier_country_code GLOB '[A-Z][A-Z]'
      AND new.counterparty_tax_id IS NOT NULL
      AND length(trim(new.counterparty_tax_id, char(9, 10, 11, 12, 13, 32))) > 0)
  );
END;
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
        AND new.recipient_country_code IS old.recipient_country_code
        AND new.recipient_identifier_type IS old.recipient_identifier_type
        AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
        AND new.invoice_delivery IS old.invoice_delivery
        AND new.receipt_locale IS old.receipt_locale)
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
          AND new.recipient_country_code IS old.recipient_country_code
          AND new.recipient_identifier_type IS old.recipient_identifier_type
          AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
          AND new.invoice_delivery IS old.invoice_delivery
          AND new.receipt_locale IS old.receipt_locale)
          OR (new.revision = old.revision + 1
               AND new.invoice_type IN ('F1', 'F2')
               AND NOT EXISTS (SELECT 1 FROM sales WHERE working_order_id = old.id)))
        AND new.delivery_table_label IS old.delivery_table_label)
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
        AND new.recipient_identifier_type IS old.recipient_identifier_type
        AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
        AND new.invoice_delivery IS old.invoice_delivery
        AND new.receipt_locale IS old.receipt_locale
        AND new."party_id" IS old."party_id"
        AND new.delivery_table_label IS old.delivery_table_label)
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
        AND new.recipient_identifier_type IS old.recipient_identifier_type
        AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
        AND new.invoice_delivery IS old.invoice_delivery
        AND new.receipt_locale IS old.receipt_locale
        AND new."party_id" IS old."party_id"
        AND new.delivery_table_label IS old.delivery_table_label)
    -- A paid bill not yet handed over may leave its party, once; only the server limits this to Finish table's counter collection (A758-7).
    OR (old.status = 'settled' AND new.status = 'settled'
        AND old.collected_at IS NULL AND new.collected_at IS NULL
        AND old.party_id IS NOT NULL AND new.party_id IS NULL
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.location_id IS old.location_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.status IS old.status
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.collected_at IS old.collected_at
        AND new.delivery_table_id IS old.delivery_table_id
        AND new.delivery_table_label IS old.delivery_table_label
        AND new.revision IS old.revision
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND new.invoice_type IS old.invoice_type
        AND new.recipient_tax_id IS old.recipient_tax_id
        AND new.recipient_legal_name IS old.recipient_legal_name
        AND new.recipient_address IS old.recipient_address
        AND new.recipient_country_code IS old.recipient_country_code
        AND new.recipient_identifier_type IS old.recipient_identifier_type
        AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
        AND new.invoice_delivery IS old.invoice_delivery
        AND new.receipt_locale IS old.receipt_locale)
    OR (old.delivery_table_id IS NOT NULL AND new.delivery_table_id IS NULL
        AND old.delivery_table_label IS NULL AND new.delivery_table_label IS NOT NULL
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.location_id IS old.location_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.status IS old.status
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.collected_at IS old.collected_at
        AND new.revision IS old.revision
        AND new.invoice_type IS old.invoice_type
        AND new.recipient_tax_id IS old.recipient_tax_id
        AND new.recipient_legal_name IS old.recipient_legal_name
        AND new.recipient_address IS old.recipient_address
        AND new.recipient_country_code IS old.recipient_country_code
        AND new.recipient_identifier_type IS old.recipient_identifier_type
        AND new.recipient_identifier_country_code IS old.recipient_identifier_country_code
        AND new.invoice_delivery IS old.invoice_delivery
        AND new.receipt_locale IS old.receipt_locale
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND new.party_id IS old.party_id)
  );
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_insert
BEFORE INSERT ON sections
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_update
BEFORE UPDATE OF image ON sections
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE exists (SELECT 1 FROM sections WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (SELECT 1 FROM sections WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER menu_version_images_media_image_fk_insert
BEFORE INSERT ON menu_version_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'menu_version_images_media_image_fk')
  WHERE NOT exists (SELECT 1 FROM media_images WHERE filename = new.filename);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_insert
BEFORE INSERT ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_update
BEFORE UPDATE OF image ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE exists (SELECT 1 FROM products WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (SELECT 1 FROM products WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER menu_version_images_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'menu_version_images_media_image_fk')
  WHERE exists (
    SELECT 1 FROM menu_version_images
    JOIN menu_publications ON menu_publications.version_id = menu_version_images.version_id
    WHERE menu_version_images.filename = old.filename
  )
  OR exists (
    SELECT 1 FROM menu_version_images
    JOIN menu_scheduled_publications ON menu_scheduled_publications.version_id = menu_version_images.version_id
    WHERE menu_version_images.filename = old.filename AND menu_scheduled_publications.state = 'queued'
  );
END;
--> statement-breakpoint
CREATE TRIGGER menu_version_images_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'menu_version_images_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND (
      exists (
        SELECT 1 FROM menu_version_images
        JOIN menu_publications ON menu_publications.version_id = menu_version_images.version_id
        WHERE menu_version_images.filename = old.filename
      )
      OR exists (
        SELECT 1 FROM menu_version_images
        JOIN menu_scheduled_publications ON menu_scheduled_publications.version_id = menu_version_images.version_id
        WHERE menu_version_images.filename = old.filename AND menu_scheduled_publications.state = 'queued'
      )
    );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_insert
BEFORE INSERT ON section_members
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE json_extract(new.folder_overrides, '$.image') IS NOT NULL
    AND NOT exists (
      SELECT 1 FROM media_images WHERE filename = json_extract(new.folder_overrides, '$.image')
    );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_update
BEFORE UPDATE OF folder_overrides ON section_members
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE json_extract(new.folder_overrides, '$.image') IS NOT NULL
    AND NOT exists (
      SELECT 1 FROM media_images WHERE filename = json_extract(new.folder_overrides, '$.image')
    );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE exists (
    SELECT 1 FROM section_members WHERE folder_overrides ->> '$.image' = old.filename
  );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (
      SELECT 1 FROM section_members WHERE folder_overrides ->> '$.image' = old.filename
    );
END;
