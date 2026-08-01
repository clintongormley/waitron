import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent, errors as undiciErrors, fetch as undiciFetch } from "undici";
import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { isAppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { Cabecera, EnvioRegistro } from "@waitron/verifactu";
import {
  aeatClientResolver,
  aeatEndpointFor,
  certMaterialFrom,
  mtlsFetch,
  readCertMaterial,
} from "./aeat-transport.js";
import type { CertKind, CertMaterial } from "./aeat-transport.js";
import {
  mintMtlsMaterial,
  startMtlsServer,
  type MtlsMaterial,
  type MtlsServer,
} from "./testing/tls.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

// A minimal SOAP-shaped body — well-formed, not a fault. This suite is about the HANDSHAKE, not
// about parsing — `createClient` parses, and its own suite covers that.
const MINIMAL_SOAP_BODY = '<?xml version="1.0"?><Envelope><Body/></Envelope>';

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 120_000,
});
const ring = loadKeyRing(KEY_ENV);
const material: MtlsMaterial = mintMtlsMaterial();

// The local TLS listener is this suite's own; only the database is `usePgliteDb`'s. The teardown is
// guarded because a `startMtlsServer` that threw would otherwise be reported twice — once really,
// once as a spurious `Cannot read properties of undefined (reading 'close')`. See
// `scripts/guarded-teardowns.test.ts`'s header for the experiment that measured that.
let server: MtlsServer;

beforeAll(async () => {
  server = await startMtlsServer(material, MINIMAL_SOAP_BODY);
}, 120_000);

afterAll(async () => {
  if (server !== undefined) await server.close();
});

async function provision(certKind: string): Promise<TenantId> {
  const tenantId = await seedTenant(suite.db);
  await withTenant(suite.db, tenantId, (tx) =>
    putCredential(tx, ring, {
      tenantId,
      purpose: "fiscal.aeat",
      value: {
        pfxBase64: material.clientPfx.toString("base64"),
        passphrase: material.clientPassphrase,
        certKind,
      },
    }),
  );
  return tenantId;
}

describe("aeatEndpointFor", () => {
  it("sends a sello certificate to the sello host, which is a different host entirely", () => {
    const preprod = aeatEndpointFor("preproduction");
    expect(preprod("sello")).toContain("prewww10");
    expect(preprod("representante")).toContain("prewww1.");
    const prod = aeatEndpointFor("production");
    expect(prod("sello")).toContain("www10");
    expect(prod("representante")).toContain("www1.");
  });
});

describe("readCertMaterial", () => {
  it("decodes the PFX and the kind", async () => {
    const tenantId = await provision("sello");
    const read = await readCertMaterial(suite.db, ring, tenantId);
    expect(read.certKind).toBe("sello");
    expect(read.passphrase).toBe(material.clientPassphrase);
    expect(read.pfx.equals(material.clientPfx)).toBe(true);
  });

  it("rejects a certKind that is not one of the two kinds", async () => {
    const tenantId = await provision("wildcard");
    const error = await captureError(() => readCertMaterial(suite.db, ring, tenantId));
    expect(isAppError(error) && error.code).toBe("server.credential_unusable");
    expect(isAppError(error) && error.params).toMatchObject({ field: "certKind" });
  });

  it("fails with credentials.missing when the tenant has no fiscal credential at all", async () => {
    const tenantId = await seedTenant(suite.db);
    const error = await captureError(() => readCertMaterial(suite.db, ring, tenantId));
    // The vault's own code, not ours: absence is the vault's fact to report, and drain's per-tenant
    // containment records whichever code arrives.
    expect(isAppError(error) && error.code).toBe("credentials.missing");
  });
});

