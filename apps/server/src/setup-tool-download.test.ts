import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Hono } from "hono";
import { mountSetup } from "./setup-api.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it("serves setup assets as attachments while the wizard and API remain readable in the browser", async () => {
  const root = await mkdtemp(join(tmpdir(), "setup-tool-download-"));
  dirs.push(root);
  await mkdir(join(root, "setup-assets"));
  await writeFile(join(root, "index.html"), "WIZARD");
  await writeFile(join(root, "setup-assets/custodian-tool.html"), "PUBLIC-OFFLINE-TOOL");
  const app = new Hono();
  mountSetup(app, { setupAppDir: root, environment: "production" }, () => {});
  const asset = await app.request("/setup-assets/custodian-tool.html", {
    headers: { "X-Waitron-Setup-Owner": "SHOULD-NOT-BE-EMBEDDED" },
  });
  expect(asset.status).toBe(200);
  expect(asset.headers.get("Content-Disposition")).toBe("attachment");
  expect(await asset.text()).toBe("PUBLIC-OFFLINE-TOOL");
  const wizard = await app.request("/");
  expect(wizard.headers.get("Content-Disposition")).toBeNull();
  expect(await wizard.text()).toBe("WIZARD");
  const status = await app.request("/setup-api/status");
  expect(status.headers.get("Content-Disposition")).toBeNull();
  expect(status.headers.get("content-type")).toContain("application/json");
  const absent = await app.request("/setup-assets/absent.html");
  expect(absent.status).toBe(404);
  expect(absent.headers.get("Content-Disposition")).toBeNull();
});
