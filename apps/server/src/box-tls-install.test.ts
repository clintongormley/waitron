import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { X509Certificate, createPrivateKey, createPublicKey } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer } from "node:tls";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  finishTlsInstall,
  installVenueAuthority,
  joinedAnotherBox,
  markJoined,
} from "./box-tls-install.js";
import { mintSelfSignedServerCert, type SelfSignedMaterial } from "./self-signed-cert.js";
import {
  syncsAndRenames as recordSyncsAndRenames,
  writtenDurably,
} from "./testing/durable-writes.js";

const { mkdirMock, openMock, renameMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  openMock: vi.fn(),
  renameMock: vi.fn(),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  mkdirMock.mockImplementation(actual.mkdir);
  openMock.mockImplementation(actual.open);
  renameMock.mockImplementation(actual.rename);
  return { ...actual, mkdir: mkdirMock, open: openMock, rename: renameMock };
});
const syncsAndRenames = (run: () => Promise<unknown>) =>
  recordSyncsAndRenames({ mkdir: mkdirMock, open: openMock, rename: renameMock }, run);

const OWN_NAME = "box-7f3a.waitron.local";
const HOSTNAMES = [OWN_NAME, "waitron.local", "localhost"];
const INSTALLED = ["ca.crt", "ca.key", "server.crt", "server.key"];

let main: SelfSignedMaterial;
let own: SelfSignedMaterial;
const dirs: string[] = [];

beforeAll(() => {
  const now = new Date();
  main = mintSelfSignedServerCert({ hostnames: ["waitron.local"], ipAddresses: [], now });
  own = mintSelfSignedServerCert({ hostnames: ["waitron.local"], ipAddresses: [], now });
});

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A state folder holding the box's own authority and leaf, as a setup start minted them. */
async function ownBox(): Promise<string> {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-tls-install-"));
  dirs.push(stateDir);
  const tls = join(stateDir, "tls");
  await mkdir(tls, { mode: 0o700 });
  await writeFile(join(tls, "ca.crt"), own.caCertPem, { mode: 0o600 });
  await writeFile(join(tls, "ca.key"), own.caKeyPem, { mode: 0o600 });
  await writeFile(join(tls, "server.crt"), own.serverCertPem, { mode: 0o600 });
  await writeFile(join(tls, "server.key"), own.serverKeyPem, { mode: 0o600 });
  return stateDir;
}

const tlsFile = (stateDir: string, name: string) => readFile(join(stateDir, "tls", name), "utf8");

function install(stateDir: string, rename?: (from: string, to: string) => Promise<void>) {
  return installVenueAuthority({
    stateDir,
    authority: { certPem: main.caCertPem, keyPem: main.caKeyPem },
    hostnames: HOSTNAMES,
    listIpv4: () => [],
    now: () => new Date(),
    ...(rename === undefined ? {} : { rename }),
  });
}