describe("certMaterialFrom", () => {
  const REF = { tenantId: "11111111-1111-1111-1111-111111111111", purpose: "fiscal.aeat" };

  // Driven directly rather than through a forged database row. `putCredential` validates, so a
  // two-field payload cannot be written through the vault's own API — and re-sealing one by hand
  // would need `seal`, which the credentials package deliberately does not export. The pure
  // function IS the read-side guard, so testing it directly tests the thing.
  it("fails loudly on a payload sealed before certKind existed, rather than guessing a host", () => {
    // Spec §5.1: reads validate nothing, so a row sealed under the old two-field list decrypts to a
    // payload whose certKind is undefined. Defaulting would send a sello certificate to the
    // non-sello host and fail every submission for that tenant with nothing explaining why.
    expect(() => certMaterialFrom({ pfxBase64: "AAA=", passphrase: "p" }, REF)).toThrow(
      /server.credential_unusable/,
    );
  });

  it.each(["pfxBase64", "passphrase"])("fails loudly when %s is absent", async (field) => {
    const full: Record<string, string> = {
      pfxBase64: "AAA=",
      passphrase: "p",
      certKind: "sello",
    };
    delete full[field];
    // `captureError` catches a synchronous throw inside the thunk too — the throw happens before
    // `Promise.resolve` is ever reached, so it propagates out of the callback into its try.
    const error = await captureError(() => Promise.resolve(certMaterialFrom(full, REF)));
    // Pins `.code` too, not just `.params` — otherwise a different `AppError` that happened to
    // carry a `field` param would satisfy this assertion just as well. Same pattern as the
    // `certKind` case above.
    expect(isAppError(error) && error.code).toBe("server.credential_unusable");
    expect(isAppError(error) && error.params).toMatchObject({ field });
  });

  it("fails loudly when pfxBase64 decodes to no usable bytes (not real base64)", async () => {
    // "!!!!" contains zero characters from the base64 alphabet, so it decodes to a zero-length
    // buffer — unlike, say, a string that merely mixes in some invalid characters among real
    // base64 letters, which Node's decoder tolerates by skipping them. This is the case the
    // decode-then-check ordering in `certMaterialFrom` exists to catch: a `pfxBase64` that is
    // PRESENT and non-empty but unusable.
    const error = await captureError(() =>
      Promise.resolve(
        certMaterialFrom({ pfxBase64: "!!!!", passphrase: "p", certKind: "sello" }, REF),
      ),
    );
    expect(isAppError(error) && error.code).toBe("server.credential_unusable");
    expect(isAppError(error) && error.params).toMatchObject({ field: "pfxBase64" });
  });

  it("decodes base64 to the exact DER bytes", () => {
    const decoded = certMaterialFrom(
      { pfxBase64: Buffer.from([1, 2, 3]).toString("base64"), passphrase: "p", certKind: "sello" },
      REF,
    );
    expect([...decoded.pfx]).toEqual([1, 2, 3]);
  });
});

