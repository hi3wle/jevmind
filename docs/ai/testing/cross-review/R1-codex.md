R1 remains **review_required**: 4 R0 findings are fixed, 10 are partially fixed, and 3 additional blockers remain.

No files were edited. `npm run typecheck` passed. Twenty-four read-only probes confirmed the behavior below; hook/storage probes used in-memory mocks. The full test suite and live host/provider checks were not run.

```json
[
  {
    "r0": "src/team.ts:290",
    "verdict": "partial",
    "severity": "blocking",
    "location": "src/team.ts:297",
    "issue": "Quoted and abbreviated flags are blocked, but shell expansion and repository-code execution remain allowed.",
    "scenario": "A reviewer runs git diff --{output,src-prefix}=src/a.ts. The filter accepts it; Bash expands it to --output=src/a.ts --src-prefix=src/a.ts, allowing overwrite. git diff --textconv also passes and can execute a configured repository script.",
    "fix": "Reject shell expansions, validate parsed arguments against a strict option allowlist, and disable external diff/textconv execution."
  },
  {
    "r0": "src/hooks.ts:157",
    "verdict": "partial",
    "severity": "blocking",
    "location": "src/hooks.ts:163",
    "issue": "Only agents observed while awaiting are remembered; unregistered agents still bypass restrictions.",
    "scenario": "Cancel a reviewer before its first tool call. Its subsequent Write is allowed because awaiting is null and its ID was never registered. An unregistered helper can likewise write after R1 exhausts the worker's correction budget.",
    "fix": "Register agent identity, role and ownership at launch, independently of awaiting. Deny unregistered agents writes and retain restrictions until termination is confirmed."
  },
  {
    "r0": "src/hooks.ts:167",
    "verdict": "partial",
    "severity": "blocking",
    "location": "src/hooks.ts:180",
    "issue": "Direct shell writes are blocked during locked stages, but every matching Jodex subcommand is exempt.",
    "scenario": "While awaiting a reviewer, the worker runs jodex uninstall --project. This passes the stage lock and removes config.toml through src/init.ts:150. Subsequent hooks return immediately because the project is no longer initialized, allowing unrestricted writes.",
    "fix": "Allow only the exact workflow subcommands and arguments appropriate to each stage. Deny agent-issued uninstall and other commands that remove enforcement."
  },
  {
    "r0": "src/cli.ts:174",
    "verdict": "partial",
    "severity": "blocking",
    "location": "src/hooks.ts:159",
    "issue": "Acceptance is protected only by a raw command-text regex; the CLI still trusts any caller.",
    "scenario": "After a critical run closes at review_required, the worker runs jodex 'accept'. The regex misses it, the routine-command gate allows it, and shell parsing gives the CLI the accept argument. src/cli.ts:175 records human acceptance.",
    "fix": "Require an authenticated human approval channel at the acceptance endpoint. Command-text matching cannot establish human authority."
  },
  {
    "r0": "src/team.ts:79",
    "verdict": "partial",
    "severity": "blocking",
    "location": "src/team.ts:100",
    "issue": "Baseline reconciliation works only when the run already has a session ID.",
    "scenario": "A review-prefixed task edits exclusively through shell, then runs jodex check. The CLI creates a run with sessionId=null at src/cli.ts:112. Review start skips its prompt baseline and produces empty scope/diff. A clean result can report verified before Stop; Stop's new scope check subsequently rejects it.",
    "fix": "Associate CLI-created runs with their active session before review capture, and refuse review or verified status when the required baseline/scope is unavailable."
  },
  {
    "r0": "src/cli.ts:114",
    "verdict": "partial",
    "severity": "blocking",
    "location": "src/crossreview.ts:88",
    "issue": "Check saves merge newer state, but run updates remain unlocked and other writers still save stale whole-run objects.",
    "scenario": "The detached reviewer reloads the run, then awaits D4 classification inside recordSubagent. During that await, jodex check merges new check results. When classification finishes, src/crossreview.ts:89 saves the reviewer's older object and deletes those results. updateRun at src/run.ts:130 also has no lock or revision comparison.",
    "fix": "Use locking or revision-checked updates for every writer. After classification, merge only the review result into the latest revision."
  },
  {
    "r0": "src/hooks.ts:111",
    "verdict": "fixed",
    "severity": "blocking",
    "location": "src/hooks.ts:111",
    "issue": "Intake now omits check commands at level 1 and applies redact to each command at level 2.",
    "scenario": "Captured intake states contained an empty testCommands array at level 1 and DB_PASSWORD=[REDACTED] npm test at level 2.",
    "fix": "None for this payload-construction defect; remaining redaction defects are listed separately."
  },
  {
    "r0": "src/jev.ts:28",
    "verdict": "partial",
    "severity": "blocking",
    "location": "src/jev.ts:28",
    "issue": "Ordinary Basic headers are fully redacted, but quoted header representations retain credentials.",
    "scenario": "A level-2 prompt contains {\"Authorization\":\"Basic dXNlcjpzZWNyZXQ=\"}. The quoted key prevents the regex matching, so the complete credential reaches intake unchanged. Authorization: \"Basic dXNlcjpzZWNyZXQ=\" also retains the credential.",
    "fix": "Redact complete Authorization values in supported quoted and serialized forms, including quoted keys and values."
  },
  {
    "r0": "src/run.ts:175",
    "verdict": "fixed",
    "severity": "blocking",
    "location": "src/run.ts:198",
    "issue": "Check evidence now requires the recorded command to equal the current configured command.",
    "scenario": "Changing a passing true check to npm run integration now makes its gate pending and returns review_required.",
    "fix": "None for this R0 finding."
  },
  {
    "r0": "src/hooks.ts:219",
    "verdict": "fixed",
    "severity": "blocking",
    "location": "src/hooks.ts:231",
    "issue": "Stop now compares the final nonempty line with the computed status.",
    "scenario": "An earlier failed_verification status followed by a final verified status is blocked when the current check failed.",
    "fix": "None for this R0 finding."
  },
  {
    "r0": "src/team.ts:105",
    "verdict": "partial",
    "severity": "blocking",
    "location": "src/team.ts:111",
    "issue": "The exhausted-budget scenario is denied, but disputed blockers can still be replaced without developer resolution when budget remains.",
    "scenario": "R0 contains only disputed blockers. The worker changes an unrelated README and reruns checks. startReview counts that change as a correction and opens R1. A clean R1 replaces the disputed blockers, although src/run.ts:264 says the developer must decide them.",
    "fix": "Keep disputed blockers unresolved across rounds until the developer decides them, and reject replacement reviews while that resolution is outstanding."
  },
  {
    "r0": "src/run.ts:202",
    "verdict": "partial",
    "severity": "nonblocking",
    "location": "src/run.ts:228",
    "issue": "Acceptance now satisfies tester_scope, but it is not bound to the accepted source identity.",
    "scenario": "A run accepted at identity I is evaluated at identity J with current checks/review. tester_scope remains satisfied using the acceptance from I; the acceptance schema at src/run.ts:78 contains no identity.",
    "fix": "Record the accepted identity and acknowledged scope violations. Require both to match the current evaluation."
  },
  {
    "r0": "src/calibrate.ts:64",
    "verdict": "fixed",
    "severity": "nonblocking",
    "location": "src/decisions.ts:25",
    "issue": "Routing now thresholds P(elevated)+P(critical), matching calibration.",
    "scenario": "With elevated=0.30, critical=0.55 and threshold=0.70, routing now raises risk to critical.",
    "fix": "None for this R0 finding."
  },
  {
    "r0": "src/run.ts:211",
    "verdict": "partial",
    "severity": "nonblocking",
    "location": "src/run.ts:236",
    "issue": "Ordinary check failures outrank a blocked plan, but a configured check named plan is excluded from that precedence.",
    "scenario": "Configure checks.plan as npm run validate-plan. If it exits 1 while the collaborative plan is blocked, evaluate returns blocked instead of failed_verification because both gates share the name plan.",
    "fix": "Distinguish check gates from workflow gates by type, rather than excluding checks by their configured name."
  },
  {
    "r0": "new",
    "verdict": "new",
    "severity": "blocking",
    "location": "src/hooks.ts:169",
    "issue": "Tester shell calls bypass production-file restrictions and correction-budget locks.",
    "scenario": "After R1 exhausts the budget, the worker runs jodex test start, which has no budget guard. The tester runs echo overwritten > src/a.ts. Shell calls have paths=null, so the tester restriction does nothing; the worker lock excludes agent_id calls, and echo is routine. Later scope detection cannot prevent the forbidden write.",
    "fix": "Enforce tester filesystem scope for shell execution and prevent tester handoff from bypassing an exhausted correction budget."
  },
  {
    "r0": "new",
    "verdict": "new",
    "severity": "blocking",
    "location": "src/team.ts:225",
    "issue": "D4 sends free-form finding text at data level 1.",
    "scenario": "With consent=true and data_level=1, a reviewer puts a private database password in the issue prose. classifyFindings still sends issue and expectedBehavior to askFinding. Only request is gated by data level, violating the metadata-only boundary.",
    "fix": "Apply data-level restrictions to the complete D4 payload. Skip prose-based classification at level 1 unless an approved metadata-only representation exists."
  },
  {
    "r0": "new",
    "verdict": "new",
    "severity": "blocking",
    "location": "src/jev.ts:24",
    "issue": "Redaction does not remove known secret environment-variable values as required by the specification.",
    "scenario": "DB_PASSWORD contains synthetic-only-bluebird-secret, and a level-2 prompt says 'The password is synthetic-only-bluebird-secret'. redact leaves the value unchanged, so intake sends a secret whose value is already known locally.",
    "fix": "Redact nonempty values of secret-named environment variables from every outbound free-text field, in addition to recognizing textual secret formats."
  }
]
```