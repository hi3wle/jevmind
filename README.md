# Jodex — Adaptive Coding Harness

Jodex is an installable outer harness for coding agents. It is specified in [coding-harness-v4.md](coding-harness-v4.md):

- `jodex setup` installs it once per machine;
- `jodex init` enables it in a project;
- the developer then prompts Claude Code, Codex or another supported agent as usual.

Jodex classifies the task and selects solo, review or collaborative mode. It coordinates plan → challenge → implement → test → review → correct → verify, and reports an evidence-backed completion status.

Decisions use a System 1 layer: deterministic rules first, then the Jev model from TypeSafe, then probability thresholds. The host agent (System 2) writes the code.

**Status:** implemented and tested on Claude Code 2.1.311 and Codex 0.171.0:
- solo and team modes;
- cross-provider review;
- Jev decisions D1 (intake), D2 (commands) and D4 (review findings);
- self-calibration.

See [coding-harness-v4.md](coding-harness-v4.md) §16–§17 for what was built and what was left out on purpose. Current work and evidence: [planning](docs/ai/planning/2026-11-20-feature-coding-harness.md), [testing](docs/ai/testing/2026-11-20-feature-coding-harness.md).

## Install and use

Requires Node ≥ 22.18, git, and Claude Code and/or Codex.

```sh
git clone <jodex-repo> jodex && cd jodex
npm install && npm run build
node plugin/dist/jodex.mjs setup   # once per machine
```

`setup` links the `jodex` command onto your PATH. It then installs the Jodex plugin into each host it finds, using the host's own marketplace commands. For Codex, open `codex`, run `/hooks`, and trust the Jodex hooks once.

```sh
cd /path/to/your/project           # must be a git repository
jodex init                         # shows the changes, asks before writing
claude                             # or: codex — then prompt as usual
```

What happens in M1:

1. **First file edit:** Jodex opens a run for the task. Edits through the shell are caught when the agent stops.
2. **Before finishing:** the agent runs `jodex check`. It runs the project's checks (from `.jodex/config.toml`) and binds each result to the exact source it ran on.
3. **Stop gate:**
   - The agent must end with `Jodex status: <status>`: `verified`, `review_required`, `failed_verification` or `blocked`.
   - An unsupported "done" is sent back once with the real gates.
   - A second stop always goes through, so the agent cannot loop.
   - Once the agent reports the status, the run ends. The next edit starts a new run, so a later task never inherits an earlier task's files or risk.
4. **Risk and review:** a critical path, a `review:`/`collab:` prompt prefix, or Jev's recommendation puts the run in review or collaborative mode. The reviewer is the other provider and read-only. Critical runs also need your `jodex accept`.
5. **Dangerous commands:** `rm -rf ~`, `git push --force`, `git reset --hard` and `git clean -f` are always denied. Unusual commands are judged by Jev.

