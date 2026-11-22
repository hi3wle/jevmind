import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('the declared Codex footer transport starts from PATH without plugin-root expansion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jodex-footer-launcher-'));
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  fs.writeFileSync(path.join(root, 'jodex'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`, { mode: 0o755 });
  const declared = JSON.parse(fs.readFileSync(new URL('../plugin/.codex-plugin/statusline.mcp.json', import.meta.url), 'utf8')).mcpServers['jodex-statusline'];
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const result = spawnSync(declared.command, declared.args, {
    cwd: root, input, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH ?? ''}` },
  });
  assert.equal(result.status, 0, result.stderr);
  const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(replies.length, 2);
  assert.equal(replies[0].result.serverInfo.name, 'jodex-statusline');
  assert.deepEqual(replies[1].result.tools[0]._meta['openai/ui'].entrypoints, [{ type: 'statusline', resourceUri: 'ui://jodex/footer' }]);
});
