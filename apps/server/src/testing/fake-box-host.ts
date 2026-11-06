import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface FakeBoxHost {
  path: string;
  lines: string[];
  connections(): number;
}

type Reply = (line: string, socket: Socket) => void;

const servers = new Set<Server>();
const sockets = new Set<Socket>();
const dirs = new Set<string>();
const children = new Set<ChildProcess>();

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

const SHELL_HANDLER = fileURLToPath(
  new URL("../../../../deploy/box/waitron-box.sh", import.meta.url),
);

/**
 * Each connection runs the real deploy/box/waitron-box.sh with the connection as its standard
 * input and output, as systemd's Accept=yes does; the connection closes when the handler exits.
 * `stderr()` is everything the handlers wrote to their standard error.
 */
export async function shellBoxHost(): Promise<{ path: string; stderr(): string }> {
  const path = tempSocketPath();
  const stateDir = mkdtempSync(join(tmpdir(), "box-host-state-"));
  dirs.add(stateDir);
  const uptime = join(stateDir, "uptime");
  writeFileSync(uptime, "12345.67 0\n");
  let stderr = "";
  const server = createServer({ pauseOnConnect: true }, (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    const child = spawn("bash", [SHELL_HANDLER, "test"], {
      stdio: [socket, socket, "pipe"],
      env: { ...process.env, WAITRON_BOX_UPTIME: uptime, WAITRON_BOX_STATE_DIR: stateDir },
    });
    children.add(child);
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("exit", () => {
      children.delete(child);
      socket.destroy();
    });
  });
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return { path, stderr: () => stderr };
}

/** A socket path in a fresh temp folder where nothing listens. */
export function noBoxHostPath(): string {
  return tempSocketPath();
}

/** Closes every server, connection and temp folder this module made; call in afterEach. */
export async function closeFakeBoxHosts(): Promise<void> {
  for (const child of children) child.kill();
  children.clear();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  servers.clear();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.clear();
}