| Command | Purpose |
|---|---|
| `jodex check` | run the checks, print the status and the `Next:` step |
| `jodex review start [--same-host]` / `jodex review wait` | independent review: by the other provider by default (Claude's work by Codex and the reverse), or a same-host subagent |
| `jodex plan start` / `jodex plan accept\|revise\|block` / `jodex test start` | collaborative mode: planner subagent, your challenge, tester subagent |
| `jodex cancel` | stop waiting for a subagent that will not report |
| `jodex calibrate [--apply]` | how well Jev's probabilities match what happened; `--apply` moves the risk cut (also automatic every 10 closed runs) |
| `jodex status` / `jodex resume` | show the open run / re-ground a new session |
| `jodex setup --statusline` / `jodex uninstall --statusline` | opt into / remove the Claude inline footer, preserving an existing footer |
| `jodex statusline [--mcp]` | renderer used by Claude's command footer / Codex's read-only MCP footer |
| `jodex accept` / `jodex reject` | record your decision and close the run |
| `jodex discard [run]` | close a test or abandoned run; calibration ignores it |
| `jodex board [--open]` | local dashboard of all runs (`~/.jodex/board/board.html`, refreshed after every run) |
| `pbpaste \| jodex key` | store the TypeSafe key for Jev decisions (`jodex init --jev` enables them per project) |
| `jodex doctor` | what is installed |
| `jodex uninstall --project [--purge]` | revert `init` in this project |
| `jodex uninstall` | remove Jodex from this machine |

Development: `npm run typecheck`, `npm test`, `npm run build`.

## Inline status

Keep using Claude Code or Codex normally. Jodex can show a compact footer in that same terminal, without a second TUI or model call:

```text
JODEX · Decision: Jev (last D1, enforced, 340ms) · Implementor: Codex (Sol)
Mode: review (Jev) · Risk: elevated · Stage: review
Waiting: reviewer/Claude (launch recorded, waiting 18s)
```

This is an example, not a live result. The actual footer uses the displayed project and session. `Decision` distinguishes observed Jev, advisory/enforced, rules with Jev off, fallback, and not yet observed. `Stage` describes the recorded workflow; `requested` and `launched` do not assert that a process is still running. An overdue role is marked with unknown liveness. Codex can additionally show native `Activity`; Claude supplies no equivalent busy signal. Closed outcomes are explicitly **last recorded**, not fresh verification of the current source. Use `jodex status` for current gates and `Next:`.

**Claude Code:** after building the checkout, run:

```sh
jodex setup --statusline
```

This explicit action only installs the footer command in `${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json`; it does not install plugins or call providers. It preserves other keys and file permissions, saves a mode-600 backup beside an existing settings file, and refuses malformed or linked settings. It never replaces a configured `statusLine`, including an existing Ponytail footer. Project/managed settings may override the user setting. Reopen Claude Code if needed.

To compose with an existing footer, keep its command and have your own statusline wrapper pass the same input to both commands. For example, save this script and point Claude's `statusLine.command` at it, replacing the existing-script path with your current command:

```sh
#!/bin/sh
payload=$(cat)
printf '%s\n' "$payload" | /absolute/path/to/existing-statusline.sh
printf '\n'
printf '%s\n' "$payload" | jodex statusline
```

Jodex does not execute or replace that existing command during setup. `jodex uninstall --statusline` removes only an unchanged, Jodex-owned command; it preserves a command you subsequently edit. If you composed a wrapper yourself, remove its Jodex call yourself. Settings backups are retained for manual recovery.

**Codex:** rebuild and refresh the installed Jodex plugin with `jodex setup`, then enable **Custom status line** in `/experimental`, restart the TUI and use `/statusline` → **Choose a status line provider** → **Jodex**. This feature is experimental in the locally checked Codex 0.171.0. The plugin supplies a small local read-only MCP statusline resource; it does not expose workflow mutations or call another agent. Leave existing providers selected until you choose to switch. Restore your previous provider/built-in footer through `/statusline`. If Jodex is absent, check that the installed plugin cache contains the rebuilt manifest and bundle; a cached older plugin must be refreshed through Codex's plugin installation commands.

The footer is blank outside an initialized project. Missing session identity is shown as unknown instead of selecting another session's run. It never scans/hashes the source or expires/mutates runs on a refresh. Native visual activation remains a separate check from local renderer/protocol tests; host trust, managed settings and disabled MCP/plugins may prevent it from loading. This footer does not implement display adapters for other agents yet.

## Repository contents

| Path | Role in v4 |
|---|---|
| [coding-harness-v4.md](coding-harness-v4.md) | product specification (current) |
| [coding-harness-v3.2.md](coding-harness-v3.2.md) | previous specification; core flow, contracts and review cycle are retained in v4 |
| [docs/ai/](docs/ai/) | AI DevKit lifecycle documents for feature `coding-harness` (requirements → testing) |
| [src/](src/), [test/](test/), [plugin/](plugin/) | M1 implementation, tests, and the plugin shared by both hosts |
| [docs/history/v3.2/](docs/history/v3.2/) | archived v3.2 lifecycle documents and README, including the tested native Claude static profile |
| [scripts/review_snapshot.py](scripts/review_snapshot.py), [tests/](tests/) | tested snapshot helper; source and acceptance suite for the M2 TypeScript port |
| [.agents/skills/](.agents/skills/) | v3.2 manual instruction pack (solo/review/collaborate); input to the v4 role prompts, replaced in M2 |
| [.codex/](.codex/) | Codex roles used to develop this repository (see below) |

The v3.2 instruction pack still works as documented in the [archived README](docs/history/v3.2/README.md), within its tested fixture scope. It is not the v4 product.

## Develop this repository

[AGENTS.md](AGENTS.md) defines the engineering policy and the approved-plan workflow. The workflow runs three sequential Codex roles from `.codex/agents/`:

| Role | Model | Effort |
|---|---|---|
| implementer | gpt-6.1-sol | medium |
| unit_tester | gpt-6.1-terra | medium |
| code_reviewer | gpt-6.1-sol | medium |

The workflow requires `multi_agent_v2` and a trusted project. Review the project configuration before accepting trust.

```sh
codex -c 'mcp_servers={}' --disable plugins --disable apps --sandbox workspace-write --ask-for-approval on-request -C /absolute/path/to/jodex-harness
```

Some flags affect more than one invocation:

- `mcp_servers={}` and the disabled plugins/apps apply only to that invocation. They exclude personal integrations that failed startup during v3.2 work.
- `--trust` persists trust for the project, including its configured MCP commands.

Only one role writes at a time. One correction cycle is allowed by default. Confirm that the roles and models are available before relying on the workflow.
