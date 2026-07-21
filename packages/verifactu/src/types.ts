export type SiNo = "S" | "N";
export type TipoFactura = "F1" | "F2" | "F3" | "R1" | "R2" | "R3" | "R4" | "R5";
export type TipoHuella = "01";

export interface IDFactura {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
}

export interface IDFacturaAnulada {
  IDEmisorFacturaAnulada: string;
  NumSerieFacturaAnulada: string;
  FechaExpedicionFacturaAnulada: string;
}

/**
 * The four-part predecessor pointer. Note the sub-element names are the
 * alta-style ones in BOTH record types — a RegistroAnulacion chaining to a
 * predecessor still uses IDEmisorFactura, not IDEmisorFacturaAnulada. The
 * ...Anulada names appear only in RegistroAnulacion/IDFactura.
 */
export interface RegistroAnterior {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
  Huella: string;
}

/**
 * Exclusive choice: exactly one branch, never both, never neither — an XSD
 * xsd:choice. Each branch pins the other field to `never` rather than just
 * omitting it: a plain two-branch union (each branch naming only its own
 * field) would still let a literal carrying BOTH fields through, because a
 * property name known to one union member is not "excess" when checking a
 * fresh object literal against the other member. The `never` guard closes
 * that hole so both-present is a type error too. See DetalleDesglose below
 * for the same shape applied to a second xsd:choice in this file.
 */
export type Encadenamiento =
  | { PrimerRegistro: "S"; RegistroAnterior?: never }
  | { RegistroAnterior: RegistroAnterior; PrimerRegistro?: never };

export interface SistemaInformatico {
  NombreRazon: string;
  NIF: string;
  NombreSistemaInformatico: string;
  IdSistemaInformatico: string;
  Version: string;
  NumeroInstalacion: string;
  TipoUsoPosibleSoloVerifactu: SiNo;
  TipoUsoPosibleMultiOT: SiNo;
  IndicadorMultiplesOT: SiNo;
}

interface DetalleDesgloseCommon {
  Impuesto?: string;
  ClaveRegimen?: string;
  TipoImpositivo?: string;
  BaseImponibleOimporteNoSujeto: string;
  BaseImponibleACoste?: string;
  CuotaRepercutida?: string;
  TipoRecargoEquivalencia?: string;
  CuotaRecargoEquivalencia?: string;
}

/**
 * `sf:IDFacturaARType` — identifies a rectified or substituted invoice inside
 * FacturasRectificadas/FacturasSustituidas. Same three fields as IDFactura,
 * under a different XSD type name, so it gets its own interface rather than
 * reusing IDFactura — the two are not interchangeable in the schema even
 * though they're structurally identical today.
 */
export interface IDFacturaAR {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
}

/**
 * `sf:DesgloseRectificacionType` — mandatory when TipoRectificativa is "S"
 * (sustitución): rule 1118. BaseRectificada/CuotaRectificada are required by
 * the XSD; CuotaRecargoRectificado is optional.
 */
export interface DesgloseRectificacion {
  BaseRectificada: string;
  CuotaRectificada: string;
  CuotaRecargoRectificado?: string;
}

/**
 * Exclusive choice, mirroring Encadenamiento above: exactly one of
 * CalificacionOperacion / OperacionExenta, never both, never neither — an
 * XSD xsd:choice in DetalleType. Each branch pins the other field to `never`
 * rather than just omitting it: a plain two-branch union (each branch naming
 * only its own field) would still let a literal carrying BOTH fields through,
 * because a property name known to one union member is not "excess" when
 * checking a fresh object literal against the other member. The `never`
 * guard closes that hole so both-present is a type error too.
 */
export type DetalleDesglose =
  | (DetalleDesgloseCommon & { CalificacionOperacion: string; OperacionExenta?: never })
  | (DetalleDesgloseCommon & { OperacionExenta: string; CalificacionOperacion?: never });

export interface RegistroAlta {
  IDVersion: "1.0";
  IDFactura: IDFactura;
  RefExterna?: string;
  NombreRazonEmisor: string;
  Subsanacion?: SiNo;
  RechazoPrevio?: "N" | "S" | "X";
  TipoFactura: TipoFactura;
  TipoRectificativa?: "S" | "I";
  FacturasRectificadas?: { IDFacturaRectificada: IDFacturaAR[] };
  FacturasSustituidas?: { IDFacturaSustituida: IDFacturaAR[] };
  ImporteRectificacion?: DesgloseRectificacion;
  FechaOperacion?: string;
  DescripcionOperacion: string;
  FacturaSimplificadaArt7273?: SiNo;
  FacturaSinIdentifDestinatarioArt61d?: SiNo;
  Macrodato?: SiNo;
  Cupon?: SiNo;
  Desglose: DetalleDesglose[];
  CuotaTotal: string;
  ImporteTotal: string;
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  FechaHoraHusoGenRegistro: string;
  TipoHuella: TipoHuella;
  Huella: string;
}

