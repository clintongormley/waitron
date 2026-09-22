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
    expect(compose).toContain("image: axllent/mailpit:v1.31.1");
    expect(compose).toContain('"127.0.0.1:1025:1025"');
    expect(compose).toContain('"127.0.0.1:8025:8025"');
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
      expect(manifest.scripts[script]).toContain("docker compose up -d --wait db mailpit");
    },
  );

  it("can reset directly to a fresh onboarding target", () => {
    // The RESET itself is no longer a Compose concern: the dev venue is a directory on the host, so
    // `docker compose down -v` resets nothing and the server script owns the wipe
    // (`dev-setup.ts`'s `--reset`). What this case still holds is the route — this entry reaches
    // the onboarding reset and not the seeded one, which is the mix-up it was written for.
    expect(manifest.scripts["dev:reset:onboard"]).toContain(
      "pnpm --filter @waitron/server dev:reset:onboard",
    );
  });

  it("starts Mailpit with the shared database, never from the worktree-specific app process", () => {
    expect(compose).toContain("    depends_on:\n      - mailpit");
    expect(manifest.scripts.dev).not.toContain("docker compose");
  });
});
