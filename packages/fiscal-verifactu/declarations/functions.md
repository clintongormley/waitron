<!-- Each line is "- <the function's text as published> — <the route or file that serves it>"; the declaration lists them in this order. -->
- toma de pedidos por mesa o en barra — POST /api/tables/:id/seat (apps/server/src/till-table-routes.ts) and POST /api/working-orders (apps/server/src/till-working-order-routes.ts)
- cobro en efectivo y con tarjeta — POST /api/working-orders/:id/payments (apps/server/src/bill-payments-api.ts)
- expedición de facturas simplificadas y completas — TipoFactura F2 and F1 in packages/fiscal-verifactu/src/backend.ts
- facturas rectificativas — apps/server/src/cancel-credit.ts
- anulación de facturas simplificadas — POST /api/working-orders/:id/cancel (apps/server/src/till-drawer-and-cancel-routes.ts)
- consulta de las facturas emitidas — GET /management-api/orders (apps/server/src/orders-api.ts)
- informes de ventas — GET /management-api/reports/period (apps/server/src/report-api.ts)
