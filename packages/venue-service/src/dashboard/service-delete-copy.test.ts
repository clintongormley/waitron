import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { DeleteDialogCopy } from "@waitron/ui";
afterEach(() => setLocale("en"));
import { serviceDeleteCopy } from "./service-delete-copy.js";
async function copy(kind: "zone" | "department") {
  return serviceDeleteCopy(kind) as DeleteDialogCopy;
}
it.each([
  ["tables", "Deletes {count} tables. {names}", "Elimina {count} mesas. {names}"],
  [
    "saved_tables",
    "Removes {count} tables from the saved plan. {names}",
    "Quita {count} mesas del plano guardado. {names}",
  ],
  ["zones", "Deletes {count} zones. {names}", "Elimina {count} zonas. {names}"],
  [
    "saved_joins",
    "Removes {count} joins from the saved plan. {names}",
    "Quita {count} uniones del plano guardado. {names}",
  ],
  [
    "today_joins",
    "Removes {count} joins from today’s plan. {names}",
    "Quita {count} uniones del plano de hoy. {names}",
  ],
  [
    "reset_targets",
    "Removes {count} saved reset targets. {names}",
    "Quita {count} destinos de restablecimiento guardados. {names}",
  ],
  [
    "reset_joins",
    "Removes {count} saved reset joins. {names}",
    "Quita {count} uniones de restablecimiento guardadas. {names}",
  ],
  ["routing_rules", "Removes {count} routing rules.", "Quita {count} reglas de enrutamiento."],
  [
    "routing_periods",
    "Removes {count} period routing rules.",
    "Quita {count} reglas de enrutamiento por periodo.",
  ],
  [
    "profile_zones",
    "Removes {count} profile zone choices: {names}.",
    "Quita {count} selecciones de zonas de perfiles: {names}.",
  ],
  [
    "profile_starting_zones",
    "Chooses a surviving starting zone for these profiles: {names}.",
    "Elige una zona inicial restante para estos perfiles: {names}.",
  ],
  [
    "screen_zones",
    "Removes {count} screen zone choices: {names}.",
    "Quita {count} selecciones de zonas de pantallas: {names}.",
  ],
  [
    "screen_notices",
    "Removes {count} screen notices: {names}.",
    "Quita {count} avisos de pantallas: {names}.",
  ],
  [
    "zone_policies",
    "Removes {count} zone service settings.",
    "Quita {count} ajustes de servicio de zonas.",
  ],
  [
    "zone_closed_times",
    "Removes {count} zone closed times.",
    "Quita {count} horarios de cierre de zonas.",
  ],
  ["zone_extensions", "Removes {count} zone extensions.", "Quita {count} extensiones de zonas."],
  [
    "department_periods",
    "Removes {count} department periods.",
    "Quita {count} periodos del departamento.",
  ],
  [
    "staff_menus",
    "Removes {count} staff menu settings.",
    "Quita {count} ajustes de menús del personal.",
  ],
  ["timetables", "Removes {count} menu timetables.", "Quita {count} horarios de menús."],
  ["slots", "Removes {count} menu slots.", "Quita {count} franjas de menús."],
  [
    "period_extensions",
    "Removes {count} period extensions.",
    "Quita {count} extensiones de periodos.",
  ],
  [
    "department_policy",
    "Removes {count} department service settings.",
    "Quita {count} ajustes de servicio del departamento.",
  ],
  [
    "transfer_desks",
    "Removes transfer desks for these profiles: {names}.",
    "Quita los puestos de traslado de estos perfiles: {names}.",
  ],
  [
    "transfer_routes",
    "Removes {count} transfer routes to or from: {names}.",
    "Quita {count} rutas de traslado hacia o desde: {names}.",
  ],
  [
    "default_department",
    "Sets the default department to: {names}.",
    "Establece el departamento predeterminado: {names}.",
  ],
  [
    "counter_default",
    "Sets the Counter default to: {names}.",
    "Establece la zona predeterminada de Mostrador: {names}.",
  ],
])("discloses %s in EN and ES", async (key, en, es) => {
  for (const [locale, line] of [
    ["en", en],
    ["es", es],
  ] as const) {
    setLocale(locale);
    const c = await copy("department");
    expect(c.item({ key, count: 3, targets: [{ id: "private", name: "Patio" }] })).toBe(
      line.replace("{count}", "3").replace("{names}", "Patio"),
    );
  }
});
it.each([
  ["department.last_active", "Keep at least one department.", "Conserva al menos un departamento."],
  [
    "zone.table_in_use",
    "Table {tableName} has open work: {names}.",
    "La mesa {tableName} tiene trabajo abierto: {names}.",
  ],
  [
    "table.delivery_in_progress",
    "Complete delivery of these orders first: {names}.",
    "Completa primero la entrega de estos pedidos: {names}.",
  ],
  [
    "table.booked",
    "Move or cancel these bookings first: {names}.",
    "Mueve o cancela primero estas reservas: {names}.",
  ],
  [
    "zone.order_in_progress",
    "An order is still open or placed in this zone.",
    "Hay un pedido abierto o enviado en esta zona.",
  ],
  [
    "department.order_in_progress",
    "An order is still open or placed in this department.",
    "Hay un pedido abierto o enviado en este departamento.",
  ],
  [
    "zone.transfer_pending",
    "Resolve the pending transfer to this zone first.",
    "Resuelve primero el traslado pendiente a esta zona.",
  ],
  [
    "department.transfer_pending",
    "Resolve the pending transfer involving this department first.",
    "Resuelve primero el traslado pendiente de este departamento.",
  ],
  [
    "zone.profile_in_use",
    "These profiles would have no allowed zones: {names}.",
    "Estos perfiles se quedarían sin zonas permitidas: {names}.",
  ],
  [
    "department.profile_in_use",
    "Move these profiles to another department first: {names}.",
    "Mueve primero estos perfiles a otro departamento: {names}.",
  ],
])("explains %s in EN and ES", async (code, en, es) => {
  for (const [locale, line] of [
    ["en", en],
    ["es", es],
  ] as const) {
    setLocale(locale);
    const c = await copy("zone");
    expect(
      c.refusal({
        code,
        params: { tableName: "4", workingOrderId: "private" },
        targets: [{ id: "private", name: "Patio" }],
      }),
    ).toBe(line.replace("{tableName}", "4").replace("{names}", "Patio"));
  }
});
it.each([
  [
    "en",
    "Delete zone",
    "Delete department",
    "The Counter default is cleared; no surviving zone replaces it.",
  ],
  [
    "es",
    "Eliminar zona",
    "Eliminar departamento",
    "Se borra la zona predeterminada de Mostrador; ninguna zona restante la sustituye.",
  ],
] as const)(
  "names both headings and a Counter with no survivor in %s",
  async (locale, zone, department, counter) => {
    setLocale(locale);
    expect((await copy("zone")).heading).toBe(zone);
    const c = await copy("department");
    expect(c.heading).toBe(department);
    expect(c.item({ key: "counter_default", count: 1, targets: [] })).toBe(counter);
  },
);
it("counts physical tables independently of today placement and discloses retained names", async () => {
  const c = await copy("zone");
  expect(
    c.item({
      key: "tables",
      count: 3,
      targets: [{ id: "never-today", name: "Never placed today" }],
    }),
  ).toBe("Deletes 3 tables. Never placed today");
  expect(c.item({ key: "saved_tables", count: 1, targets: [] })).toBe(
    "Removes 1 tables from the saved plan.",
  );
});
it.each(["zone", "department"] as const)(
  "%s uses the approved irreversible sentence in both languages",
  (kind) => {
    setLocale("en");
    expect(serviceDeleteCopy(kind).irreversible).toBe("This can't be undone.");
    setLocale("es");
    expect(serviceDeleteCopy(kind).irreversible).toBe("Esta acción no se puede deshacer.");
  },
);