describe("the resolved client over a real client-certificate handshake", () => {
  it("presents the vaulted certificate to a server that requires one", async () => {
    const tenantId = await provision("representante");
    // Captured rather than discarded: `aeatClientResolver` reads `certKind` off THIS tenant's own
    // vaulted material and is supposed to hand it to `endpointFor` unchanged. A zero-argument
    // `() => server.origin` stub would still make every other assertion in this test pass even if
    // the implementation hardcoded a kind or forwarded the wrong field — the seam between "the
    // provisioned certKind" and "the endpoint it selects" is the one thing a two-tenant deployment
    // actually depends on, so it is the one thing this test must not let through unobserved.
    let seenCertKind: CertKind | undefined;
    const resolver = aeatClientResolver({
      db: suite.db,
      ring,
      endpointFor: (certKind) => {
        seenCertKind = certKind;
        return server.origin;
      },
      fetchFor: (m) => mtlsFetch(m, material.caPem),
    });
    const client = await resolver.resolve(tenantId);

    // `submit` posts, and the local server answers with a body `parseRespuestaSuministro` will
    // reject. The assertion is the HANDSHAKE: the server only answers at all if the client
    // presented a certificate its CA signed.
    //
    // `[anyRegistro()]`, not `[]`: `serializeEnvio` refuses an empty registros array before
    // `submit` ever calls `fetch` ("An envio must contain at least one registro"), which would
    // make this test pass for the wrong reason — no request sent, `sawClientCn()` never set, and
    // the assertion below would just as reliably fail whether or not the handshake worked.
    await captureError(() => client.submit(anyCabecera(), [anyRegistro()]));
    expect(server.sawClientCn()).toBe(material.clientCn);
    expect(seenCertKind).toBe("representante");
  });

  it("still reaches the server when ca is omitted, because the vaulted PFX bundles its own issuing CA", async () => {
    // `boot.ts` calls `mtlsFetch(material)` with no second argument — the production default, and
    // the branch `ca === undefined ? {} : { ca }` exists to cover. `mintMtlsMaterial`'s PKCS#12
    // bundles BOTH the client leaf certificate and the CA that signed it
    // (`forge.pkcs12.toPkcs12Asn1(clientKeys.privateKey, [clientCert, caCert], ...)`), mirroring how
    // a real FNMT export commonly ships a chain rather than a bare leaf. Node's PKCS#12 loader adds
    // every non-leaf certificate in a `pfx` as an extra trust anchor for verifying the PEER, not only
    // as the client's own presented identity — confirmed directly: the identical handshake against a
    // LEAF-ONLY PFX (no bundled CA, everything else unchanged) fails with `SELF_SIGNED_CERT_IN_CHAIN`
    // (see the task report). So the omitted `ca` argument does not leave this connection unverified;
    // it relies on what the vaulted material itself already carries, which is this suite's own
    // fixture and a realistic PFX shape, not a gap in the test.
    const tenantId = await provision("representante");
    const resolver = aeatClientResolver({
      db: suite.db,
      ring,
      endpointFor: () => server.origin,
      fetchFor: (m) => mtlsFetch(m),
    });
    const client = await resolver.resolve(tenantId);
    await captureError(() => client.submit(anyCabecera(), [anyRegistro()]));
    expect(server.sawClientCn()).toBe(material.clientCn);
  });

  it("is refused when no client certificate is presented", async () => {
    // A bare Agent carrying the CA but no pfx/cert/key at all — deliberately NOT
    // `mtlsFetch({ pfx: Buffer.alloc(0), ... })`. An empty Buffer is not a parseable PKCS#12, so
    // that route fails LOCALLY inside Node's `configSecureContext` ("not enough data") before any
    // socket is even opened — it would throw an Error whether or not this server's
    // `rejectUnauthorized` guarantee actually works, which is not a test of the server refusing
    // anything. This dispatcher completes a TCP connection and a TLS ClientHello with no
    // certificate attached, so the failure verified below is the SERVER tearing the connection
    // down mid-handshake — not a local parse error.
    const requestsBefore = server.requests();
    const dispatcher = new Agent({ connect: { ca: material.caPem } });
    const error = await captureError(() =>
      undiciFetch(`${server.origin}/`, { method: "POST", body: "x", dispatcher }),
    );
    expect(error).toBeInstanceOf(Error);
    // `fetch`'s own error is a generic `TypeError: fetch failed` — the SPECIFIC failure lives on
    // `.cause`. Checked empirically against two other ways this same fetch can fail, so this isn't
    // presumed: a wrong CA produces a raw TLS `Error` with `code: "CERT_SIGNATURE_FAILURE"`, and a
    // bad origin fails before any connection with `code: undefined, message: "bad port"` — NEITHER
    // is `instanceof SocketError`. Only the server tearing the connection down mid-handshake (this
    // case) produces undici's `SocketError` (`code: "UND_ERR_SOCKET"`). Asserting on the class
    // rather than a message string keeps this pinned to that specific failure shape.
    expect((error as Error).cause).toBeInstanceOf(undiciErrors.SocketError);
    // A second, independent, SERVER-side signal: the request HANDLER — which only runs once a full
    // HTTP request has arrived — did not run. This alone does not distinguish "no cert presented"
    // from a wrong CA or a bad origin (checked: all three leave the count equally unchanged), so it
    // is not a substitute for the `SocketError` check above — but it directly disproves the one
    // thing this test's name asserts and an error TYPE never can: that the server actually accepted
    // and answered the request. (Mutation-checked: flipping this fixture's own `rejectUnauthorized`
    // to `false` makes the request succeed and turns this whole test red — see the task report.)
    expect(server.requests()).toBe(requestsBefore);
  });
});

