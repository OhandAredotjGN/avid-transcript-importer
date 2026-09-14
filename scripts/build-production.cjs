/* Static production build: minified application code, no source maps, Python bytecode. */
const fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const esbuild = require('esbuild');
const {loadPyodide} = require('pyodide');
const root = path.join(__dirname, '..');
const output = path.join(root, '.site-dist', 'TranscriptTamer');
async function main() {
  execFileSync(process.execPath, [path.join(__dirname, 'build-demo.cjs')], {stdio:'inherit'});
  fs.rmSync(path.join(root, '.site-dist'), {recursive:true, force:true});
  fs.mkdirSync(output, {recursive:true});
  for (const name of ['review.txt', 'THIRD_PARTY_NOTICES.md', 'assets', 'licenses'])
    fs.cpSync(path.join(root, 'demo', name), path.join(output, name), {recursive:true});
  const runtimeVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/pyodide/package.json'), 'utf8')).version;
  fs.cpSync(path.join(root, 'demo/vendor/pyodide'), path.join(output, 'vendor/pyodide', runtimeVersion), {recursive:true});
  // Keep only the shared parser/preflight/cleanup from the Apps Script source.
  const parser = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
  const pure = parser.slice(parser.indexOf('function preflightTranscriptFiles'), parser.indexOf('/**\n * Imports dropped TXT'))
    + parser.slice(parser.indexOf('function parseTranscript_'), parser.indexOf('function writeClientTranscript_'))
    + parser.slice(parser.indexOf('function normalizeText_'));
  const application = pure + '\n' + fs.readFileSync(path.join(root, 'core/composer.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(root, 'demo/app.js'), 'utf8');
  const js = await esbuild.transform(application, {loader:'js', format:'esm', minify:true, target:'es2022', legalComments:'none', sourcemap:false});
  fs.writeFileSync(path.join(output, 'app.js'), js.code);
  const css = await esbuild.transform(fs.readFileSync(path.join(root, 'demo/app.css'), 'utf8'), {loader:'css', minify:true});
  fs.writeFileSync(path.join(output, 'app.css'), css.code);
  // Compile with the exact Python runtime delivered to browsers, not the build host's Python.
  const py = await loadPyodide();
  py.FS.writeFile('/tmp/transcript_docx.py', fs.readFileSync(path.join(root, 'exporter/transcript_docx.py'), 'utf8'));
  py.runPython("import py_compile\npy_compile.compile('/tmp/transcript_docx.py', cfile='/tmp/transcript_docx.pyc', dfile='transcript_docx.py', doraise=True, optimize=2, invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)");
  fs.writeFileSync(path.join(output, 'transcript_docx.pyc'), py.FS.readFile('/tmp/transcript_docx.pyc'));
  let worker = fs.readFileSync(path.join(root, 'demo/export-worker.js'), 'utf8')
    .replaceAll('./vendor/pyodide/', `./vendor/pyodide/${runtimeVersion}/`)
    .replaceAll('transcript_docx.py', 'transcript_docx.pyc')
    .replace('const source = await response.text();', 'const source = new Uint8Array(await response.arrayBuffer());');
  const builtWorker = await esbuild.transform(worker, {loader:'js', format:'esm', minify:true, target:'es2022', legalComments:'none', sourcemap:false});
  fs.writeFileSync(path.join(output, 'export-worker.js'), builtWorker.code);
  let html = fs.readFileSync(path.join(root, 'demo/index.html'), 'utf8')
    .replace('<head>', '<head>\n  <base href="/TranscriptTamer/">')
    .replace('<script src="parser.js"></script><script src="composer.js"></script>', '');
  fs.writeFileSync(path.join(output, 'index.html'), html);
  console.log(`Production build: ${output} (Pyodide ${runtimeVersion}, compiled exporter)`);
}
main().catch(error => {console.error(error); process.exitCode = 1;});
