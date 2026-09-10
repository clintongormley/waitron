import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { AppError } from "@waitron/shared";
import { createErrorBoundary } from "@waitron/server-kit";
import "./errors.js";
import { createRotatingFileSink } from "./log-file.js";
import { createLogger } from "./logger.js";
import { FRESH, afterFailure, type RecoveryState } from "./recovery-state.js";
import { GENERIC_TEXT, OPERATOR_TEXT, escapeHtml, recoveryApp } from "./recovery-surface.js";

const state = afterFailure(
  afterFailure(afterFailure(FRESH, "module.config_invalid", new Date()), "x", new Date()),
  "module.config_invalid",
  new Date(),
);

describe("recoveryApp", () => {
  it("states the count and the last error on the page", async () => {
    const app = recoveryApp({
      state,
      logDir: await mkdtemp(join(tmpdir(), "wt-log-")),
      onRetry: vi.fn(),
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("module.config_invalid");
    // NOT `toContain("3")`: the page also renders an ISO timestamp, which contains a 3 most of the
    // time, so that would pass with the count omitted entirely.
    expect(body).toMatch(/failed 3 times|3 consecutive/i);
  });

  it("serves exactly the same facts as JSON — no extra field leaks", async () => {
    const app = recoveryApp({
      state,
      logDir: await mkdtemp(join(tmpdir(), "wt-log-")),
      onRetry: vi.fn(),
    });
    const res = await app.request("/recovery-api/status");
    // toEqual, not toMatchObject: an unlisted key is never checked, and this route must not leak a
    // log path or a raw error message (CLAUDE.md §4).
    expect(await res.json()).toEqual({
      failures: 3,
      level: "recovery",
      lastErrorCode: "module.config_invalid",
      lastFailureAt: state.lastFailureAt,
    });
  });

  it("retry resets the counter and asks for a normal boot", async () => {
    const onRetry = vi.fn(() => Promise.resolve());
    const app = recoveryApp({
      state,
      logDir: await mkdtemp(join(tmpdir(), "wt-log-")),
      onRetry,
    });
    expect((await app.request("/recovery-api/retry", { method: "POST" })).status).toBe(200);
    expect(onRetry).toHaveBeenCalledWith("normal");
  });

  it("shows the log tail, and tolerates no log at all", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "wt-log-"));
    await writeFile(join(logDir, "waitron.log"), "line-one\nline-two\n");
    const app = recoveryApp({ state, logDir, onRetry: vi.fn() });
    expect(await (await app.request("/")).text()).toContain("line-two");
    const empty = recoveryApp({
      state,
      logDir: await mkdtemp(join(tmpdir(), "wt-log-")),
      onRetry: vi.fn(),
    });
    expect((await empty.request("/")).status).toBe(200);
  });

  it("escapes an attacker-influenceable error code into the page — not raw HTML", async () => {
    const xssState: RecoveryState = {
      failures: 1,
      level: "normal",
      lastErrorCode: `<script>alert(1)</script>"'&`,
      lastFailureAt: new Date().toISOString(),
    };
    const app = recoveryApp({
      state: xssState,
      logDir: await mkdtemp(join(tmpdir(), "wt-log-")),
      onRetry: vi.fn(),
    });
    const body = await (await app.request("/")).text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;");
  });

  it("escapes an attacker-influenceable log line into the page — not raw HTML", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "wt-log-"));
    await writeFile(join(logDir, "waitron.log"), `<img src=x onerror="alert(1)">\n`);
    const app = recoveryApp({ state, logDir, onRetry: vi.fn() });
    const body = await (await app.request("/")).text();
    expect(body).not.toContain('<img src=x onerror="alert(1)">');
    expect(body).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

/**
 * What the log tail actually carries, run rather than reasoned about. Every piece below is the real
 * one — the shared error boundary, this process's logger, the rotating sink and the page — so what
 * it renders is what a box renders.
 *
 * It exists because `OPERATOR_TEXT`'s header used to claim that no params could reach the page. They
 * can: the boundary logs `{ ...cause.params }` into the very file the page tails
 * (`packages/server-kit/src/error-boundary.ts`). The design is unchanged and still sound (spec §5
 * names the tail as a second attacker-influenceable channel) — what keeps a SECRET off this
 * unauthenticated page is the repo's convention that an `AppError`'s params never carry one
 * (`apps/server/src/errors.ts`), not the page. This test is that claim's receipt.
 */
