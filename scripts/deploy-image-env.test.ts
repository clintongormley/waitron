import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/server/src/config.js";
import { esbuildArgs } from "./bundle-node.mjs";
import { workspaceMembers } from "./workspace-members.mjs";

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
const WAITRON_SH = read("deploy/waitron.sh");
const CI = read(".github/workflows/ci.yml");
const IMAGE_SMOKE = read(".github/workflows/image-smoke.yml");
// Fetched onto every box beside compose.yml, so a line it still calls REQUIRED is an instruction an
// operator follows for a variable nothing reads.
const ENV_EXAMPLE = read("deploy/.env.example");
const CONFIG_SOURCE = read("apps/server/src/config.ts");
// The operator commands the server bundle produces. Declared under `waitron.commands` rather than
// `bin` because nothing builds at install time, so a `bin` target under `dist/` is a command pnpm
// cannot link — see scripts/manifest-commands.test.ts.
const SERVER_MANIFEST = JSON.parse(read("apps/server/package.json")) as {
  waitron: { commands: Record<string, string> };
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

const load = (env: Record<string, string | undefined>) =>
  loadConfig(env, "/opt/waitron/drizzle", "/opt/waitron/state");

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

  it("stamps the exact source revision into every CI-built image", () => {
    expect(IMAGE_ENV.WAITRON_BUILD_ID).toBe("${WAITRON_BUILD_ID}");
    expect(CI).toContain("build-args: WAITRON_BUILD_ID=${{ github.sha }}");
    expect(IMAGE_SMOKE).toContain("build-args: WAITRON_BUILD_ID=${{ github.sha }}");
  });

  it("binds every interface, not the container's own loopback", () => {
    // config.ts defaults httpHost to 127.0.0.1, which in a container serves nobody while the
    // loopback healthcheck still reports healthy.
    expect(load(IMAGE_ENV).httpHost).toBe("0.0.0.0");
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
    const config = load({ ...IMAGE_ENV, WAITRON_ENV: "production" });
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
    const commands = Object.values(SERVER_MANIFEST.waitron.commands);
    // An empty declaration would satisfy the loop below without checking anything (CLAUDE.md §2).
    expect(commands.length).toBeGreaterThan(0);
    for (const target of commands) {
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

describe("the print-agent image and its compose wiring", () => {
  it("builds a print-agent target from deploy/Dockerfile", () => {
    expect(DOCKERFILE).toContain("FROM node:26-slim AS print-agent");
    // Emitted by the shared build stage — the source the COPY below pulls from.
    expect(DOCKERFILE).toContain("pnpm --filter @waitron/print-agent-app build");
    expect(DOCKERFILE).toContain(
      "COPY --from=build --chown=node:node /src/apps/print-agent/dist/print-agent.js /app/print-agent.js",
    );
    // The app runtime stage stays LAST, so a bare `docker build` still yields the app image.
    expect(DOCKERFILE.lastIndexOf("AS runtime")).toBeGreaterThan(
      DOCKERFILE.indexOf("AS print-agent"),
    );
  });

  it("runs the agent as an on-by-default compose service with the measured USB shape", () => {
    expect(COMPOSE).toContain("print-agent:");
    expect(COMPOSE).toContain(
      "image: ${WAITRON_PRINT_AGENT_IMAGE:-ghcr.io/clintongormley/waitron-print-agent:main}",
    );
    // The hot-plug-safe device shape, pinned so a subdirectory mount or a hard `devices:` line
    // (both of which the box receipts rejected, spec §5) fails here.
    expect(COMPOSE).toContain("/dev:/dev:ro");
    expect(COMPOSE).toContain('"c 180:* rwm"');
    expect(COMPOSE).not.toMatch(/^\s*devices:/m);
    // The state volume mount matches the agent stage's WAITRON_STATE_DIR ENV.
    expect(COMPOSE).toContain("print_agent:/var/lib/waitron-print-agent");
    expect(DOCKERFILE).toContain("WAITRON_STATE_DIR=/var/lib/waitron-print-agent");
  });

  it("keeps the print-agent service on the host network", () => {
    const agent = only(
      COMPOSE,
      /\n {2}print-agent:([\s\S]*?)(?=\n(?: {2}[a-zA-Z][\w-]*:|[a-zA-Z])|$)/,
      "print-agent service",
    );
    expect(agent).toMatch(/^ {4}network_mode: host$/m);
  });

  it("has retired the standalone agent Dockerfile", () => {
    // One image definition. A resurrected file would build a second, drifting image.
    expect(() => read("apps/print-agent/Dockerfile")).toThrow();
  });

  it("smokes the print-agent target it ships", () => {
    expect(IMAGE_SMOKE).toContain("target: print-agent");
  });
});

describe("the waitron.sh box command", () => {
  it("is a bash script", () => {
    expect(WAITRON_SH).toMatch(/^#!.*\bbash\b/);
  });

  it("fetches the box files from the repository's public raw endpoint", () => {
    expect(WAITRON_SH).toContain("raw.githubusercontent.com/clintongormley/waitron");
  });

  it("defaults the install ref to main", () => {
    expect(WAITRON_SH).toMatch(/ref="\$\{1:-main\}"/);
  });

  it("honours WAITRON_DIR, defaulting to /opt/waitron", () => {
    expect(WAITRON_SH).toMatch(/WAITRON_DIR:-\/opt\/waitron/);
  });

  // The DELAY default is pinned here because `scripts/waitron-sh.test.mjs` overrides it in every
  // case, so no behaviour anywhere would notice a typo: a box would give up in two seconds instead
  // of three minutes and every test would still pass. The try count is pinned here too, though that
  // suite also asserts it behaviourally. Closing braces are part of both patterns — without them
  // `:-5` matches `:-50` and `:-36` matches `:-360`, which is the likeliest slip of all.
  it("ships a health wait of 36 tries, five seconds apart", () => {
    expect(WAITRON_SH).toMatch(/WAITRON_SH_MAX_HEALTH_TRIES:-36\}/);
    expect(WAITRON_SH).toMatch(/WAITRON_SH_HEALTH_DELAY:-5\}/);
  });

  it("reports a script-prefixed error to stderr when misused", () => {
    expect(WAITRON_SH).toMatch(/echo "waitron\.sh: [^\n]*>&2/);
  });

  it("builds a branch image from the repo git context with deploy/Dockerfile", () => {
    expect(WAITRON_SH).toMatch(/docker build[^\n]*-f deploy\/Dockerfile/);
    expect(WAITRON_SH).toContain("github.com/clintongormley/waitron.git");
    expect(WAITRON_SH).toMatch(/waitron\.git#\$\{?\w+\}?/);
  });

  it("records the branch image in .env rather than only inline on compose up", () => {
    expect(WAITRON_SH).toMatch(/env_set WAITRON_IMAGE/);
  });

  it("keeps the tls certificate when it empties the state volume on a plain reset", () => {
    expect(WAITRON_SH).toMatch(/find "\$\{WAITRON_STATE_DIR:\?\}" .*! -name tls/);
  });

  it("refuses a reset on a production box unless forced", () => {
    expect(WAITRON_SH).toMatch(/--force-production/);
    expect(WAITRON_SH).toMatch(/refusing to reset:[^\n]*PRODUCTION/);
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
    expect(only(WAITRON_SH, /BOX_URL="([^"]+)"/, "waitron.sh BOX_URL")).toBe(`https://${HOSTNAME}`);
  });
});

it("starts no database server on the box, and needs no secret before the box boots", () => {
  // A venue is a directory of SQLite files inside the `state` volume, so the box runs no cluster and
  // holds no database credential. Pinned as absences because both are one line away from returning:
  // the service and the named volume are spelled the same way at the same indent, so one pattern
  // covers both, and a `${POSTGRES_PASSWORD:?...}` interpolation makes compose refuse to read the
  // file at all — including for a `down`, which is how a box gets torn down.
  expect(COMPOSE).not.toMatch(/^ {2}db:$/m);
  expect(COMPOSE).not.toContain("POSTGRES_PASSWORD");
  expect(COMPOSE).not.toContain("postgres");
  expect(COMPOSE).not.toContain("5432");
  // The same absence in the two files that would put it back: the script that installs a box, and
  // the example environment it fetches onto one.
  expect(WAITRON_SH).not.toContain("POSTGRES_PASSWORD");
  expect(ENV_EXAMPLE).not.toContain("POSTGRES_PASSWORD");
});

it("stores image-library bytes in the database without a separate image volume", () => {
  expect(IMAGE_ENV).not.toHaveProperty("WAITRON_MEDIA_DIR");
  expect(DOCKERFILE).not.toContain("/var/lib/waitron/media");
  expect(COMPOSE).not.toContain("media:/var/lib/waitron/media");
  expect(COMPOSE).not.toMatch(/^ {2}media:$/m);
});

/**
 * sharp is a native addon with a shared library beside it, and esbuild does not refuse to bundle
 * it. Without `--external:sharp` the build exits 0 and the bundle cannot even be loaded: bundled
 * sharp declares `createRequire` a second time beside the banner `scripts/bundle-node.mjs` adds,
 * and `node --check dist/server.js` reports `SyntaxError: Identifier 'createRequire' has already
 * been declared`. Measured 2026-09-23 on esbuild 0.28.2.
 *
 * Every Node bundle is built by `scripts/bundle-node.mjs`, and the flag is taken from that
 * script's own argument builder. The rest reads package.json TEXT: it sees a workspace script that
 * calls `esbuild` by name, but not a package script that runs a file of its own which calls esbuild
 * or its JavaScript API. It pins that `@waitron/server`'s and `@waitron/provisioning`'s `build`
 * scripts name the shared script, so a NEW member that reaches `@waitron/media` and bundles
 * through something the first case cannot see — a file of its own, another bundler, or esbuild
 * reached by path — is not flagged.
 */
describe("sharp stays outside every bundle and ships beside the server's", () => {
  type Manifest = {
    name: string;
    scripts?: Record<string, string>;
  };
  let listed: Manifest[] | undefined;
  const manifests = (): Manifest[] => {
    listed ??= workspaceMembers().map(
      ({ dir }) => JSON.parse(read(`${dir}/package.json`)) as Manifest,
    );
    // An empty listing would pass every loop over it.
    expect(listed.length).toBeGreaterThan(0);
    return listed;
  };

  it("runs no esbuild command outside the shared bundle script", () => {
    const direct = manifests().flatMap(({ name, scripts }) =>
      Object.entries(scripts ?? {})
        .filter(([, command]) => /(?:^|[\s;&|(])esbuild(?:\s|$)/.test(command))
        .map(([script]) => `${name} ${script}`),
    );
    expect(direct).toEqual([]);
  }, 60_000);

  it("builds the Node bundles that can reach @waitron/media with the shared script", () => {
    const builds = new Map(manifests().map(({ name, scripts }) => [name, scripts?.build ?? ""]));
    for (const name of ["@waitron/server", "@waitron/provisioning"]) {
      expect(builds.get(name), name).toContain("scripts/bundle-node.mjs");
    }
  }, 60_000);

  it("names --external:sharp for every bundle the shared script builds", () => {
    expect(esbuildArgs("src/bin.ts", "dist/server.js")).toContain("--external:sharp");
  });

  it("copies sharp beside the bundle in the image, and both CI jobs check it", () => {
    expect(DOCKERFILE).toContain("/sharp-runtime/node_modules/ /app/node_modules/");
    expect(CI).toContain(`grep -q 'import("sharp")' apps/server/dist/server.js`);
    expect(IMAGE_SMOKE).toContain("await import('sharp')");
  });
});

/**
 * The `@img/sharp-libvips-*` release pnpm-lock.yaml resolves, and the libvips version it carries.
 *
 * The package version comes from the lockfile, which names every platform's package. The libvips
 * version is not in the lockfile, so it comes from the `versions.json` of the package installed for
 * THIS machine. That stands for the box's linux packages only because one sharp-libvips release
 * carries one libvips version on every platform: checked 2026-09-24 for 1.3.3, where darwin-arm64's
 * `versions.json` and the `./binary` export `npm view` printed for linux-x64 and linux-arm64 all
 * name 8.18.6. So the check needs that release installed on the machine running it, and throws where
 * none is.
 */
function libvipsRelease(): { packageVersion: string; libvips: string } {
  const lockfile = read("pnpm-lock.yaml");
  const versions = new Set(
    [...lockfile.matchAll(/^ {2}'@img\/sharp-libvips-[\w-]+@([^']+)':$/gm)].map((m) => m[1]!),
  );
  if (versions.size !== 1) {
    throw new Error(`expected one @img/sharp-libvips-* version, found [${[...versions]}]`);
  }
  const [packageVersion] = [...versions] as [string];
  for (const arch of ["x64", "arm64"]) {
    expect(lockfile).toContain(`'@img/sharp-libvips-linux-${arch}@${packageVersion}':`);
  }
  const store = `${ROOT}node_modules/.pnpm`;
  const installed = readdirSync(store).filter(
    (dir) => dir.startsWith("@img+sharp-libvips-") && dir.endsWith(`@${packageVersion}`),
  );
  const libvips = new Set(
    installed.map((dir) => {
      const name = dir.slice(0, dir.lastIndexOf("@")).replace("+", "/");
      const path = `${store}/${dir}/node_modules/${name}/versions.json`;
      return (JSON.parse(readFileSync(path, "utf8")) as { vips: string }).vips;
    }),
  );
  if (libvips.size !== 1) {
    throw new Error(`expected one installed libvips version, found [${[...libvips]}]`);
  }
  return { packageVersion, libvips: [...libvips][0]! };
}

const NOTICES = read("deploy/third-party/README.md");

/** The `## <heading>…` section of the third-party notice, up to the next `## ` heading. */
function noticeSection(heading: string): string {
  const sections = NOTICES.split(/^(?=## )/m).filter((section) =>
    section.startsWith(`## ${heading}`),
  );
  if (sections.length !== 1) {
    throw new Error(`expected one "## ${heading}" section, found ${sections.length}`);
  }
  return sections[0]!;
}

/**
 * libvips ships in the image as its own shared library, under LGPL-3.0-or-later. Reads TEXT: it
 * proves the files exist and the Dockerfile names them, not that the built image holds them — the
 * image-smoke step below is what looks inside the image.
 */
describe("the box image carries libvips's licence, its notices and a written source offer", () => {
  it("copies the licence texts, the offer and the libvips package's notices into /app/third-party", () => {
    expect(DOCKERFILE).toContain("/src/deploy/third-party/ /app/third-party/");
    expect(DOCKERFILE).toContain("/third-party/libvips/ /app/third-party/libvips/");
    expect(DOCKERFILE).toContain('cp "$1/README.md" /third-party/libvips/NOTICES.md');
    expect(IMAGE_SMOKE).toContain("/app/third-party/libvips/NOTICES.md");
  });

  it("holds both licence texts, and an offer naming libvips's version and where to ask", () => {
    const lgpl = read("deploy/third-party/licenses/LGPL-3.0.txt");
    expect(lgpl).toContain("GNU LESSER GENERAL PUBLIC LICENSE");
    expect(lgpl).toContain("Version 3, 29 June 2007");
    expect(read("deploy/third-party/licenses/GPL-3.0.txt")).toContain("GNU GENERAL PUBLIC LICENSE");
    const offer = noticeSection("libvips");
    const { packageVersion, libvips } = libvipsRelease();
    expect(offer).toContain(`libvips ${libvips}`);
    expect(offer).toContain(`libvips-cpp.so.${libvips}`);
    expect(offer).toContain(packageVersion);
    // Every version the section names is one of those two, so a stale one anywhere in it fails.
    expect(new Set(offer.match(/\b\d+\.\d+\.\d+\b/g))).toEqual(new Set([libvips, packageVersion]));
    expect(offer).toContain("info@waitron.io");
    // GPL-3.0 §6(b)'s term for a physical product, and §6(d)'s directions for a download.
    expect(offer).toMatch(/at least three years/);
    expect(offer).toMatch(/spare parts or customer support/);
    expect(offer).toMatch(/container registry/);
  });
});

/**
 * Litestream ships in the image as its own program, under Apache-2.0. Reads TEXT, like the libvips
 * block: it ties the notice's version to the pin `packages/stream` exports and proves the files and
 * the image-smoke step exist, not that the licence text is the one at the tag or that the built
 * image holds it — the image-smoke step is what looks inside the image.
 */
describe("the box image carries Litestream's licence and a notice naming the pinned version", () => {
  const PIN_LINE = /^export const LITESTREAM_VERSION = "([0-9.]+)";$/m;
  const pinned = read("packages/stream/src/litestream.ts").match(PIN_LINE)?.[1];

  it("names the pinned version, and only that one, in its section of the notice", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    const section = noticeSection("Litestream");
    expect(section).toContain(`Litestream ${pinned}`);
    expect(section).toContain(`\`v${pinned}\``);
    expect(new Set(section.match(/\b\d+\.\d+\.\d+\b/g))).toEqual(new Set([pinned]));
    expect(section).toMatch(/Apache License,\s+Version 2\.0/);
    expect(section).toContain("`licenses/Apache-2.0.txt`");
  });

  it("names no version in the notice but libvips's and Litestream's", () => {
    const { packageVersion, libvips } = libvipsRelease();
    expect(new Set(NOTICES.match(/\b\d+\.\d+\.\d+\b/g))).toEqual(
      new Set([libvips, packageVersion, pinned]),
    );
  });

  // The header line is the only thing that ties the notice file to a version, so a pin moved
  // without rerunning scripts/litestream-notices.mjs fails here; the module list under it is not
  // compared with the binary.
  it("ships the notices of what the binary bundles, generated for the pinned version", () => {
    const bundled = read("deploy/third-party/litestream/NOTICES.txt");
    expect(bundled.match(/^Litestream version: ([0-9.]+)$/gm)).toEqual([
      `Litestream version: ${pinned}`,
    ]);
    expect(noticeSection("Litestream")).toContain("`litestream/NOTICES.txt`");
    expect(IMAGE_SMOKE).toContain(
      'grep -qx "Litestream version: $pinned" /app/third-party/litestream/NOTICES.txt',
    );
  });

  it("holds the Apache License 2.0 text", () => {
    const apache = read("deploy/third-party/licenses/Apache-2.0.txt");
    expect(apache).toContain("Apache License");
    expect(apache).toContain("Version 2.0, January 2004");
    expect(apache).toContain("END OF TERMS AND CONDITIONS");
  });

  it("copies the binary into the runtime image, and image-smoke runs it against the pin", () => {
    expect(DOCKERFILE).toContain(
      "COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream",
    );
    // The step reads the pin with this sed expression, so it must be the one that matches above.
    expect(IMAGE_SMOKE).toContain(
      `sed -nE 's/${PIN_LINE.source}/\\1/p' packages/stream/src/litestream.ts`,
    );
    expect(IMAGE_SMOKE).toContain('reported=$(docker exec "$app" litestream version)');
    expect(IMAGE_SMOKE).toContain('[ "$reported" = "$pinned" ]');
    expect(IMAGE_SMOKE).toContain("test -s /app/third-party/licenses/Apache-2.0.txt");
  });
});