/** Serves the box's leaf and connects as a device pinning `caPem`, naming `servername`. */
async function handshake(stateDir: string, caPem: string, servername: string): Promise<string> {
  const server = createServer({
    cert: await tlsFile(stateDir, "server.crt"),
    key: await tlsFile(stateDir, "server.key"),
  });
  server.on("secureConnection", (socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise<string>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port, servername, ca: caPem });
      socket.once("secureConnect", () => {
        socket.destroy();
        resolve("verified");
      });
      socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** The authority and leaf on disk belong together: the leaf is signed by the authority and its key
 * is the leaf's. */
async function matchingSet(stateDir: string): Promise<boolean> {
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

describe("installVenueAuthority", () => {
  it("a joined box's leaf verifies under the main box's authority", async () => {
    const stateDir = await ownBox();
    await install(stateDir);

    expect(await tlsFile(stateDir, "ca.crt")).toBe(main.caCertPem);
    expect(await tlsFile(stateDir, "ca.key")).toBe(main.caKeyPem);
    for (const name of INSTALLED) {
      expect((await stat(join(stateDir, "tls", name))).mode & 0o777).toBe(0o600);
    }
    expect((await readdir(join(stateDir, "tls"))).sort()).toEqual(INSTALLED);
    expect(await handshake(stateDir, main.caCertPem, OWN_NAME)).toBe("verified");
    // Control: a device still pinning the box's old authority refuses the new leaf.
    expect(await handshake(stateDir, own.caCertPem, OWN_NAME)).not.toBe("verified");
  });

  it("a crash after the list finishes at the next start", async () => {
    for (let renamesBeforeCrash = 0; renamesBeforeCrash <= INSTALLED.length; renamesBeforeCrash++) {
      const stateDir = await ownBox();
      let renamed = 0;
      const crashing = async (from: string, to: string) => {
        if (renamesBeforeCrash === 0) throw new Error("power lost");
        await rename(from, to);
        renamed += 1;
        if (renamed === renamesBeforeCrash) throw new Error("power lost");
      };
      await expect(install(stateDir, crashing)).rejects.toThrow("power lost");

      expect(await finishTlsInstall(stateDir)).toBe("finished");
      expect(await tlsFile(stateDir, "ca.crt")).toBe(main.caCertPem);
      expect(await matchingSet(stateDir)).toBe(true);
      expect((await readdir(join(stateDir, "tls"))).sort()).toEqual(INSTALLED);
      expect(await finishTlsInstall(stateDir)).toBe("none");
    }
  });

  it("working files with no list are deleted", async () => {
    const stateDir = await ownBox();
    for (const name of INSTALLED) {
      await writeFile(join(stateDir, "tls", `${name}.install`), "half-written");
    }

    expect(await finishTlsInstall(stateDir)).toBe("discarded");
    expect((await readdir(join(stateDir, "tls"))).sort()).toEqual(INSTALLED);
    expect(await tlsFile(stateDir, "ca.crt")).toBe(own.caCertPem);
    expect(await finishTlsInstall(stateDir)).toBe("none");
  });

  it("a crash before the list leaves the box's own authority, and the next start serves the old leaf", async () => {
    const stateDir = await ownBox();
    // A folder where the list goes stops the install after its four working files, before the list.
    await mkdir(join(stateDir, "tls", "install.json", "blocker"), { recursive: true });
    await expect(install(stateDir)).rejects.toThrow();
    await rm(join(stateDir, "tls", "install.json"), { recursive: true });

    expect(await finishTlsInstall(stateDir)).toBe("discarded");
    expect(await tlsFile(stateDir, "ca.crt")).toBe(own.caCertPem);
    expect(await tlsFile(stateDir, "ca.key")).toBe(own.caKeyPem);
    expect(await tlsFile(stateDir, "server.crt")).toBe(own.serverCertPem);
    expect(await tlsFile(stateDir, "server.key")).toBe(own.serverKeyPem);
    expect(await handshake(stateDir, own.caCertPem, "waitron.local")).toBe("verified");
  });

  it("writes the four working files and the list durably before the renames, and syncs the folder before and after the list goes", async () => {
    const stateDir = await ownBox();
    const tls = join(stateDir, "tls");
    const events = await syncsAndRenames(() => install(stateDir));
    for (const name of [...INSTALLED.map((n) => `${n}.install`), "install.json"]) {
      expect(writtenDurably(events, join(tls, name), tls), name).toBe(true);
    }
    const listWritten = events.indexOf(
      `rename ${join(tls, "install.json.tmp")} ${join(tls, "install.json")}`,
    );
    const moves = INSTALLED.map((name) =>
      events.indexOf(`rename ${join(tls, `${name}.install`)} ${join(tls, name)}`),
    );
    for (const moved of moves) expect(moved).toBeGreaterThan(listWritten);
    const moveOrder = events
      .filter((event) => event.startsWith(`rename ${tls}/`) && event.includes(".install "))
      .map((event) => event.split(" ")[2]!.slice(tls.length + 1));
    expect(moveOrder).toEqual(["ca.key", "ca.crt", "server.key", "server.crt"]);
    // One sync before the list is removed and one after it.
    const syncsAfterMoves = events
      .slice(Math.max(...moves))
      .filter((event) => event === `sync ${tls}`);
    expect(syncsAfterMoves).toHaveLength(2);
  });

  it("a box with no tls folder has nothing to finish", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-tls-install-"));
    dirs.push(stateDir);
    expect(await finishTlsInstall(stateDir)).toBe("none");
  });
});

describe("markJoined", () => {
  it("writes the marker durably, syncing the state folder after creating tls in it", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-tls-joined-"));
    dirs.push(stateDir);
    const tls = join(stateDir, "tls");
    const events = await syncsAndRenames(() => markJoined(stateDir, "origin"));
    expect(writtenDurably(events, join(tls, "joined.json"), tls)).toBe(true);
    const created = events.indexOf(`mkdir ${tls}`);
    expect(created).not.toBe(-1);
    expect(events.indexOf(`sync ${stateDir}`, created)).toBeGreaterThan(created);
  });

  it("records the main box's node id, and only a box that joined reads as joined", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-tls-joined-"));
    dirs.push(stateDir);
    expect(await joinedAnotherBox(stateDir)).toBe(false);

    await markJoined(stateDir, "44444444-4444-4444-8444-444444444444");

    expect(JSON.parse(await tlsFile(stateDir, "joined.json"))).toEqual({
      originNodeId: "44444444-4444-4444-8444-444444444444",
    });
    expect((await stat(join(stateDir, "tls", "joined.json"))).mode & 0o777).toBe(0o600);
    expect(await joinedAnotherBox(stateDir)).toBe(true);
  });
});
