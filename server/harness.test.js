import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as harness from './harness.js';

const dir = path.resolve('.test-tmp', 'harness');

test('other coding agents: an npm launcher runs without a shell, the crew is mirrored, OpenCode events read', () => {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'bin', 'node_modules', 'qx'), { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'bin', 'qx.cmd'), '@ECHO off\r\n' + String.raw`"%_prog%"  "%dp0%\node_modules\qx\cli.js" %*` + '\r\n');
    fs.writeFileSync(path.join(dir, 'bin', 'node_modules', 'qx', 'cli.js'), '');
    assert.deepEqual(harness.which('qx', { PATH: path.join(dir, 'bin') }), [process.execPath, path.join(dir, 'bin', 'node_modules', 'qx', 'cli.js')]);
  }
  assert.equal(harness.which('nothing-like-this', { PATH: path.join(dir, 'bin') }), null);
  const crew = path.join(dir, 'crew'); fs.mkdirSync(path.join(crew, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(crew, 'CLAUDE.md'), '# Director\nDirect.');
  fs.writeFileSync(path.join(crew, '.claude', 'agents', 'audio-cleaner.md'), '---\nname: audio-cleaner\ndescription: Cleans audio\nskills: raw-footage-cut\n---\nClean it.\n');
  harness.mirror('qwen', crew); harness.mirror('opencode', crew);
  assert.match(fs.readFileSync(path.join(crew, 'QWEN.md'), 'utf8'), /# Director/);
  assert.match(fs.readFileSync(path.join(crew, 'AGENTS.md'), 'utf8'), /# Director/);
  const q = fs.readFileSync(path.join(crew, '.qwen', 'agents', 'audio-cleaner.md'), 'utf8');
  assert.match(q, /^---\nname: audio-cleaner\ndescription: Cleans audio\n---/); assert.ok(q.includes(path.join('raw-footage-cut', 'SKILL.md'))); assert.match(q, /Clean it\./);
  assert.match(fs.readFileSync(path.join(crew, '.opencode', 'agent', 'audio-cleaner.md'), 'utf8'), /mode: subagent/);
  assert.deepEqual(harness.openCodeEvents({ type: 'text', part: { text: 'Hi' } }), [{ kind: 'text', text: 'Hi' }]);
  assert.equal(harness.openCodeEvents({ type: 'tool_use', part: { tool: 'bash', callID: 'c1', state: { input: { command: 'ls' } } } })[0].text, 'ls');
  assert.equal(harness.openCodeEvents({ type: 'error', error: { data: { message: 'This API key has expired.' } } })[0].ok, false);
  assert.throws(() => harness.use({ id: 'nope' }), /Unknown coding agent/);
});
