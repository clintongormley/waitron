import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Plugin } from "vite";

const fileName = "setup-assets/custodian-tool.html";
export function setupAssets(): Plugin {
  let artifact: Promise<Buffer> | undefined;
  const load = () =>
    (artifact ??= (async () => {
      const directory = await mkdtemp(join(tmpdir(), "waitron-setup-tool-"));
      try {
        const output = join(directory, "custodian-tool.html");
        await promisify(execFile)(
          process.execPath,
          [
            fileURLToPath(
              new URL("../../fiscal-verifactu/scripts/build-custodian.mjs", import.meta.url),
            ),
            "--out",
            output,
          ],
          { timeout: 30_000 },
        );
        return await readFile(output);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    })());
  return {
    name: "waitron-setup-assets",
    async generateBundle() {
      this.emitFile({ type: "asset", fileName, source: await load() });
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (
          request.url?.split("?")[0] !== `/${fileName}` ||
          (request.method !== "GET" && request.method !== "HEAD")
        ) {
          next();
          return;
        }
        try {
          const bytes = await load();
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader(
            "Content-Disposition",
            'attachment; filename="waitron-custodian-tool.html"',
          );
          response.setHeader("Cache-Control", "no-cache");
          response.setHeader("Content-Length", bytes.length);
          response.end(request.method === "HEAD" ? undefined : bytes);
        } catch {
          response.statusCode = 503;
          response.end();
        }
      });
    },
  };
}
