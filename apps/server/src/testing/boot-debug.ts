import { vi } from "vitest";
import * as verbosity from "../verbosity.js";

export function enableDebugForNextBoot(): void {
  const create = verbosity.createVerbosityController;
  vi.spyOn(verbosity, "createVerbosityController").mockImplementationOnce((options) =>
    create({ ...options, defaultLevel: "debug" }),
  );
}
