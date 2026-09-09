import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/server/src/config.js";

/**
 * The container image's environment, checked against the server that has to boot on it.
 *
 * Lives in the ROOT project deliberately (CLAUDE.md §4): it pins files under `deploy/`, and a
 * package-resident guard only runs when its package is in scope. It ran from `apps/server` at
 * first, which worked only because `deploy/**` currently scopes GLOBAL — narrowing that scope
 * (design §10 calls it an optimisation) would have switched this guard off for exactly the change
 * class it exists to catch. The cost of living here, stated because nothing else says it: the root
 * project is not typechecked (CLAUDE.md §2), so type errors in this file surface only as runtime
 * ones.
 *
 * It reads TEXT for everything outside the server's own module graph — the Dockerfile's `ENV`
 * block, compose's two defaults, the shell's `BOX_URL`, and `boot.ts`'s hostname literal. So these
 * are PINS between four copies of one string, not a single source anything derives from; the guard
 * is what makes a change to one of them fail loudly rather than ship a box whose certificate,
 * QR and passkey relying party disagree.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

const DOCKERFILE = read("deploy/Dockerfile");
const COMPOSE = read("deploy/compose.yml");
const PREPARE = read("deploy/prepare.sh");
const CONFIG_SOURCE = read("apps/server/src/config.ts");
const SERVER_MANIFEST = JSON.parse(read("apps/server/package.json")) as {
  bin: Record<string, string>;
};

/** A capture that must exist: a regex that stops matching would otherwise pass every assertion. */
function only(source: string, pattern: RegExp, what: string): string {
  const match = pattern.exec(source);
  if (match?.[1] === undefined) throw new Error(`no ${what} found — this guard has gone blind`);
  return match[1];
}

/** The image's `ENV` block as a record — one `ENV` instruction, backslash-continued. */
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

/** `boot.ts`'s own literal — the name the mDNS responder answers for and the leaf's SANs cover. */
const HOSTNAME = only(
  read("apps/server/src/boot.ts"),
  /const BOX_HOSTNAME = "([^"]+)"/,
  "BOX_HOSTNAME",
);

// A provisioned box's own URL, from `instance.env`. The image never carries one.
const DATABASE_URL = "postgres://waitron_app:pw@127.0.0.1:5432/waitron";
const load = (env: Record<string, string | undefined>) =>
  loadConfig(env, "/opt/waitron/drizzle", "/opt/waitron/media", "/opt/waitron/state");

/** `@waitron/shared`'s `AppError` shape, duck-typed: the root project cannot import the package. */
function thrown(run: () => unknown): { code?: unknown; params?: { variable?: unknown } } {
  try {
    run();
  } catch (error) {
    return error as { code?: unknown; params?: { variable?: unknown } };
  }
  throw new Error("expected a throw, got none");
}

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

  it("sets every variable config.ts requires in production", () => {
    // Derived from config.ts rather than listed here, so a NEW production-required variable fails
    // this guard instead of shipping a box that cannot boot live.
    const required = [...CONFIG_SOURCE.matchAll(/requiredInProduction\(\s*env,\s*"(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(required.length).toBeGreaterThan(0);
    for (const variable of required) expect(IMAGE_ENV).toHaveProperty(variable);
  });

  it("loads as a LIVE box — the mode the wizard writes and no preproduction run reaches", () => {
    const config = load({ ...IMAGE_ENV, DATABASE_URL, WAITRON_ENV: "production" });
    expect(config.environment).toBe("production");
    expect(config.managementRpId).toBe(HOSTNAME);
  });

  // The negative control for the case above: production is the only mode where these two are
  // required, so an image that dropped either would boot fine in preproduction and then escalate to
  // the recovery page the moment an owner chose "live".
  it.each(["WAITRON_MANAGEMENT_RP_ID", "WAITRON_MANAGEMENT_ORIGIN"])(
    "would fail to boot live without %s",
    (variable) => {
      const env: Record<string, string | undefined> = {
        ...IMAGE_ENV,
        DATABASE_URL,
        WAITRON_ENV: "production",
      };
      delete env[variable];
      const error = thrown(() => load(env));
      expect(error.code).toBe("server.config_missing");
      expect(error.params).toEqual({ variable });
    },
  );

  it("does not enable backups, which are fail-closed without their other two variables", () => {
    // Setting the directory alone throws at boot (backup-config.ts), which would kill a box on its
    // first start into trading. compose passes the three together from the box's .env.
    expect(IMAGE_ENV).not.toHaveProperty("WAITRON_BACKUP_DIR");
  });

  it("ships every operator CLI and nothing else from the server bundle", () => {
    const copied = new Set(
      [...DOCKERFILE.matchAll(/\/src\/apps\/server\/dist\/([\w.-]+)/g)].map((m) => m[1]),
    );
    for (const target of Object.values(SERVER_MANIFEST.bin)) {
      expect(copied).toContain(target.replace("./dist/", ""));
    }
    // The demo scripts write real sales through the real fiscal backend into an append-only,
    // hash-chained table. `dist/` holds them; the image must not.
    expect(copied).not.toContain("record-one-sale.js");
  });

  it("ships the sample images at the directory the installed Demo seed reads", () => {
    expect(IMAGE_ENV.WAITRON_DEMO_MEDIA_SOURCE).toBe("/app/demo-media");
    expect(DOCKERFILE).toContain("/src/apps/server/scripts/demo-seed/media/ /app/demo-media/");
  });
});

describe("every copy of the box's hostname", () => {
  it("is the one boot.ts declares", () => {
    expect(IMAGE_ENV.WAITRON_MANAGEMENT_RP_ID).toBe(HOSTNAME);
    expect(IMAGE_ENV.WAITRON_MANAGEMENT_ORIGIN).toBe(`https://${HOSTNAME}`);
    // compose's operator-override defaults, which must not disagree with the image they default to.
    expect(
      only(
        COMPOSE,
        /WAITRON_MANAGEMENT_RP_ID: \$\{WAITRON_MANAGEMENT_RP_ID:-([^}]+)\}/,
        "compose RP ID",
      ),
    ).toBe(HOSTNAME);
    expect(
      only(
        COMPOSE,
        /WAITRON_MANAGEMENT_ORIGIN: \$\{WAITRON_MANAGEMENT_ORIGIN:-([^}]+)\}/,
        "compose origin",
      ),
    ).toBe(`https://${HOSTNAME}`);
    // The URL in the QR code the restaurant actually scans.
    expect(only(PREPARE, /BOX_URL="([^"]+)"/, "prepare.sh BOX_URL")).toBe(`https://${HOSTNAME}`);
  });
});
