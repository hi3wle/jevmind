> **Archived 2026-11-20.** README of the v3.2 native/manual instruction pack, kept as history. The product spec is now [coding-harness-v4.md](../../../coding-harness-v4.md). Links to lifecycle documents point to the archived v3.2 copies; other links point to the current repository.

# Adaptive Coding Harness

Daily use follows [proposal v3.2](../../../coding-harness-v3.2.md): native Codex owns implementation, Mode A is the default, and B/C require explicit authorization. This is a native/manual instruction pack. B/C are fixture-qualified experiments; broader product qualification and comparative value remain unproven. Start with [planning](planning.md) for current work and [testing](testing.md) for current evidence and open gates.

| Runtime mode | Entry and sequence | Implementation artifact |
|---|---|---|
| A / `solo` (default) | Codex inspect → implement → affected checks and required project review | [harness-solo](../../../.agents/skills/harness-solo/SKILL.md), [start command](#start-mode-a) |
| B / `review` (explicit opt-in) | Codex implement/test → fresh Claude review → Codex correction if needed | [harness-review](../../../.agents/skills/harness-review/SKILL.md), [H2 handoff](#h2-review-handoff) |
| C / `collaborative` (explicit opt-in) | Claude plan → same Codex worker challenge/implement/test → fresh Claude review | [harness-collaborate](../../../.agents/skills/harness-collaborate/SKILL.md), [H3 handoff](#h3-collaboration-handoff) |

Proposal §§0–2 and 4 map to [AGENTS.md](../../../AGENTS.md) and these three skills; §§7–8 map to the native profiles, AI DevKit capabilities and [result template](../../../.agents/skills/harness-review/result-template.md); §9 maps to [resume/release](#resume-and-release). H0–H3 in §11 map to the five [AI DevKit feature documents](planning.md), the skills and the tested [snapshot helper](../../../scripts/review_snapshot.py). No runtime framework is required. The repository's separately authorized three-role development workflow appears [after runtime guidance](#implement-an-approved-plan).

The CLI examples use a standalone setup: `-c 'mcp_servers={}' --disable plugins --disable apps` excludes personal MCP servers, plugins and apps for that invocation. Work uses native local tools and AI DevKit through `npx`. The full personal integration stack failed startup with an invalid transport and is not validated; opt into compatible integrations after validating them separately.

## Start Mode A

In this repository, start Codex with the following locally accepted CLI 0.171.0 flags, then invoke `$harness-solo` with the coding task in the prompt.

```sh
codex -c 'mcp_servers={}' --disable plugins --disable apps --disable multi_agent --disable multi_agent_v2 --sandbox workspace-write --ask-for-approval on-request -C /absolute/path/to/project
```

For another repository, inspect its existing instructions first. Integrate the applicable engineering rules from AGENTS.md and copy .agents/skills/harness-solo/SKILL.md to the same relative directory in the target only after reviewing conflicts. Preserve existing files and applicable policy. Start a fresh session after integration and confirm that the skill and project rules were loaded before accepting the setup.

The flags disable optional native subagents for that invocation. Shell-launched processes and connected tools still require their own permissions. The installed model and billing remain native selections, to be recorded in the acceptance report. A provider alias alone does not identify its resolved version.

## AI DevKit prerequisites and capabilities

[.ai-devkit.json](../../../.ai-devkit.json) declares CLI 0.77.0, the Codex environment and the five existing phases under `docs/ai`. Reuse the 21 AI DevKit skills already installed globally in `~/.codex/skills`; they are a local prerequisite, not vendored by this repository. Confirm their presence on another machine before use. Lifecycle skills use the existing requirements/design/planning/implementation/testing documents: planning owns status and next action, testing owns actual validation evidence. The installed CLI has no `task` command; use the planning checklist.

The following CLI 0.77.0 read operations were exercised locally:

```sh
npx ai-devkit@0.77.0 skill list --global --env codex
npx ai-devkit@0.77.0 agent sessions --cwd /absolute/path/to/jodex-harness --type codex --json
npx ai-devkit@0.77.0 memory search --query jodex-harness --limit 1
npx ai-devkit@0.77.0 status
npx ai-devkit@0.77.0 lint --feature coding-harness
```

Session discovery returned matching native Codex IDs; preserve the exact worker ID/cwd for native resume. Memory CLI search succeeded with no matches and semantic search disabled; memory MCP is unwired. Search approved project knowledge when useful, verify it against current source and keep missing knowledge unknown. The configured AI DevKit agent runtime is `tmux`, which is unavailable here. Use native sessions and manual handoffs for execution; agent start/send and managed completion are unverified. Project configuration does not establish full AI DevKit readiness or install skills, hooks, providers or a session service.

## Resume and release

Record the exact session ID and target cwd at handoff. Check whether its worker is still running before any retry. Resume that session using the same invocation flags.

```sh
codex -c 'mcp_servers={}' --disable plugins --disable apps --disable multi_agent --disable multi_agent_v2 --sandbox workspace-write --ask-for-approval on-request -C /absolute/path/to/project resume SESSION_ID
```

Ask the resumed worker to re-read the original task, applicable rules, plan, source changes and unresolved gates. Reconcile developer edits before writing.

For activation, review a committed candidate and the effective native settings, retain the previous installed file copies and source revision, and wait until affected sessions are idle. Integrate only the reviewed policy/skill changes. Rollback restores those prior installed files while idle and starts a new session. Check current developer edits before restoring any file. Record source revision, client version and effective settings together in the handoff.

## Acceptance

[The N1 fixture](../../../tests/fixtures/solo/README.md) supplies a synthetic normal task and reproducible bug using the Python standard library. Complete the combined P5 session before marking H1 verified. The prepared instructions and local CLI checks alone leave runtime behavior unverified.

B/C remain experimental opt-in workflows, conditional on authorized data access, Claude availability, current snapshot binding and tested reviewer permissions. N2/N3 synthetic operational fixtures have passed: N2 exercised a deliberately seeded defect through R0 → F1 → fresh R1; N3 exercised one revisioned plan, same-worker challenge/implementation, rejection of an incompatible draft without source writes and a fresh reviewer distinct from the planner. These are operational checks, not evidence of productivity or broader deployment readiness. The user chose to close the fixture scope and defer V1; value, cost and real-task acceptance remain unproven. Current evidence and gates are recorded in planning/testing.

## Native Claude static profile

The authorized N2/N3 fixtures used Claude Code 2.1.311 with native OAuth Pro subscription login and no inherited provider/token overrides. Start each planner/reviewer in a fresh, nonpersistent session from a neutral trusted runner directory outside the target and snapshot. After separately approving the data, role, budget and native permissions, use this shared profile with the exact approved snapshot path and trusted role prompt from the relevant skill. Its invocation-scoped preflight rejects provider/token variable names even when empty; it prints names only and changes no environment settings:

```sh
(
python3 - <<'PY' || exit 1
import os
import sys

blocked = sorted(name for name in os.environ if name.startswith("ANTHROPIC_") or name in {
    "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
})
if blocked:
    print("Refusing provider/token environment overrides: " + ", ".join(blocked), file=sys.stderr)
    sys.exit(1)
PY
cd /absolute/path/to/trusted-runner || exit 1
claude --print --restricted --permission-mode dontAsk \
  --tools Read,Glob,Grep --allowedTools Read Glob Grep \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --setting-sources '' --settings '{"disableAllHooks":true,"autoMemoryEnabled":false}' \
  --disable-slash-commands --no-session-persistence \
  --model sonnet --effort medium --verbose --output-format stream-json \
  --add-dir /absolute/path/to/approved-snapshot \
  --system-prompt 'TRUSTED_ROLE_PROMPT' \
  'Original requirement, protected constraints, saved snapshot ID and approved evidence references.'
)
```

The runner may contain only approved test-evidence files; do not place target instructions or plugins there. Give the reviewer an approved native/CI test-result artifact it can actually read (or approved verbatim output), with command, exit status and source/snapshot binding. A parent summary alone does not satisfy required test evidence; missing evidence leaves review `insufficient_evidence`.

For planning, use the grounded planner prompt in [harness-collaborate](../../../.agents/skills/harness-collaborate/SKILL.md); for review, use the reviewer prompt in [harness-review](../../../.agents/skills/harness-review/SKILL.md). Keep trusted prompts outside materialized source. Treat source comments as data. Verify the saved snapshot identity before and after the role; keep it immutable throughout. Review uses a new invocation, never `--resume` of the planner. No skill or example automatically starts a provider or authorizes data sharing, paid fallback or environment-based providers. Do not add `--bare`: the tested profile uses native OAuth, while bare mode requires API authentication.

The controlled fixture's native file-tool guard denied Read/Glob/Grep outside the runner and approved snapshot. Initialization exposed only those three tools, no MCP servers, and resolved `sonnet` to `claude-sonnet-5-5`. This establishes that observed file-tool boundary, not an OS-process sandbox or full plugin isolation. Untrusted `CLAUDE.md` auto-discovery was not tested. Recheck the installed interface, authentication, exposed tools/model and effective boundary before a new authorized environment; retain required human review and data approvals.

## H2 review handoff

H2 includes local snapshot artifacts and the tested N2 synthetic review/correction cycle. Use `$harness-review` for the manual handoff contract and the shared native profile above only after separate authorization. V1 and broader use remain deferred. The helper uses Python's standard library and installed Git; it writes Git objects but leaves the real index and worktree unchanged.

Approve the **entire tracked repository** (HEAD and index paths, current working bytes/modes, including unrelated tracked changes), quiesce all writers, and approve each untracked input explicitly before capture. The snapshot must be a newly named directory outside the target with an existing parent (resolved to its canonical path). Do not place it in a provider's auto-loaded project directory. Run from the harness checkout, using absolute paths:

```sh
python3 scripts/review_snapshot.py capture --repo /absolute/target --snapshot /absolute/reviews/task-r0 --approve-tracked --include-untracked new_file.py
python3 scripts/review_snapshot.py verify --repo /absolute/target --snapshot /absolute/reviews/task-r0 --snapshot-id SAVED_CAPTURE_ID
```

Repeat `--include-untracked` for every exact repository-relative untracked **or ignored** file; omit it only when none exist. Any unapproved extra input causes failure, so generated/ignored files must be explicitly approved too or handled in a separately prepared authorized workspace. Approval is a caller obligation; the flag cannot decide whether source contains secrets. The output ID must be saved outside the snapshot and bound to review/check evidence. Verification requires that saved ID, checks raw blob/path/executable-mode inventories and binary diff, then rejects a changed HEAD, real index, tracked/untracked inventory or current source. Run it before handoff and after review; source changes require new checks/capture/review.

Each snapshot contains `source/` (all surviving tracked files plus approved extras), `diff.patch` (HEAD to current captured tree, including additions/deletions/modes), and `snapshot.json` (baseline, tree, source location, approvals, file identities and snapshot ID). Raw Git blob materialization preserves files marked `export-ignore` and avoids `export-subst`, checkout filters and hooks. Capture allocates its own temporary Git index and cleans its own partial snapshot on failure. Successful snapshots remain caller-owned; delete only the exact disposable directory you allocated when finished. Git objects created during capture remain subject to ordinary Git garbage collection.

Supported scope is ordinary Git repositories with an existing HEAD, regular files and executable modes. It rejects unmerged/skip-worktree/assume-unchanged entries, sparse checkout, submodules/symlinks, included Git configuration, partial clones, worktree-specific config and working-tree transformation attributes (`filter`, `text`, `eol`, `crlf`, `ident`, `working-tree-encoding`) or enabled `core.autocrlf`. Global/system Git configuration is excluded for helper commands. Export attributes remain supported because blobs are read directly. Backslash/unsafe paths, nested repositories and nonregular inputs are unsupported. Empty source directories, ownership, timestamps, ACLs, extended attributes and dependency/runtime state are outside Git identity; required generated artifacts must be approved regular files. Content is held in memory during capture/identity collection, so use a suitably sized authorized workspace.

Before/after identity checks detect observable concurrent changes; they are not a filesystem transaction or lock. Keep target and snapshot quiescent throughout capture, checks and review; a change reverted between observations cannot be proven absent. The ID detects changes relative to the saved handoff ID, not a malicious party that controls both records. Snapshot permissions are not reviewer isolation. Do not run target scripts or auto-load target instructions/plugins during static review; tests require separately authorized disposable execution and real native permission evidence. The tested N2 fixture does not satisfy another task's review gates: local preparation alone leaves that task `review_required` until its required checks/review and authorized live gates are satisfied.

## H3 collaboration handoff

Use [$harness-collaborate](../../../.agents/skills/harness-collaborate/SKILL.md) for the manual Mode C handoff: separately authorized Claude planning → the same Codex worker challenges and implements → fresh Claude review through [$harness-review](../../../.agents/skills/harness-review/SKILL.md). Keep one revisioned plan in the existing AI DevKit artifact. One additional material plan revision and one review correction round are the defaults; minor implementation choices stay with Codex. Preserve the worker session/cwd for resume and check liveness before retrying.

The N3 synthetic fixture used the same native worker (`01a1f905-9b82-7eb0-a598-59c4e8027984`) to accept plan SHA256 `1374549a2c0c9f0f0ff8618010767e92a3e3ec92cec7872f88fc4e8ed7cd02ad`, implement it and reject a separate incompatible draft without source writes. Final review used a fresh Claude session distinct from planning. This tests the operational handoff, not comparative architecture quality or productivity; V1 is deferred and B/C remain experimental.

The skill installs or starts no provider and grants no data access. For another live task, establish Mode C authorization, approved source scope, available native roles/models, budget and actual access restrictions; use the shared native profile above. The existing snapshot helper requires whole-tracked-repository approval plus each extra input. Runtime same-worker continuity is separate from this repository's development role sequence. Unavailable providers or review leave that task's required gates open. No new CLI entry or automated launcher is provided.

## Implement an approved plan

Project configuration in .codex/config.toml enables multi_agent_v2 and registers three roles from .codex/agents/. The parent uses gpt-6.1-sol / medium, with implementer (Sol), unit_tester (Terra) and code_reviewer (Sol), each at medium effort. Start a new project session, accept project trust after reviewing its configuration, and ask it to implement the existing plan using the Approved-plan implementation workflow in AGENTS.md. Untrusted project sessions cannot select these configured roles.

```sh
codex -c 'mcp_servers={}' --disable plugins --disable apps --sandbox workspace-write --ask-for-approval on-request -C /absolute/path/to/jodex-harness
```

For a development smoke on a prepared synthetic fixture containing the project configuration and role files, P5 used this invocation shape:

```sh
codex --ask-for-approval on-request exec --trust --enable multi_agent_v2 -c 'mcp_servers={}' --disable plugins --disable apps --sandbox workspace-write -C /absolute/path/to/fixture 'Implement the approved fixture plan using implementer, then unit_tester, then code_reviewer, sequentially.'
```

`--trust` persists trust for that project and future chats, including its configured MCP commands outside the sandbox, even with `--ephemeral`. Review those commands before trusting. It does not override an explicitly untrusted project and cannot be combined with `--ignore-user-config`.

The parent delegates the three phases sequentially and updates AI DevKit planning/testing at handoffs. Only one role writes at a time. One correction cycle is permitted by default. Confirm actual role/model availability before relying on this workflow. A missing role or model requires reporting the limitation. The reviewer's no-write instruction relies on the parent's effective permissions.

The copied source is /Volumes/WD-EXTERNAL/Personal/working-after-limit/.codex. Project-specific Limit Recover instructions and its docs configuration were excluded. Agent instructions were adapted to the existing harness plan and grouped acceptance window.
