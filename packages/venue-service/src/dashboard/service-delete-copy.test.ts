import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { DeleteDialogCopy } from "@waitron/ui";
afterEach(() => setLocale("en"));
import { serviceDeleteCopy, serviceDeleteError } from "./service-delete-copy.js";
async function copy(kind: "zone" | "department") {
  return serviceDeleteCopy(kind) as DeleteDialogCopy;
}
it.each([
  ["tables", "Deletes {count} tables. {names}", "Elimina {count} mesas. {names}"],
  [
    "saved_tables",
    "Removes {count} tables from the floor plans. {names}",
    "Quita {count} mesas de los planos. {names}",
  ],
  ["zones", "Deletes {count} zones. {names}", "Elimina {count} zonas. {names}"],
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
  ["zone_extensions", "Removes {count} zone extensions.", "Quita {count} extensiones de zonas."],
  [
    "department_periods",
    "Removes {count} department periods.",
    "Quita {count} periodos del departamento.",
  ],
  [
    "staff_menus",
    "Removes {count} staff menu settings.",
    "Quita {count} ajustes de cartas del personal.",
  ],
  ["seasons", "Removes hours in {count} seasons.", "Quita los horarios de {count} temporadas."],
  [
    "department_policy",
    "Removes {count} department service settings.",
    "Quita {count} ajustes de servicio del departamento.",
  ],
  ["service_steps", "Removes {count} service steps.", "Quita {count} pasos de servicio."],
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
    "Removes 1 table from the floor plans.",
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

it.each([
  [
    "en",
    "The default department is cleared.",
    "This could not be deleted. Try again.",
    "Keep at least one department.",
  ],
  [
    "es",
    "Se borra el departamento predeterminado.",
    "No se pudo eliminar. Vuelve a intentarlo.",
    "Conserva al menos un departamento.",
  ],
] as const)(
  "explains absent replacements and safe error fallbacks in %s",
  (locale, empty, fallback, last) => {
    setLocale(locale);
    const c = serviceDeleteCopy("department");
    expect(c.item({ key: "default_department", count: 1, targets: [] })).toBe(empty);
    expect(
      c.item({
        key: "unrecognised-impact",
        count: 1,
        targets: [{ id: "private-id", name: "Private target" }],
      }),
    ).toBe(fallback);
    expect(
      c.refusal({ code: "unrecognised-refusal", params: { privateId: "private-id" }, targets: [] }),
    ).toBe(fallback);
    expect(serviceDeleteError("department", { code: "department.last_active" })).toBe(last);
    expect(serviceDeleteError("zone", { code: "zone.order_in_progress", params: {} })).toBe(
      locale === "en"
        ? "An order is still open or placed in this zone."
        : "Hay un pedido abierto o enviado en esta zona.",
    );
    expect(serviceDeleteError("zone", new Error("private diagnostic"))).toBe(fallback);
  },
);
it.each([
  ["en", "Removes 2 floor plan sets."],
  ["es", "Quita 2 conjuntos de planos de sala."],
] as const)("counts a department's floor plan sets in %s", async (locale, line) => {
  setLocale(locale);
  const c = await copy("department");
  expect(c.item({ key: "floor_plan_sets", count: 2, targets: [] })).toBe(line);
});
it.each([
  [
    "tables",
    ["Deletes {count} table. {names}", "Deletes {count} tables. {names}"],
    ["Elimina {count} mesa. {names}", "Elimina {count} mesas. {names}"],
  ],
  [
    "saved_tables",
    [
      "Removes {count} table from the floor plans. {names}",
      "Removes {count} tables from the floor plans. {names}",
    ],
    ["Quita {count} mesa de los planos. {names}", "Quita {count} mesas de los planos. {names}"],
  ],
  [
    "zones",
    ["Deletes {count} zone. {names}", "Deletes {count} zones. {names}"],
    ["Elimina {count} zona. {names}", "Elimina {count} zonas. {names}"],
  ],
  [
    "today_joins",
    [
      "Removes {count} join from today’s plan. {names}",
      "Removes {count} joins from today’s plan. {names}",
    ],
    [
      "Quita {count} unión del plano de hoy. {names}",
      "Quita {count} uniones del plano de hoy. {names}",
    ],
  ],
  [
    "reset_targets",
    ["Removes {count} saved reset target. {names}", "Removes {count} saved reset targets. {names}"],
    [
      "Quita {count} destino de restablecimiento guardado. {names}",
      "Quita {count} destinos de restablecimiento guardados. {names}",
    ],
  ],
  [
    "routing_rules",
    ["Removes {count} routing rule.", "Removes {count} routing rules."],
    ["Quita {count} regla de enrutamiento.", "Quita {count} reglas de enrutamiento."],
  ],
  [
    "routing_periods",
    ["Removes {count} period routing rule.", "Removes {count} period routing rules."],
    [
      "Quita {count} regla de enrutamiento por periodo.",
      "Quita {count} reglas de enrutamiento por periodo.",
    ],
  ],
  [
    "profile_zones",
    [
      "Removes {count} profile zone choice: {names}.",
      "Removes {count} profile zone choices: {names}.",
    ],
    [
      "Quita {count} selección de zona de perfil: {names}.",
      "Quita {count} selecciones de zonas de perfiles: {names}.",
    ],
  ],
  [
    "screen_zones",
    [
      "Removes {count} screen zone choice: {names}.",
      "Removes {count} screen zone choices: {names}.",
    ],
    [
      "Quita {count} selección de zona de pantalla: {names}.",
      "Quita {count} selecciones de zonas de pantallas: {names}.",
    ],
  ],
  [
    "screen_notices",
    ["Removes {count} screen notice: {names}.", "Removes {count} screen notices: {names}."],
    ["Quita {count} aviso de pantalla: {names}.", "Quita {count} avisos de pantallas: {names}."],
  ],
  [
    "zone_policies",
    ["Removes {count} zone service setting.", "Removes {count} zone service settings."],
    ["Quita {count} ajuste de servicio de zona.", "Quita {count} ajustes de servicio de zonas."],
  ],
  [
    "zone_extensions",
    ["Removes {count} zone extension.", "Removes {count} zone extensions."],
    ["Quita {count} extensión de zona.", "Quita {count} extensiones de zonas."],
  ],
  [
    "department_periods",
    ["Removes {count} department period.", "Removes {count} department periods."],
    ["Quita {count} periodo del departamento.", "Quita {count} periodos del departamento."],
  ],
  [
    "floor_plan_sets",
    ["Removes {count} floor plan set.", "Removes {count} floor plan sets."],
    ["Quita {count} conjunto de planos de sala.", "Quita {count} conjuntos de planos de sala."],
  ],
  [
    "staff_menus",
    ["Removes {count} staff menu setting.", "Removes {count} staff menu settings."],
    [
      "Quita {count} ajuste de carta del personal.",
      "Quita {count} ajustes de cartas del personal.",
    ],
  ],
  [
    "seasons",
    ["Removes hours in {count} season.", "Removes hours in {count} seasons."],
    ["Quita los horarios de {count} temporada.", "Quita los horarios de {count} temporadas."],
  ],
  [
    "department_policy",
    ["Removes {count} department service setting.", "Removes {count} department service settings."],
    [
      "Quita {count} ajuste de servicio del departamento.",
      "Quita {count} ajustes de servicio del departamento.",
    ],
  ],
  [
    "service_steps",
    ["Removes {count} service step.", "Removes {count} service steps."],
    ["Quita {count} paso de servicio.", "Quita {count} pasos de servicio."],
  ],
  [
    "transfer_routes",
    [
      "Removes {count} transfer route to or from: {names}.",
      "Removes {count} transfer routes to or from: {names}.",
    ],
    [
      "Quita {count} ruta de traslado hacia o desde: {names}.",
      "Quita {count} rutas de traslado hacia o desde: {names}.",
    ],
  ],
] as const)("words %s in the singular for one and the plural otherwise", (key, en, es) => {
  for (const [locale, [one, many]] of [
    ["en", en],
    ["es", es],
  ] as const) {
    setLocale(locale);
    const c = serviceDeleteCopy("department");
    const line = (count: number) =>
      c.item({ key, count, targets: [{ id: "private", name: "Patio" }] });
    const fill = (text: string, count: number) =>
      text.replace("{count}", String(count)).replace("{names}", "Patio");
    expect(line(1)).toBe(fill(one, 1));
    expect(line(2)).toBe(fill(many, 2));
    expect(line(0)).toBe(fill(many, 0));
  }
});
