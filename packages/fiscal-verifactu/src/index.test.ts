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
  isUniqueViolation,
  lockChainHead,
  registerSif,
  registroSif,
  registrosFacturacion,
  toRegistroRow,
  VerifactuBackend,
  verifyChain,
} from "./index.js";

/**
 * A coherence check on the package root, not a duplicate of schema-ownership.test.ts or
 * migrations.test.ts — this proves `./index.js` itself re-exports the right things, mirroring
 * `packages/db/src/index.test.ts`'s own reasoning: every other test in this package imports its
 * subjects from a deep path (`./schema/index.js`, `./migrations.js`, `./registro-sif.js`), so none
 * of them would catch a re-export deleted from the root.
 */
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
    // Task 13's addition. The type-only exports (`RegisterSifParams`, `SifRegistration`) have no
    // runtime existence to assert on here — `errors.reachability.test.ts` and this package's own
    // `pnpm typecheck` are what would catch either going missing from ./index.ts.
    expect(typeof registerSif).toBe("function");
    expect(typeof currentSif).toBe("function");
    expect(typeof esPrimerRegistro).toBe("function");
  });

  it("re-exports the chain-append surface (appendToChain, lockChainHead, isUniqueViolation, toRegistroRow) from the package root", () => {
    // Task 14's addition. Type-only exports (ChainHead, PendingRegistro, RegistroRowContext,
    // RegistroRowInsert) have no runtime existence to assert on here — errors.reachability.test.ts
    // and this package's own `pnpm typecheck` are what would catch either going missing.
    expect(typeof appendToChain).toBe("function");
    expect(typeof lockChainHead).toBe("function");
    expect(typeof isUniqueViolation).toBe("function");
    expect(typeof toRegistroRow).toBe("function");
  });

  it("re-exports the chain-verification surface (verifyChain, fromRegistroRow) from the package root", () => {
    // Task 15's addition. The type-only export (RegistroRow) has no runtime existence to assert
    // on here — errors.reachability.test.ts and this package's own `pnpm typecheck` are what
    // would catch it going missing.
    expect(typeof verifyChain).toBe("function");
    expect(typeof fromRegistroRow).toBe("function");
  });

  it("re-exports the real backend (VerifactuBackend) from the package root", () => {
    // Task 16's addition. The type-only export (VerifactuBackendOptions) has no runtime existence
    // to assert on here — errors.reachability.test.ts and this package's own `pnpm typecheck` are
    // what would catch it going missing.
    expect(typeof VerifactuBackend).toBe("function");
  });

  it("re-exports the module's declared vocabulary (FISCAL_VOCABULARY) from the package root", () => {
    // The `vocabulary` seat is wired from this barrel (`@waitron/composition`); the root
    // english-only suite reads it through the descriptor, so a re-export deleted here would fail
    // there, not in this package's own gate.
    expect(FISCAL_VOCABULARY).toContain("huella");
  });
});
