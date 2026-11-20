import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { jodexHome, refreshBoard, registerProject, writeBoard } from './board.ts';
import { apiKey, keyFile, saveKey } from './jev.ts';
import { calibrate } from './calibrate.ts';
import { launchReviewer, runReviewer, waitReview } from './crossreview.ts';
import { decidePlan, reconcileSession, startPlan, startReview, startTests } from './team.ts';
import { runChecks } from './checks.ts';
import { loadConfig } from './config.ts';
import { type HookEvent, handleHook } from './hooks.ts';
import { planInit, uninstallProject } from './init.ts';
import { gitRoot, isInitialized, sourceIdentity } from './project.ts';
import { createRun, evaluate, expireAwaiting, formatStatus, listRuns, type Run, saveRun, updateRun } from './run.ts';
import { doctor, setup, setupStatusline, uninstallGlobal } from './setup.ts';
import { renderStatusline, serveStatusline } from './statusline.ts';

const HELP = `jodex — adaptive coding harness

  jodex setup                 install Jodex into Claude Code and Codex (once per machine)
  jodex setup --statusline    enable the Claude footer if no statusLine is already configured
  jodex statusline [--mcp]    native footer: Claude JSON stdin or read-only Codex MCP stdio
  jodex init [--yes] [--jev]  enable Jodex in the current git project (--jev: enable Jev decisions)
  jodex key                   store the TypeSafe API key read from stdin (~/.jodex/typesafe.key, mode 600)
  jodex check                 run the project's checks and print the run status
  jodex review start [--same-host]
                              open an independent review round (the other provider by default)
  jodex review wait           wait for the review result and print the status
  jodex plan start            ask a planner subagent for a plan (collaborative mode)
  jodex plan accept|revise|block [reason]
                              record your challenge of the latest plan
  jodex test start            hand test writing to a tester subagent
  jodex cancel                stop waiting for a subagent that will not report
  jodex status                print the current run status
  jodex resume                print the current run for a new session to re-ground
  jodex accept|reject [run]   record the developer's decision and close the run
  jodex discard [run]         close a test or abandoned run; calibration ignores it
  jodex calibrate [--apply]   reliability of Jev's probabilities against outcomes; --apply moves the risk cut
  jodex board [--open]        write the local dashboard (~/.jodex/board/board.html)
  jodex doctor                show what is installed and supported
  jodex uninstall [--statusline | --project [--purge]]
                              remove Jodex from this machine, or from the current project
`;

const log = (s: string) => process.stdout.write(`${s}\n`);
const fail = (s: string): never => {
  process.stderr.write(`${s}\n`);
  process.exit(1);
};

function projectRoot(): string {
  const root = gitRoot(process.cwd()) ?? fail('Not inside a git repository.');
  if (!isInitialized(root)) fail('Jodex is not enabled here; run `jodex init`.');
  return root;
}