describe("the log tail as a second channel out of the image", () => {
  it("renders an AppError's params, escaped, after the real error boundary logs them", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "wt-log-"));
    const log = createLogger(
      createRotatingFileSink({ dir: logDir, maxBytes: 1_000_000, maxFiles: 2 }),
      () => new Date(),
    );
    const run = createErrorBoundary({ "server.config_invalid": 400 }, "probe.failed");
    const api = new Hono();
    api.get("/boom", (c) =>
      run(c, log, () => {
        // A param that is NOT a secret — the convention holds here, deliberately. The point is the
        // channel, not a leak: this value travels the same route a secret param would.
        throw new AppError("server.config_invalid", {
          variable: "WAITRON_PROBE",
          reason: "<param-from-outside-the-image>",
        });
      }),
    );
    expect((await api.request("/boom")).status).toBe(400);

    const body = await (await recoveryApp({ state, logDir, onRetry: vi.fn() }).request("/")).text();
    expect(body).toContain("WAITRON_PROBE");
    // Present on the page, and escaped — both halves matter. Escaped-only would pass with the tail
    // omitted entirely; present-only would pass with the tail rendered as raw HTML.
    expect(body).toContain("&lt;param-from-outside-the-image&gt;");
    expect(body).not.toContain("<param-from-outside-the-image>");

    // The control, in the other direction: the same state with no log to tail carries neither, so
    // the assertions above are reading the TAIL and not some other part of the page.
    const withoutLog = await (
      await recoveryApp({ state, logDir: "/nonexistent", onRetry: vi.fn() }).request("/")
    ).text();
    expect(withoutLog).not.toContain("WAITRON_PROBE");
  });
});

/** The page as an operator sees it, for one recorded failure code. */
async function pageFor(lastErrorCode: string | null): Promise<string> {
  const app = recoveryApp({
    state: {
      failures: 3,
      level: "recovery",
      lastErrorCode,
      lastFailureAt: new Date().toISOString(),
    },
    logDir: "/nonexistent",
    onRetry: vi.fn(),
  });
  return await (await app.request("/")).text();
}

