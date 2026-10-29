import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAuthority, SIN_DATOS_BODY, SOAP_FAULT_BODY } from "../test/certificate-fixtures.js";
import { startDiagnosticServer } from "../test/certificate-diagnosis-fixtures.js";
import { aeatEndpointFor } from "./aeat-transport.js";
import type { FiscalCertificateJson } from "@waitron/fiscal";
import { diagnosticTransport } from "./certificate-diagnosis-transport.js";
import { openCertificateFile } from "./certificate-file.js";
import {
  makeCertificateDiagnosisChild,
  runCertificateDiagnosisChild,
  type CertificateDiagnosisChildInput,
  type CertificateDiagnosisChildOverrides,
} from "./certificate-diagnosis-child.js";

const authority = makeAuthority();
const first = authority.issue({ commonName: "selected first" });
const second = authority.issue({ commonName: "selected second" });
const servers: Awaited<ReturnType<typeof startDiagnosticServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server?.close()));
});
const input: CertificateDiagnosisChildInput = {
  operation: "check",
  material: {
    pfxBase64: first.pfx.toString("base64"),
    passphrase: first.passphrase,
    certKind: "sello",
  },
  taxpayer: { legalName: "PRIVATE TAXPAYER", taxId: "89890001K" },
  timeZone: "Europe/Madrid",
  environment: "preproduction",
  startedAt: "2026-10-31T23:30:00.000Z",
};
const signal = () => new AbortController().signal;
const run = (value = input, overrides: CertificateDiagnosisChildOverrides = {}, abort = signal()) =>
  runCertificateDiagnosisChild(value, abort, () => {}, overrides);
async function serve(status: number, body: string) {
  const server = await startDiagnosticServer(authority, (_request, response) => {
    response.writeHead(status);
    response.end(body);
  });
  servers.push(server);
  return server;
}
function localTransport(endpoint: string): CertificateDiagnosisChildOverrides {
  return {
    endpointFor: () => endpoint,
    transport: (material, options) =>
      diagnosticTransport(material, { ...options, ca: authority.caPem }),
  };
}