describe("aeatClientResolver lifetime", () => {
  it("closes one transport per tenant it built", async () => {
    const tenantA = await provision("sello");
    const tenantB = await provision("representante");
    const closed: string[] = [];
    const resolver = aeatClientResolver({
      db: suite.db,
      ring,
      endpointFor: () => "https://example.test/soap",
      fetchFor: (m) => ({
        fetch: (() => Promise.reject(new Error("not this test's subject"))) as typeof fetch,
        close: () => {
          closed.push(m.certKind);
          return Promise.resolve();
        },
      }),
    });

    await resolver.resolve(tenantA);
    await resolver.resolve(tenantB);
    await resolver.closeAll();

    expect(closed).toHaveLength(2);
  });

  // The constraint that is invisible until it is violated: `closeAll` runs in boot's `finally`, so
  // a throw there would REPLACE drain's return value or its error — a cleanup path eating the
  // finding it was cleaning up after. Every transport is still attempted, and the failure is
  // logged rather than silently dropped.
  it("does not throw when a transport's close fails, and still closes the rest", async () => {
    const tenantA = await provision("sello");
    const tenantB = await provision("representante");
    const closed: string[] = [];
    const logged: Array<[string, string, Record<string, unknown> | undefined]> = [];
    let n = 0;
    const resolver = aeatClientResolver(
      {
        db: suite.db,
        ring,
        endpointFor: () => "https://example.test/soap",
        fetchFor: () => ({
          fetch: (() => Promise.reject(new Error("not this test's subject"))) as typeof fetch,
          close: () => {
            n += 1;
            if (n === 1) return Promise.reject(new Error("socket already gone"));
            closed.push("ok");
            return Promise.resolve();
          },
        }),
      },
      (level, event, fields) => logged.push([level, event, fields]),
    );

    await resolver.resolve(tenantA);
    await resolver.resolve(tenantB);

    await expect(resolver.closeAll()).resolves.toBeUndefined();
    expect(closed).toEqual(["ok"]);
    // The one call attributable to the failing transport, not the one that closed cleanly —
    // carrying WHICH tenant (tenantA, resolved first, so its close() is the one `n === 1` catches)
    // and a message that survives `codeOf`'s "unknown" flattening of a plain socket-layer `Error`.
    expect(logged).toEqual([
      [
        "warn",
        "transport.close_failed",
        { tenantId: tenantA, errorCode: "unknown", message: "socket already gone" },
      ],
    ]);
  });

  // A rejected promise can reject with ANY value, not only an `Error` — `close()`'s own type
  // (`Promise<void>`) makes no promise about what it rejects with, so `message: error instanceof
  // Error ? error.message : String(error)` above has a real, not merely defensive, second branch.
  it("stringifies a close failure that rejects with something other than an Error", async () => {
    const tenantA = await provision("sello");
    const logged: Array<[string, string, Record<string, unknown> | undefined]> = [];
    const resolver = aeatClientResolver(
      {
        db: suite.db,
        ring,
        endpointFor: () => "https://example.test/soap",
        fetchFor: () => ({
          fetch: (() => Promise.reject(new Error("not this test's subject"))) as typeof fetch,
          close: () => Promise.reject("socket gone, no Error wrapper"),
        }),
      },
      (level, event, fields) => logged.push([level, event, fields]),
    );

    await resolver.resolve(tenantA);

    await expect(resolver.closeAll()).resolves.toBeUndefined();
    expect(logged).toEqual([
      [
        "warn",
        "transport.close_failed",
        { tenantId: tenantA, errorCode: "unknown", message: "socket gone, no Error wrapper" },
      ],
    ]);
  });

  // F2 of the 2026-07-27 pre-merge review: every case above rejects a *returned* Promise —
  // `.catch` alone. `TenantTransport.close` is typed `() => Promise<void>`, but an injected
  // `fetchFor` is free to violate that and throw BEFORE ever returning a promise (undici's real
  // `Agent.close()` cannot, but the seam here is `fetchFor`, not undici). A synchronous throw
  // inside the `.map` callback used to propagate straight out of `closeAll` before
  // `Promise.allSettled` was ever reached — rejecting into `boot.ts`'s `finally` and replacing
  // `drain`'s own return value or error, and abandoning every transport queued after the throwing
  // one even though `open.splice(0)` had already emptied the list. `Promise.resolve().then(...)`
  // wraps the call so a throw becomes a rejection like any other, caught by the same `.catch`.
  it("does not throw when a transport's close throws SYNCHRONOUSLY, and still closes the one after it", async () => {
    const tenantA = await provision("sello");
    const tenantB = await provision("representante");
    const closed: string[] = [];
    const logged: Array<[string, string, Record<string, unknown> | undefined]> = [];
    let n = 0;
    const resolver = aeatClientResolver(
      {
        db: suite.db,
        ring,
        endpointFor: () => "https://example.test/soap",
        fetchFor: () => ({
          fetch: (() => Promise.reject(new Error("not this test's subject"))) as typeof fetch,
          close: () => {
            n += 1;
            if (n === 1) {
              // Thrown, not returned as a rejected Promise — the case `.catch` alone cannot reach.
              throw new Error("socket exploded synchronously");
            }
            closed.push("ok");
            return Promise.resolve();
          },
        }),
      },
      (level, event, fields) => logged.push([level, event, fields]),
    );

    await resolver.resolve(tenantA);
    await resolver.resolve(tenantB);

    await expect(resolver.closeAll()).resolves.toBeUndefined();
    // The transport queued AFTER the one whose close() threw synchronously still closed — proof
    // the throw did not abort the whole `.map`/`Promise.allSettled` sweep.
    expect(closed).toEqual(["ok"]);
    expect(logged).toEqual([
      [
        "warn",
        "transport.close_failed",
        { tenantId: tenantA, errorCode: "unknown", message: "socket exploded synchronously" },
      ],
    ]);
  });

  // The second half of the same guarantee, and the reason the log call is guarded in turn while
  // `loop.ts`'s and `pass.ts`'s equivalents are not: those sit in ordinary catch blocks, where a
  // throwing `Logger` surfaces as itself. This one runs inside `boot.ts`'s `finally`, where a throw
  // does not surface at all — it REPLACES the sweep's own result or error. Without the inner guard
  // this test throws "logger is down" out of `closeAll`, and `tenantB`'s transport is never closed.
  it("does not throw when the LOGGER fails while reporting a close failure", async () => {
    const tenantA = await provision("sello");
    const tenantB = await provision("representante");
    const closed: string[] = [];
    let n = 0;
    const resolver = aeatClientResolver(
      {
        db: suite.db,
        ring,
        endpointFor: () => "https://example.test/soap",
        fetchFor: () => ({
          fetch: (() => Promise.reject(new Error("not this test's subject"))) as typeof fetch,
          close: () => {
            n += 1;
            if (n === 1) return Promise.reject(new Error("socket already gone"));
            closed.push("ok");
            return Promise.resolve();
          },
        }),
      },
      () => {
        throw new Error("logger is down");
      },
    );

    await resolver.resolve(tenantA);
    await resolver.resolve(tenantB);

    await expect(resolver.closeAll()).resolves.toBeUndefined();
    // The transport AFTER the failing one still got released — the loop was not abandoned.
    expect(closed).toEqual(["ok"]);
  });

  it("mtlsFetch's close closes the Agent it built", async () => {
    // Against the suite's existing mTLS fixture: a request succeeds, close resolves, and a request
    // after close rejects — which is what proves `close` reached the real Agent rather than a
    // no-op wrapper.
    const certMaterial: CertMaterial = {
      pfx: material.clientPfx,
      passphrase: material.clientPassphrase,
      certKind: "representante",
    };
    const transport = mtlsFetch(certMaterial, material.caPem);
    await transport.fetch(server.origin);
    await transport.close();
    await expect(transport.fetch(server.origin)).rejects.toThrow();
  });
});

