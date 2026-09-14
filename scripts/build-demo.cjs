const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), output = path.join(root, 'demo');
fs.mkdirSync(output, {recursive:true});
for (const [source, destination] of [
  ['Code.gs', 'parser.js'], ['core/composer.js', 'composer.js'],
  ['exporter/transcript_docx.py', 'transcript_docx.py'], ['examples/review.txt', 'review.txt'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md']
]) fs.copyFileSync(path.join(root, source), path.join(output, destination));
const runtime = path.join(output, 'vendor/pyodide');
fs.mkdirSync(runtime, {recursive:true});
for (const file of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'])
  fs.copyFileSync(path.join(root, 'node_modules/pyodide', file), path.join(runtime, file));
fs.cpSync(path.join(root, 'licenses'), path.join(output, 'licenses'), {recursive:true});