describe("isolated certificate work", () => {
  it.each(["sello", "representante"] as const)(
    "opens the exact %s material for an inspection without network work",
    async (certKind) => {
      const issued = certKind === "sello" ? first : second;
      const server = await serve(200, SIN_DATOS_BODY);
      const transport = vi.fn(() => {
        throw new Error("inspection must not construct network transport");
      });
      const value = {
        ...input,
        operation: "inspect" as const,
        material: {
          pfxBase64: issued.pfx.toString("base64"),
          passphrase: issued.passphrase,
          certKind,
        },
      };
      const result = await run(value, { ...localTransport(server.origin), transport });
      expect(result).toEqual({
        openedFingerprint: issued.fingerprint,
        kind: certKind,
        completedAt: expect.any(String),
        stage: "complete",
        category: "local-ready",
        httpStatus: null,
        localFinding: null,
      });
      expect(server.requests()).toBe(0);
    },
  );

  it.each(["sello", "representante"] as const)(
    "queries once with the selected %s file and the venue month",
    async (certKind) => {
      const issued = certKind === "sello" ? first : second;
      const server = await serve(200, SIN_DATOS_BODY);
      const result = await run(
        {
          ...input,
          material: {
            pfxBase64: issued.pfx.toString("base64"),
            passphrase: issued.passphrase,
            certKind,
          },
        },
        localTransport(server.origin),
      );
      expect(result).toEqual({
        openedFingerprint: issued.fingerprint,
        kind: certKind,
        completedAt: expect.any(String),
        stage: "complete",
        category: "query-completed",
        httpStatus: 200,
        localFinding: null,
      });
      expect(server.requests()).toBe(1);
      expect(server.clientNames).toEqual([
        certKind === "sello" ? "selected first" : "selected second",
      ]);
      expect(server.bodies).toHaveLength(1);
      expect(server.bodies[0]).toContain("ConsultaFactuSistemaFacturacion");
      expect(server.bodies[0]).toContain("NIF>89890001K<");
      expect(server.bodies[0]).toContain("Ejercicio>2026<");
      expect(server.bodies[0]).toContain("Periodo>11<");
      expect(server.bodies[0]).not.toContain("RegistroAlta");
      await server.connectionClosed;
      expect(server.openConnections()).toBe(0);
    },
  );

  it.each([
    [
      "production",
      "sello",
      "https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    ],
    [
      "preproduction",
      "sello",
      "https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    ],
    [
      "production",
      "representante",
      "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    ],
    [
      "preproduction",
      "representante",
      "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    ],
  ] as const)("uses only configured %s/%s destination", async (environment, certKind, endpoint) => {
    let destination = "";
    const result = await run(
      { ...input, environment, material: { ...input.material, certKind } },
      {
        transport: (_material, options) => {
          destination = options.endpoint;
          return {
            fetch: async () => new Response(SIN_DATOS_BODY),
            close: async () => {},
            destroy: async () => {},
            observation: () => ({ stage: "parse", category: "http-response", httpStatus: 200 }),
          };
        },
      },
    );
    expect(aeatEndpointFor(environment)(certKind)).toBe(endpoint);
    expect(destination).toBe(endpoint);
    expect(result.category).toBe("query-completed");
  });

  it.each([
    [403, "secret body", "http-response"],
    [200, "broken secret XML", "reply-unparseable"],
    [500, SOAP_FAULT_BODY, "soap-fault"],
    [500, "<env:Fault><unclosed", "reply-unparseable"],
    [200, "<env:Envelope><env:Body><env:Fault/></env:Body></env:Envelope>", "reply-unparseable"],
  ])("keeps HTTP %i independently of classification %#", async (status, body, category) => {
    const server = await serve(status as number, body as string);
    const result = await run(input, localTransport(server.origin));
    expect(result.category).toBe(category);
    expect(result.httpStatus).toBe(status);
    expect(Object.keys(result).sort()).toEqual([
      "category",
      "completedAt",
      "httpStatus",
      "kind",
      "localFinding",
      "openedFingerprint",
      "stage",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret|PRIVATE|89890001K|Test fault|env:Client/);
    expect(server.requests()).toBe(1);
  });

  it.each([
    ["ENOTFOUND", "name-lookup-failed"],
    ["EAI_AGAIN", "name-lookup-failed"],
    ["ECONNREFUSED", "connection-refused"],
    ["ECONNRESET", "connection-closed"],
    ["UND_ERR_SOCKET", "connection-closed"],
    ["EPROTO", "tls-protocol-failed"],
    ["ERR_SSL_WRONG_VERSION_NUMBER", "tls-protocol-failed"],
    ["CERT_HAS_EXPIRED", "tls-protocol-failed"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls-protocol-failed"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "tls-protocol-failed"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls-protocol-failed"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls-protocol-failed"],
    ["CERT_SIGNATURE_FAILURE", "unknown"],
    ["UNKNOWN_PRIVATE_CODE", "unknown"],
  ])("maps only the observed %s code", async (code, category) => {
    const result = await run(input, {
      transport: () => ({
        fetch: async () => {
          throw new Error("secret low-level error", {
            cause: Object.assign(new Error("secret cause"), { code }),
          });
        },
        close: async () => {},
        destroy: async () => {},
        observation: () => ({ stage: "connect", category: "unknown", httpStatus: null }),
      }),
    });
    expect(result.category).toBe(category);
    expect(result.httpStatus).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/secret|PRIVATE|89890001K|UNKNOWN_PRIVATE_CODE/);
  });

  it.each([
    ["passphrase_wrong", { material: { ...input.material, passphrase: "wrong-secret" } }],
    [
      "unreadable",
      {
        material: {
          ...input.material,
          pfxBase64: Buffer.from("not a certificate").toString("base64"),
        },
      },
    ],
    ["expired", { startedAt: "2030-01-01T00:00:00.000Z" }],
    ["not_yet_valid", { startedAt: "2025-12-31T23:59:59.999Z" }],
    ["other_taxpayer", { taxpayer: { legalName: "OTHER SECRET", taxId: "B12345674" } }],
  ] as const)("keeps local %s finding private and makes no query", async (localFinding, change) => {
    const server = await serve(200, SIN_DATOS_BODY);
    const result = await run({ ...input, ...change }, localTransport(server.origin));
    expect(result.localFinding).toBe(localFinding);
    expect(result.category).toBe("local-finding");
    expect(result.httpStatus).toBeNull();
    expect(server.requests()).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|OTHER SECRET|89890001K|B12345674|wrong-secret/,
    );
  });

  it("accepts the exact validity start and does not refuse a previously seen fingerprint", async () => {
    const value = {
      ...input,
      operation: "inspect" as const,
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    expect((await run(value)).category).toBe("local-ready");
    expect((await run(value)).category).toBe("local-ready");
  });

  it("reports progress with no identifiers or raw failures", async () => {
    const server = await serve(403, "secret body");
    const events: unknown[] = [];
    await runCertificateDiagnosisChild(
      input,
      signal(),
      (event) => events.push(event),
      localTransport(server.origin),
    );
    expect(events).toContainEqual({ stage: "local", category: "unknown", httpStatus: null });
    expect(events).toContainEqual({
      stage: "response",
      category: "http-response",
      httpStatus: 403,
    });
    expect(events).toContainEqual({ stage: "parse", category: "http-response", httpStatus: 403 });
    expect(JSON.stringify(events)).not.toMatch(
      /PRIVATE|89890001K|selected first|secret|passphrase|pfx|Fingerprint/,
    );
  });

  it("does no native opening or query after prior cancellation", async () => {
    const open = () => {
      throw new Error("opening must not happen");
    };
    const result = await run(input, { open }, AbortSignal.abort());
    expect(result.category).toBe("cancelled");
    expect(result.openedFingerprint).toBeNull();
  });

  it("cancels a held real response, keeps HTTP status and releases the socket", async () => {
    const server = await startDiagnosticServer(authority, (_request, response) => {
      response.writeHead(403);
      response.write("held secret");
    });
    servers.push(server);
    const controller = new AbortController();
    const progress: unknown[] = [];
    const pending = runCertificateDiagnosisChild(
      input,
      controller.signal,
      (value) => progress.push(value),
      localTransport(server.origin),
    );
    await server.requestArrived;
    await vi.waitFor(() =>
      expect(progress).toContainEqual({
        stage: "response",
        category: "http-response",
        httpStatus: 403,
      }),
    );
    controller.abort("deadline");
    const result = await pending;
    expect(result.category).toBe("deadline-elapsed");
    expect(result.httpStatus).toBe(403);
    await server.connectionClosed;
    expect(server.openConnections()).toBe(0);
  });

  it("refuses an untrusted server without guessing an unlisted TLS cause", async () => {
    const server = await serve(200, SIN_DATOS_BODY);
    const unrelated = makeAuthority();
    const codes: unknown[] = [];
    const result = await run(input, {
      endpointFor: () => server.origin,
      transport: (material, options) => {
        const real = diagnosticTransport(material, { ...options, ca: unrelated.caPem });
        return {
          ...real,
          fetch: async (...args) => {
            try {
              return await real.fetch(...args);
            } catch (error) {
              let current = error;
              while (current instanceof Error) {
                if ("code" in current) codes.push(current.code);
                current = current.cause;
              }
              throw error;
            }
          },
        };
      },
    });
    expect(["unknown", "tls-protocol-failed"]).toContain(result.category);
    expect(codes.length).toBeGreaterThan(0);
    expect(result.httpStatus).toBeNull();
    expect(server.requests()).toBe(0);
  });

  it("reports a real socket reset without retrying or inventing HTTP status", async () => {
    const server = await startDiagnosticServer(authority, (request) => {
      request.socket.destroy();
    });
    servers.push(server);
    const result = await run(input, localTransport(server.origin));
    expect(result.category).toBe("connection-closed");
    expect(result.httpStatus).toBeNull();
    expect(server.requests()).toBe(1);
  });

  it("classifies an oversized decoded body without retaining its bytes", async () => {
    const server = await serve(200, " ".repeat(1048577));
    const result = await run(input, localTransport(server.origin));
    expect(result.category).toBe("reply-too-large");
    expect(result.httpStatus).toBe(200);
    expect(JSON.stringify(result).length).toBeLessThan(1024);
    expect(server.requests()).toBe(1);
  });

  it("allows a parsed query reply at exactly the decoded size limit", async () => {
    const server = await serve(
      200,
      SIN_DATOS_BODY + " ".repeat(1048576 - Buffer.byteLength(SIN_DATOS_BODY)),
    );
    const result = await run(input, localTransport(server.origin));
    expect(result.category).toBe("query-completed");
    expect(result.httpStatus).toBe(200);
    expect(server.requests()).toBe(1);
  });

  it("does not query with a file lacking a private key", async () => {
    const issued = authority.issue({ withKey: false });
    const server = await serve(200, SIN_DATOS_BODY);
    const result = await run(
      { ...input, material: { ...input.material, pfxBase64: issued.pfx.toString("base64") } },
      localTransport(server.origin),
    );
    expect(result.category).toBe("local-finding");
    expect(result.localFinding).toBe("no_private_key");
    expect(server.requests()).toBe(0);
  });

  it("retains the opener's old-encryption refusal without raw text", async () => {
    const server = await serve(200, SIN_DATOS_BODY);
    const result = await run(input, {
      ...localTransport(server.origin),
      open: () => ({ ok: false, reason: "old_encryption" }),
    });
    expect(result.localFinding).toBe("old_encryption");
    expect(server.requests()).toBe(0);
  });

  it("strictly opens a valid JSON child envelope through the factory", async () => {
    const value = { ...input, operation: "inspect" };
    const child = makeCertificateDiagnosisChild();
    const output = await child(value, signal(), () => {});
    expect(output).toEqual({
      openedFingerprint: first.fingerprint,
      kind: "sello",
      completedAt: expect.any(String),
      stage: "complete",
      category: "local-ready",
      httpStatus: null,
      localFinding: null,
    });
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });

  it("opens stored material whose actual passphrase is empty without substituting a candidate", async () => {
    const issued = authority.issue({ passphrase: "" });
    const child = makeCertificateDiagnosisChild();
    const output = await child(
      {
        ...input,
        operation: "inspect",
        material: {
          ...input.material,
          pfxBase64: issued.pfx.toString("base64"),
          passphrase: "",
        },
      },
      signal(),
      () => {},
    );
    expect(output).toEqual({
      openedFingerprint: issued.fingerprint,
      kind: "sello",
      completedAt: expect.any(String),
      stage: "complete",
      category: "local-ready",
      httpStatus: null,
      localFinding: null,
    });
  });

  it("never returns a native cleanup error through the generic child seam", async () => {
    const child = makeCertificateDiagnosisChild({
      transport: () => ({
        fetch: async () => new Response(SIN_DATOS_BODY),
        observation: () => ({ stage: "parse", category: "http-response", httpStatus: 200 }),
        close: async () => {
          throw new Error("secret cleanup exception");
        },
        destroy: async () => {},
      }),
    });
    await expect(child({ ...input }, signal(), () => {})).rejects.toThrow(
      "Certificate diagnosis child unavailable",
    );
  });

  it.each(["sello", "representante"] as const)(
    "makes no HTTP request with an untrusted %s client",
    async (certKind) => {
      const issued = authority.issue({ signedBy: "stranger" });
      const server = await serve(200, SIN_DATOS_BODY);
      const result = await run(
        {
          ...input,
          material: {
            pfxBase64: issued.pfx.toString("base64"),
            passphrase: issued.passphrase,
            certKind,
          },
        },
        localTransport(server.origin),
      );
      expect(result.category).toBe("connection-closed");
      expect(result.httpStatus).toBeNull();
      expect(server.requests()).toBe(0);
    },
  );

  it("allows a missing subject taxpayer identifier without inventing a mismatch", async () => {
    const issued = authority.issue({ organizationIdentifier: null });
    const result = await run({
      ...input,
      operation: "inspect",
      material: { ...input.material, pfxBase64: issued.pfx.toString("base64") },
    });
    expect(result.category).toBe("local-ready");
    expect(result.localFinding).toBeNull();
  });

  it("returns a fixed unknown observation for a native opening failure", async () => {
    const result = await run(input, {
      open: () => {
        throw new Error("secret native error");
      },
    });
    expect(result).toEqual({
      openedFingerprint: null,
      kind: null,
      completedAt: expect.any(String),
      stage: "local",
      category: "unknown",
      httpStatus: null,
      localFinding: null,
    });
  });

  it("zeros the owned decoded material after native work ends", async () => {
    let decoded: Buffer | undefined;
    const result = await run(
      { ...input, operation: "inspect" },
      {
        open: (pfx, passphrase) => {
          decoded = pfx;
          return openCertificateFile(pfx, passphrase);
        },
      },
    );
    expect(result.openedFingerprint).toBe(first.fingerprint);
    expect(decoded).toBeDefined();
    expect(decoded!.length).toBe(first.pfx.length);
    expect(decoded!.every((byte) => byte === 0)).toBe(true);
    expect(first.pfx.some((byte) => byte !== 0)).toBe(true);
  });

  const invalidEnvelopes: FiscalCertificateJson[] = [
    null,
    [],
    false,
    1,
    "secret input",
    ...Object.keys(input).map((field) =>
      Object.fromEntries(Object.entries(input).filter(([key]) => key !== field)),
    ),
    { ...input, taxpayer: null },
    { ...input, material: [] },
    { ...input, taxpayer: { legalName: null, taxId: "89890001K" } },
    { ...input, taxpayer: { legalName: "", taxId: "89890001K" } },
    { ...input, taxpayer: { legalName: "private", taxId: null } },
    { ...input, taxpayer: { legalName: "private", taxId: "" } },
    { ...input, timeZone: null },
    { ...input, startedAt: null },
    ...[
      null,
      "",
      "AQI",
      "AB==",
      "!!!!",
      Buffer.alloc(102401).toString("base64"),
      Buffer.alloc(102404).toString("base64"),
    ].map((pfxBase64) => ({ ...input, material: { ...input.material, pfxBase64 } })),
    { ...input, material: { ...input.material, passphrase: null } },
    { ...input, material: { ...input.material, certKind: null } },
    { ...input, material: { ...input.material, certKind: "other" } },
  ];
  it.each(invalidEnvelopes)(
    "rejects malformed IPC %# without invoking native work",
    async (raw) => {
      let opened = 0;
      const child = makeCertificateDiagnosisChild({
        open: () => {
          opened++;
          return { ok: false, reason: "unreadable" };
        },
      });
      await expect(child(raw, signal(), () => {})).rejects.toThrow();
      expect(opened).toBe(0);
    },
  );

  it.each([
    { ...input, environment: "test" },
    { ...input, operation: "submit" },
    { ...input, taxpayer: { ...input.taxpayer, extra: "secret" } },
    { ...input, material: { ...input.material, endpoint: "https://caller.example" } },
    { ...input, timeZone: "not-a-zone" },
    { ...input, startedAt: "invalid" },
    { ...input, startedAt: "2026-02-30T00:00:00.000Z" },
    { ...input, endpoint: "https://caller.example" },
  ])("rejects untrusted child envelope %# before opening", async (raw) => {
    const child = makeCertificateDiagnosisChild({
      open: () => {
        throw new Error("must not open");
      },
    });
    await expect(child(raw, signal(), () => {})).rejects.toThrow();
  });
});
