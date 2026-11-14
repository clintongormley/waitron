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
    "Chooses a surviving starting zone for this profile: {names}.",
    "Elige una zona inicial restante para este perfil: {names}.",
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
    "transfer_desks",
    "Removes the transfer desk for this profile: {names}.",
    "Quita el puesto de traslado de este perfil: {names}.",
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
    "Complete delivery of this order first: {names}.",
    "Completa primero la entrega de este pedido: {names}.",
  ],
  [
    "table.booked",
    "Move or cancel this booking first: {names}.",
    "Mueve o cancela primero esta reserva: {names}.",
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
    "This profile would have no allowed zones: {names}.",
    "Este perfil se quedaría sin zonas permitidas: {names}.",
  ],
  [
    "department.profile_in_use",
    "Move this profile to another department first: {names}.",
    "Mueve primero este perfil a otro departamento: {names}.",
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
    "floor_plan_sets",
    ["Removes {count} floor plan set.", "Removes {count} floor plan sets."],
    ["Quita {count} conjunto de planos de sala.", "Quita {count} conjuntos de planos de sala."],
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
it.each([
  [
    "profile_starting_zones",
    [
      "Chooses a surviving starting zone for this profile: Patio.",
      "Chooses a surviving starting zone for these profiles: Patio, Bar.",
    ],
    [
      "Elige una zona inicial restante para este perfil: Patio.",
      "Elige una zona inicial restante para estos perfiles: Patio, Bar.",
    ],
  ],
  [
    "transfer_desks",
    [
      "Removes the transfer desk for this profile: Patio.",
      "Removes transfer desks for these profiles: Patio, Bar.",
    ],
    [
      "Quita el puesto de traslado de este perfil: Patio.",
      "Quita los puestos de traslado de estos perfiles: Patio, Bar.",
    ],
  ],
] as const)("words %s by the names shown, not by the rows counted", (key, en, es) => {
  for (const [locale, [one, many]] of [
    ["en", en],
    ["es", es],
  ] as const) {
    setLocale(locale);
    const c = serviceDeleteCopy("department");
    const patio = { id: "private", name: "Patio" };
    expect(c.item({ key, count: 2, targets: [patio] })).toBe(one);
    expect(c.item({ key, count: 1, targets: [patio, { id: "other", name: "Bar" }] })).toBe(many);
  }
});
it.each([
  [
    "table.booked",
    [
      "Move or cancel this booking first: Ana.",
      "Move or cancel these bookings first: Ana, Luis.",
      "Move or cancel the bookings on the tables being deleted first.",
    ],
    [
      "Mueve o cancela primero esta reserva: Ana.",
      "Mueve o cancela primero estas reservas: Ana, Luis.",
      "Mueve o cancela primero las reservas de las mesas que se eliminan.",
    ],
  ],
  [
    "table.delivery_in_progress",
    [
      "Complete delivery of this order first: Ana.",
      "Complete delivery of these orders first: Ana, Luis.",
      "Complete delivery of the orders to the tables being deleted first.",
    ],
    [
      "Completa primero la entrega de este pedido: Ana.",
      "Completa primero la entrega de estos pedidos: Ana, Luis.",
      "Completa primero la entrega de los pedidos a las mesas que se eliminan.",
    ],
  ],
  [
    "zone.profile_in_use",
    [
      "This profile would have no allowed zones: Ana.",
      "These profiles would have no allowed zones: Ana, Luis.",
      "A profile would have no allowed zones.",
    ],
    [
      "Este perfil se quedaría sin zonas permitidas: Ana.",
      "Estos perfiles se quedarían sin zonas permitidas: Ana, Luis.",
      "Un perfil se quedaría sin zonas permitidas.",
    ],
  ],
  [
    "department.profile_in_use",
    [
      "Move this profile to another department first: Ana.",
      "Move these profiles to another department first: Ana, Luis.",
      "Move this department's profiles to another department first.",
    ],
    [
      "Mueve primero este perfil a otro departamento: Ana.",
      "Mueve primero estos perfiles a otro departamento: Ana, Luis.",
      "Mueve primero a otro departamento los perfiles de este departamento.",
    ],
  ],
  [
    "zone.table_in_use",
    ["Table 4 has open work: Ana.", "Table 4 has open work: Ana, Luis.", "Table 4 has open work."],
    [
      "La mesa 4 tiene trabajo abierto: Ana.",
      "La mesa 4 tiene trabajo abierto: Ana, Luis.",
      "La mesa 4 tiene trabajo abierto.",
    ],
  ],
] as const)(
  "words %s by the names it carries, and without names when the delete itself is refused",
  (code, en, es) => {
    for (const [locale, [one, many, unnamed]] of [
      ["en", en],
      ["es", es],
    ] as const) {
      setLocale(locale);
      const c = serviceDeleteCopy("zone");
      const params = { tableName: "4" };
      const ana = { id: "private", name: "Ana" };
      expect(c.refusal({ code, params, targets: [ana] })).toBe(one);
      expect(c.refusal({ code, params, targets: [ana, { id: "other", name: "Luis" }] })).toBe(many);
      expect(serviceDeleteError("zone", { code, params })).toBe(unnamed);
    }
  },
);

it.each([
  ["en", "deleted"],
  ["es", "eliminado"],
])("marks the deleted settings owner in %s", (locale, mark) => {
  setLocale(locale);
  const line = serviceDeleteCopy("zone").item({
    key: "screen_zones",
    count: 1,
    targets: [{ id: "gone", name: "Terrace", deleted: true }],
  });
  expect(line).toContain(`Terrace (${mark})`);
});