const currentRun = (root: string): Run | undefined => {
  const run = listRuns(root).findLast((r) => r.open);
  if (run && expireAwaiting(run)) saveRun(root, run);
  return run;
};

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const flag = (f: string) => rest.includes(f);
  switch (cmd) {
    case 'statusline': {
      if (flag('--mcp')) return serveStatusline();
      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      try {
        const text = renderStatusline(JSON.parse(raw), 'claude-code');
        if (text) log(text);
      } catch { /* Invalid host input must not disturb the native prompt. */ }
      return;
    }
    case 'hook': {
      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      try {
        log(JSON.stringify(await handleHook(JSON.parse(raw) as HookEvent)));
      } catch (e) {
        // Fail open: a broken hook must not block the developer's agent. The error is kept for `doctor`.
        const file = path.join(jodexHome(), 'hook-errors.log');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${new Date().toISOString()} ${(e as Error).stack}\n`);
        log('{}');
      }
      return;
    }
    case 'setup':
      if (flag('--statusline')) {
        if (!setupStatusline(log)) process.exitCode = 1;
        return;
      }
      if (!setup(log)) process.exitCode = 1;
      return;
    case 'init': {
      const root = gitRoot(process.cwd()) ?? fail('Not inside a git repository; run `git init` first.');
      let useJev = flag('--jev');
      if (!useJev && !flag('--yes') && process.stdin.isTTY && apiKey()) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const a = await rl.question('Enable Jev decisions? This sends each prompt (secrets redacted) and project metadata, never source, to TypeSafe. [y/N] ');
        rl.close();
        useJev = /^y(es)?$/i.test(a.trim());
      }
      const changes = planInit(root, useJev);
      if (!changes.length) {
        registerProject(root, true);
        return log('Jodex is already enabled in this project.');
      }
      log(`Jodex will change ${root}:`);
      for (const c of changes) log(`  ${c.file}: ${c.summary}`);
      if (!flag('--yes')) {
        if (!process.stdin.isTTY) fail('Re-run with --yes to apply these changes.');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question('Apply? [y/N] ');
        rl.close();
        if (!/^y(es)?$/i.test(answer.trim())) return log('Nothing changed.');
      }
      for (const c of changes) c.apply();
      registerProject(root, true);
      refreshBoard();
      return log('Done. Start a new Claude Code or Codex session in this project.');
    }
    case 'check': {
      const root = projectRoot();
      const cfg = loadConfig(root);
      const run = currentRun(root) ?? createRun(root, null, '');
      reconcileSession(root, run, cfg);
      saveRun(root, run);
      runChecks(root, cfg, run, log);
      // Merge only the check results: a detached reviewer may have saved the run meanwhile.
      const saved = updateRun(root, run.runId, (fresh) => Object.assign(fresh.checks, run.checks)) ?? run;
      refreshBoard();
      return log(formatStatus(saved, evaluate(saved, cfg, sourceIdentity(root))));
    }
    case 'review':
    case 'plan':
    case 'test': {
      const root = projectRoot();
      const cfg = loadConfig(root);
      const run = currentRun(root) ?? (cmd === 'plan' && rest[0] === 'start' ? createRun(root, null, '') : fail('No open Jodex run; edit a file or run `jodex check` first.'));
      const sub = rest[0];
      let out: { ok: boolean; text: string };
      if (cmd === 'review' && sub === 'run') return runReviewer(root, rest[1]); // detached reviewer process
      if (cmd === 'review' && sub === 'wait') {
        launchReviewer(root, run, process.argv[1]);
        const done = await waitReview(root, run.runId, process.argv[1], 100 * 1000); // fits the default 2-minute Bash tool timeout
        const review = done?.reviews?.at(-1);
        if (!done || !review?.at) return log('The review is still running; run `jodex review wait` again.');
        log(`${review.round} by ${review.reviewer?.host ?? 'subagent'}${review.reviewer?.model ? ` (${review.reviewer.model})` : ''}: ${review.status}${review.error ? ` (${review.error})` : ''}`);
        for (const f of review.findings) log(`  [${f.severity}${f.severity === 'blocking' ? (f.confirmed ? ', confirmed' : ', disputed by Jev') : ''}] ${f.location}: ${f.issue}`);
        return log(formatStatus(done, evaluate(done, cfg, sourceIdentity(root))));
      }
      if (cmd === 'review' && sub === 'start') out = startReview(root, run, cfg, flag('--same-host'));
      else if (cmd === 'test' && sub === 'start') out = startTests(root, run);
      else if (cmd === 'plan' && sub === 'start') out = startPlan(root, run);
      else if (cmd === 'plan' && ['accept', 'revise', 'block'].includes(sub)) out = { ok: true, text: decidePlan(run, sub === 'block' ? 'blocked' : (sub as 'accept' | 'revise'), rest.slice(1).join(' ')) };
      else return fail(HELP);
      saveRun(root, run);
      refreshBoard();
      log(out.text);
      if (!out.ok) process.exitCode = 1;
      return;
    }
    case 'cancel': {
      const root = projectRoot();
      const run = currentRun(root);
      if (!run?.awaiting) return log('Nothing to cancel.');
      const role = run.awaiting.role;
      expireAwaiting(run, 'cancelled by `jodex cancel`');
      saveRun(root, run);
      return log(`Stopped waiting for the ${role}.`);
    }
    case 'status':
    case 'resume': {
      const root = projectRoot();
      const run = currentRun(root);
      if (!run) return log('No open Jodex run in this project.');
      if (cmd === 'resume') {
        log(`Original request: ${run.request || '(unknown)'}`);
        log(`Files touched: ${run.touched.join(', ') || '(none recorded)'}`);
      }
      log(formatStatus(run, evaluate(run, loadConfig(root), sourceIdentity(root))));
      if (cmd === 'resume') log('Re-read the request, AGENTS.md and the changed files before writing; run `jodex check` before finishing.');
      return;
    }
    case 'accept':
    case 'reject':
    case 'discard': {
      const root = projectRoot();
      // Default: the latest run still without a decision, open or closed (critical runs close at review_required).
      const run = (rest[0] ? listRuns(root).find((r) => r.runId === rest[0]) : listRuns(root).findLast((r) => !r.acceptance)) ??
        fail(listRuns(root).length ? 'No run waiting for a decision.' : 'No Jodex runs in this checkout yet. Runs stay in the checkout where the agent worked (each git worktree has its own).');
      const identity = sourceIdentity(root);
      run.acceptance = { decision: cmd === 'accept' ? 'accepted' : cmd === 'reject' ? 'rejected' : 'discarded', at: new Date().toISOString(), identity };
      run.open = false;
      // Acceptance satisfies a required human review for this source only; the status is recomputed.
      const result = evaluate(run, loadConfig(root), identity);
      run.completion = { status: result.status, identity, at: run.acceptance.at };
      saveRun(root, run);
      refreshBoard();
      return log(`Run ${run.runId} ${run.acceptance.decision} and closed.\n${formatStatus(run, result)}`);
    }
    case 'key': {
      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      if (!raw.trim()) fail('Pipe the key on stdin, e.g. `pbpaste | jodex key`.');
      saveKey(raw);
      return log(`Saved to ${keyFile()} (mode 600).`);
    }
    case 'calibrate': {
      const root = projectRoot();
      const r = calibrate(root, flag('--apply'));
      for (const s of r.signals) {
        log(`${s.signal}: ${s.n} labeled (${s.positives} positive; label = ${s.label})${s.brier !== null ? `, Brier ${s.brier}` : ''}`);
        for (const b of s.reliability) log(`  p ${b.band}: n=${b.n} predicted ${b.predicted} observed ${b.observed}`);
      }
      log(`raise_risk: current ${r.raiseRisk.current}; ${r.raiseRisk.proposed === null ? r.raiseRisk.reason : `proposed ${r.raiseRisk.proposed} (${r.raiseRisk.reason}, balanced accuracy ${r.raiseRisk.balancedAccuracy})`}${r.applied ? '; applied' : ''}`);
      refreshBoard();
      return;
    }
    case 'board': {
      const file = writeBoard();
      log(file);
      if (flag('--open')) spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [file], { stdio: 'ignore' });
      return;
    }
    case 'doctor':
      return doctor(process.cwd(), log);
    case 'uninstall':
      if (flag('--statusline')) {
        if (!setupStatusline(log, true)) process.exitCode = 1;
        return;
      }
      if (flag('--project')) {
        const root = projectRoot();
        for (const line of uninstallProject(root, flag('--purge'))) log(line);
        registerProject(root, false);
        refreshBoard();
      } else if (!uninstallGlobal(log)) process.exitCode = 1;
      return;
    default:
      log(HELP);
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
