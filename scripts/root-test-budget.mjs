import { availableParallelism, freemem, loadavg } from "node:os";

// A root worker also starts children. Leave processor room for them and budget their memory
// together with the worker's; measurements and the startup-snapshot limit are in ci-and-gates.md.
export function rootGuardWorkers() {
  const processorHeadroom = availableParallelism() - loadavg()[0];
  return Math.max(1, Math.floor(Math.min(processorHeadroom / 2, freemem() / 1024 ** 3)));
}
