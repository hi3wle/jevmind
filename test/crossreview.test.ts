import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runChecks } from '../src/checks.ts';
import { loadConfig } from '../src/config.ts';
import { runReviewer } from '../src/crossreview.ts';
import { handleHook } from '../src/hooks.ts';
import { listRuns, saveRun } from '../src/run.ts';
import { startReview } from '../src/team.ts';
import { tempRepo } from './helpers.ts';

// Fake provider CLIs: each answers --version and returns a ReviewResult for the snapshot in the brief.
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fakebin-'));
const result = (status: string) => `const brief = process.argv.find((a) => a.includes('Snapshot ID')) || '';
const id = (brief.match(/"snapshotId": "([0-9a-f]+)"/) || [])[1];
const r = '\`\`\`json\\n' + JSON.stringify({ snapshotId: id, status: '${status}', findings: [] }) + '\\n\`\`\`';`;
fs.writeFileSync(path.join(bin, 'codex'), `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('codex-cli fake'); process.exit(0); }
if (process.argv.includes('read-only') === false) process.exit(3);
${result('no_blocking_findings')}
require('fs').writeFileSync(process.argv[process.argv.indexOf('-o') + 1], 'Reviewed.\\n' + r);
`);
fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('claude fake'); process.exit(0); }
if (!process.argv.includes('Read,Glob,Grep')) process.exit(3);
${result('no_blocking_findings')}
console.log(JSON.stringify({ result: r, total_cost_usd: 0.01, modelUsage: { 'claude-sonnet-fake': {} } }));
`);
for (const f of ['codex', 'claude']) fs.chmodSync(path.join(bin, f), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

function repo() {
  const root = tempRepo({ 'src/a.js': 'export const a = 1;\n' });
  fs.mkdirSync(path.join(root, '.jodex'));
  fs.writeFileSync(path.join(root, '.jodex/config.toml'), '[risk]\ncritical = []\n[checks]\ntest = "true"\n');
  return root;
}

for (const [worker, reviewer, extra] of [['claude-code', 'codex', {}], ['codex', 'claude-code', { turn_id: 't' }]] as const) {
  test(`${worker} work is reviewed by ${reviewer}`, async () => {
    const root = repo();
    const ev = (name: string, more: object = {}) => ({ hook_event_name: name, session_id: 'S', cwd: root, ...extra, ...more });
    await handleHook(ev('UserPromptSubmit', { prompt: 'review: change a' }));
    await handleHook(ev('PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/a.js') } }));
    fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 2;\n');
    let run = listRuns(root)[0];
    runChecks(root, loadConfig(root), run, () => {});
    const out = startReview(root, run, loadConfig(root));
    assert.match(out.text, /cross-provider review/);
    assert.equal(run.reviews![0].reviewer!.host, reviewer);
    saveRun(root, run);
    await runReviewer(root, run.runId);
    run = listRuns(root)[0];
    assert.equal(run.reviews![0].status, 'no_blocking_findings');
    assert.equal(run.awaiting, null);
    if (reviewer === 'claude-code') assert.equal(run.reviews![0].reviewer!.model, 'claude-sonnet-fake');
  });
}
