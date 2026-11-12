import { createServer, type Server } from "node:https";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { buildBackupBackend } from "./backup-backends.js";
import { StatusClients } from "./backup-status-clients.js";
import { backupArchiveKey } from "./backup-keys.js";
import { readDestinationStatus } from "./backup-status.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import type { BackupDestination, StorageBackend, StoredObject } from "./storage-backend.js";

const NOW = new Date("2026-11-07T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

type Built = { id: string; serial: number; closed: boolean };

/** Each built client lists from `answers` in turn; an unset answer lists empty at once. */
function harness() {
  const built: Built[] = [];
  let pending: ((objects: StoredObject[]) => void) | undefined;
  let hold = false;
  const clients = new StatusClients(
    (dest: BackupDestination): StorageBackend => {
      if (dest.kind === "local-fs" && dest.dir === "/unbuildable")
        throw new AppError("backup.destination_key_invalid", { field: "prefix" });
      const record: Built = { id: dest.id, serial: built.length, closed: false };
      built.push(record);
      return {
        id: dest.id,
        put: async () => {},
        putFile: async () => {},
        getFile: async () => {},
        get: async () => Buffer.alloc(0),
        delete: async () => {},
        deleteMany: async () => {},
        list: () => {
          if (!hold) return Promise.resolve([]);
          hold = false;
          return new Promise<StoredObject[]>((resolve) => (pending = resolve));
        },
        close: () => {
          record.closed = true;
        },
      };
    },
    (backend) => backend.close(),
  );
  const read = (dest: BackupDestination) =>
    clients.read(dest, (backend) => readDestinationStatus(backend, DAY, NOW, 60_000));
  return {
    clients,
    built,
    read,
    holdNextListing: () => (hold = true),
    answerHeldListing: (objects: StoredObject[]) => pending!(objects),
  };
}

const folder = (id: string, dir: string): BackupDestination => ({ kind: "local-fs", id, dir });
const bucket = (secretAccessKey: string): BackupDestination => ({
  kind: "s3",
  id: "cloud",

  bucket: {
    region: "eu-south-2",
    bucket: "b",
    prefix: "",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey,
  },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("StatusClients", () => {
  it("builds one client per destination and lends it to every later read", async () => {
    const h = harness();
    await h.read(folder("usb", "/a"));
    await h.read(folder("usb", "/a"));
    await h.read(folder("usb", "/a"));
    await h.read(folder("other", "/b"));
    expect(h.built.map(({ id }) => id)).toEqual(["usb", "other"]);
    expect(h.built.some(({ closed }) => closed)).toBe(false);
  });

  it("keeps the client when the settings arrive as a new object with the same values", async () => {
    const h = harness();
    await h.read(bucket("secret-one"));
    await h.read(bucket("secret-one"));
    expect(h.built).toHaveLength(1);
  });

  it("replaces and closes the client when the destination's settings change, the secret included", async () => {
    const h = harness();
    await h.read(bucket("secret-one"));
    await h.read(bucket("secret-two"));
    await settle();
    expect(h.built.map(({ serial, closed }) => ({ serial, closed }))).toEqual([
      { serial: 0, closed: true },
      { serial: 1, closed: false },
    ]);
  });

  it("closes a replaced client only once the listing it lent out has settled, and that read still answers", async () => {
    const h = harness();
    const mtimeMs = NOW.getTime() - 60_000;
    h.holdNextListing();
    const first = h.read(folder("usb", "/a"));
    await h.read(folder("usb", "/b"));
    await settle();
    expect(h.built[0]!.closed).toBe(false);

    h.answerHeldListing([{ key: backupArchiveKey(new Date(mtimeMs)), size: 1, mtimeMs }]);
    const answered = await first;
    await settle();
    expect(h.built[0]!.closed).toBe(true);
    expect(answered).toMatchObject({ readErrorCode: null, ageSeconds: 60, stale: false });
    expect(h.built[1]!.closed).toBe(false);
  });

  it("closes the client of a destination no longer configured, and keeps the others", async () => {
    const h = harness();
    await h.read(folder("usb", "/a"));
    await h.read(folder("other", "/b"));
    h.clients.keepOnly([folder("other", "/b")]);
    await settle();
    expect(h.built.map(({ id, closed }) => ({ id, closed }))).toEqual([
      { id: "usb", closed: true },
      { id: "other", closed: false },
    ]);
    await h.read(folder("other", "/b"));
    expect(h.built).toHaveLength(2);
  });

  it("keepOnly replaces nothing that is kept but changed: the next read does", async () => {
    const h = harness();
    await h.read(folder("usb", "/a"));
    h.clients.keepOnly([folder("usb", "/b")]);
    await settle();
    expect(h.built[0]!.closed).toBe(false);
    await h.read(folder("usb", "/b"));
    await settle();
    expect(h.built.map(({ closed }) => closed)).toEqual([true, false]);
  });

  it("closes every client on closeAll, then builds a client per read and closes it when the listing settles", async () => {
    const h = harness();
    await h.read(folder("usb", "/a"));
    await h.read(folder("other", "/b"));
    h.clients.closeAll();
    await settle();
    expect(h.built.every(({ closed }) => closed)).toBe(true);

    await h.read(folder("usb", "/a"));
    await settle();
    expect(h.built).toHaveLength(3);
    expect(h.built[2]!.closed).toBe(true);
  });

  it("after closeAll, closes the client a read built when the read throws before it returns, and the caller still sees the throw", async () => {
    const h = harness();
    h.clients.closeAll();
    expect(() =>
      h.clients.read(folder("usb", "/a"), () => {
        throw new Error("read failed");
      }),
    ).toThrow("read failed");
    await settle();
    expect(h.built.map(({ closed }) => closed)).toEqual([true]);
  });

  it("keeps a client whose read throws before it returns, open, and lends it to the next read", async () => {
    const h = harness();
    expect(() =>
      h.clients.read(folder("usb", "/a"), () => {
        throw new Error("read failed");
      }),
    ).toThrow("read failed");
    await settle();
    expect(h.built.map(({ closed }) => closed)).toEqual([false]);
    await h.read(folder("usb", "/a"));
    expect(h.built).toHaveLength(1);
  });

  it("answers a destination that will not build with the build's code, and keeps nothing for it", async () => {
    const h = harness();
    const status = await h.read(folder("usb", "/unbuildable"));
    expect(status).toEqual({
      id: "usb",
      lastBackupAt: null,
      ageSeconds: null,
      stale: true,
      readErrorCode: "backup.destination_key_invalid",
    });
    await h.read(folder("usb", "/a"));
    expect(h.built).toHaveLength(1);
  });
});

describe("StatusClients against an HTTPS bucket", () => {
  const tls = mintSelfSignedServerCert({
    hostnames: ["localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date(),
  });
  let server: Server | undefined;
  let port: number;
  let connections = 0;
  let listings = 0;

  beforeAll(async () => {
    const listening = createServer(
      { key: tls.serverKeyPem, cert: tls.serverCertPem },
      (req, res) => {
        req.resume();
        req.on("end", () => {
          if (req.url?.includes("list-type=2")) listings += 1;
          res.writeHead(200, { "content-type": "application/xml" });
          res.end(
            '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>b</Name>' +
              "<KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>" +
              "</ListBucketResult>",
          );
        });
      },
    );
    server = listening;
    listening.on("secureConnection", () => (connections += 1));
    await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
    port = (listening.address() as { port: number }).port;
  });

  afterAll(async () => {
    if (server !== undefined) {
      const open = server;
      open.closeAllConnections();
      await new Promise<void>((resolve) => open.close(() => resolve()));
    }
  });

  const dest = (): BackupDestination => ({
    kind: "s3",
    id: "cloud",

    bucket: {
      endpoint: `https://127.0.0.1:${port}`,
      region: "eu-south-2",
      bucket: "b",
      prefix: "",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-example",
    },
  });

  /** The client's own keep-alive agent, told to trust the test certificate and nothing else. */
  const clients = () =>
    new StatusClients(
      (d) =>
        buildBackupBackend(d, {
          requestHandler: { socketTimeout: 30_000, httpsAgent: { ca: tls.caCertPem } },
        }),
      (backend) => backend.close(),
    );

  /** Connections opened by two reads in a row, and the listings the server answered. */
  async function twoReads(holder: StatusClients) {
    const before = { connections, listings };
    for (let read = 0; read < 2; read += 1) {
      const status = await holder.read(dest(), (backend) =>
        readDestinationStatus(backend, DAY, NOW, 10_000),
      );
      expect(status.readErrorCode).toBeNull();
    }
    return { connections: connections - before.connections, listings: listings - before.listings };
  }

  it("opens one connection for two reads in a row on the kept client", async () => {
    const holder = clients();
    try {
      expect(await twoReads(holder)).toEqual({ connections: 1, listings: 2 });
    } finally {
      holder.closeAll();
    }
  });

  it("opens two when every read builds its own client, as after a stop", async () => {
    const holder = clients();
    holder.closeAll();
    expect(await twoReads(holder)).toEqual({ connections: 2, listings: 2 });
  });
});
