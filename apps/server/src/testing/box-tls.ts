import { X509Certificate, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { connect, createServer } from "node:tls";

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
  await writeFile(join(tls, "server.crt"), set.serverCertPem, { mode: 0o600 });
  await writeFile(join(tls, "server.key"), set.serverKeyPem, { mode: 0o600 });
}

/** Whether `tls/`'s four files belong together: the authority's key is its certificate's, the
 * leaf is signed by the authority, and the leaf's key is the leaf's. */
export async function tlsSetMatches(stateDir: string): Promise<boolean> {
  const ca = new X509Certificate(await tlsFile(stateDir, "ca.crt"));
  const caKey = createPrivateKey(await tlsFile(stateDir, "ca.key"));
  const leaf = new X509Certificate(await tlsFile(stateDir, "server.crt"));
  const leafKey = createPrivateKey(await tlsFile(stateDir, "server.key"));
  return (
    ca.publicKey.equals(createPublicKey(caKey)) &&
    leaf.verify(ca.publicKey) &&
    leaf.checkPrivateKey(leafKey)
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
    cert: await tlsFile(stateDir, "server.crt"),
    key: await tlsFile(stateDir, "server.key"),
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
