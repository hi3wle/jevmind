# Local review record (manual)

- Original goal / protected constraints / plan revision: <references>
- Mode / mode source / risk floor: review / explicit / unknown
- Harness revision / task ID: <references>
- Snapshot ID / baseline / tree / source / diff: <capture metadata and saved ID>
- Data scope authorization / native reviewer permissions: <evidence or unknown>
- Required checks: <command, source identity, environment, time, exit status, output ref>
- Review call: <R0 or R1; fresh native session ref; provider/model/effort or unknown>
- Correction budget consumed: <false, or true from F1 start>
- Completed correction + re-review cycles: <0 or 1; reviewer calls counted separately>

## Reviewer result

- snapshotId: <exact saved ID>
- status: <no_blocking_findings | changes_required | insufficient_evidence>
- reviewedPaths: <actual paths>
- testsSeen: <actual evidence references>
- limitations: <coverage gaps and uncertainty>
- findings: <none, or each severity blocking/nonblocking/question; location; issue;
  concrete evidence; expected behavior; impact>

## Adjudication and completion

- Response contract / contradictions / findings adjudication: <evidence>
- Post-review snapshot verify / required check binding: <commands and results>
- Outcome / reason / remaining review gates / next action: <current evidence>
- Native usage/time refs: unknown
- User acceptance / cost: unknown

Keep approved evidence local. Optional TaskEvidence v2 can reference this record/native
results: schemaVersion 2, taskId, harnessRevision, mode, modeSource, riskFloor,
startedAt, finishedAt, outcome, reasonCode, finalSnapshotId, executions (role,
provider, model, effort, elapsedMs, usageRef), reviewRounds (completed cycles),
reviewRef, acceptedAt, reworkTurns. Unknown fields stay null/absent; do not duplicate
aggregate native accounting across resume or roles. No raw transcript collection.