describe("curated operator text", () => {
  // Compared through `escapeHtml`, because that is what the page renders: every curated string is
  // escaped like any other interpolation, so a title carrying an apostrophe reaches the page as
  // `&#39;`. Using the module's own function rather than a second copy of the rule here.
  it("renders the title and action for every code in the table", async () => {
    for (const [code, text] of Object.entries(OPERATOR_TEXT)) {
      const body = await pageFor(code);
      expect(body).toContain(escapeHtml(text.title));
      expect(body).toContain(escapeHtml(text.action));
    }
  });

  it("tells the operator of an ahead database to restore or reinstall — never to wipe", async () => {
    const body = await pageFor("provisioning.database_ahead");
    expect(body).toMatch(/restore it from a backup, or reinstall/i);
    expect(body).not.toMatch(/\bwipe\b|\berase\b|\bdelete the database\b/i);
  });

  // "Restore it from a backup, or reinstall" is not an action for the reader this page has: a
  // restaurant operator with no terminal, usually no backup and no installer. Every action that says
  // it must also name the person who can do it, or the page stops being actionable exactly where the
  // failure is worst.
  it("points an operator with no backup at whoever installed the box", () => {
    const restoreActions = Object.entries(OPERATOR_TEXT).filter(([, text]) =>
      /restore it from a backup, or reinstall/i.test(text.action),
    );
    expect(restoreActions.length).toBeGreaterThan(0);
    for (const [code, text] of restoreActions) {
      expect(text.action, `${code} offers a restore with no fallback`).toMatch(
        /ask whoever installed this box/i,
      );
    }
  });

  // The CONVERSE of the test above. Its scope is the ENTRYPOINT's OWN vocabulary — the codes
  // `classifyBootFailure` produces and the codes `runEntry` throws before `startServer` — and it is
  // NOT every code that can reach the page: the entrypoint persists `classifyBootFailure(error)` for
  // any error out of `startServer`, so the whole of `boot.ts` lands here, and
  // `provisioning.replication_not_ready`, `sync.subscription_failed` and the `credentials.*` family
  // do fall to the generic line. The name says "the entrypoint" for that reason.
  //
  // `deployment.environment_mismatch` is listed by hand as the one exception, because it is the
  // `boot.ts` code a generic line fails worst: a box running against the OTHER environment's
  // database is CLAUDE.md §5 territory (a pre-production sale burns a hole in the production
  // series), and "Waitron could not start." would leave its operator pressing Retry.
  it("has an entry for every code the entrypoint itself classifies or throws", () => {
    const classified = [
      "provisioning.database_unreachable",
      "provisioning.schema_mismatch",
      "unknown",
    ];
    const thrownByRunEntry = [
      "server.config_missing",
      "provisioning.admin_uri_not_a_url",
      "provisioning.database_ahead",
      "migrations.set_missing",
      "migrations.incomplete",
      "server.boot_incomplete",
    ];
    const fromBootByHand = ["deployment.environment_mismatch"];
    const missing = [...classified, ...thrownByRunEntry, ...fromBootByHand].filter(
      (code) => code !== "unknown" && !(code in OPERATOR_TEXT),
    );
    expect(missing).toEqual([]);
  });

  // `classifyBootFailure` returns `provisioning.database_unreachable` for three different causes: the
  // bounded connection wait timing out, and the SQLSTATEs `28P01` (wrong password) and `3D000` (no
  // such database) (`boot-failure.ts`, `UNREACHABLE_SQL_STATES`). Restarting a box cannot change a
  // password or create a database, so an action that ends at "restart the box" is advice that cannot
  // work for two of the three. Both halves are asserted: the retry that DOES fix the transient cause,
  // and the person who can fix the other two.
  it("offers a database_unreachable both a retry and the person a restart cannot replace", () => {
    const text = OPERATOR_TEXT["provisioning.database_unreachable"];
    expect(text).toBeDefined();
    expect(text!.action).toMatch(/retry/i);
    expect(text!.action).toMatch(/ask whoever installed this box/i);
  });

  // A cold restore RUNS the migrations (`apps/server/src/restore.ts` → `applyMigrations`), so a
  // restore is one of the things that can raise `migrations.incomplete` in the first place. Telling
  // an operator whose backup is from the failing release point to restore is a loop with no exit,
  // and this page is the only instruction they get.
  it("does not answer a partly-updated database with the restore that can raise it", () => {
    const text = OPERATOR_TEXT["migrations.incomplete"];
    expect(text).toBeDefined();
    expect(text!.action).not.toMatch(/restore it from a backup, or reinstall/i);
    expect(text!.action).toMatch(/ask whoever installed this box/i);
  });

  // The generic line used to promise the reason had been written where the installer could read it.
  // `runEntry` writes it from ONE try/catch, and `readRecoveryState` and the pre-boot counter write
  // both run before that block — the counter write deliberately allowed to throw — so a failed state
  // volume escapes to the outer handler, which logs `server.boot_failed { errorCode }` and no detail
  // at all. The page must not promise what that path does not deliver.
  it("does not promise the generic failure's reason was written down anywhere", () => {
    expect(GENERIC_TEXT.action).not.toMatch(/read the reason/i);
    expect(GENERIC_TEXT.action).toMatch(/ask whoever installed this box/i);
  });

  it("renders the generic line for a code it does not know, without throwing", async () => {
    const body = await pageFor("some.code.invented.later");
    expect(body).toContain(GENERIC_TEXT.title);
    expect(body).toContain(GENERIC_TEXT.action);
  });

  it("renders the generic line when no failure has been recorded at all", async () => {
    const body = await pageFor(null);
    expect(body).toContain(GENERIC_TEXT.title);
  });

  // The code is read from a file on the box and treated as attacker-influenceable, and a plain
  // object literal inherits `Object.prototype` — so a lookup keyed on "toString" or "constructor"
  // finds a FUNCTION, which `?? GENERIC_TEXT` does not catch and whose `.title` is undefined. The
  // page must still render the generic line rather than throwing or printing "undefined".
  it("renders the generic line for an inherited property name, not a prototype value", async () => {
    for (const code of ["toString", "constructor", "__proto__", "valueOf"]) {
      const body = await pageFor(code);
      expect(body).toContain(GENERIC_TEXT.title);
      expect(body).not.toContain("undefined");
    }
  });
});
