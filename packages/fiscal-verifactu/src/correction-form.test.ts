import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordCorrection, recordSale } from "@waitron/core";
import { buildCadena, serializeEnvio } from "@waitron/verifactu";
import type { Cabecera, RegistroAlta } from "@waitron/verifactu";
import { invoiceSeries, newId, nowIso, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { seriesId as brandSeriesId, deviceOrigin } from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";
import type { TrustedClock } from "@waitron/fiscal";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";

/**
 * Pins, as literals, what a by-differences corrective files: the stored fields, the string its
 * fingerprint is computed over, and the XML AEAT receives. A replacement corrective is filed by a
 * separate branch of `recordCorrection`; these cases are what prove the by-differences branch was
 * left as it was, for a corrective issued on the original's day and on a later one.
 */
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let backend: VerifactuBackend;
let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;
let rectSeriesId: SeriesId;
let rectifySessionId: string;

beforeEach(async () => {
  ({ deviceId, nodeId, seriesId } = await seedTenantWithSif(suite.db, { nif: "20009999E" }));
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "R", purpose: "rectificative", nextNumber: 1 })
    .returning({ id: invoiceSeries.id });
  rectSeriesId = brandSeriesId(series!.id);
  const rows = await seedPersons(suite.db, {
    id: newId(),
    createdAt: nowIso(),
    displayName: "P",
    pinHash: hashPin("1234"),
    role: "supervisor",
  });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId, personId: rows[0]!.id, pin: "1234" }),
  );
  rectifySessionId = session.id;
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

/** Four days after the original, at another time of day. */
const laterDayClock: TrustedClock = {
  ...steadyClock,
  now: () => ({ ...steadyClock.now(), instant: new Date("2026-03-05T19:40:00+01:00") }),
};

async function correctedSale(correctionClock: TrustedClock = steadyClock): Promise<SaleId> {
  const { saleId: original } = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId })),
  );
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordCorrection(tx, backend, {
      origin: deviceOrigin(deviceId),
      nodeId,
      seriesId: rectSeriesId,
      correctsSaleId: original,
      total: "-2.31",
      lines: [
        {
          lineNo: 1,
          name: "Agua",
          descriptions: { "es-ES": "Agua" },
          quantity: "-1",
          unitPrice: "2.10",
          vatRate: "10.00",
          lineTotal: "-2.10",
        },
      ],
      authz: { sessionId: rectifySessionId },
      clock: correctionClock,
    }),
  );
  return saleId;
}

