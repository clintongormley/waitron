import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import type { StartedServer } from "./boot.js";
import { createContentSuggestionRunner } from "./content-suggestion-runner.js";
import { mountContentSuggestionsApi } from "./content-suggestions-api.js";
import { withCapturedStdout, waitForEvent } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { serverFixture } from "./testing/server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("./content-suggestion-runner.js", async (original) => {
  const actual = await original<typeof import("./content-suggestion-runner.js")>();
  return {
    ...actual,
    createContentSuggestionRunner: vi.fn(
      (...args: Parameters<typeof actual.createContentSuggestionRunner>) => {
        const runner = actual.createContentSuggestionRunner(...args);
        return { ...runner, run: vi.fn(runner.run), wake: vi.fn(runner.wake) };
      },
    ),
  };
});
vi.mock("./content-suggestions-api.js", async (original) => {
  const actual = await original<typeof import("./content-suggestions-api.js")>();
  return { ...actual, mountContentSuggestionsApi: vi.fn(actual.mountContentSuggestionsApi) };
});

const { beforeServerStarts, startServer } = serverFixture();
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

it("starts the Translate all runner with a Cloud connection, wakes it from the routes and logs what its loop meets", async () => {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  const [port] = await freePorts(1);
  let scratch: string | undefined;
  let server: StartedServer | undefined;
  try {
    scratch = await mkdtemp(join(tmpdir(), "waitron-boot-suggestion-runner-"));
    const migrationsRoot = join(scratch, "migrations");
    for (const [index, set] of manifestSets().entries()) {
      await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const env = {
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
      WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    };
    server = await startServer(env, env);
    await vi.waitFor(async () => {
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    });

    const listed = await fetch(
      `http://127.0.0.1:${port}/management-api/content-suggestions?language=es`,
      { headers: { cookie: venue.managerCookie } },
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      service: "not_connected",
      cloudOrigin: "https://cloud.example",
      run: null,
    });

    expect(createContentSuggestionRunner).toHaveBeenCalledOnce();
    const runner = vi.mocked(createContentSuggestionRunner).mock.results[0]!.value as ReturnType<
      typeof createContentSuggestionRunner
    >;
    expect(runner.run).toHaveBeenCalledOnce();
    const [signal, options] = vi.mocked(runner.run).mock.calls[0]!;
    expect(signal.aborted).toBe(false);

    const deps = vi.mocked(mountContentSuggestionsApi).mock.calls[0]![1];
    expect(runner.wake).not.toHaveBeenCalled();
    deps.wake();
    expect(runner.wake).toHaveBeenCalledOnce();

    const logged = await withCapturedStdout(async (lines) => {
      options!.onError!(new AppError("cloud.unavailable", {}));
      return waitForEvent(lines, "content.suggestion_runner_failed");
    });
    expect(logged).toMatchObject({ errorCode: "cloud.unavailable" });

    await server.close();
    server = undefined;
    expect(signal.aborted).toBe(true);
  } finally {
    await server?.close();
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  }
});
