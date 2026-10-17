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

export async function prepareFirstSetupCommand(
  runtime: Runtime,
  suppliedOwner: FirstSetupOwnerAttempt,
  io: ProvisioningIo,
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
    return [{ module, command: seat.command }];
  });
  const inputs: { module: string; input: unknown }[] = [];
  for (const { module, command } of offerings) {
    if (Object.hasOwn(state.inputs, module)) {
      inputs.push({ module, input: state.inputs[module] });
      continue;
    }
    const result = await command(firstSetupModuleContext(state, module), {
      output: (line) => io.stdout(line),
      prompt: (question) => io.prompt(question),
      prepare: (proposal) => runtime.preparation.prepare(owner, module, proposal),
      select: async (proposal) => {
        const proof = await runtime.owner.reconfirm(
          owner,
          await io.promptSecret("Confirm setup password: "),
          "block-use",
        );
        const selected = await runtime.preparation.select(owner, module, proposal, proof);
        state = selected.state;
        owner = { ...owner, revision: state.revision };
        return "preparation" in selected
          ? selected.preparation
          : firstSetupModuleContext(state, module).request;
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
