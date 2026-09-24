import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("development account email", () => {
  const compose = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("declares the mailpit service, pinned, with SMTP and its inbox only on loopback", () => {
    // The service KEY, not just the image: every dev script names `mailpit`, and the image and port
    // lines below would stay right under a renamed key.
    expect(compose).toMatch(/^ {2}mailpit:$/m);
    expect(compose).toContain("image: axllent/mailpit:v1.31.1");
    expect(compose).toContain('"127.0.0.1:1025:1025"');
    expect(compose).toContain('"127.0.0.1:8025:8025"');
  });

  it("starts no database server for the dev stack, and needs no database secret", () => {
    // Pinned as absences: the mailpit case above still passes with a `db:` service pasted back in.
    expect(compose).not.toMatch(/^ {2}db:$/m);
    expect(compose).not.toContain("POSTGRES_PASSWORD");
    expect(compose).not.toContain("postgres");
    expect(compose).not.toContain("5432");
  });

  it("packages the same loopback-only capture service for installed nodes", () => {
    const installed = readFileSync(join(REPO_ROOT, "deploy/compose.yml"), "utf8");
    expect(installed).toContain("image: axllent/mailpit:v1.31.1");
    expect(installed).toContain('"127.0.0.1:1025:1025"');
    expect(installed).toContain('"127.0.0.1:8025:8025"');
    expect(installed).toContain("mailpit:/data");
  });

  it.each(["dev:setup", "dev:reset", "dev:onboard", "dev:reset:onboard"])(
    "starts Mailpit in %s",
    (script) => {
      expect(manifest.scripts[script]).toContain("docker compose up -d --wait mailpit");
    },
  );

  it("can reset directly to a fresh onboarding target", () => {
    expect(manifest.scripts["dev:reset:onboard"]).toContain(
      "pnpm --filter @waitron/server dev:reset:onboard",
    );
  });

  it("never starts Mailpit from the worktree-specific app process", () => {
    // `dev` runs per worktree, and Compose names its project after the directory, so a compose call
    // here would start a SECOND Mailpit per checkout, competing for the fixed 1025/8025 ports.
    // `COMPOSE_PROJECT_NAME=waitron`, set by `wa-wt` outside this repository, is not asserted here.
    expect(manifest.scripts.dev).not.toContain("docker compose");
  });
});
