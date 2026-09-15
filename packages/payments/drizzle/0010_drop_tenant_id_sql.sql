-- The inbound webhook no longer looks up an owning tenant: it asks whether a payment carries the
-- reference (hasPaymentWithExternalRef in src/store.ts), which app_user's SELECT on payments covers.
DROP FUNCTION resolve_payment_tenant(text, text);
