import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { captureError } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import serverManifest from "../package.json" with { type: "json" };
import { BOX_HOSTNAME } from "./boot.js";
import { loadConfig } from "./config.js";

// The image is a deployment artefact, so nothing in this package's own boot can catch a variable it
// forgets. This suite reads `deploy/Dockerfile` as text and runs the environment it declares through
// the real `loadConfig`, in the ONE mode a preproduction run cannot exercise: a live box.
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DOCKERFILE = readFileSync(`${REPO_ROOT}deploy/Dockerfile`, "utf8");

/** The image's `ENV` block as a plain record — one `ENV` instruction, backslash-continued. */
function imageEnv(dockerfile: string): Record<string, string> {
  const out: Record<string, string> = {};
  let continued = false;
  for (const raw of dockerfile.split("\n")) {
    const line = raw.trim();
    if (!continued && !line.startsWith("ENV ")) continue;
    const body: string = continued ? line : line.slice("ENV ".length);
    continued = body.endsWith("\\");
    const assignment = (continued ? body.slice(0, -1) : body).trim();
    const eq = assignment.indexOf("=");
    if (eq > 0) out[assignment.slice(0, eq)] = assignment.slice(eq + 1);
  }
  return out;
}

const IMAGE_ENV = imageEnv(DOCKERFILE);

// A provisioned box's own URL, from `instance.env`. The image never carries one.
const DATABASE_URL = "postgres://waitron_app:pw@127.0.0.1:5432/waitron";
const ROOTS = ["/opt/waitron/drizzle", "/opt/waitron/media", "/opt/waitron/state"] as const;

const load = (env: Record<string, string | undefined>) =>
  loadConfig(env, ROOTS[0], ROOTS[1], ROOTS[2]);

describe("the container image's environment", () => {
  it("parses as a non-empty ENV block", () => {
    // A parser that silently returned {} would make every assertion below vacuous.
    expect(IMAGE_ENV.WAITRON_STATE_DIR).toBe("/var/lib/waitron/state");
  });

  it("binds every interface, not the container's own loopback", () => {
    // config.ts defaults httpHost to 127.0.0.1, which in a container serves nobody while the
    // loopback healthcheck still reports healthy.
    expect(load({ ...IMAGE_ENV, DATABASE_URL }).httpHost).toBe("0.0.0.0");
  });

  it("names the same host the mDNS responder and the leaf's SANs use", () => {
    expect(IMAGE_ENV.WAITRON_MANAGEMENT_RP_ID).toBe(BOX_HOSTNAME);
    expect(IMAGE_ENV.WAITRON_MANAGEMENT_ORIGIN).toBe(`https://${BOX_HOSTNAME}`);
  });

  it("loads as a LIVE box — the mode the wizard writes and no preproduction run reaches", () => {
    const config = load({ ...IMAGE_ENV, DATABASE_URL, WAITRON_ENV: "production" });
    expect(config.environment).toBe("production");
    expect(config.managementRpId).toBe(BOX_HOSTNAME);
  });

  // The negative control for the case above: production is the only mode where these two are
  // required, so an image that dropped either would boot fine in preproduction and then restart-loop
  // the moment an owner chose "live".
  it.each(["WAITRON_MANAGEMENT_RP_ID", "WAITRON_MANAGEMENT_ORIGIN"])(
    "would fail to boot live without %s",
    async (variable) => {
      const env: Record<string, string | undefined> = {
        ...IMAGE_ENV,
        DATABASE_URL,
        WAITRON_ENV: "production",
      };
      delete env[variable];
      // `Promise.resolve` around a synchronous throw, and `params` compared with `toEqual` — the
      // shape config.test.ts's own production-RP cases use.
      const error = await captureError(() => Promise.resolve(load(env)));
      expect(isAppError(error) && error.code).toBe("server.config_missing");
      expect(isAppError(error) && error.params).toEqual({ variable });
    },
  );

  it("ships every operator CLI and nothing else from the server bundle", () => {
    const copied = new Set(
      [...DOCKERFILE.matchAll(/\/src\/apps\/server\/dist\/([\w.-]+)/g)].map((m) => m[1]),
    );
    for (const target of Object.values(serverManifest.bin)) {
      expect(copied).toContain(target.replace("./dist/", ""));
    }
    // The demo scripts write real sales through the real fiscal backend into an append-only,
    // hash-chained table. `dist/` holds them; the image must not.
    expect(copied).not.toContain("record-one-sale.js");
  });
});
