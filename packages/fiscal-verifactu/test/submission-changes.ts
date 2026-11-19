import { installChangeFeed, subscribeToChanges, type Database } from "@waitron/db";
import { onTestFinished } from "vitest";

export async function observeSubmissionChanges(db: Database): Promise<string[]> {
  await installChangeFeed(db, [{ table: "sales", type: "sales" }]);
  const types: string[] = [];
  const stop = subscribeToChanges(({ resources }) => {
    for (const { type } of resources) {
      if (type === "sales" || type === "fiscal_submission_queued") types.push(type);
    }
  });
  onTestFinished(() => stop());
  return types;
}
