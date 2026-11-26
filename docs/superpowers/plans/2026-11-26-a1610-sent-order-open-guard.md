# A1610 sent-order-open guard implementation plan

The CI guard should check every eligible TypeScript file for literal writes that reopen orders and
finish comfortably inside its existing 30-second limit. GitHub-hosted job 140003829093 spent 36.995
seconds in the whole-tree case. At `3a764b17c3`, a local profile counted 3,584 files and measured
2.06 seconds of parsing in 2.42 seconds of scan time, after reading the files. The proposed text
check retained 870 candidates, including the only file the full scan flagged. The exact reason the
hosted runner was slower that time is unknown.

1. In `scripts/sent-order-open.test.ts`, first run a temporary regression test that watches the real
   `ts.createSourceFile`. A source with neither `status` nor `open` and no backslash must return no
   findings and make zero parser calls. Confirm the old code still parses it. Use the existing
   TypeScript spy pattern in `scripts/no-history-length.test.ts` for this experiment.
2. Add an early return in `openingWrites`. A file can be skipped if it has no backslash and lacks
   either `status` or `open`, using case-insensitive checks because the SQL rule ignores case. Let
   TypeScript parse files with backslashes since escaped spellings may hide either word. Keep the
   current file selection, parser, findings, and timeout. Add scanner examples for an escaped
   TypeScript property and value, an escaped SQL string, and uppercase SQL. Keep every existing
   assertion and remove the temporary parser spy after observing it pass.
3. Run the focused file locally. In a disposable checkout, add a second reopen write with escaped
   letters in a different eligible file and confirm that the whole-tree case names it. Run the
   restored check and compare the whole-tree case time against the unchanged guard. Record the
   selected current-head root-guards job, runner and case time in the PR, and check the merge's own
   root-guards job. Leave product code and CI routing alone. Recheck the backlog and delete any
   entry for A1610 that appeared since this plan was written. Neither backlog file names it now.

Expected size is about four scanner lines and three test cases. The existing TypeScript parser
continues to decide which writes the guard flags.