/**
 * A minimal `Cabecera`. `submit` serialises it and POSTs; this suite never inspects the XML, and the
 * local server answers a body `parseRespuestaSuministro` will reject. The subject is the HANDSHAKE.
 */
function anyCabecera(): Cabecera {
  return { ObligadoEmision: { NombreRazon: "Test SL", NIF: "12345678Z" } };
}

/**
 * A minimal, well-typed `RegistroAnulacion` — present only so `serializeEnvio` has a non-empty
 * array to serialise (see the comment at its call site). Its huella/chain fields are never
 * verified by anything this suite exercises: `serializeEnvio` only stringifies them, and neither
 * `huella.ts` nor `validate.ts` sits between `submit` and the wire. Its CONTENT is not the subject.
 */
function anyRegistro(): EnvioRegistro {
  return {
    RegistroAnulacion: {
      IDVersion: "1.0",
      IDFactura: {
        IDEmisorFacturaAnulada: "12345678Z",
        NumSerieFacturaAnulada: "1",
        FechaExpedicionFacturaAnulada: "01-01-2026",
      },
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: {
        NombreRazon: "Test SL",
        NIF: "12345678Z",
        NombreSistemaInformatico: "Waitron",
        IdSistemaInformatico: "W1",
        Version: "1.0",
        NumeroInstalacion: "1",
        TipoUsoPosibleSoloVerifactu: "S",
        TipoUsoPosibleMultiOT: "N",
        IndicadorMultiplesOT: "N",
      },
      FechaHoraHusoGenRegistro: "2026-01-01T00:00:00+01:00",
      TipoHuella: "01",
      Huella: "0000000000000000000000000000000000000000000000000000000000000000",
    },
  };
}
