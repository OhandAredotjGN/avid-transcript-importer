const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const ctx = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../Code.gs"), "utf8"),
  ctx,
);
test("inline speakers and metadata", () => {
  const p = ctx.parseTranscript_(
    "Project: [Fictional Launch]\nClip Name: [Demo]\nALEX: First line.\nJAMIE: Second line.",
  );
  assert.equal(p.project, "Fictional Launch");
  assert.equal(p.blocks.length, 2);
  assert.equal(p.blocks[0].text, "First line.");
});
test("timestamp before speaker", () => {
  const p = ctx.parseTranscript_("00:20\nALEX:\nA fictional line.");
  assert.equal(p.blocks[0].timestamp, "00:20");
  assert.equal(p.blocks[0].speaker, "ALEX");
});
test("speaker before timecode range", () => {
  const p = ctx.parseTranscript_(
    "ALEX:\n10:54:43:23 - 10:54:48:01\nA fictional line.",
  );
  assert.equal(p.blocks[0].timestamp, "10:54:43:23 - 10:54:48:01");
});
test("preflight rejects missing input without document access", () =>
  assert.throws(() => ctx.preflightTranscriptFiles([])));
test("preflight counts speaker turns without document access", () =>
  assert.equal(
    ctx.preflightTranscriptFiles([
      { name: "demo.txt", content: "ALEX: One.\nJAMIE: Two." },
    ])[0].stats.speakerTurns,
    2,
  ));
test("cleanup preserves meaningful text", () =>
  assert.match(
    ctx.balancedCleanClientText_("A fictional scene."),
    /fictional scene/,
  ));
test('metadata is not counted as inline speakers', () => {
  const r = ctx.preflightTranscriptFiles([{name:'demo.txt',content:'Project: [Fictional]\nClip Name: [Demo]\n00:01\nALEX:\nA line.'}])[0];
  assert.equal(r.stats.possibleInlineSpeakers, 0);
});
test('punctuated and combined speaker labels preserve attribution', () => {
  const p = ctx.parseTranscript_('00:01\nNOVA!:\nFirst.\n00:02\nALEX: & JAMIE:\nTogether.\n00:03\nÉLODIE:\nLast.');
  assert.equal(p.blocks.length, 3);
  assert.equal(p.blocks[0].speaker, 'NOVA!');
  assert.equal(p.blocks[1].speaker, 'ALEX & JAMIE');
  assert.equal(p.blocks[1].text, 'Together.');
  assert.equal(p.blocks[2].speaker, 'ÉLODIE');
});
test('same speaker timed turns stay separate', () => {
  const p = ctx.parseTranscript_('00:01\nALEX:\nOne.\n00:02\nALEX:\nTwo.');
  assert.equal(p.blocks.length, 2);
  assert.equal(p.blocks[1].timestamp, '00:02');
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../core/composer.js'), 'utf8'), ctx);
test('composition sorts files and applies selected cleanup once', () => {
  const result = ctx.TranscriptComposer.compose([{name:'scene10.txt',content:'ALEX: Um, ten.'},{name:'scene2.txt',content:'JAMIE: Uh, two.'}], {cleanMode:'light'});
  assert.equal(result.documents[0].sourceFile, 'scene2.txt');
  assert.equal(result.documents[0].blocks[0].text, 'Uh, two.');
  const cleaned = ctx.TranscriptComposer.compose([{name:'demo.txt',content:'ALEX: Um, test <laugh>.'}], {cleanMode:'balanced'});
  assert.equal(cleaned.documents[0].blocks[0].text, 'test.');
});
test('composition blocks empty or invalid files instead of silently skipping them', () => {
  assert.throws(() => ctx.TranscriptComposer.compose([{name:'empty.txt',content:''}]));
  assert.throws(() => ctx.TranscriptComposer.compose([{name:'bad.txt',content:'ALEX: bad\0text'}]));
  assert.throws(() => ctx.TranscriptComposer.compose([{name:'demo.txt',content:'ALEX: fine.'}],{cleanMode:'constructor'}));
});
