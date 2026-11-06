import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeBoxHost {
  path: string;
  lines: string[];
  connections(): number;
}

type Reply = (line: string, socket: Socket) => void;

const servers = new Set<Server>();
const sockets = new Set<Socket>();
const dirs = new Set<string>();

function tempSocketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "box-host-"));
  dirs.add(dir);
  return join(dir, "box.sock");
}

/** `reply` gets each line the client sends, without its newline, and the connection. */
export async function fakeBoxHost(reply: Reply): Promise<FakeBoxHost> {
  const path = tempSocketPath();
  const lines: string[] = [];
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const end = buffered.indexOf("\n");
      if (end === -1) return;
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      lines.push(line);
      reply(line, socket);
    });
    socket.on("error", () => {});
  });
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return { path, lines, connections: () => connections };
}

/** Writes `text` exactly and ends the connection. */
export function answer(text: string): Reply {
  return (_line, socket) => socket.end(text);
}

/** A socket path in a fresh temp folder where nothing listens. */
export function noBoxHostPath(): string {
  return tempSocketPath();
}

/** Closes every server, connection and temp folder this module made; call in afterEach. */
export async function closeFakeBoxHosts(): Promise<void> {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  servers.clear();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.clear();
}
