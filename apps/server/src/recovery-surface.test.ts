import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
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

  // The CONVERSE of the test above, and the one that matters: every code the entrypoint can
  // actually persist must have an entry. Without it the table can rot into uselessness one new code
  // at a time, each falling silently to the generic line — which is what `unknown` did to the first
  // real box's operator.
  it("has an entry for every code the entrypoint can classify or throw", () => {
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
    const missing = [...classified, ...thrownByRunEntry].filter(
      (code) => code !== "unknown" && !(code in OPERATOR_TEXT),
    );
    expect(missing).toEqual([]);
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
