import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/server/src/config.js";
import { esbuildArgs } from "./bundle-node.mjs";
import { workspaceMembers } from "./workspace-members.mjs";

/**
 * The container image's environment, checked against the server that has to boot on it.
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
// Declared under `waitron.commands` rather than `bin`; see scripts/manifest-commands.test.ts.
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

/** Each `dbus` rule of an AppArmor profile that allows rather than denies, from its keyword to the
 * comma that ends it; a comma inside `( )` or `{ }` does not. A rule is found where it begins a
 * line or follows a `,` or `{` on one. Comments are dropped first. */
function dbusAllowRules(profile: string): string[] {
  const text = profile.replace(/#.*$/gm, "");
  const rules: string[] = [];
  for (const start of text.matchAll(/(?:^|[,{])[ \t]*((?:(?:audit|allow|deny)\s+)*)dbus\b/gm)) {
    const from = start.index + start[0].length - start[1]!.length - "dbus".length;
    let depth = 0;
    let end = -1;
    for (let i = start.index + start[0].length; i < text.length && end < 0; i += 1) {
      const c = text[i];
      if (c === "(" || c === "{") depth += 1;
      else if (c === ")" || c === "}") depth -= 1;
      else if (c === "," && depth === 0) end = i;
    }
    if (end < 0) throw new Error(`unterminated dbus rule at offset ${from}`);
    if (!/\bdeny\b/.test(start[1]!)) rules.push(text.slice(from, end + 1));
  }
  return rules;
}

const BUS_NAME = String.raw`[A-Za-z_][\w.]*`;
const LITERAL_BUS_NAMES = new RegExp(`^(?:${BUS_NAME}|\\{${BUS_NAME}(?:,${BUS_NAME})*\\})$`);

/** Which of a rule's `interface=` and `member=` are missing, or not a literal name or `{a,b}` list
 * of them — any other value is a glob. */
function unnamedBusFields(rule: string): string[] {
  return ["interface", "member"].filter((key) => {
    const value = new RegExp(`(?:^|[\\s(,])${key}=("[^"]*"|\\{[^}]*\\}|[^\\s,)]+)`).exec(rule)?.[1];
    return value === undefined || !LITERAL_BUS_NAMES.test(value.replace(/^"(.*)"$/, "$1"));
  });
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
    // An empty declaration would satisfy the loop below without checking anything.
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

  it("ships the Bluetooth sender beside the agent's bundle, with a python3 to run it", () => {
    // The transport finds the script beside the module that loads it (apps/print-agent/src/rfcomm.ts),
    // so the package's own build puts it beside the bundle and the image copies that pair.
    const manifest = JSON.parse(read("apps/print-agent/package.json")) as {
      scripts: { build: string };
    };
    expect(manifest.scripts.build).toContain("cp src/rfcomm-send.py dist/rfcomm-send.py");
    expect(DOCKERFILE).toContain(
      "COPY --from=build --chown=node:node /src/apps/print-agent/dist/rfcomm-send.py /app/rfcomm-send.py",
    );
    expect(DOCKERFILE).toContain("apt-get install -y --no-install-recommends python3-minimal");
  });

  it("runs the agent as an on-by-default compose service with the measured USB shape", () => {
    expect(COMPOSE).toContain("print-agent:");
    expect(COMPOSE).toContain(
      "image: ${WAITRON_PRINT_AGENT_IMAGE:-ghcr.io/clintongormley/waitron-print-agent:main}",
    );
    // The hot-plug-safe device shape, so a subdirectory mount or a hard `devices:` line fails here.
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

  it("runs the agent under the AppArmor profile waitron.sh loads, else under Docker's default", () => {
    const agent = only(
      COMPOSE,
      /\n {2}print-agent:([\s\S]*?)(?=\n(?: {2}[a-zA-Z][\w-]*:|[a-zA-Z])|$)/,
      "print-agent service",
    );
    expect(agent).toMatch(/^ {6}- "apparmor=\$\{WAITRON_PRINT_AGENT_APPARMOR:-docker-default\}"$/m);
    expect(read("deploy/apparmor/waitron-print-agent")).toMatch(/^profile waitron-print-agent /m);
    expect(WAITRON_SH).toContain("/deploy/apparmor/waitron-print-agent");
    expect(WAITRON_SH).toContain("env_set WAITRON_PRINT_AGENT_APPARMOR waitron-print-agent");
  });

  // Reads the profile as TEXT: it catches an allowing D-Bus rule whose interface or members are
  // missing or a glob, not a literal list that has grown.
  it("names the interface and methods of every D-Bus rule the agent's profile allows, with no glob", () => {
    const rules = dbusAllowRules(read("deploy/apparmor/waitron-print-agent"));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(unnamedBusFields(rule), rule).toEqual([]);
  });

  it("reads a D-Bus rule to its own closing comma, not to a comma inside ( ) or { }", () => {
    const profile = `  dbus (send, receive) bus=system interface=org.bluez.Adapter1
       member={StartDiscovery,StopDiscovery} peer=(name=org.bluez, label=unconfined),
  deny dbus send interface=org.bluez.* member=*,
  # dbus send member=*,
  audit dbus receive interface=org.bluez.Device1 member=*,`;
    expect(dbusAllowRules(profile)).toEqual([
      `dbus (send, receive) bus=system interface=org.bluez.Adapter1
       member={StartDiscovery,StopDiscovery} peer=(name=org.bluez, label=unconfined),`,
      "audit dbus receive interface=org.bluez.Device1 member=*,",
    ]);
    expect(unnamedBusFields(dbusAllowRules(profile)[0]!)).toEqual([]);
  });

  it("finds a D-Bus rule that follows a , or { on the same line, not only one that begins it", () => {
    const profile = `  deny mount, dbus send bus=system interface=org.bluez.* member=*,
  profile inner { audit dbus receive interface=org.bluez.Device1 member=*, }`;
    expect(dbusAllowRules(profile)).toEqual([
      "dbus send bus=system interface=org.bluez.* member=*,",
      "audit dbus receive interface=org.bluez.Device1 member=*,",
    ]);
  });

  it("refuses a member or interface that is missing or a glob, and leaves the path alone", () => {
    const rule = (fields: string) => `dbus send bus=system path=/org/bluez/** ${fields},`;
    expect(unnamedBusFields(rule("interface=org.bluez.Adapter1 member=StartDiscovery"))).toEqual(
      [],
    );
    expect(unnamedBusFields(rule('interface="org.bluez.Adapter1" member={A,B}'))).toEqual([]);
    expect(unnamedBusFields(rule("interface=org.bluez.Adapter1 member=*"))).toEqual(["member"]);
    expect(unnamedBusFields(rule("interface=org.bluez.* member=StartDiscovery"))).toEqual([
      "interface",
    ]);
    expect(unnamedBusFields(rule("interface=org.bluez.Adapter1 member={Start*,Stop}"))).toEqual([
      "member",
    ]);
    expect(unnamedBusFields(rule("interface=org.bluez.Adapter? member=[SG]et"))).toEqual([
      "interface",
      "member",
    ]);
    expect(unnamedBusFields(rule("member=StartDiscovery"))).toEqual(["interface"]);
  });

  it("smokes the agent's Bluetooth sender under that profile", () => {
    expect(IMAGE_SMOKE).toContain("python3 /app/rfcomm-send.py 66:55:44:33:22:11 1 5");
    expect(IMAGE_SMOKE).toContain("[Errno 13]");
  });

  it("smokes the agent under that profile against a stand-in BlueZ, with docker-default as the control", () => {
    expect(IMAGE_SMOKE).toContain("apparmor_parser -r deploy/apparmor/waitron-print-agent");
    expect(IMAGE_SMOKE).toContain('echo "WAITRON_PRINT_AGENT_APPARMOR=waitron-print-agent"');
    expect(IMAGE_SMOKE).toContain("scripts/fake-bluez.py");
    expect(IMAGE_SMOKE).toContain('echo "scan off"');
    expect(IMAGE_SMOKE).toContain("node /tmp/bluetoothctl-pair.mjs 86:67:7A:00:00:01 1234");
    expect(IMAGE_SMOKE).toContain("fake bluez: Disconnected /org/bluez/hci0/dev_86_67_7A_00_00_01");
    expect(IMAGE_SMOKE).toContain("bluetoothctl remove 86:67:7A:00:00:01");
    expect(IMAGE_SMOKE).toContain("bluetoothctl trust 66:55:44:33:22:11");
    expect(IMAGE_SMOKE).toContain("--security-opt apparmor=docker-default");
    expect(IMAGE_SMOKE).toContain("jq -e '.bluetooth.available == true' status.json");
  });

  it("has retired the standalone agent Dockerfile", () => {
    // One image definition. A resurrected file would build a second, drifting image.
    expect(() => read("apps/print-agent/Dockerfile")).toThrow();
  });

  it("smokes the print-agent target it ships", () => {
    expect(IMAGE_SMOKE).toContain("target: print-agent");
  });
});

/**
 * What each `RUN` in a Dockerfile that mentions `apt-get` misses of the bounded-wait shape: apt's
 * own read timeouts and `APT::Update::Error-Mode "any"` (so an update that cannot fetch exits
 * non-zero and is retried) written to a file under /etc/apt/apt.conf.d/, a `bounded()` wrapper
 * that runs `"$@"` under `timeout <n>`, every `apt-get update` and `apt-get install` called
 * through it, and the file removed again so the image ships no apt setting. Reads TEXT: it does
 * not check that `bounded()` retries, run the shell, judge the numbers, or see apt reached any
 * other way (`apt`, a script).
 */
function aptRunGaps(dockerfile: string): { runs: number; gaps: string[] } {
  const runs = dockerfile
    .replace(/\\\n/g, " ")
    .split("\n")
    .filter((line) => /^RUN\s/.test(line) && line.includes("apt-get"));
  const gaps = runs.flatMap((run, index) => {
    const where = `RUN ${index + 1} with apt-get`;
    const missing: string[] = [];
    const config = /> *(\/etc\/apt\/apt\.conf\.d\/\S+?);/.exec(run)?.[1];
    if (
      config === undefined ||
      !run.includes("Acquire::http::Timeout") ||
      !run.includes("Acquire::https::Timeout")
    ) {
      missing.push(`${where}: writes no http and https read timeout under /etc/apt/apt.conf.d/`);
    } else if (
      !new RegExp(
        `\\brm\\s+-rf\\b[^;]*\\s${config.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|;|$)`,
      ).test(run)
    ) {
      missing.push(`${where}: does not remove ${config}`);
    }
    if (config === undefined || !run.includes(`'APT::Update::Error-Mode "any";'`)) {
      missing.push(`${where}: writes no APT::Update::Error-Mode "any" under /etc/apt/apt.conf.d/`);
    }
    if (!/\bbounded\(\)\s*\{[^}]*\btimeout\s+\d+\s+"\$@"/.test(run)) {
      missing.push(`${where}: defines no bounded() that runs each attempt under timeout <n>`);
    }
    for (const call of run.matchAll(/\bapt-get(?:\s+-\S+)*\s+(?:update|install)\b/g)) {
      if (!/\bbounded\s+$/.test(run.slice(0, call.index))) {
        missing.push(`${where}: \`${call[0]}\` is not called through bounded`);
      }
    }
    return missing;
  });
  return { runs: runs.length, gaps };
}

describe("the Dockerfile's apt waits", () => {
  const bounded =
    "RUN set -eux; \\\n" +
    "  printf '%s\\n' 'Acquire::Retries \"3\";' 'Acquire::http::Timeout \"30\";' 'Acquire::https::Timeout \"30\";' 'APT::Update::Error-Mode \"any\";' \\\n" +
    "    > /etc/apt/apt.conf.d/99bounded-waits; \\\n" +
    '  bounded() { for attempt in 1 2 3; do timeout 300 "$@" && return 0; done; return 1; }; \\\n' +
    "  bounded apt-get update; \\\n" +
    "  bounded apt-get install -y --no-install-recommends bluez; \\\n" +
    "  rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99bounded-waits\n";

  it("passes a RUN in the bounded shape, and skips a RUN with no apt-get", () => {
    expect(aptRunGaps(`FROM x\n${bounded}RUN echo hi\n`)).toEqual({ runs: 1, gaps: [] });
  });

  it.each([
    [
      "an apt-get not called through bounded",
      bounded.replace("bounded apt-get update", "apt-get update"),
      "RUN 1 with apt-get: `apt-get update` is not called through bounded",
    ],
    [
      "a bounded() with no timeout",
      bounded.replace("timeout 300 ", ""),
      "RUN 1 with apt-get: defines no bounded() that runs each attempt under timeout <n>",
    ],
    [
      "no https read timeout",
      bounded.replace(" 'Acquire::https::Timeout \"30\";'", ""),
      "RUN 1 with apt-get: writes no http and https read timeout under /etc/apt/apt.conf.d/",
    ],
    [
      "an update that cannot fetch still exiting 0",
      bounded.replace(" 'APT::Update::Error-Mode \"any\";'", ""),
      'RUN 1 with apt-get: writes no APT::Update::Error-Mode "any" under /etc/apt/apt.conf.d/',
    ],
    [
      "a config left in the image",
      bounded.replace(" /etc/apt/apt.conf.d/99bounded-waits\n", "\n"),
      "RUN 1 with apt-get: does not remove /etc/apt/apt.conf.d/99bounded-waits",
    ],
  ])("reports %s", (_shape, dockerfile, gap) => {
    expect(aptRunGaps(dockerfile).gaps).toEqual([gap]);
  });

  it("bounds every apt-get wait in deploy/Dockerfile", () => {
    const { runs, gaps } = aptRunGaps(DOCKERFILE);
    expect(runs, "expected both stages' apt-get RUNs to still be here").toBeGreaterThanOrEqual(2);
    expect(
      gaps,
      "apt's own read timeout did not end a wait on a mirror sending a byte every 5 s, so each " +
        "apt-get on a box's link runs " +
        'through bounded() (docs/developers/ci-and-gates.md, "Every apt wait is bounded")',
    ).toEqual([]);
  });

  it("bounds the apt-get wait in the bench's CA probe image", () => {
    const body = only(
      read("bench/sqlite-failover/src/probes/linux-binaries.ts"),
      /const CA_DOCKERFILE = \[\n([\s\S]*?)\n\]\.join\("\\n"\);/,
      "CA_DOCKERFILE array",
    );
    const lines = [...body.matchAll(/^\s*`((?:[^`\\]|\\.)*)`,?$/gm)].map((line) =>
      (line[1] ?? "").replace(/\\(.)/g, "$1"),
    );
    expect(lines.length, "expected CA_DOCKERFILE's template-literal lines").toBeGreaterThan(0);
    const { runs, gaps } = aptRunGaps(lines.join("\n"));
    expect(runs, "expected the CA probe's apt-get RUN to still be here").toBeGreaterThanOrEqual(1);
    expect(gaps).toEqual([]);
  });
});

/**
 * What a box script misses of the bounded apt shape: every `apt-get` runs inside `apt_get()`, whose
 * body runs each one under `"$limit" <n>` (a number or a `"$variable"`) in the same command, with
 * `limit` resolved from gtimeout or timeout. Reads TEXT: a `command -v apt-get` lookup, whole-line
 * comments and, inside the body, apt-get named within quotes are skipped, and it does not run the
 * shell, check the retries, or see apt reached any other way (`apt`, `eval`, a variable).
 */
function shAptGaps(script: string): string[] {
  const gaps: string[] = [];
  const lines = script.split("\n");
  const start = lines.findIndex((line) => /^apt_get\(\) \{$/.test(line));
  const end = start === -1 ? -1 : lines.indexOf("}", start);
  if (end === -1) return ["defines no multi-line apt_get() { … } function"];
  const commands: { line: number; text: string }[] = [];
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    const previous = commands.at(-1);
    if (previous?.text.endsWith("\\"))
      previous.text = `${previous.text.slice(0, -1).trimEnd()} ${line.trim()}`;
    else if (!/^\s*#/.test(line)) commands.push({ line: index + 1, text: line.trim() });
  }
  const body = commands.map((command) => command.text).join("\n");
  if (
    !/\blimit="\$\(command -v gtimeout \|\| command -v timeout\)"/.test(body) ||
    !/"\$limit"\s+(?:\d+|"\$\w+")\s[^\n]*\bapt-get\b/.test(body)
  ) {
    gaps.push('apt_get() does not run apt-get under "$limit" <n>, limit from gtimeout or timeout');
  }
  for (const { line, text } of commands) {
    const masked = text.replace(/"(?!\$\w+")[^"]*"|'[^']*'/g, '""');
    for (const call of masked.matchAll(/\bapt-get\b/g)) {
      const command =
        masked
          .slice(0, call.index)
          .split(/;|&&|\|\||\||(?<![<>&])&(?![&>])|\(|\{/)
          .at(-1) ?? "";
      if (!/"\$limit"\s+(?:\d+|"\$\w+")\s/.test(command)) {
        gaps.push(`line ${line} runs apt-get in apt_get() but not under "$limit" <n>: ${text}`);
      }
    }
  }
  lines.forEach((line, index) => {
    if ((index > start && index < end) || /^\s*#/.test(line)) return;
    if (/\bapt-get\b/.test(line.replaceAll("command -v apt-get", ""))) {
      gaps.push(`line ${index + 1} runs apt-get outside apt_get(): ${line.trim()}`);
    }
  });
  return gaps;
}

describe("waitron.sh's apt waits", () => {
  const script = [
    "# apt-get, in a comment",
    "apt_get() {",
    '  local limit; limit="$(command -v gtimeout || command -v timeout)" || die "need timeout"',
    '  as_root "$limit" 300 env apt-get \\',
    '    -o Acquire::Retries=3 "$@"',
    "}",
    "command -v apt-get >/dev/null && apt_get install -y qrencode",
  ].join("\n");

  it("passes a script whose only apt-get runs inside a bounded apt_get()", () => {
    expect(shAptGaps(script)).toEqual([]);
  });

  it("passes apt-get named only inside quotes in the body", () => {
    const quoted = script.replace(
      '"$@"\n}',
      '"$@" && return 0\n  echo "attempt failed: apt-get $*" >&2\n  die \'apt-get failed\'\n}',
    );
    expect(shAptGaps(quoted)).toEqual([]);
  });

  it.each([
    [
      "a direct apt-get call",
      `${script}\n  apt-get install -y curl`,
      ["line 8 runs apt-get outside apt_get(): apt-get install -y curl"],
    ],
    [
      "an apt_get() with no limit",
      script.replace('"$limit" 300 ', ""),
      [
        'apt_get() does not run apt-get under "$limit" <n>, limit from gtimeout or timeout',
        'line 4 runs apt-get in apt_get() but not under "$limit" <n>: as_root env apt-get ' +
          '-o Acquire::Retries=3 "$@"',
      ],
    ],
    [
      "an unbounded apt-get beside the bounded one",
      script.replace("  as_root", "  apt-get update\n  as_root"),
      ['line 4 runs apt-get in apt_get() but not under "$limit" <n>: apt-get update'],
    ],
    [
      "a second apt-get on the bounded call's line",
      script.replace('"$@"\n}', '"$@"; apt-get update\n}'),
      [
        'line 4 runs apt-get in apt_get() but not under "$limit" <n>: as_root "$limit" 300 env ' +
          'apt-get -o Acquire::Retries=3 "$@"; apt-get update',
      ],
    ],
    [
      "no apt_get() at all",
      script.replace("apt_get() {", "apt_get () {"),
      ["defines no multi-line apt_get() { … } function"],
    ],
  ])("reports %s", (_shape, fixture, gaps) => {
    expect(shAptGaps(fixture)).toEqual(gaps);
  });

  it("runs every apt-get in deploy/waitron.sh through the bounded apt_get()", () => {
    expect(
      shAptGaps(WAITRON_SH),
      'docs/developers/ci-and-gates.md, "Every apt wait is bounded"',
    ).toEqual([]);
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
  // case, so no behaviour anywhere would notice a typo. Closing braces are part of both patterns —
  // without them `:-5` matches `:-50` and `:-36` matches `:-360`.
  it("ships a health wait of 36 tries, five seconds apart", () => {
    expect(WAITRON_SH).toMatch(/WAITRON_SH_MAX_HEALTH_TRIES:-36\}/);
    expect(WAITRON_SH).toMatch(/WAITRON_SH_HEALTH_DELAY:-5\}/);
  });

  // `scripts/waitron-sh.test.mjs` points the drop-in inside each case's own directory, so no
  // behaviour there would notice a typo in the path a box gets.
  it("ships the Bluetooth drop-in to systemd's folder for bluetooth.service", () => {
    expect(WAITRON_SH).toContain(
      "WAITRON_SH_BLUETOOTH_DROPIN:-/etc/systemd/system/bluetooth.service.d/waitron-noautopair.conf}",
    );
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
  // holds no database credential. Pinned as absences because both are one line away from returning;
  // a `${POSTGRES_PASSWORD:?...}` interpolation makes compose refuse to read the file at all,
  // including for a `down`.
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
 * it. Keep it external so its native library stays beside the server bundle.
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
 * The libvips version is not in the lockfile, so it comes from the `versions.json` of the package
 * installed for THIS machine. That stands for the box's linux packages only because one
 * sharp-libvips release carries one libvips version on every platform. So the check needs that
 * release installed on the machine running it, and throws where none is.
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

describe("bundled npm notices in the two images", () => {
  it("copies the server and three web build notices into the app image", () => {
    for (const app of ["server", "till", "dashboard", "setup"]) {
      expect(DOCKERFILE).toContain(`/src/apps/${app}/dist/`);
      expect(DOCKERFILE).toContain(`/app/third-party/npm/${app}/`);
      expect(IMAGE_SMOKE).toContain(`/app/third-party/npm/${app}/`);
    }
  });

  it("copies the print-agent bundle notice into its own image", () => {
    expect(DOCKERFILE).toContain("/src/apps/print-agent/dist/print-agent.js.NOTICES.txt");
    expect(DOCKERFILE).toContain("/app/third-party/npm/print-agent/");
    expect(IMAGE_SMOKE).toContain("/app/third-party/npm/print-agent/");
  });
});

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
 * image holds it — the image-smoke step is what looks inside the image. It reads
 * `litestream/NOTICES.txt` as TEXT too, comparing its `Litestream version:` line with the pin and
 * never its module list with the binary.
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

  it("names no version in the notice but libvips's, Litestream's and Iosevka's", () => {
    const { packageVersion, libvips } = libvipsRelease();
    expect(new Set(NOTICES.match(/\b\d+\.\d+\.\d+\b/g))).toEqual(
      new Set([libvips, packageVersion, pinned, fontRelease()]),
    );
  });

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

const GLYPHS_SOURCE = read("packages/printing/src/glyphs.ts");

/** The Iosevka release the glyph table's generated header says its bitmaps were drawn from. */
function fontRelease(): string {
  const release = GLYPHS_SOURCE.match(
    /derived from Iosevka Term Bold, release (\d+\.\d+\.\d+)\./,
  )?.[1];
  if (release === undefined) throw new Error("glyphs.ts names no Iosevka release");
  return release;
}

/**
 * The server draws printed text from a table of glyph bitmaps derived from Iosevka Term Bold, under
 * the SIL Open Font License 1.1, so the image carries that licence. Reads TEXT: it ties the
 * licence's copyright line, the release and the font file's sha256 to the ones the generated
 * table's header names, and proves image-smoke looks for the file — not that the licence is the one
 * at the release tag, nor that the table was really generated from that font.
 */
describe("the box image carries the licence of the font printed text is drawn in", () => {
  const LICENCE = "deploy/third-party/iosevka/LICENSE.md";

  it("ships the SIL Open Font License with the copyright line the glyph table carries", () => {
    const licence = read(LICENCE);
    expect(licence).toContain("SIL Open Font License v1.1");
    expect(licence).toContain(
      "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
    );
    expect(licence).toContain("DISCLAIMER");
    const copyright = GLYPHS_SOURCE.match(/^\/\/ (Copyright \(c\) .+)$/m)?.[1];
    expect(copyright).toMatch(/Renzhi Li/);
    expect(licence).toContain(copyright);
    expect(GLYPHS_SOURCE).toContain("/app/third-party/iosevka/LICENSE.md");
  });

  it("records where the font came from, with the sha256 the glyph table names", () => {
    const provenance = read("deploy/third-party/iosevka/README.md");
    const sha256 = GLYPHS_SOURCE.match(/\(sha256 ([0-9a-f]{64})\)/)?.[1];
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance).toContain(sha256);
    expect(provenance).toContain(`v${fontRelease()}/PkgTTF-IosevkaTerm-${fontRelease()}.zip`);
    expect(provenance).toContain("packages/printing/scripts/build-glyph-table.mjs");
  });

  it("describes it in the notice, and image-smoke looks for it in the built image", () => {
    const section = noticeSection("Iosevka");
    expect(section).toContain(`Iosevka Term Bold, release ${fontRelease()}`);
    expect(section).toContain("`iosevka/LICENSE.md`");
    expect(section).toMatch(/SIL Open Font License,\s+Version 1\.1/);
    expect(IMAGE_SMOKE).toContain("test -s /app/third-party/iosevka/LICENSE.md");
  });
});

/**
 * The dashboard bundles Google Sans Medium for its Sign in with Google button, under the SIL Open
 * Font License 1.1. Reads TEXT and hashes the source file: it proves the notice and the licence file
 * name the font's copyright line, that the font file in the dashboard's source matches the SHA-256
 * the notice records, and that image-smoke looks for the licence — not that a build emits the font,
 * that the built image serves it, nor that the licence is the one Google publishes beside the font.
 */
describe("the box image carries the licence of the font the Google button is drawn in", () => {
  const COPYRIGHT =
    "Copyright 2025 The Google Sans Project Authors (https://github.com/googlefonts/googlesans)";

  it("ships the SIL Open Font License with Google Sans's copyright line", () => {
    const licence = read("deploy/third-party/google-sans/OFL.txt");
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(licence).toContain(COPYRIGHT);
  });

  it("describes it in the notice, and image-smoke looks for it in the built image", () => {
    const section = noticeSection("Google Sans");
    expect(section).toContain("`google-sans/OFL.txt`");
    expect(section.replace(/\s+/g, " ")).toContain(COPYRIGHT);
    expect(section).toMatch(/SIL Open Font License,\s+Version 1\.1/);
    expect(IMAGE_SMOKE).toContain("test -s /app/third-party/google-sans/OFL.txt");
  });

  it("the font file it describes is in the dashboard's source and matches the notice's SHA-256", () => {
    const font = readFileSync(`${ROOT}apps/dashboard/src/assets/google-sans-medium-latin.woff2`);
    expect(font.length).toBeGreaterThan(0);
    expect(noticeSection("Google Sans")).toContain(createHash("sha256").update(font).digest("hex"));
  });
});

/**
 * The dashboard's Google button draws Google's "G", a Google trademark, so the notice credits it.
 * Reads only the notice's TEXT — never the SVG, nor what the built image carries.
 */
describe("the notice credits Google's \"G\" as Google's trademark", () => {
  it("names Google's \"G\" on the dashboard's Google button as Google's trademark in the notice", () => {
    expect(noticeSection('Google "G" mark').replace(/\s+/g, " ")).toContain(
      'Google and the Google "G" logo are trademarks of Google LLC.',
    );
  });
});

/**
 * python3-minimal and what it pulls in ship in the print-agent image under Debian's own copyright
 * files. Reads TEXT: it proves the Dockerfile derives the list and copies the files and that
 * image-smoke looks for them, not that the list is complete — image-smoke is what looks inside the
 * image.
 */
describe("the print-agent image carries the copyright files of python3-minimal and what it pulls in", () => {
  const stage = DOCKERFILE.slice(
    DOCKERFILE.indexOf("AS print-agent"),
    DOCKERFILE.indexOf("\nFROM ", DOCKERFILE.indexOf("AS print-agent")),
  );

  it("installs python3-minimal on its own, before bluez, so the packages it adds can be listed", () => {
    const python = stage.indexOf("apt-get install -y --no-install-recommends python3-minimal;");
    const bluez = stage.indexOf("apt-get install -y --no-install-recommends bluez;");
    expect(python).toBeGreaterThan(stage.indexOf("> /tmp/base-packages"));
    expect(stage.indexOf("comm -13 /tmp/base-packages")).toBeGreaterThan(python);
    expect(bluez).toBeGreaterThan(stage.indexOf("comm -13 /tmp/base-packages"));
  });

  // A pipe reports only its last command's status, so a failed listing of the base would otherwise
  // leave the list empty and every installed package would be counted as pulled in.
  it("refuses an empty list of the base image's packages", () => {
    const listed = stage.indexOf("> /tmp/base-packages;");
    const guard = stage.indexOf("[ -s /tmp/base-packages ];");
    expect(guard).toBeGreaterThan(listed);
    expect(
      stage.indexOf("apt-get install -y --no-install-recommends python3-minimal;"),
    ).toBeGreaterThan(guard);
  });

  it("refuses a list without python3-minimal, and copies each listed package's copyright file", () => {
    expect(stage).toContain("grep -qx python3-minimal /tmp/python3-packages");
    expect(stage).toContain(
      'cp -L "/usr/share/doc/$pkg/copyright" "/app/third-party/python3-minimal/$pkg/copyright"',
    );
    expect(stage).toContain("/app/third-party/python3-minimal/PACKAGES.txt");
  });

  it("describes them in the notice, and image-smoke looks for them in the built image", () => {
    const section = noticeSection("The print agent's Python");
    expect(section).toContain("`/app/third-party/python3-minimal/`");
    expect(section).toContain("`PACKAGES.txt`");
    expect(IMAGE_SMOKE).toContain(
      "grep -q '^python3-minimal ' /app/third-party/python3-minimal/PACKAGES.txt",
    );
    expect(IMAGE_SMOKE).toContain(
      "test -s /app/third-party/python3-minimal/python3-minimal/copyright",
    );
  });
});

describe("the invoice renderer's bundled font", () => {
  it("ships the same font beside the bundle and records its licence and source hash", () => {
    const font = readFileSync(`${ROOT}apps/server/src/assets/invoice-noto-sans.ttf`);
    const provenance = read("deploy/third-party/noto-sans/README.md");
    expect(provenance).toContain(createHash("sha256").update(font).digest("hex"));
    expect(read("deploy/third-party/noto-sans/OFL.txt")).toContain(
      "SIL OPEN FONT LICENSE Version 1.1",
    );
    expect(DOCKERFILE).toContain("/src/apps/server/dist/assets/ /app/assets/");
    expect(IMAGE_SMOKE).toContain("test -s /app/assets/invoice-noto-sans.ttf");
    expect(IMAGE_SMOKE).toContain("test -s /app/third-party/noto-sans/OFL.txt");
    expect(read("apps/server/scripts/copy-migrations.mjs")).toContain('join(distDir, "assets")');
    expect(noticeSection("Noto Sans")).toContain("noto-sans/OFL.txt");
  });
});

describe("the invoice raster encoder's CUPS attribution", () => {
  it("ships the adapted raster source notices with the Apache licence", () => {
    const notices = read("deploy/third-party/cups-raster/NOTICES.txt");
    expect(notices).toContain("Copyright © 2020-2024 by OpenPrinting.");
    expect(notices).toContain("Copyright 2007-2019 by Apple Inc.");
    expect(notices).toContain("Copyright 1997-2006 by Easy Software Products.");
    expect(notices).toContain("Apache License");
    expect(read("deploy/third-party/licenses/Apache-2.0.txt")).toContain("Version 2.0");
    expect(noticeSection("CUPS raster encoding")).toContain("cups-raster/NOTICES.txt");
    expect(IMAGE_SMOKE).toContain("test -s /app/third-party/cups-raster/NOTICES.txt");
    expect(DOCKERFILE).toContain("/src/deploy/third-party/ /app/third-party/");
  });
});
