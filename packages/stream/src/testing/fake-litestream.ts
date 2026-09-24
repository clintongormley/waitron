import { LITESTREAM_VERSION } from "../litestream.js";
import type { ChildHandle, SpawnFn } from "../litestream-process.js";

/** A Litestream that runs until told to exit or killed. */
export class FakeChild implements ChildHandle {
  readonly pid: number | undefined;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly exited: Promise<number | null>;
  killed = false;
  done = false;
  readonly #resolve: (code: number | null) => void;
  readonly #output: string;
  readonly #events: string[];

  constructor(
    args: readonly string[],
    env: Readonly<Record<string, string>>,
    output: string,
    events: string[],
    pid?: number,
  ) {
    this.pid = pid;
    this.args = args;
    this.env = env;
    this.#output = output;
    this.#events = events;
    let resolve!: (code: number | null) => void;
    this.exited = new Promise((settle) => (resolve = settle));
    this.#resolve = resolve;
  }

  output(): string {
    return this.#output;
  }

  kill(): void {
    this.killed = true;
    this.#events.push(`kill ${this.args[0]}`);
    this.exit(null);
  }

  /** Settles `exited` once: a kill after an exit leaves the exit code standing, as a process's does. */
  exit(code: number | null): void {
    if (this.done) return;
    this.done = true;
    this.#resolve(code);
  }
}

/** Stands in for the binary: answers `version`, and keeps every `replicate` it was asked to start. */
export class FakeLitestream {
  readonly children: FakeChild[] = [];
  version = LITESTREAM_VERSION;
  /** How `version` exits; null is a binary that could not be started at all. */
  versionExitCode: number | null = 0;
  /** A binary that never answers `version`. */
  versionHangs = false;
  /** What every `replicate` child prints — a test sets it to see what the supervisor does with it. */
  replicateOutput = "";
  /** The PID every `replicate` child reports; none by default. */
  pid: number | undefined = undefined;
  readonly #events: string[];

  constructor(events: string[] = []) {
    this.#events = events;
  }

  readonly spawn: SpawnFn = (_bin, args, env) => {
    const isVersion = args[0] === "version";
    const child = isVersion
      ? new FakeChild(args, env, `${this.version}\n`, this.#events)
      : new FakeChild(args, env, this.replicateOutput, this.#events, this.pid);
    this.children.push(child);
    this.#events.push(`spawn ${args[0]}`);
    if (isVersion && !this.versionHangs) child.exit(this.versionExitCode);
    return child;
  };

  replicas(): FakeChild[] {
    return this.children.filter((child) => child.args[0] === "replicate");
  }

  running(): FakeChild | undefined {
    return this.replicas().find((child) => !child.done);
  }
}
