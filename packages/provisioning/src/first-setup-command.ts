import { initialSetupFor } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { createFirstSetupRuntime } from "./first-setup-runtime.js";
import type { FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import { firstSetupModuleContext } from "./first-setup-module-context.js";
import type { ProvisioningIo } from "./io.js";
import "./errors.js";

type Runtime = Pick<
  ReturnType<typeof createFirstSetupRuntime>,
  "modules" | "owner" | "preparation" | "assertSelection"
>;

/** Runs each module's `commandBeforeActivation`, its last check before activation. */
export async function recheckFirstSetupCommand(
  runtime: Runtime,
  owner: FirstSetupOwnerAttempt,
  io: ProvisioningIo,
) {
  const state = await runtime.owner.authorize(owner);
  runtime.assertSelection(state);
  for (const { module } of state.frozen.modules) {
    const seat = initialSetupFor(runtime.modules, module);
    if (seat?.commandBeforeActivation === undefined) continue;
    const reviewed = await seat.commandBeforeActivation(firstSetupModuleContext(state, module), {
      output: (line) => io.stdout(line),
      prompt: (question) => io.prompt(question),
      prepare: (proposal) => runtime.preparation.prepare(owner, module, proposal, { onBox: true }),
      select: async () => {
        throw new AppError("setup.attempt_conflict", {});
      },
      sleep: async () => {
        throw new AppError("setup.attempt_conflict", {});
      },
    });
    if (reviewed.status !== "ready") return { status: reviewed.status };
  }
  return { status: "ready" as const };
}

export async function prepareFirstSetupCommand(
  runtime: Runtime,
  suppliedOwner: FirstSetupOwnerAttempt,
  io: ProvisioningIo,
  sleep: (ms: number) => Promise<void>,
) {
  let owner = { ...suppliedOwner };
  let state = await runtime.owner.authorize(owner);
  if (!["claimed", "consumption-intent"].includes(state.status))
    throw new AppError("setup.attempt_conflict", {});
  runtime.assertSelection(state);
  const offerings = state.frozen.modules.flatMap(({ module }) => {
    const seat = initialSetupFor(runtime.modules, module);
    if (seat === undefined) return [];
    if (seat.command === undefined) throw new AppError("setup.not_ready", {});
    return [{ module, seat, command: seat.command }];
  });
  const inputs: { module: string; input: unknown }[] = [];
  for (const { module, seat, command } of offerings) {
    // One confirmation lasts through the module's waits, so nothing is asked once a wait has begun.
    let proof: string | undefined;
    const confirm = async () =>
      (proof ??= await runtime.owner.reconfirm(
        owner,
        await io.promptSecret("Confirm setup password: "),
        "block-use",
      ));
    const result = await command(firstSetupModuleContext(state, module), {
      output: (line) => io.stdout(line),
      prompt: (question) => io.prompt(question),
      prepare: (proposal) => runtime.preparation.prepare(owner, module, proposal, { onBox: true }),
      sleep,
      select: async (proposal) => {
        const kept = proof !== undefined;
        let selected: Awaited<ReturnType<Runtime["preparation"]["select"]>>;
        try {
          selected = await runtime.preparation.select(owner, module, proposal, await confirm());
        } catch (error) {
          // Here a kept confirmation fails only by expiring during the wait; a lost claim fails
          // `authorize` and keeps its own refusal.
          if (!kept || !(error instanceof AppError) || error.code !== "setup.owner_required")
            throw error;
          await runtime.owner.authorize(owner);
          io.stdout(
            "The command waited so long that the password confirmation expired, so the setup stopped before anything was chosen.",
          );
          throw error;
        }
        state = selected.state;
        owner = { ...owner, revision: state.revision };
        const answer =
          "preparation" in selected
            ? selected.preparation
            : firstSetupModuleContext(state, module).request;
        if (seat.pending?.(answer) !== true) proof = undefined;
        return answer;
      },
    });
    if (result.status !== "ready") {
      state = await runtime.owner.authorize(owner);
      return { status: result.status, owner, state };
    }
    inputs.push({ module, input: result.input });
  }
  for (const { module, input } of inputs) {
    state = await runtime.preparation.import(owner, module, input);
    owner = { ...owner, revision: state.revision };
  }
  state = await runtime.owner.authorize(owner);
  return { status: "ready" as const, owner, state };
}
