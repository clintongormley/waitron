import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lockVenueDatabase } from "@waitron/db";
import { verifyPassword } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { inTurn } from "./attempt-turns.js";
import { canonicalFirstSetupRoots } from "./first-setup-resolution.js";
import { readStartAgainChoices } from "./first-setup-start-again-choice.js";
import { beginStartAgainGuess } from "./first-setup-start-again-guesses.js";
import {
  surveyStartAgainLeftovers,
  type StartAgainSurvey,
} from "./first-setup-start-again-leftovers.js";
import type { SetAsideIo } from "./first-setup-start-again-set-aside.js";
import { parseState, type FirstSetupState } from "./first-setup-state.js";
import "./errors.js";

type Roots = { stateDir: string; venueDir: string };
type Choice = Extract<StartAgainSurvey, { kind: "choice" }>;

const turns = {};

async function assertNotKept(stateDir: string, survey: Choice): Promise<void> {
  const records = await readStartAgainChoices(stateDir, survey);
  if (records.some((record) => record.choice === "keep"))
    throw new AppError("setup.start_again_kept", {});
}

/** The setup record the survey just accepted; the survey under the lock proves it unchanged. */
async function setupRecord(roots: Roots, survey: Choice): Promise<FirstSetupState> {
  try {
    const bytes = await readFile(join(roots.stateDir, "first-setup.json"), "utf8");
    const state = parseState(JSON.parse(bytes), roots.venueDir, roots.stateDir);
    if (state.frozen.attemptId === survey.attemptId && state.frozenDigest === survey.frozenDigest)
      return state;
  } catch {
    // Read below as a box that is no longer ready.
  }
  throw new AppError("setup.not_ready", {});
}

/**
 * The recovery page's Keep or Move after a cut-off Start again. Refuses a page whose list is no
 * longer the box's before counting a guess; counts the guess before checking the password; then,
 * under the venue lock, refuses unless the box still shows the list the page showed.
 */
export async function chooseStartAgainLeftovers(input: {
  roots: Roots;
  password: string;
  choice: "keep" | "move";
  listed: string;
  now: () => Date;
  io?: SetAsideIo;
  verify?: (password: string, stored: string) => Promise<boolean>;
}): Promise<{ choice: "keep" } | { choice: "move"; setAside: { state: string; venue: string } }> {
  const roots = await canonicalFirstSetupRoots(input.roots);
  const verify = input.verify ?? verifyPassword;
  return inTurn(turns, roots.stateDir, async () => {
    const survey = await surveyStartAgainLeftovers(roots);
    if (survey === null || survey.kind !== "choice") throw new AppError("setup.not_ready", {});
    await assertNotKept(roots.stateDir, survey);
    if (survey.digest !== input.listed) throw new AppError("setup.start_again_files_changed", {});
    const state = await setupRecord(roots, survey);
    const finish = await beginStartAgainGuess(roots.stateDir, survey.attemptId, input.now());
    if (!(await verify(input.password, state.ownerVerifier))) {
      await finish("invalid");
      throw new AppError("setup.owner_required", {});
    }
    await finish("success");
    const hold = await lockVenueDatabase(roots.venueDir);
    try {
      const locked = await surveyStartAgainLeftovers(roots);
      if (locked === null || locked.kind !== "choice" || locked.digest !== input.listed)
        throw new AppError("setup.start_again_files_changed", {});
      await assertNotKept(roots.stateDir, locked);
      // Task 5b replaces this refusal: the rename probe, the choice record, the note, Keep and Move.
      throw new Error("chooseStartAgainLeftovers: Keep and Move are not built yet (A1098 Task 5b)");
    } finally {
      hold.release();
    }
  });
}
