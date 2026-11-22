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
git clone https://github.com/hi3wle/jodex-harness.git jodex && cd jodex
npm ci && npm run build
node plugin/dist/jodex.mjs setup   # once per machine
```

`setup` links the `jodex` command onto your PATH. It then installs the Jodex plugin into each host it finds, using the host's own marketplace commands. For Codex, open `codex`, run `/hooks`, and trust the Jodex hooks once (again after an update changes them). Codex hooks run `jodex hook` from `PATH`, because Codex 0.171.0 leaves plugin-root placeholders in hook commands unexpanded; start Codex where `command -v jodex` succeeds.

```sh
cd /path/to/your/project           # must be a git repository
jodex init                         # shows the changes, asks before writing
claude                             # or: codex — then prompt as usual
```

## Your first run

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
| `jodex review start [--same-host] [--evidence <file>]` / `jodex review wait` | independent review: by the other provider by default (Claude's work by Codex and the reverse), or a same-host subagent. The reviewer gets the session's last 5 prompts; `--evidence` attaches a screenshot or log (project or temp dir, ≤5 MB, never secret-looking files) |
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

## Live board and model routing

New projects start with `mode = "apply"` under `[models]` in `.jodex/config.toml`. Jodex requests Opus on Claude or Astra high on Codex for planning. For testing, it requests Luna high on Codex, and Haiku on Claude (Sonnet for critical risk). Reviewer and implementor keep their host settings.

Set `mode = "off"` to use host defaults, or `"shadow"` to record proposals only. Running `jodex init` again preserves existing settings. Older configs without `[models]` use host defaults.

`jodex board --live` shows connected Planner → Implementor → Tester → Reviewer cards, with the recorded activity and Decision/Checks/Outcome gates below. Requested and observed models stay separate; unknown observations remain explicit. Updates arrive through server events with a polling fallback. Select a run by keyboard or click to filter its session; nodes stack on narrow screens. Recorded handoffs and recent activity are not proof a process is alive.

For the optional terminal footer, see the [Claude Code and Codex setup guide](docs/statusline.md).

## Repository contents

| Path | Role in v4 |
|---|---|
| [coding-harness-v4.md](coding-harness-v4.md) | product specification (current) |
| [coding-harness-v3.2.md](coding-harness-v3.2.md) | previous specification; core flow, contracts and review cycle are retained in v4 |
| [docs/ai/](docs/ai/) | AI DevKit lifecycle documents for feature `coding-harness` (requirements → testing) |
| [src/](src/), [tests/](tests/), [plugin/](plugin/) | M1 implementation, tests, and the plugin shared by both hosts |
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
