import { availableParallelism, freemem, loadavg } from "node:os";

// Leave room for children and another root starting before the load average catches up.
// The startup estimate and measured allowance are documented in ci-and-gates.md.
export function rootGuardWorkers() {
  const processorHeadroom = availableParallelism() - loadavg()[0];
  return Math.max(1, Math.floor(Math.min(processorHeadroom / 4, freemem() / 1024 ** 3)));
}
