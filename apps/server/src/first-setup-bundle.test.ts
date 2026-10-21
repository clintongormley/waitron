import { request as httpsRequest } from "node:https";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { freePorts } from "./testing/free-ports.js";

it.each(["bin.ts", "node-entry.ts"])(
  "a bundled %s launch opens exactly one restricted listener and returns from startup",
  async (entrySource) => {
    const root = await mkdtemp(join(tmpdir(), "first-setup-bundle-"));
    let child: ReturnType<typeof spawn> | undefined;
    let closed: Promise<unknown> | undefined;
    try {
      const stateDir = join(root, "state"),
        venueDir = join(root, "venue");
      await mkdir(join(stateDir, "tls"), { recursive: true });
      const tls = mintSelfSignedServerCert({
        hostnames: ["waitron.local", "localhost"],
        ipAddresses: ["127.0.0.1"],
        now: new Date(),
      });
      for (const [name, value] of Object.entries({
        "ca.crt": tls.caCertPem,
        "ca.key": tls.caKeyPem,
        "server.crt": tls.serverCertPem,
        "server.key": tls.serverKeyPem,
      }))
        await writeFile(join(stateDir, "tls", name), value);
      await mkdir(venueDir);
      await writeFile(join(venueDir, "first-setup-claim.json"), "{}");
      await cp(resolve("src/assets"), join(root, "assets"), { recursive: true });
      await symlink(resolve("node_modules"), join(root, "node_modules"));
      const entry = join(root, "direct.mjs");
      await build({
        stdin: {
          contents: `import "./${entrySource}"; process.stdout.write("PROBE_READY\\n");`,
          resolveDir: resolve("src"),
          sourcefile: "direct-probe.ts",
        },
        outfile: entry,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node24",
        external: ["sharp"],
        banner: {
          js: "import { createRequire as makeRequire } from 'node:module'; const require = makeRequire(import.meta.url);",
        },
        logLevel: "silent",
      });
      const [port] = await freePorts(1);
      child = spawn(process.execPath, [entry], {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("WAITRON_")),
          ),
          WAITRON_STATE_DIR: stateDir,
          WAITRON_VENUE_DIR: venueDir,
          WAITRON_HTTP_HOST: "127.0.0.1",
          WAITRON_HTTP_PORT: String(port),
          WAITRON_HTTP_LANDING_PORT: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      closed = once(child, "close");
      let output = "";
      child.stderr!.on("data", (chunk) => {
        output += String(chunk);
      });
      await new Promise<void>((ready, reject) => {
        const timer = setTimeout(
          () => reject(new Error("bundle did not finish startup: " + output)),
          30000,
        );
        child!.stdout!.on("data", (chunk) => {
          output += String(chunk);
          if (output.includes("PROBE_READY")) {
            clearTimeout(timer);
            ready();
          }
        });
        child!.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child!.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("bundle exited before ready: " + output));
        });
      });
      const response = await new Promise<Response>((resolve, reject) => {
        const req = httpsRequest(
          {
            hostname: "127.0.0.1",
            port,
            path: "/setup-api/first-setup/status",
            ca: tls.caCertPem,
            servername: "waitron.local",
            timeout: 5000,
          },
          (res) => {
            let body = "";
            res.on("data", (chunk: Buffer) => {
              body += chunk.toString();
            });
            res.on("end", () => resolve(new Response(body, { status: res.statusCode! })));
          },
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("HTTPS bundled entry deadline")));
        req.end();
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ claimed: true, resolution: true });
      expect(output.match(/"event":"recovery.listening"/g)).toHaveLength(1);
      await expect(stat(join(venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (child?.pid !== undefined && child.exitCode === null) child.kill("SIGTERM");
      await closed;
      await rm(root, { recursive: true, force: true });
    }
  },
);
