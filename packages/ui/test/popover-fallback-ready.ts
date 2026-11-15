import { beforeAll } from "vitest";
import "./popover-fallback-setup.js";
import { startWithPopover } from "../src/popover-startup.js";
beforeAll(() => new Promise<void>((ready, failed) => startWithPopover(ready, failed)));
