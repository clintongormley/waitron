// Vite bundles this file into the setup app's config, for `vite build` in the image as well as for
// the dev server, so its runtime imports are `node:` built-ins only.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vitest/config";

export type Signer = (body: string) => Promise<string>;

export interface DevCustodianOptions {
  readonly target: string;
  readonly secure?: boolean;
  readonly stateDir?: string;
  readonly sign?: Signer;
  readonly log?: (message: string) => void;
}

type Request = IncomingMessage & { originalUrl?: string };

const PROVISION_PATH = "/setup-api/provision";
const SERVER_DIR = fileURLToPath(new URL("../../", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The server's own state directory: `WAITRON_STATE_DIR`, relative to `apps/server`, else its default. */
export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.WAITRON_STATE_DIR?.trim();
  if (configured === undefined || configured === "") return join(SERVER_DIR, "src", "state");
  return isAbsolute(configured) ? configured : resolve(SERVER_DIR, configured);
}

const SIGN_TIMEOUT_MS = 60_000;

export function cliSigner(
  custodianDir: string,
  options: { command?: readonly string[]; timeoutMs?: number } = {},
): Signer {
  const [file, ...args] = options.command ?? [
    "pnpm",
    "--silent",
    "--filter",
    "@waitron/server",
    "dev:custodian",
    "sign",
    "--dir",
    custodianDir,
  ];
  const timeoutMs = options.timeoutMs ?? SIGN_TIMEOUT_MS;
  return (body) =>
    new Promise((done, fail) => {
      // Its own process group, so the time limit also stops what pnpm started.
      const child = spawn(file!, args, {
        cwd: REPO_ROOT,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        process.kill(-child.pid!, "SIGKILL");
      }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", (error) => {
        clearTimeout(timer);
        fail(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) fail(new Error(`dev:custodian sign timed out after ${timeoutMs} ms`));
        else if (code === 0) done(stdout);
        else fail(new Error(`dev:custodian sign exited ${code}: ${stderr.trim()}`));
      });
      child.stdin.end(body);
    });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Only a plain object without an allocation is signed; anything else the server answers itself. */
function needsAllocation(text: string): boolean {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return false;
  }
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    !("initialOperations" in body)
  );
}

function forward(
  options: DevCustodianOptions,
  req: Request,
  res: ServerResponse,
  body: Buffer,
): Promise<void> {
  const target = new URL(options.target);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  const headers: OutgoingHttpHeaders = { ...req.headers, "content-length": body.length };
  delete headers["transfer-encoding"];
  return new Promise((done, fail) => {
    const upstream = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: req.originalUrl ?? req.url,
        headers,
        ...(options.secure === false ? { rejectUnauthorized: false } : {}),
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
        answer.on("end", done);
        answer.on("error", fail);
      },
    );
    upstream.on("error", fail);
    upstream.end(body);
  });
}

function refuse(res: ServerResponse): void {
  // A development tool's answer, not a registered product error code.
  res.writeHead(500, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "dev_custodian.sign_failed", params: {} } }));
}

export function devCustodianProvision(
  options: DevCustodianOptions,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  const custodianDir = join(options.stateDir ?? defaultStateDir(), "dev-custodian");
  const sign = options.sign ?? cliSigner(custodianDir);
  const log = options.log ?? ((message: string) => console.error(message));
  return (req: Request, res, next) => {
    const path = (req.originalUrl ?? req.url ?? "").split("?")[0];
    if (req.method !== "POST" || path !== PROVISION_PATH) return next();
    // Checked before the body is read, so a request handed on still carries its whole body.
    if (!existsSync(custodianDir)) return next();
    void (async () => {
      const original = await readBody(req);
      let body = original;
      if (needsAllocation(original.toString())) {
        try {
          body = Buffer.from(await sign(original.toString()));
        } catch (error) {
          log(`dev custodian: ${error instanceof Error ? error.message : String(error)}`);
          refuse(res);
          return;
        }
      }
      await forward(options, req, res, body);
    })().catch((error: unknown) => {
      log(`dev custodian: forwarding failed: ${String(error)}`);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  };
}

export function devCustodianPlugin(options: DevCustodianOptions): Plugin {
  return {
    name: "waitron-dev-custodian",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        devCustodianProvision({
          ...options,
          log: options.log ?? ((message) => server.config.logger.error(message)),
        }),
      );
    },
  };
}
