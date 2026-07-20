import type { CadenaAltaInput, CadenaAnulacionInput } from "../src/types.js";

/** Huella spec v0.1.2 §6.1 — first record of a chain, so no predecessor. */
export const VECTOR_1_INPUT: CadenaAltaInput = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345678/G33",
  FechaExpedicionFactura: "01-01-2024",
  TipoFactura: "F1",
  CuotaTotal: "12.35",
  ImporteTotal: "123.45",
  huellaAnterior: "",
  FechaHoraHusoGenRegistro: "2024-01-01T19:20:30+01:00",
};

export const VECTOR_1_CADENA =
  "IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024" +
  "&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=" +
  "&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00";

export const VECTOR_1_HUELLA = "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60";

/** Huella spec v0.1.2 §6.2 — alta chained onto vector 1. */
export const VECTOR_2_INPUT: CadenaAltaInput = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345679/G34",
  FechaExpedicionFactura: "01-01-2024",
  TipoFactura: "F1",
  CuotaTotal: "12.35",
  ImporteTotal: "123.45",
  huellaAnterior: VECTOR_1_HUELLA,
  FechaHoraHusoGenRegistro: "2024-01-01T19:20:35+01:00",
};

export const VECTOR_2_HUELLA = "F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97";

/** Huella spec v0.1.2 §6.3 — anulación chained onto vector 2. Five fields, three renamed. */
export const VECTOR_3_INPUT: CadenaAnulacionInput = {
  IDEmisorFacturaAnulada: "89890001K",
  NumSerieFacturaAnulada: "12345679/G34",
  FechaExpedicionFacturaAnulada: "01-01-2024",
  huellaAnterior: VECTOR_2_HUELLA,
  FechaHoraHusoGenRegistro: "2024-01-01T19:20:40+01:00",
};

export const VECTOR_3_CADENA =
  "IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=12345679/G34" +
  "&FechaExpedicionFacturaAnulada=01-01-2024&Huella=" +
  VECTOR_2_HUELLA +
  "&FechaHoraHusoGenRegistro=2024-01-01T19:20:40+01:00";

export const VECTOR_3_HUELLA = "177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68";
