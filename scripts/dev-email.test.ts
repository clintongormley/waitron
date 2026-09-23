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
    // The service KEY, not just the image: every dev script names `mailpit` on the command line, so
    // a renamed or removed key fails all four with "no such service" — a failure the image and port
    // lines below would not catch, since they stay right under any key.
    expect(compose).toMatch(/^ {2}mailpit:$/m);
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
      // A failure means this entry point stopped bringing the inbox up, so every invitation and
      // password reset it triggers goes to a refused SMTP port with nowhere to read it.
      expect(manifest.scripts[script]).toContain("docker compose up -d --wait mailpit");
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

  it("never starts Mailpit from the worktree-specific app process", () => {
    // `dev` runs per worktree, and Compose names its project after the directory, so a compose call
    // here would start a SECOND Mailpit per checkout, competing for the fixed 1025/8025 ports. The
    // setup entry points above are the only ones that may touch Compose.
    //
    // The half of this case that pinned the mechanism keeping Mailpit ONE container — the `db`
    // service's `depends_on: - mailpit` — went with that service; what enforces it now is
    // `COMPOSE_PROJECT_NAME=waitron`, set by `wa-wt` outside this repository, so nothing here can
    // assert it.
    expect(manifest.scripts.dev).not.toContain("docker compose");
  });
});