describe("a by-differences corrective's filed form", () => {
  it("files the pinned fields, fingerprint input and envelope", async () => {
    const saleId = await correctedSale();
    const { rows } = await suite.db.execute<Record<string, unknown>>(
      sql`select * from registros_facturacion where sale_id = ${saleId}`,
    );
    const row = decodeRegistroRow(rows[0]!);

    expect({
      tipoFactura: row.tipo_factura,
      tipoRectificativa: row.tipo_rectificativa,
      importeRectificacion: row.importe_rectificacion,
      facturasRectificadas: row.facturas_rectificadas,
      desglose: row.desglose,
      cuotaTotal: row.cuota_total,
      importeTotal: row.importe_total,
    }).toMatchInlineSnapshot(`
      {
        "cuotaTotal": "-0.21",
        "desglose": [
          {
            "BaseImponibleOimporteNoSujeto": "-2.10",
            "CalificacionOperacion": "S1",
            "ClaveRegimen": "01",
            "CuotaRepercutida": "-0.21",
            "TipoImpositivo": "10.00",
          },
        ],
        "facturasRectificadas": {
          "IDFacturaRectificada": [
            {
              "FechaExpedicionFactura": "01-03-2026",
              "IDEmisorFactura": "20009999E",
              "NumSerieFactura": "A/1",
            },
          ],
        },
        "importeRectificacion": null,
        "importeTotal": "-2.31",
        "tipoFactura": "R5",
        "tipoRectificativa": "I",
      }
    `);

    const record = fromRegistroRow(row) as RegistroAlta;
    expect(buildCadena(record)).toMatchInlineSnapshot(
      `"IDEmisorFactura=20009999E&NumSerieFactura=R/1&FechaExpedicionFactura=01-03-2026&TipoFactura=R5&CuotaTotal=-0.21&ImporteTotal=-2.31&Huella=02C8C5E2AD26D065B73756D08302582743E373389C4AC6C426B1D53D14FF103B&FechaHoraHusoGenRegistro=2026-03-01T13:05:00+01:00"`,
    );

    const cabecera: Cabecera = {
      ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura },
    };
    expect(
      serializeEnvio(cabecera, [{ RegistroAlta: { ...record, RefExterna: "ref-1" } }]),
    ).toMatchInlineSnapshot(
      `"<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"><soapenv:Body><sfLR:RegFactuSistemaFacturacion><sfLR:Cabecera><sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>20009999E</sf:NIF></sf:ObligadoEmision></sfLR:Cabecera><sfLR:RegistroFactura><sf:RegistroAlta><sf:IDVersion>1.0</sf:IDVersion><sf:IDFactura><sf:IDEmisorFactura>20009999E</sf:IDEmisorFactura><sf:NumSerieFactura>R/1</sf:NumSerieFactura><sf:FechaExpedicionFactura>01-03-2026</sf:FechaExpedicionFactura></sf:IDFactura><sf:RefExterna>ref-1</sf:RefExterna><sf:NombreRazonEmisor>Waitron SL</sf:NombreRazonEmisor><sf:TipoFactura>R5</sf:TipoFactura><sf:TipoRectificativa>I</sf:TipoRectificativa><sf:FacturasRectificadas><sf:IDFacturaRectificada><sf:IDEmisorFactura>20009999E</sf:IDEmisorFactura><sf:NumSerieFactura>A/1</sf:NumSerieFactura><sf:FechaExpedicionFactura>01-03-2026</sf:FechaExpedicionFactura></sf:IDFacturaRectificada></sf:FacturasRectificadas><sf:DescripcionOperacion>Venta en establecimiento</sf:DescripcionOperacion><sf:Desglose><sf:DetalleDesglose><sf:ClaveRegimen>01</sf:ClaveRegimen><sf:CalificacionOperacion>S1</sf:CalificacionOperacion><sf:TipoImpositivo>10.00</sf:TipoImpositivo><sf:BaseImponibleOimporteNoSujeto>-2.10</sf:BaseImponibleOimporteNoSujeto><sf:CuotaRepercutida>-0.21</sf:CuotaRepercutida></sf:DetalleDesglose></sf:Desglose><sf:CuotaTotal>-0.21</sf:CuotaTotal><sf:ImporteTotal>-2.31</sf:ImporteTotal><sf:Encadenamiento><sf:RegistroAnterior><sf:IDEmisorFactura>20009999E</sf:IDEmisorFactura><sf:NumSerieFactura>A/1</sf:NumSerieFactura><sf:FechaExpedicionFactura>01-03-2026</sf:FechaExpedicionFactura><sf:Huella>02C8C5E2AD26D065B73756D08302582743E373389C4AC6C426B1D53D14FF103B</sf:Huella></sf:RegistroAnterior></sf:Encadenamiento><sf:SistemaInformatico><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>20009999E</sf:NIF><sf:NombreSistemaInformatico>Waitron</sf:NombreSistemaInformatico><sf:IdSistemaInformatico>WT</sf:IdSistemaInformatico><sf:Version>0.0.0-dev</sf:Version><sf:NumeroInstalacion>1</sf:NumeroInstalacion><sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu><sf:TipoUsoPosibleMultiOT>N</sf:TipoUsoPosibleMultiOT><sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT></sf:SistemaInformatico><sf:FechaHoraHusoGenRegistro>2026-03-01T13:05:00+01:00</sf:FechaHoraHusoGenRegistro><sf:TipoHuella>01</sf:TipoHuella><sf:Huella>A55D8FDCD2FB12B214742F5D94E7FC5A5441CE35F9C3D1257363DC32E6B807FC</sf:Huella></sf:RegistroAlta></sfLR:RegistroFactura></sfLR:RegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>"`,
    );
  });

  it("files the pinned fields, fingerprint input and envelope when issued on a later day", async () => {
    const saleId = await correctedSale(laterDayClock);
    const { rows } = await suite.db.execute<Record<string, unknown>>(
      sql`select * from registros_facturacion where sale_id = ${saleId}`,
    );
    const row = decodeRegistroRow(rows[0]!);

    expect({
      tipoFactura: row.tipo_factura,
      tipoRectificativa: row.tipo_rectificativa,
      importeRectificacion: row.importe_rectificacion,
      facturasRectificadas: row.facturas_rectificadas,
      desglose: row.desglose,
      cuotaTotal: row.cuota_total,
      importeTotal: row.importe_total,
    }).toMatchInlineSnapshot(`
      {
        "cuotaTotal": "-0.21",
        "desglose": [
          {
            "BaseImponibleOimporteNoSujeto": "-2.10",
            "CalificacionOperacion": "S1",
            "ClaveRegimen": "01",
            "CuotaRepercutida": "-0.21",
            "TipoImpositivo": "10.00",
          },
        ],
        "facturasRectificadas": {
          "IDFacturaRectificada": [
            {
              "FechaExpedicionFactura": "01-03-2026",
              "IDEmisorFactura": "20009999E",
              "NumSerieFactura": "A/1",
            },
          ],
        },
        "importeRectificacion": null,
        "importeTotal": "-2.31",
        "tipoFactura": "R5",
        "tipoRectificativa": "I",
      }
    `);

    const record = fromRegistroRow(row) as RegistroAlta;
    expect(buildCadena(record)).toMatchInlineSnapshot(
      `"IDEmisorFactura=20009999E&NumSerieFactura=R/1&FechaExpedicionFactura=05-03-2026&TipoFactura=R5&CuotaTotal=-0.21&ImporteTotal=-2.31&Huella=02C8C5E2AD26D065B73756D08302582743E373389C4AC6C426B1D53D14FF103B&FechaHoraHusoGenRegistro=2026-03-05T19:40:00+01:00"`,
    );

    const cabecera: Cabecera = {
      ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura },
    };
    expect(
      serializeEnvio(cabecera, [{ RegistroAlta: { ...record, RefExterna: "ref-1" } }]),
    ).toMatchInlineSnapshot(
      `"<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"><soapenv:Body><sfLR:RegFactuSistemaFacturacion><sfLR:Cabecera><sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>20009999E</sf:NIF></sf:ObligadoEmision></sfLR:Cabecera><sfLR:RegistroFactura><sf:RegistroAlta><sf:IDVersion>1.0</sf:IDVersion><sf:IDFactura><sf:IDEmisorFactura>20009999E</sf:IDEmisorFactura><sf:NumSerieFactura>R/1</sf:NumSerieFactura><sf:FechaExpedicionFactura>05-03-2026</sf:FechaExpedicionFactura></sf:IDFactura><sf:RefExterna>ref-1</sf:RefExterna><sf:NombreRazonEmisor>Waitron SL</sf:NombreRazonEmisor><sf:TipoFactura>R5</sf:TipoFactura><sf:TipoRectificativa>I</sf:TipoRectificativa><sf:FacturasRectificadas><sf:IDFacturaRectificada><sf:IDEmisorFactura>20009999E</sf:IDEmisorFactura><sf:NumSerieFactura>A/1</sf:NumSerieFactura><sf:FechaExpedicionFactura>01-03-2026</sf:FechaExpedicionFactura></sf:IDFacturaRectificada></sf:FacturasRectificadas><sf:DescripcionOperacion>Venta en establecimiento</sf:DescripcionOperacion><sf:Desglose><sf:DetalleDesglose><sf:ClaveRegimen>01</sf:ClaveRegimen><sf:CalificacionOperacion>S1</sf:CalificacionOperacion><sf:TipoImpositivo>10.00</sf:TipoImpositivo><sf:BaseImponibleOimporteNoSujeto>-2.10</sf:BaseImponibleOimporteNoSujeto><sf:CuotaRepercutida>-0.21</sf:CuotaRepercutida></sf:DetalleDesglose></sf:Desglose><sf:CuotaTotal>-0.21</sf:CuotaTotal><sf:ImporteTotal>-2.31</sf:ImporteTotal><sf:Encadenamiento><sf:RegistroAnterior><sf:IDEmisorFactura>20009999E</sf:IDEmisorFactura><sf:NumSerieFactura>A/1</sf:NumSerieFactura><sf:FechaExpedicionFactura>01-03-2026</sf:FechaExpedicionFactura><sf:Huella>02C8C5E2AD26D065B73756D08302582743E373389C4AC6C426B1D53D14FF103B</sf:Huella></sf:RegistroAnterior></sf:Encadenamiento><sf:SistemaInformatico><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>20009999E</sf:NIF><sf:NombreSistemaInformatico>Waitron</sf:NombreSistemaInformatico><sf:IdSistemaInformatico>WT</sf:IdSistemaInformatico><sf:Version>0.0.0-dev</sf:Version><sf:NumeroInstalacion>1</sf:NumeroInstalacion><sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu><sf:TipoUsoPosibleMultiOT>N</sf:TipoUsoPosibleMultiOT><sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT></sf:SistemaInformatico><sf:FechaHoraHusoGenRegistro>2026-03-05T19:40:00+01:00</sf:FechaHoraHusoGenRegistro><sf:TipoHuella>01</sf:TipoHuella><sf:Huella>23FF6F9B329FF56BFBC46BA20D5D8A01C9E905C1C0F2A3D1DF6C2D8CF0E9BC32</sf:Huella></sf:RegistroAlta></sfLR:RegistroFactura></sfLR:RegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>"`,
    );
  });
});
