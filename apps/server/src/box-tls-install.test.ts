import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  finishTlsInstall,
  installVenueAuthority,
  joinedAnotherBox,
  markJoined,
} from "./box-tls-install.js";
import {
  mintSelfSignedServerCert,
  reissueServerLeaf,
  type SelfSignedMaterial,
} from "./self-signed-cert.js";
import {
  syncsAndRenames as recordSyncsAndRenames,
  writtenDurably,
} from "./testing/durable-writes.js";
import { handshake, tlsFile, tlsSetMatches, writeTlsSet } from "./testing/box-tls.js";

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
vi.mock("./self-signed-cert.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./self-signed-cert.js")>();
  return { ...actual, reissueServerLeaf: vi.fn(actual.reissueServerLeaf) };
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
  await writeTlsSet(stateDir, own);
  return stateDir;
}

function install(stateDir: string, authority = { certPem: main.caCertPem, keyPem: main.caKeyPem }) {
  return installVenueAuthority({
    stateDir,
    authority,
    hostnames: HOSTNAMES,
    listIpv4: () => [],
    now: () => new Date(),
  });
}

/** The box's four files, byte for byte. */
async function setOf(stateDir: string): Promise<string[]> {
  return Promise.all(INSTALLED.map((name) => tlsFile(stateDir, name)));
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
      const rename = renameMock.getMockImplementation()!;
      // The first rename puts the list in place and each later one moves a working file; the
      // process stops after `renamesBeforeCrash` moves.
      for (let renamed = 0; renamed < Math.max(1, renamesBeforeCrash); renamed++) {
        renameMock.mockImplementationOnce(rename);
      }
      renameMock.mockImplementationOnce(async (from: string, to: string) => {
        if (renamesBeforeCrash > 0) await rename(from, to);
        throw new Error("power lost");
      });
      await expect(install(stateDir)).rejects.toThrow("power lost");

      expect(await finishTlsInstall(stateDir)).toBe("finished");
      expect(await tlsFile(stateDir, "ca.crt")).toBe(main.caCertPem);
      expect(await tlsSetMatches(stateDir)).toBe(true);
      expect((await readdir(join(stateDir, "tls"))).sort()).toEqual(INSTALLED);
      expect(await finishTlsInstall(stateDir)).toBe("none");
    }
  });

  it("working files with no list are deleted", async () => {
    const stateDir = await ownBox();
    for (const name of [...INSTALLED, "install.json"]) {
      await writeFile(join(stateDir, "tls", `${name}.tmp`), "half-written");
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
    for (const name of [...INSTALLED, "install.json"]) {
      expect(writtenDurably(events, join(tls, name), tls), name).toBe(true);
    }
    const listWritten = events.indexOf(
      `rename ${join(tls, "install.json.tmp")} ${join(tls, "install.json")}`,
    );
    const moves = INSTALLED.map((name) =>
      events.indexOf(`rename ${join(tls, `${name}.tmp`)} ${join(tls, name)}`),
    );
    for (const name of INSTALLED) {
      const synced = events.indexOf(`sync ${join(tls, `${name}.tmp`)}`);
      expect(synced, name).not.toBe(-1);
      expect(synced, name).toBeLessThan(listWritten);
    }
    for (const moved of moves) expect(moved).toBeGreaterThan(listWritten);
    const moveOrder = events
      .filter((event) => event.startsWith(`rename ${tls}/`) && !event.includes("install.json"))
      .map((event) => event.split(" ")[2]!.slice(tls.length + 1));
    expect(moveOrder).toEqual(["ca.key", "ca.crt", "server.key", "server.crt"]);
    // One sync before the list is removed and one after it.
    const syncsAfterMoves = events
      .slice(Math.max(...moves))
      .filter((event) => event === `sync ${tls}`);
    expect(syncsAfterMoves).toHaveLength(2);
  });

  it("refuses an authority certificate paired with another authority's key, leaving the box's own set", async () => {
    const stateDir = await ownBox();
    const before = await setOf(stateDir);

    await expect(
      install(stateDir, { certPem: main.caCertPem, keyPem: own.caKeyPem }),
    ).rejects.toMatchObject({ code: "mirror.bundle_fetch_failed" });

    expect(await setOf(stateDir)).toEqual(before);
    expect((await readdir(join(stateDir, "tls"))).sort()).toEqual(INSTALLED);
  });

  it("refuses a leaf that does not verify under the authority, leaving the box's own set", async () => {
    const stateDir = await ownBox();
    const before = await setOf(stateDir);
    vi.mocked(reissueServerLeaf).mockReturnValueOnce({
      serverCertPem: own.serverCertPem,
      serverKeyPem: own.serverKeyPem,
    });

    await expect(install(stateDir)).rejects.toMatchObject({ code: "mirror.bundle_fetch_failed" });

    expect(await setOf(stateDir)).toEqual(before);
    expect((await readdir(join(stateDir, "tls"))).sort()).toEqual(INSTALLED);
  });

  it("a listed install finishes its listed files and deletes every other working file", async () => {
    const stateDir = await ownBox();
    const tls = join(stateDir, "tls");
    await writeFile(join(tls, "server.crt.tmp"), main.serverCertPem);
    await writeFile(join(tls, "server.key.tmp"), main.serverKeyPem);
    await writeFile(join(tls, "ca.key.tmp"), "half-written");
    await writeFile(join(tls, "install.json.tmp"), "half-written");
    await writeFile(
      join(tls, "install.json"),
      JSON.stringify({ files: ["server.crt", "server.key"] }),
    );

    expect(await finishTlsInstall(stateDir)).toBe("finished");

    expect((await readdir(tls)).sort()).toEqual(INSTALLED);
    expect(await tlsFile(stateDir, "server.crt")).toBe(main.serverCertPem);
    expect(await tlsFile(stateDir, "server.key")).toBe(main.serverKeyPem);
    expect(await tlsFile(stateDir, "ca.key")).toBe(own.caKeyPem);
  });

  it("finishes a listed install in a tls folder that is a link", async () => {
    const stateDir = await ownBox();
    const elsewhere = await mkdtemp(join(tmpdir(), "waitron-tls-install-linked-"));
    dirs.push(elsewhere);
    await rm(join(stateDir, "tls"), { recursive: true });
    await symlink(elsewhere, join(stateDir, "tls"));
    for (const name of INSTALLED) await writeFile(join(elsewhere, name), "old");
    await writeFile(join(elsewhere, "server.crt.tmp"), main.serverCertPem);
    await writeFile(
      join(elsewhere, "install.json"),
      JSON.stringify({ files: ["server.crt", "server.key"] }),
    );

    expect(await finishTlsInstall(stateDir)).toBe("finished");

    expect((await readdir(elsewhere)).sort()).toEqual(INSTALLED);
    expect(await readFile(join(elsewhere, "server.crt"), "utf8")).toBe(main.serverCertPem);
  });

  it.each([
    ["a list that is not JSON", "{", "setup.attempt_invalid"],
    [
      "a list naming a file outside the set",
      JSON.stringify({ files: ["secrets.env"] }),
      "setup.not_ready",
    ],
    ["a list with no files", JSON.stringify({}), "setup.not_ready"],
  ])("refuses %s and leaves the set and the list as found", async (_case, body, code) => {
    const stateDir = await ownBox();
    const tls = join(stateDir, "tls");
    const before = await setOf(stateDir);
    await writeFile(join(tls, "server.crt.tmp"), main.serverCertPem);
    await writeFile(join(tls, "install.json"), body);

    await expect(finishTlsInstall(stateDir)).rejects.toMatchObject({ code });

    expect(await setOf(stateDir)).toEqual(before);
    expect(await readFile(join(tls, "install.json"), "utf8")).toBe(body);
  });

  it("a whole set with no install in progress has nothing to finish, and takes no lock for it", async () => {
    const stateDir = await ownBox();
    const before = await setOf(stateDir);
    // A folder where the lock file goes makes taking the lock fail, as a full disk does.
    await mkdir(join(stateDir, "recovery.lock"));

    expect(await finishTlsInstall(stateDir)).toBe("none");
    expect(await setOf(stateDir)).toEqual(before);
    expect((await readdir(join(stateDir, "tls"))).sort()).toEqual(INSTALLED);
  });

  it.each(["install.json", "install.json.tmp", "server.crt.tmp"])(
    "a set holding %s takes the lock to finish it",
    async (name) => {
      const stateDir = await ownBox();
      await writeFile(join(stateDir, "tls", name), JSON.stringify({ files: ["server.crt"] }));
      await mkdir(join(stateDir, "recovery.lock"));

      await expect(finishTlsInstall(stateDir)).rejects.toThrow("unable to open database file");
    },
  );

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
