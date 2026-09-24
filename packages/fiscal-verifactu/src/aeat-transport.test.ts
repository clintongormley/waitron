import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent, errors as undiciErrors, fetch as undiciFetch } from "undici";
import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { isAppError } from "@waitron/shared";
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
} from "@waitron/server-kit/testing/mtls.js";

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

// A minimal SOAP-shaped body — well-formed, not a fault. This suite is about the HANDSHAKE, not
// about parsing — `createClient` parses, and its own suite covers that.
const MINIMAL_SOAP_BODY = '<?xml version="1.0"?><Envelope><Body/></Envelope>';

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 120_000,
});
const ring = loadKeyRing(KEY_ENV);
const material: MtlsMaterial = mintMtlsMaterial();

// The teardown is guarded because a `startMtlsServer` that threw would otherwise be reported
// twice (see `scripts/guarded-teardowns.test.ts`).
let server: MtlsServer;

beforeAll(async () => {
  server = await startMtlsServer(material, MINIMAL_SOAP_BODY);
}, 120_000);

afterAll(async () => {
  if (server !== undefined) await server.close();
});

async function provision(certKind: string): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    putCredential(tx, ring, {
      purpose: "fiscal.aeat",
      value: {
        pfxBase64: material.clientPfx.toString("base64"),
        passphrase: material.clientPassphrase,
        certKind,
      },
    }),
  );
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
    await provision("sello");
    const read = await readCertMaterial(suite.db, ring);
    expect(read.certKind).toBe("sello");
    expect(read.passphrase).toBe(material.clientPassphrase);
    expect(read.pfx.equals(material.clientPfx)).toBe(true);
  });

  it("rejects a certKind that is not one of the two kinds", async () => {
    await provision("wildcard");
    const error = await captureError(() => readCertMaterial(suite.db, ring));
    expect(isAppError(error) && error.code).toBe("server.credential_unusable");
    expect(isAppError(error) && error.params).toMatchObject({ field: "certKind" });
  });

  it("fails with credentials.missing when the venue has no fiscal credential at all", async () => {
    const error = await captureError(() => readCertMaterial(suite.db, ring));
    // The vault's own code, not ours: absence is the vault's fact to report, and drain's
    // containment records whichever code arrives.
    expect(isAppError(error) && error.code).toBe("credentials.missing");
  });
});

describe("certMaterialFrom", () => {
  const REF = { purpose: "fiscal.aeat" };

  // Driven directly: `putCredential` validates, so a two-field payload cannot be written through
  // the vault's own API.
  it("fails loudly on a payload sealed before certKind existed, rather than guessing a host", () => {
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
    const error = await captureError(() => Promise.resolve(certMaterialFrom(full, REF)));
    expect(isAppError(error) && error.code).toBe("server.credential_unusable");
    expect(isAppError(error) && error.params).toMatchObject({ field });
  });

  it("fails loudly when pfxBase64 decodes to no usable bytes (not real base64)", async () => {
    // "!!!!" has no base64-alphabet characters, so it decodes to zero bytes: PRESENT and non-empty,
    // but unusable.
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
    await provision("representante");
    // Captured: the kind handed to `endpointFor` decides which AEAT host every submission reaches.
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
    const client = await resolver.resolve();

    // The assertion is the HANDSHAKE: the server answers only if the client presented a
    // certificate its CA signed. `[anyRegistro()]`, not `[]`: `serializeEnvio` refuses an empty
    // array before any request is sent.
    await captureError(() => client.submit(anyCabecera(), [anyRegistro()]));
    expect(server.sawClientCn()).toBe(material.clientCn);
    expect(seenCertKind).toBe("representante");
  });

  it("still reaches the server when ca is omitted, because the vaulted PFX bundles its own issuing CA", async () => {
    // Production (`./slot.ts`) passes no `ca`. `mintMtlsMaterial`'s PKCS#12 bundles the CA beside
    // the leaf, as a real FNMT export commonly does, and Node treats a bundled certificate as a
    // trust anchor for the PEER; a leaf-only PFX fails this handshake with
    // `SELF_SIGNED_CERT_IN_CHAIN`.
    await provision("representante");
    const resolver = aeatClientResolver({
      db: suite.db,
      ring,
      endpointFor: () => server.origin,
      fetchFor: (m) => mtlsFetch(m),
    });
    const client = await resolver.resolve();
    await captureError(() => client.submit(anyCabecera(), [anyRegistro()]));
    expect(server.sawClientCn()).toBe(material.clientCn);
  });

  it("is refused when no client certificate is presented", async () => {
    // A bare Agent with the CA but no client certificate, NOT an empty `pfx`: an empty PKCS#12
    // fails locally before any socket opens, which would not test the server refusing anything.
    const requestsBefore = server.requests();
    const dispatcher = new Agent({ connect: { ca: material.caPem } });
    const error = await captureError(() =>
      undiciFetch(`${server.origin}/`, { method: "POST", body: "x", dispatcher }),
    );
    expect(error).toBeInstanceOf(Error);
    // The specific failure is on `.cause`: only the server tearing the connection down
    // mid-handshake produces undici's `SocketError`; a wrong CA or a bad origin do not.
    expect((error as Error).cause).toBeInstanceOf(undiciErrors.SocketError);
    // Server-side: the request handler never ran. This alone does not tell "no certificate" from a
    // wrong CA or a bad origin, so it complements the `SocketError` check rather than replacing it.
    expect(server.requests()).toBe(requestsBefore);
  });
});

