import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { stationDeleteCopy } from "./station-delete-copy.js";
afterEach(() => setLocale("en"));
it.each([
  [
    "en",
    "Delete station",
    "Choose another default station first.",
    "Move these screens first: Grill, Bar.",
    "3 dishes are still waiting or being prepared.",
  ],
  [
    "es",
    "Eliminar estación",
    "Elige otra estación predeterminada primero.",
    "Cambia primero estas pantallas: Grill, Bar.",
    "3 platos siguen pendientes o en preparación.",
  ],
] as const)(
  "writes named and counted refusals in %s without technical identifiers",
  (locale, heading, defaultLine, screens, work) => {
    setLocale(locale);
    const copy = stationDeleteCopy();
    expect(copy.heading).toBe(heading);
    expect(
      copy.refusal({
        code: "station.is_default",
        params: { stationId: "private-id" },
        targets: [],
      }),
    ).toBe(defaultLine);
    expect(
      copy.refusal({
        code: "station.screen_in_use",
        params: { count: 2 },
        targets: [
          { id: "private-id", name: "Grill" },
          { id: "other-id", name: "Bar" },
        ],
      }),
    ).toBe(screens);
    expect(
      copy.refusal({ code: "station.work_in_progress", params: { count: 3 }, targets: [] }),
    ).toBe(work);
  },
);
it.each([
  [
    "station_unsent_lines",
    "2 unsent order lines return to normal routing.",
    "2 líneas de pedidos sin enviar vuelven al enrutamiento normal.",
  ],
  [
    "station_draft_lines",
    "2 draft lines return to normal routing.",
    "2 líneas de borradores vuelven al enrutamiento normal.",
  ],
  [
    "station_printers",
    "Remove these printer links: Grill, Bar.",
    "Quita estos vínculos de impresoras: Grill, Bar.",
  ],
  [
    "station_made_here",
    "Remove Made here from these devices: Grill, Bar.",
    "Quita Hecho aquí de estos dispositivos: Grill, Bar.",
  ],
  [
    "station_timing",
    "Remove station timing settings (2).",
    "Quita los ajustes de tiempos de la estación (2).",
  ],
  [
    "station_routing_cells",
    "Remove 2 normal routing rules.",
    "Quita 2 reglas de enrutamiento normal.",
  ],
  [
    "station_routing_periods",
    "Remove 2 period routing rules.",
    "Quita 2 reglas de enrutamiento por periodo.",
  ],
  [
    "station_device_screens",
    "Remove this station from these devices: Grill, Bar.",
    "Quita esta estación de estos dispositivos: Grill, Bar.",
  ],
  [
    "station_profile_screens",
    "Remove this station from these profiles: Grill, Bar.",
    "Quita esta estación de estos perfiles: Grill, Bar.",
  ],
  [
    "station_daily_states",
    "Remove 2 daily station settings.",
    "Quita 2 ajustes diarios de la estación.",
  ],
  [
    "station_daily_destinations",
    "These closed stations use normal routing: Grill, Bar.",
    "Estas estaciones cerradas usan el enrutamiento normal: Grill, Bar.",
  ],
] as const)("discloses %s in both languages", (key, en, es) => {
  for (const [locale, line] of [
    ["en", en],
    ["es", es],
  ] as const) {
    setLocale(locale);
    expect(
      stationDeleteCopy().item({
        key,
        count: 2,
        targets: [
          { id: "private-id", name: "Grill" },
          { id: "other-id", name: "Bar" },
        ],
      }),
    ).toBe(line);
  }
});
