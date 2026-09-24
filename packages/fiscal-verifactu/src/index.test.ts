import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  appendToChain,
  FISCAL_MIGRATIONS,
  FISCAL_VOCABULARY,
  cadenas,
  contadoresInstalacion,
  currentSif,
  envios,
  esPrimerRegistro,
  fromRegistroRow,
  readChainHead,
  registerSif,
  registroSif,
  registrosFacturacion,
  toRegistroRow,
  VerifactuBackend,
  verifyChain,
} from "./index.js";

/** Other tests import their subjects from deep paths, so none would catch a re-export deleted
 * from the root. */
describe("package public surface (./index.js)", () => {
  it("re-exports FISCAL_MIGRATIONS and every owned table from the package root", () => {
    expect(FISCAL_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_fiscal");
    expect(getTableName(cadenas)).toBe("cadenas");
    expect(getTableName(contadoresInstalacion)).toBe("contadores_instalacion");
    expect(getTableName(envios)).toBe("envios");
    expect(getTableName(registroSif)).toBe("registro_sif");
    expect(getTableName(registrosFacturacion)).toBe("registros_facturacion");
  });

  it("re-exports the registration surface (registerSif, currentSif, esPrimerRegistro) from the package root", () => {
    expect(typeof registerSif).toBe("function");
    expect(typeof currentSif).toBe("function");
    expect(typeof esPrimerRegistro).toBe("function");
  });

  it("re-exports the chain-append surface (appendToChain, readChainHead, toRegistroRow) from the package root", () => {
    expect(typeof appendToChain).toBe("function");
    expect(typeof readChainHead).toBe("function");
    expect(typeof toRegistroRow).toBe("function");
  });

  it("re-exports the chain-verification surface (verifyChain, fromRegistroRow) from the package root", () => {
    expect(typeof verifyChain).toBe("function");
    expect(typeof fromRegistroRow).toBe("function");
  });

  it("re-exports the real backend (VerifactuBackend) from the package root", () => {
    expect(typeof VerifactuBackend).toBe("function");
  });

  it("re-exports the module's declared vocabulary (FISCAL_VOCABULARY) from the package root", () => {
    expect(FISCAL_VOCABULARY).toContain("huella");
  });
});
