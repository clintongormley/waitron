import * as fs from "node:fs/promises";
import { join } from "node:path";
import { lockVenueDatabase } from "@waitron/db";
import { verifyPassword } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { inTurn } from "./attempt-turns.js";
import { canonicalFirstSetupRoots } from "./first-setup-resolution.js";
import {
  readStartAgainChoices,
  startAgainChoiceStem,
  writeStartAgainChoice,
  type StartAgainChoiceRecord,
} from "./first-setup-start-again-choice.js";
import { finishStartAgainDeletion } from "./first-setup-start-again-deletion.js";
import { beginStartAgainGuess } from "./first-setup-start-again-guesses.js";
import {
  surveyStartAgainLeftovers,
  type StartAgainSurvey,
} from "./first-setup-start-again-leftovers.js";
import {
  moveStartAgainUnits,
  prepareSetAside,
  setAsideDestinations,
  type SetAsideIo,
} from "./first-setup-start-again-set-aside.js";
import { parseState, type FirstSetupState } from "./first-setup-state.js";
import "./errors.js";

type Roots = { stateDir: string; venueDir: string };
type Choice = Extract<StartAgainSurvey, { kind: "choice" }>;

const turns = {};

const reasonOf = (error: unknown) =>
  error instanceof AppError
    ? (error.reason ?? error.code)
    : `move failed: ${String((Object(error) as { code?: unknown }).code ?? "unknown")}`;

async function assertNotKept(stateDir: string, survey: Choice): Promise<void> {
  const records = await readStartAgainChoices(stateDir, survey);
  if (records.some((record) => record.choice === "keep"))
    throw new AppError("setup.start_again_kept", {});
}

/** The setup record the survey just accepted; the survey under the lock proves it unchanged. */
async function setupRecord(roots: Roots, survey: Choice): Promise<FirstSetupState> {
  try {
    const bytes = await fs.readFile(join(roots.stateDir, "first-setup.json"), "utf8");
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
 * under the venue lock, refuses unless the box still shows the list the page showed. Keep records
 * the choice. Move probes the renames, records the choice, raises the note, moves the units aside
 * and finishes Start again; any failure once the Move is recorded is
 * `setup.start_again_move_unfinished`, carrying the cause as its reason.
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
      const record: Omit<StartAgainChoiceRecord, "version"> = {
        at: input.now().toISOString(),
        attemptId: locked.attemptId,
        frozenDigest: locked.frozenDigest,
        markerSha256: locked.markerSha256,
        choice: "keep",
        administrator: {
          administratorId: state.frozen.administratorId,
          displayName: state.frozen.request.admin.displayName,
          email: state.frozen.request.admin.email,
        },
        ownerGeneration: state.ownerGeneration,
        listed: { digest: locked.digest, units: locked.units },
        setAside: null,
        noteFloorMs: null,
      };
      if (input.choice === "keep") {
        await writeStartAgainChoice(roots.stateDir, record);
        return { choice: "keep" };
      }
      const stem = startAgainChoiceStem(record);
      const setAside = await setAsideDestinations(roots, stem, input.io);
      const made = await prepareSetAside(roots, locked.units, setAside, input.io);
      const move = {
        ...record,
        choice: "move",
        setAside,
        noteFloorMs: locked.noteFloorMs,
      } as const;
      try {
        await writeStartAgainChoice(roots.stateDir, move);
      } catch (error) {
        // Nothing is moved yet, so these are still empty; rmdir refuses one that is not.
        const rmdir = input.io?.rmdir ?? fs.rmdir;
        for (const folder of made) await rmdir(folder).catch(() => undefined);
        throw error;
      }
      try {
        await moveStartAgainUnits(roots, { version: 1, ...move }, input.io);
        await finishStartAgainDeletion(roots);
      } catch (error) {
        // The Move is recorded, so no refusal may say the files are unchanged or nothing was saved.
        throw new AppError("setup.start_again_move_unfinished", {}, { reason: reasonOf(error) });
      }
      return { choice: "move", setAside };
    } finally {
      hold.release();
    }
  });
}
