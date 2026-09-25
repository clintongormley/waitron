import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import forge from "node-forge";
import { beforeAll, describe, expect, it } from "vitest";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { tunnelHttpClient } from "./tunnel-http.js";

// The URL host is the RELAY's address while the certificate belongs to the BOX. The box cert carries
// `waitron.local` as its ONLY SAN and NO IP SAN, so a pass can only come from the servername override.
describe("tunnelHttpClient", () => {
  let sharedKeypair: forge.pki.rsa.KeyPair;
  beforeAll(() => {
    sharedKeypair = forge.pki.rsa.generateKeyPair(2048);
  });

  const startBoxServer = async (): Promise<{
    port: number;
    ca: string;
    close: () => Promise<void>;
  }> => {
    const { caCertPem, serverCertPem, serverKeyPem } = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: [],
      now: new Date("2026-08-26T00:00:00Z"),
      keypair: () => sharedKeypair,
    });
    const server = createHttpsServer({ key: serverKeyPem, cert: serverCertPem }, (_req, res) =>
      res.end("ok"),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    return {
      port,
      ca: caCertPem,
      // Tears down the undici Agent's pooled keep-alive socket, which close() would otherwise wait on.
      close: () =>
        new Promise<void>((r) => {
          server.closeAllConnections();
          server.close(() => r());
        }),
    };
  };

  it("connects to the relay address while validating the box hostname + CA", async () => {
    const { port, ca, close } = await startBoxServer();
    try {
      const http = tunnelHttpClient({ ca, servername: "waitron.local" });
      const res = await http(`https://127.0.0.1:${port}/`, { headers: {} });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      await close();
    }
  });

  it("checks the certificate against the relay's address when no box hostname is given, and refuses it", async () => {
    const { port, ca, close } = await startBoxServer();
    try {
      const http = tunnelHttpClient({ ca });
      await expect(http(`https://127.0.0.1:${port}/`, { headers: {} })).rejects.toMatchObject({
        cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
      });
    } finally {
      await close();
    }
  });

  it("fails the TLS handshake with a cert-trust error when the box CA is not trusted", async () => {
    const { port, close } = await startBoxServer();
    try {
      // No `ca`: the default trust store rejects the box's CA. Pin the REASON to a cert-trust failure
      // on undici's `cause.code`, not any throw, which ECONNREFUSED would also satisfy.
      const http = tunnelHttpClient({ servername: "waitron.local" });
      await expect(http(`https://127.0.0.1:${port}/`, { headers: {} })).rejects.toMatchObject({
        cause: {
          code: expect.stringMatching(
            /^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT)$/,
          ),
        },
      });
    } finally {
      await close();
    }
  });
});