describe("aeatClientResolver lifetime", () => {
  // `resolve` appends a transport on EVERY call, so the transports to release track resolve calls.
  it("closes one transport per client it resolved", async () => {
    await provision("sello");
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

    await resolver.resolve();
    await resolver.resolve();
    await resolver.closeAll();

    expect(closed).toHaveLength(2);
  });

  // Every transport is still attempted, and a close failure is logged rather than dropped.
  // `closeAll` runs in the drain seat's `finally` (`./slot.ts`), where a throw would replace the
  // pass's own result or error.
  it("does not throw when a transport's close fails, and still closes the rest", async () => {
    // Two transports, built by resolving twice (see the count test above).
    await provision("sello");
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

    await resolver.resolve();
    await resolver.resolve();

    await expect(resolver.closeAll()).resolves.toBeUndefined();
    expect(closed).toEqual(["ok"]);
    // One call, for the failing transport, with a message that survives `codeOf`'s "unknown".
    expect(logged).toEqual([
      ["warn", "transport.close_failed", { errorCode: "unknown", message: "socket already gone" }],
    ]);
  });

  // A promise can reject with any value, not only an `Error`.
  it("stringifies a close failure that rejects with something other than an Error", async () => {
    await provision("sello");
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

    await resolver.resolve();

    await expect(resolver.closeAll()).resolves.toBeUndefined();
    expect(logged).toEqual([
      [
        "warn",
        "transport.close_failed",
        { errorCode: "unknown", message: "socket gone, no Error wrapper" },
      ],
    ]);
  });

  // `close` is typed to return a promise, but an injected `fetchFor` can throw synchronously
  // instead; the deferral in `closeAll` turns that into a rejection like any other.
  it("does not throw when a transport's close throws SYNCHRONOUSLY, and still closes the one after it", async () => {
    // Two transports, built by resolving twice (see the count test above).
    await provision("sello");
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

    await resolver.resolve();
    await resolver.resolve();

    await expect(resolver.closeAll()).resolves.toBeUndefined();
    // The transport queued after the throwing one still closed.
    expect(closed).toEqual(["ok"]);
    expect(logged).toEqual([
      [
        "warn",
        "transport.close_failed",
        { errorCode: "unknown", message: "socket exploded synchronously" },
      ],
    ]);
  });

  // A logger that throws while reporting a close failure must not make `closeAll` throw.
  it("does not throw when the LOGGER fails while reporting a close failure", async () => {
    // Two transports, built by resolving twice (see the count test above).
    await provision("sello");
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

    await resolver.resolve();
    await resolver.resolve();

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
 * A minimal, well-typed `RegistroAnulacion`, present only so `serializeEnvio` has a non-empty
 * array to serialise. Its CONTENT is not the subject.
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
