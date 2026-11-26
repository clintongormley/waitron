import { X509Certificate, createPrivateKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { connect, createServer } from "node:tls";
import forge from "node-forge";

export const tlsFile = (stateDir: string, name: string): Promise<string> =>
  readFile(join(stateDir, "tls", name), "utf8");

/** Writes `set` as `stateDir`'s `tls/` folder, 0700, each file 0600. */
export async function writeTlsSet(
  stateDir: string,
  set: { caCertPem: string; caKeyPem: string; serverCertPem: string; serverKeyPem: string },
): Promise<void> {
  const tls = join(stateDir, "tls");
  await mkdir(tls, { mode: 0o700 });
  await writeFile(join(tls, "ca.crt"), set.caCertPem, { mode: 0o600 });
  await writeFile(join(tls, "ca.key"), set.caKeyPem, { mode: 0o600 });
  await writeFile(join(tls, "server.pem"), set.serverCertPem + set.serverKeyPem, { mode: 0o600 });
}

export function certChain(pem: string): string[] {
  return (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []).map(
    (block) => block + "\n",
  );
}

export function leafExpiresAt(leafPem: string, signingPem: string, expiresAt: Date): string {
  const leaf = forge.pki.certificateFromPem(leafPem);
  const [signer, key] = forge.pem.decode(signingPem);
  leaf.validity.notAfter = expiresAt;
  leaf.sign(forge.pki.privateKeyFromPem(forge.pem.encode(key!)), forge.md.sha256.create());
  return forge.pki.certificateToPem(leaf) + forge.pem.encode(signer!);
}

let fixtureKeys: forge.pki.rsa.KeyPair[] | undefined;
export function fixtureBoxKeys(): () => forge.pki.rsa.KeyPair {
  fixtureKeys ??= Array.from({ length: 3 }, () => forge.pki.rsa.generateKeyPair(2048));
  const keys = fixtureKeys.values();
  return () => keys.next().value!;
}

export async function tlsSetMatches(stateDir: string): Promise<boolean> {
  const root = new X509Certificate(await tlsFile(stateDir, "ca.crt"));
  const signerPem = await tlsFile(stateDir, "ca.key");
  const key = createPrivateKey(signerPem);
  const signer = new X509Certificate(signerPem);
  const serverPem = await tlsFile(stateDir, "server.pem");
  const [leafPem, chainPem] = certChain(serverPem);
  const leaf = new X509Certificate(leafPem!);
  return (
    !root.checkPrivateKey(key) &&
    signer.checkPrivateKey(key) &&
    signer.verify(root.publicKey) &&
    new X509Certificate(chainPem!).fingerprint256 === signer.fingerprint256 &&
    leaf.verify(signer.publicKey) &&
    leaf.checkPrivateKey(createPrivateKey(serverPem))
  );
}

/** Connects to 127.0.0.1:`port` as a device pinning `ca` and naming `servername`, and returns the
 * certificate served; rejects when the handshake fails. */
export function peerCertificate(options: {
  port: number;
  ca: string | Buffer;
  servername: string;
}): Promise<X509Certificate | undefined> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", ...options }, () => {
      resolve(socket.getPeerX509Certificate());
      socket.destroy();
    });
    socket.once("error", reject);
  });
}

/** Serves `stateDir`'s leaf and connects as a device pinning `caPem`, naming `servername`:
 * "verified", or the handshake's error code. */
export async function handshake(
  stateDir: string,
  caPem: string,
  servername: string,
): Promise<string> {
  const server = createServer({
    cert: await tlsFile(stateDir, "server.pem"),
    key: await tlsFile(stateDir, "server.pem"),
  });
  server.on("secureConnection", (socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await peerCertificate({ port, ca: caPem, servername }).then(
      () => "verified",
      (error: NodeJS.ErrnoException) => error.code ?? error.message,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
