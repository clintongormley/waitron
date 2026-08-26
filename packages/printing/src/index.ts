// The public barrel of @waitron/printing. Task 2 ships only the permission + error-code layer, so
// there is nothing to re-export yet; later tasks (T3 enrol/auth, T4 enqueue, T5 runtime) add the real
// exports here.

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts (and
// guarded tree-wide by scripts/errors-reachable.test.ts).
import "./errors.js";
