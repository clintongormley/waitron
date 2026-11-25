import { realpathSync } from "node:fs";
import { Server } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const live = realpathSync(join(process.env.WAITRON_VENUE_DIR!, "venue.db"));
const at = process.env.PLACE_COPY_KILL_AT;
const write = process.stdout.write.bind(process.stdout);
let swapped = false;
process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
  if (String(chunk).includes("handover-place-copy.placed")) {
    swapped = true;
    if (at === "swapped") process.kill(process.pid, "SIGKILL");
  }
  return Reflect.apply(write, process.stdout, [chunk, ...args]);
}) as typeof process.stdout.write;

const prepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function (sql) {
  const statement = prepare.call(this, sql);
  const file = this.location();
  if (
    (at === "opened" || at === "wal") &&
    swapped &&
    file !== null &&
    realpathSync(file) === live
  ) {
    if (at === "wal") {
      const writer = new DatabaseSync(live);
      writer.exec("pragma user_version = 778");
    }
    process.kill(process.pid, "SIGKILL");
  }
  return statement;
};

Server.prototype.listen = function () {
  throw new Error("production entry reached a listener before the crash point");
};
