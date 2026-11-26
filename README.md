# Jevmind — Adaptive Coding Harness

Jevmind (formerly Jodex) is an installable outer harness for coding agents: Jev decides the workflow and risk, Claude Code and Codex do the work. It is specified in [coding-harness-v4.md](coding-harness-v4.md):

- `jevmind setup` installs it once per machine;
- `jevmind init` enables it in a project;
- the developer then prompts Claude Code, Codex or another supported agent as usual.

Jevmind classifies the task and selects solo, review or collaborative mode. It coordinates plan → challenge → implement → test → review → correct → verify, and reports an evidence-backed completion status.

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
npx jevmind@latest setup             # once per machine; run it again to update
```

`setup` installs that version of `jevmind` globally, so hooks call the installed command and never download at run time. It asks which agents you use (Claude Code, Codex or both; arrow keys and space, pre-checked with the ones it finds, or `--agent claude,codex`), saves the choice in `~/.jevmind/config.toml` and installs the Jevmind plugin into those agents with their own marketplace commands. With one agent, every role runs on it (Claude: planner Opus, tester Haiku or Sonnet for critical risk, same-host reviewer; Codex: planner Astra, tester Luna, same-host reviewer); with both, each reviews the other's work. If no TypeSafe key is stored, it offers to save one for Jev. `jevmind init` asks again only to override the agents for that project. For Codex, open `codex`, run `/hooks`, and trust the Jevmind hooks once (again after an update changes them). Codex hooks run `jevmind hook` from `PATH`, because Codex 0.171.0 leaves plugin-root placeholders in hook commands unexpanded; start Codex where `command -v jevmind` succeeds. Run `jevmind setup --statusline` with the installed command, not through `npx`.

```sh
cd /path/to/your/project           # must be a git repository
jevmind init                         # shows the changes, asks before writing
claude                             # or: codex — then prompt as usual
```

## Your first run

1. **First file edit:** Jevmind opens a run for the task. Edits through the shell are caught when the agent stops.
2. **Before finishing:** the agent runs `jevmind check`. It runs the project's checks (from `.jevmind/config.toml`) and binds each result to the exact source it ran on.
3. **Stop gate:**
   - The agent must end with `Jevmind status: <status>`: `verified`, `review_required`, `failed_verification` or `blocked`.
   - An unsupported "done" is sent back once with the real gates.
   - A second stop always goes through, so the agent cannot loop.
   - Once the agent reports the status, the run ends. The next edit starts a new run, so a later task never inherits an earlier task's files or risk.
4. **Risk and review:** a critical path, a `review:`/`collab:` prompt prefix, or Jev's recommendation puts the run in review or collaborative mode. The reviewer is the other provider and read-only. Critical runs also need your approval: in Claude Code the agent asks in a dialog (Accept, Reject, Review the diff first); in Codex, or any time, run `jevmind accept`.
5. **Dangerous commands:** `rm -rf ~`, `git push --force`, `git reset --hard` and `git clean -f` are always denied. Unusual commands are judged by Jev.

| Command | Purpose |
|---|---|
| `jevmind check` | run the checks, print the status and the `Next:` step |
| `jevmind review start [--same-host] [--evidence <file>]` / `jevmind review wait` | independent review: by the other provider by default (Claude's work by Codex and the reverse), or a same-host subagent. The reviewer gets the session's last 5 prompts; `--evidence` attaches a screenshot or log (project or temp dir, ≤5 MB, never secret-looking files) |
| `jevmind plan start` / `jevmind plan accept\|revise\|block` / `jevmind test start` | collaborative mode: planner subagent, your challenge, tester subagent |
| `jevmind cancel` | stop waiting for a subagent that will not report |
| `jevmind calibrate [--apply]` | how well Jev's probabilities match what happened; `--apply` moves the risk cut (also automatic every 10 closed runs) |
| `jevmind status` / `jevmind resume` | show the open run / re-ground a new session |
| `jevmind setup --statusline` / `jevmind uninstall --statusline` | opt into / remove the Claude inline footer, preserving an existing footer |
| `jevmind statusline [--mcp]` | renderer used by Claude's command footer / Codex's read-only MCP footer |
| `jevmind accept` / `jevmind reject` | record your decision and close the run |
| `jevmind discard [run]` | close a test or abandoned run; calibration ignores it |
| `jevmind board [--open]` | local dashboard of all runs (`~/.jevmind/board/board.html`, refreshed after every run) |
| `pbpaste \| jevmind key` | store the TypeSafe key for Jev decisions (`jevmind init --jev` enables them per project) |
| `jevmind doctor` | what is installed |
| `jevmind uninstall --project [--purge]` | revert `init` in this project |
| `jevmind uninstall` | remove Jevmind from this machine |

Development: `npm run typecheck`, `npm test`, `npm run build`.

## Live board and model routing

New projects start with `mode = "apply"` under `[models]` in `.jevmind/config.toml`. Each role gets a model at effort medium; only the planner goes to high, on critical runs. A critical run moves the other roles to a stronger model instead. Claude: planner Opus, tester Haiku (Sonnet when critical), reviewer Sonnet (Opus when critical). Codex: planner Astra, tester Luna high (Sol medium when critical), reviewer Sol (Astra when critical). Your own session is the implementor, so Jevmind only suggests its model (Sonnet, Opus when critical; Sol medium on every run) at the start of a task. Full table: coding-harness-v4.md §17. To limit which models and efforts each step may use, run `jevmind models`. It is also offered at the end of setup, and you can run it again anytime. Keep the recommendation, or pick the allowed models and efforts for each step, review them, and save. Jevmind then chooses within your limits.

Set `mode = "off"` to use host defaults, or `"shadow"` to record proposals only. Running `jevmind init` again preserves existing settings. Older configs without `[models]` use host defaults.

`jevmind board --live` shows connected Planner → Implementor → Tester → Reviewer cards, with the recorded activity and Decision/Checks/Outcome gates below. Requested and observed models stay separate; unknown observations remain explicit. Updates arrive through server events with a polling fallback. Select a run by keyboard or click to filter its session; nodes stack on narrow screens. Recorded handoffs and recent activity are not proof a process is alive.

For the optional terminal footer, see the [Claude Code and Codex setup guide](docs/statusline.md).

## Migrating from Jodex

Jodex was renamed to Jevmind. To move a machine and its projects:

1. With the old command, remove the old install: `jodex uninstall`.
2. Keep your settings and Jev key: `mv ~/.jodex ~/.jevmind`.
3. Install Jevmind: `npx jevmind@latest setup`. In Codex, run `/hooks` and trust the Jevmind hooks; in Claude Code, run `/reload-plugins`.
4. In each project: `jevmind init`. It renames `.jodex/` to `.jevmind/` and updates the AGENTS.md block and `.gitignore` lines, after you confirm.

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

Install from a checkout instead of npm (`setup` then links the checkout onto your PATH):

```sh
git clone https://github.com/hi3wle/jevmind.git jevmind && cd jevmind
npm ci && npm run build
node plugin/dist/jevmind.mjs setup
```

[AGENTS.md](AGENTS.md) defines the engineering policy and the approved-plan workflow. The workflow runs three sequential Codex roles from `.codex/agents/`:

| Role | Model | Effort |
|---|---|---|
| implementer | gpt-6.1-sol | medium |
| unit_tester | gpt-6.1-terra | medium |
| code_reviewer | gpt-6.1-sol | medium |

The workflow requires `multi_agent_v2` and a trusted project. Review the project configuration before accepting trust.

```sh
codex -c 'mcp_servers={}' --disable plugins --disable apps --sandbox workspace-write --ask-for-approval on-request -C /absolute/path/to/jevmind
```

Some flags affect more than one invocation:

- `mcp_servers={}` and the disabled plugins/apps apply only to that invocation. They exclude personal integrations that failed startup during v3.2 work.
- `--trust` persists trust for the project, including its configured MCP commands.

Only one role writes at a time. One correction cycle is allowed by default. Confirm that the roles and models are available before relying on the workflow.
