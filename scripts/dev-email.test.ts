import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("development account email", () => {
  const compose = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("pins Mailpit and exposes SMTP plus its inbox only on loopback", () => {
    expect(compose).toContain("image: axllent/mailpit:v1.27.4");
    expect(compose).toContain('"127.0.0.1:1025:1025"');
    expect(compose).toContain('"127.0.0.1:8025:8025"');
  });

  it.each(["dev:setup", "dev:reset", "dev:onboard"])("starts Mailpit in %s", (script) => {
    expect(manifest.scripts[script]).toContain("docker compose up -d --wait db mailpit");
  });

  it("starts Mailpit with the shared database, never from the worktree-specific app process", () => {
    expect(compose).toContain("    depends_on:\n      - mailpit");
    expect(manifest.scripts.dev).not.toContain("docker compose");
  });
});
