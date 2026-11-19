import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// never your real crew or settings, even when this file runs on its own (npm test sets these too): a crew folder and
// a data folder (config.json) of its own under .test-tmp, set before config.js loads
process.env.VIDEOHUB_DATA_DIR ||= path.resolve('.test-tmp', 'data');
process.env.VIDEOHUB_BASE_DIR ||= path.resolve('.test-tmp', 'base');
const { baseDir } = await import('./config.js');
const CREW = path.resolve('.test-tmp', 'crew-under-test');
fs.rmSync(CREW, { recursive: true, force: true });
process.env.VIDEOHUB_CREW_DIR = CREW;
const crew = await import('./crew.js');

test('crew files: only CLAUDE.md, settings.json and agents/<id>.md, validated before saving', () => {
  const dir = CREW;
  assert.equal(crew.crewDir(), dir);   // an empty crew folder is made from the starter crew
  assert.equal(crew.fileOf('CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
  assert.equal(crew.fileOf('agents/editor.md'), path.join(dir, '.claude', 'agents', 'editor.md'));
  const ids = crew.agents().map(a => a.id);
  for (const id of ['editor', 'writer']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('_template'));   // the template stays out
  assert.ok(fs.existsSync(path.join(dir, 'voice-words.txt')));
  for (const k of ['../x.md', 'agents/../../x.md', 'agents/A B.md', 'secrets.json']) assert.throws(() => crew.fileOf(k), /Not a crew file/);
  assert.throws(() => crew.write({ key: 'settings.json', text: '{ nope' }), /not valid JSON/);
  assert.throws(() => crew.write({ key: 'agents/x.md', text: 'no front matter' }), /front matter/);
  crew.write({ key: 'settings.json', text: '{"permissions":{"defaultMode":"auto"}}\n' });
  assert.match(crew.read('settings.json').text, /auto/);
});

test('a new agent starts from a template and shows in the list with its skills', () => {
  fs.rmSync(crew.fileOf('agents/devin-editor.md'), { force: true });
  crew.newAgent({ id: 'devin-editor' });
  assert.throws(() => crew.newAgent({ id: 'devin-editor' }), /already exists/);
  assert.throws(() => crew.newAgent({ id: 'Devin Editor' }), /lowercase/);
  const t = crew.read('agents/devin-editor.md').text.replace('skills: ', 'skills: devin-style, onetake');
  crew.write({ key: 'agents/devin-editor.md', text: t });
  const a = crew.status().agents.find(x => x.id === 'devin-editor');
  assert.deepEqual(a.skills, ['devin-style', 'onetake']);
  assert.match(crew.read('agents/devin-editor.md').text, /You are the devin-editor/);
});

test('a new Director per kind of content: its own crew folder, your instructions, no agents yet; switch back and forth', () => {
  delete process.env.VIDEOHUB_CREW_DIR; crew.setCrewDir({ dir: CREW });   // the setting decides from here on
  const made = path.join(path.dirname(CREW), 'cartoon-explainers-crew');
  fs.rmSync(made, { recursive: true, force: true });
  const c = crew.createCrew({ name: 'Cartoon explainers', about: 'Short cartoon explainers for kids, 60 s, Darija.' });
  assert.equal(c.dir, made); assert.equal(crew.crewDir(), made);
  const md = fs.readFileSync(path.join(made, 'CLAUDE.md'), 'utf8');
  assert.match(md, /## This Director: Cartoon explainers/); assert.match(md, /Short cartoon explainers for kids/); assert.match(md, /Your first job is to design the crew/);
  assert.deepEqual(crew.agents(), []);   // it builds its own
  assert.throws(() => crew.createCrew({ name: 'Cartoon explainers', about: 'x' }), /already exists/);
  assert.throws(() => crew.createCrew({ name: 'x' }), /Describe the content/);
  const list = crew.crews(); assert.ok(list.some(x => x.dir === CREW)); assert.ok(list.find(x => x.dir === made).active);
  crew.useCrew({ dir: CREW }); assert.equal(crew.crewDir(), CREW);
  assert.throws(() => crew.useCrew({ dir: 'C:\nowhere' }), /No such crew/);
  process.env.VIDEOHUB_CREW_DIR = CREW;
});

test('the Director of directors comes first, sees the studio folder, and new crew folders are found on their own', () => {
  const list = crew.crews();
  assert.equal(list[0].name, crew.HEAD_NAME); assert.ok(list[0].head);
  const md = fs.readFileSync(path.join(crew.headDir(), 'CLAUDE.md'), 'utf8');
  assert.match(md, /# Director of directors/); assert.ok(md.includes(crew.studioDir())); assert.doesNotMatch(md, /\{\{/);
  const extra = path.join(crew.studioDir(), 'found-by-itself-crew');
  fs.rmSync(extra, { recursive: true, force: true }); fs.mkdirSync(path.join(extra, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(extra, 'CLAUDE.md'), '# Director');
  assert.ok(crew.crews().some(c => c.dir === extra && c.name === 'found-by-itself'));
  fs.rmSync(extra, { recursive: true, force: true });
});

test("any Director's instructions read and saved without switching to it; unknown folders refused", () => {
  const head = crew.instructionsOf({ dir: crew.headDir() });
  assert.equal(head.name, crew.HEAD_NAME); assert.match(head.text, /# Director of directors/);
  crew.saveInstructions({ dir: crew.headDir(), text: head.text + '\nOne more rule.\n' });
  assert.match(crew.instructionsOf({ dir: crew.headDir() }).text, /One more rule\./);
  assert.throws(() => crew.instructionsOf({ dir: 'C:\Windows' }), /No such Director/);
});

test('shared agents: copied into every crew, the crew\x27s own wins, an edit reaches the library', () => {
  const lib = path.resolve('.test-tmp', 'shared-lib'); fs.rmSync(lib, { recursive: true, force: true }); fs.mkdirSync(lib, { recursive: true });
  process.env.VIDEOHUB_SHARED_AGENTS = lib;
  fs.writeFileSync(path.join(lib, 'glass-editor.md'), '---\nshared: true\nname: glass-editor\ndescription: Glass edits\nskills: talking-head-glass-edit\n---\nEdit in glass.\n');
  fs.writeFileSync(path.join(lib, 'editor.md'), '---\nshared: true\nname: audio-cleaner\ndescription: shared cleaner\n---\nx\n');
  assert.ok(crew.syncShared() >= 1);
  const g = crew.agents().find(a => a.id === 'glass-editor'); assert.ok(g.shared);
  assert.equal(crew.agents().find(a => a.id === 'editor').shared, false);   // the crew has its own editor: it wins
  crew.write({ key: 'agents/glass-editor.md', text: crew.read('agents/glass-editor.md').text.replace('Edit in glass.', 'Edit in glass, softly.') });
  assert.match(fs.readFileSync(path.join(lib, 'glass-editor.md'), 'utf8'), /softly/);
  crew.shareAgent({ id: 'writer' });
  assert.ok(fs.existsSync(path.join(lib, 'writer.md'))); assert.ok(crew.agents().find(a => a.id === 'writer').shared);
  delete process.env.VIDEOHUB_SHARED_AGENTS;
});

test("an agent's memory: read MEMORY.md first, save corrections, refuse odd names", () => {
  assert.deepEqual(crew.memoryOf({ id: 'editor' }).files, []);
  crew.saveMemory({ id: 'editor', text: '- The user wants 48 kHz exports\n' });
  const m = crew.memoryOf({ id: 'editor' });
  assert.equal(m.files[0].name, 'MEMORY.md'); assert.match(m.files[0].text, /48 kHz/);
  assert.throws(() => crew.memoryOf({ id: '../x' }), /bad agent name/);
  assert.throws(() => crew.saveMemory({ id: 'editor', name: '../evil.md', text: 'x' }), /bad file name/);
});

test("a Director's kit: seeded from the skills its files name, saved filtered, linked into a private folder", () => {
  const skills = path.resolve('.test-tmp', 'skills-under-test'), dir = crew.crewDir();
  fs.rmSync(skills, { recursive: true, force: true });
  for (const s of ['videohub', 'onetake', 'unused-skill']) { fs.mkdirSync(path.join(skills, s), { recursive: true }); fs.writeFileSync(path.join(skills, s, 'SKILL.md'), '---\nname: ' + s + '\n---\n'); }
  const was = process.env.VIDEOHUB_SKILLS_DIR; process.env.VIDEOHUB_SKILLS_DIR = skills;
  try {
    fs.rmSync(path.join(dir, '.claude', 'videohub.json'), { force: true });
    fs.appendFileSync(path.join(dir, 'CLAUDE.md'), '\nUse the onetake skill.\n');
    assert.deepEqual(crew.kitOf().skills, ['onetake', 'videohub']);   // named in its files, plus videohub; not the unused one
    const k = crew.saveKit({ skills: ['unused-skill', 'not-a-skill'], mcp: ['not-a-server'] });
    assert.deepEqual([k.skills, k.mcp], [['unused-skill'], []]);
    assert.throws(() => crew.saveKit({ dir: 'C:/nowhere', skills: [], mcp: [] }), /Not a Director folder/);
    const b = crew.buildKit(), links = path.join(b.addDir, '.claude', 'skills');
    // the ticked skills, plus every skill of yours the crew's agents name (an agent can only load what its Director has)
    const named = crew.namedByAgents();
    assert.deepEqual(fs.readdirSync(links).sort(), [...new Set(['unused-skill', ...named])].sort());
    crew.saveKit({ skills: ['videohub'], mcp: [] }); crew.buildKit();
    assert.deepEqual(fs.readdirSync(links).sort(), [...new Set(['videohub', ...named])].sort());
    assert.ok(fs.existsSync(path.join(skills, 'unused-skill', 'SKILL.md')));   // removing a link never touches the skill
    assert.deepEqual(JSON.parse(fs.readFileSync(b.mcpConfig, 'utf8')), { mcpServers: {} });
    assert.deepEqual(crew.isolation().slice(0, 2), ['--setting-sources', 'project,local']);
  } finally { if (was === undefined) delete process.env.VIDEOHUB_SKILLS_DIR; else process.env.VIDEOHUB_SKILLS_DIR = was; }
});
