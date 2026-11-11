<!-- Each line is "- <the function's text as published> — <the route or file that serves it>"; the declaration lists them in this order. -->
- toma de pedidos por mesa o en barra — POST /api/tables/:id/seat and POST /api/working-orders (apps/server/src/till-api.ts)
- cobro en efectivo y con tarjeta — POST /api/working-orders/:id/payments (apps/server/src/bill-payments-api.ts)
- expedición de facturas simplificadas — TipoFactura F2 in packages/fiscal-verifactu/src/backend.ts
- facturas rectificativas — apps/server/src/cancel-credit.ts
- consulta de las facturas emitidas — GET /management-api/orders (apps/server/src/orders-api.ts)
- informes de ventas — GET /management-api/reports/period (apps/server/src/report-api.ts)
