import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { baseDir } from './config.js';

const term = await import('./terminal.js');
// shortcut: node-pty's Windows ConPTY keeps a handle open after the program ends, so this test file ends itself (keeps the exit code)
test.after(() => setTimeout(() => process.exit(), 200));

test('the Director never inherits the markers of a Claude session that started the hub', () => {
  const e = term.cleanEnv({ PATH: 'x', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'a', ANTHROPIC_BASE_URL: 'http://host', ANTHROPIC_API_KEY: 'k' });
  assert.deepEqual(e, { PATH: 'x', ANTHROPIC_API_KEY: 'k' });
  assert.deepEqual(term.cleanEnv({ PATH: 'x', ANTHROPIC_BASE_URL: 'http://mine' }), { PATH: 'x', ANTHROPIC_BASE_URL: 'http://mine' });   // your own setting stays
});

test('the terminal runs a program in the workspace, takes typed input, and keeps output for a page that opens later', async () => {
  fs.mkdirSync(baseDir(), { recursive: true });
  const seen = [];
  assert.throws(() => term.input({ data: 'x' }), /not running/);
  const exited = new Promise(r => term.onTerm(ev => { seen.push(ev); if (ev.kind === 'exit') r(); }));
  term.start({ cols: 80, rows: 20 }, process.execPath, ['-e', 'process.stdout.write("ready\\n");process.stdin.on("data",d=>{process.stdout.write("got:"+d);process.exit(0)})']);
  assert.equal(term.busy(), true);
  for (let i = 0; i < 100 && !term.state().output.includes('ready'); i++) await new Promise(r => setTimeout(r, 50));
  term.input({ data: 'hello\r' });
  await exited;
  assert.equal(term.busy(), false);
  assert.match(term.state().output, /got:hello/);
  assert.ok(seen.some(e => e.kind === 'data'));
  assert.throws(() => term.input({ data: 1 }), /must be text/);
});