export interface RegistroAnulacion {
  IDVersion: "1.0";
  IDFactura: IDFacturaAnulada;
  RefExterna?: string;
  SinRegistroPrevio?: SiNo;
  RechazoPrevio?: SiNo;
  GeneradoPor?: "E" | "D" | "T";
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  FechaHoraHusoGenRegistro: string;
  TipoHuella: TipoHuella;
  Huella: string;
}

/**
 * Discriminates the two record types by the presence of TipoFactura, which
 * only RegistroAlta carries. Shared by huella.ts (canonical-string building)
 * and validate.ts (record validation) — both need the same discriminator, so
 * it lives here rather than being redefined in each.
 */
export function isAlta(record: RegistroAlta | RegistroAnulacion): record is RegistroAlta {
  return "TipoFactura" in record;
}

/** Exactly the eight fields that feed the alta huella, in order. */
export interface CadenaAltaInput {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
  TipoFactura: string;
  CuotaTotal: string;
  ImporteTotal: string;
  huellaAnterior: string;
  FechaHoraHusoGenRegistro: string;
}

/** Exactly the five fields that feed the anulación huella, in order. */
export interface CadenaAnulacionInput {
  IDEmisorFacturaAnulada: string;
  NumSerieFacturaAnulada: string;
  FechaExpedicionFacturaAnulada: string;
  huellaAnterior: string;
  FechaHoraHusoGenRegistro: string;
}

interface DetalleDesgloseInputCommon {
  Impuesto?: string;
  ClaveRegimen?: string;
  TipoImpositivo?: string;
  BaseImponibleOimporteNoSujeto: string;
  BaseImponibleACoste?: string;
  CuotaRepercutida?: string;
  TipoRecargoEquivalencia?: string;
  CuotaRecargoEquivalencia?: string;
}

/** Same exclusive-choice shape as DetalleDesglose above, over input types. */
export type DetalleDesgloseInput =
  | (DetalleDesgloseInputCommon & { CalificacionOperacion: string; OperacionExenta?: never })
  | (DetalleDesgloseInputCommon & { OperacionExenta: string; CalificacionOperacion?: never });

/** Input mirror of IDFacturaAR — FechaExpedicionFactura arrives as a Date, like FechaExpedicionFactura elsewhere. */
export interface IDFacturaARInput {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: Date;
}

/** Input mirror of DesgloseRectificacion — amounts arrive as exact decimal strings. */
export interface DesgloseRectificacionInput {
  BaseRectificada: string;
  CuotaRectificada: string;
  CuotaRecargoRectificado?: string;
}

/** Fields shared verbatim between AltaInput and AnulacionInput. */
interface RecordInputBase {
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  generadoEn: Date;
  /** Minutes east of UTC. Explicit because a Date carries no zone of its own. */
  offsetMinutes: number;
  RefExterna?: string;
}

export interface AltaInput extends RecordInputBase {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: Date;
  NombreRazonEmisor: string;
  Subsanacion?: SiNo;
  RechazoPrevio?: "N" | "S" | "X";
  TipoFactura: TipoFactura;
  TipoRectificativa?: "S" | "I";
  /** The rectified invoices' identities. Formatted with this input's own offsetMinutes, like FechaExpedicionFactura. */
  FacturasRectificadas?: IDFacturaARInput[];
  /** The substituted invoices' identities. Formatted with this input's own offsetMinutes, like FechaExpedicionFactura. */
  FacturasSustituidas?: IDFacturaARInput[];
  /** Mandatory (rule 1118) when TipoRectificativa is "S" — sustitución. */
  ImporteRectificacion?: DesgloseRectificacionInput;
  /** A date like FechaExpedicionFactura — RegistroAlta stores it pre-formatted as DD-MM-YYYY. */
  FechaOperacion?: Date;
  DescripcionOperacion: string;
  FacturaSimplificadaArt7273?: SiNo;
  FacturaSinIdentifDestinatarioArt61d?: SiNo;
  Macrodato?: SiNo;
  Cupon?: SiNo;
  Desglose: DetalleDesgloseInput[];
  CuotaTotal: string;
  ImporteTotal: string;
}

export interface AnulacionInput extends RecordInputBase {
  IDEmisorFacturaAnulada: string;
  NumSerieFacturaAnulada: string;
  FechaExpedicionFacturaAnulada: Date;
  SinRegistroPrevio?: SiNo;
  RechazoPrevio?: SiNo;
  GeneradoPor?: "E" | "D" | "T";
}
