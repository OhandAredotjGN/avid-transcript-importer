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
