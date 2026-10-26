import { chmod, lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  chooseStartAgainLeftovers,
  START_AGAIN_SET_ASIDE_DIR,
  surveyStartAgainLeftovers,
} from "@waitron/provisioning";
import {
  START_AGAIN_ADMIN_PASSWORD,
  startAgainAttempt,
} from "@waitron/provisioning/testing/start-again-attempt";

import { fixture, recovery } from "../test/first-setup-backup-recovery-fixture.js";

vi.mock("./first-setup-backup-source.js", { spy: true });

async function filesUnder(path: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(path);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const child = join(path, name);
    if ((await lstat(child)).isDirectory()) out.push(...(await filesUnder(child)));
    else out.push(child);
  }
  return out;
}

it("recover from a backup after a Move", async () => {
  let unreadable = "";
  const moved = new Map<string, { bytes: Buffer; ino: number }>();
  const f = await fixture(true, {
    prepareBox: async (roots) => {
      const attempt = await startAgainAttempt(dirname(roots.stateDir));
      await writeFile(join(attempt.roots.venueDir, "venue.db"), "found venue database bytes");
      await writeFile(join(attempt.roots.venueDir, "node.db"), "found node database bytes");
      const survey = await surveyStartAgainLeftovers(attempt.roots);
      if (survey?.kind !== "choice") throw new Error(`expected choice, got ${survey?.kind}`);
      const chosen = await chooseStartAgainLeftovers({
        roots: attempt.roots,
        password: START_AGAIN_ADMIN_PASSWORD,
        choice: "move",
        listed: survey.digest,
        now: () => new Date(),
      });
      expect(chosen.choice).toBe("move");
      for (const root of new Set(Object.values(attempt.roots)))
        for (const path of await filesUnder(join(root, START_AGAIN_SET_ASIDE_DIR)))
          moved.set(path, { bytes: await readFile(path), ino: (await lstat(path)).ino });
      expect([...moved.values()].map(({ bytes }) => bytes.toString()).sort()).toEqual([
        "found node database bytes",
        "found venue database bytes",
      ]);
      unreadable = [...moved.keys()][0]!;
      await chmod(unreadable, 0o000);
    },
  });
  try {
    const service = recovery(f.options);
    const session = await service.open(f.request, { onBox: false });
    await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
    expect((await f.workspace.read()).at(-1)).toMatchObject({ phase: "prepared" });
  } finally {
    await chmod(unreadable, 0o600);
  }
  for (const [path, before] of moved) {
    expect(await readFile(path)).toEqual(before.bytes);
    expect((await lstat(path)).ino).toBe(before.ino);
  }
  const evidence = (
    await Promise.all([...new Set(Object.values(f.roots))].map((root) => filesUnder(root)))
  )
    .flat()
    .filter((path) => path.split("/").includes("evidence"));
  for (const path of evidence)
    for (const { bytes } of moved.values())
      expect((await readFile(path)).equals(bytes)).toBe(false);
});
