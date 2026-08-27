import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import forge from "node-forge";
import { beforeAll, describe, expect, it } from "vitest";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { tunnelHttpClient } from "./tunnel-http.js";

// The whole point of this client: the URL host is the RELAY's address (127.0.0.1:<port> here), while
// the certificate belongs to the BOX (`box.test`) and is signed by the box's own private CA. TLS must
// therefore terminate against `box.test` (SNI + identity check) and trust the box CA — the relay is a
// blind byte-splicer. The box cert below carries `box.test` as its ONLY SAN and NO IP SAN, so a pass
// can only come from the servername override doing the identity check (not from an IP-SAN shortcut).
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
      hostnames: ["box.test"], // SAN=box.test only
      ipAddresses: [], // no IP SAN — 127.0.0.1 must NOT be what authorizes the handshake
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
      // closeAllConnections tears down the client's keep-alive socket so close() cannot hang: the
      // per-call undici Agent pools its connection and close() otherwise waits on that idle socket.
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
      const http = tunnelHttpClient({ ca, servername: "box.test" });
      const res = await http(`https://127.0.0.1:${port}/`, { headers: {} });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      await close();
    }
  });

  it("fails the TLS handshake when the box CA is not trusted", async () => {
    const { port, close } = await startBoxServer();
    try {
      // No `ca`: Node's default trust store cannot verify the box's self-signed CA, so the handshake
      // is rejected. This proves the trust in the passing case is real, not a bypassed check.
      const http = tunnelHttpClient({ servername: "box.test" });
      await expect(http(`https://127.0.0.1:${port}/`, { headers: {} })).rejects.toThrow();
    } finally {
      await close();
    }
  });
});
