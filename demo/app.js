const $ = id => document.getElementById(id);
const input = $('files'), preview = $('preview'), exportButton = $('export');
let files = [], model = null, worker = null, exportTimer = null, reading = false, batch = 0;
function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = value;
  return el;
}
function status(message, error = false) {
  $('status').textContent = message;
  $('status').className = error ? 'error' : '';
}
function options() {
  return {cleanMode:$('cleanup').value, showTimestamps:$('timestamps').checked, includeMeta:$('metadata').checked, includeImportLog:$('log').checked};
}
function cancelExport() {
  worker?.terminate(); worker = null;
  clearTimeout(exportTimer);
  $('cancel-export').hidden = true;
  exportButton.disabled = !model || reading;
}
function renderFiles() {
  $('file-list').replaceChildren();
  $('file-count').textContent = files.length;
  $('clear').hidden = !files.length;
  for (const [index, file] of files.entries()) {
    const item = node('div', 'file');
    const head = node('div', 'file-head');
    head.append(node('span', 'file-name', file.name));
    const remove = node('button', 'text-button', 'Remove');
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.addEventListener('click', () => {files.splice(index, 1); render();});
    head.append(remove); item.append(head);
    if (file.error) item.append(node('small', '', file.error));
    else {
      const report = preflightTranscriptFiles([file])[0];
      item.append(node('small', '', `${report.stats.speakerTurns} turns · ${report.stats.timestamps} timestamps`));
      if (report.warnings.length) {
        const details = node('details');
        details.append(node('summary', '', `${report.warnings.length} preflight notes`));
        const list = node('ul');
        report.warnings.forEach(w => list.append(node('li', '', w)));
        details.append(list); item.append(details);
      }
    }
    $('file-list').append(item);
  }
}
function render() {
  cancelExport(); model = null; exportButton.disabled = true;
  renderFiles(); preview.replaceChildren(); status('');
  if (!files.length) {
    const empty = node('div', 'empty');
    const mascot = node('img', 'mascot');
    mascot.src = 'assets/transcripttamer-mascot.png'; mascot.alt = '';
    mascot.width = 128; mascot.height = 128;
    empty.append(mascot, node('h3', '', 'Your next review starts here.'));
    preview.append(empty); $('turn-count').textContent = 'No transcripts selected'; return;
  }
  try {
    const broken = files.find(f => f.error);
    if (broken) throw new Error(`${broken.name}: ${broken.error} Remove this file to continue.`);
    model = TranscriptComposer.compose(files, options());
    let total = 0, shown = 0;
    for (const doc of model.documents) {
      const article = node('article', 'transcript');
      article.append(node('h3', 'doc-title', doc.title), node('p', 'doc-subtitle', 'Client Review Transcript'));
      if (model.options.includeMeta) {
        const lines = [];
        if (doc.project) lines.push('Project: ' + doc.project);
        if (doc.clipName) lines.push('Clip: ' + doc.clipName);
        lines.push('Source file: ' + doc.sourceFile);
        article.append(node('p', 'doc-meta', lines.join('\n')));
      }
      article.append(node('h4', 'doc-section', 'Transcript'));
      total += doc.blocks.length;
      for (const b of doc.blocks) {
        if (shown >= 300) break;
        const label = b.speaker + (model.options.showTimestamps && b.timestamp ? '  ' + b.timestamp : '');
        article.append(node('p', 'speaker', label), node('p', 'dialogue', b.text)); shown++;
      }
      preview.append(article);
    }
    if (total > shown) preview.append(node('p', 'preview-limit', `Preview shows the first ${shown} turns. The DOCX includes all ${total}.`));
    if (model.options.includeImportLog) {
      const log = node('section', 'import-log'); log.append(node('h3', '', 'Import Log'));
      for (const doc of model.documents) {
        log.append(node('h4', '', doc.sourceFile));
        const r = doc.report;
        log.append(node('pre', '', `Status: ${r.status}\nLines: ${r.stats.lines}\nSpeaker turns: ${r.stats.speakerTurns}\nTimestamps: ${r.stats.timestamps}\nWarnings: ${r.warnings.join('; ') || 'None'}`));
      }
      preview.append(log);
    }
    $('turn-count').textContent = `${model.documents.length} transcript${model.documents.length === 1 ? '' : 's'} · ${total} turns`;
    exportButton.disabled = reading;
  } catch (error) {status(error.message, true); $('turn-count').textContent = 'Check selected files';}
}
async function addFiles(list) {
  if (reading) return;
  const selected = Array.from(list).filter(f => !f.name.startsWith('._'));
  if (!selected.length) return;
  if (selected.some(f => !/\.txt$/i.test(f.name))) {status('Choose .txt transcript files.', true); return;}
  if (selected.length + files.length > TranscriptComposer.MAX_FILES || selected.reduce((n,f)=>n+f.size,0) + files.reduce((n,f)=>n+(f.bytes || 0),0) > 10_000_000) {
    status('Choose up to 50 files, totalling no more than 10 MB.', true); return;
  }
  const currentBatch = ++batch;
  cancelExport(); reading = true; exportButton.disabled = true; status('Reading transcripts…');
  try {
    const loaded = await Promise.all(selected.map(async f => {
      try {return {name:f.name, bytes:f.size, content:new TextDecoder('utf-8', {fatal:true}).decode(await f.arrayBuffer())};}
      catch {return {name:f.name, bytes:f.size, error:'Could not read UTF-8 text.'};}
    }));
    if (currentBatch !== batch) return;
    files.push(...loaded);
  } finally {if (currentBatch === batch) {reading = false; render();}}
}
input.addEventListener('change', () => {addFiles(input.files); input.value = '';});
$('clear').addEventListener('click', () => {batch++; reading = false; files = []; render();});
for (const event of ['dragover', 'drop']) $('dropzone').addEventListener(event, e => e.preventDefault());
$('dropzone').addEventListener('dragover', () => $('dropzone').classList.add('dragging'));
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
$('dropzone').addEventListener('drop', e => {$('dropzone').classList.remove('dragging'); addFiles(e.dataTransfer.files);});
$('sample').addEventListener('click', async () => {
  if (reading) return;
  try {
    const response = await fetch('./review.txt');
    if (!response.ok) throw new Error('Could not load the sample.');
    const sample = new File([await response.text()], 'review.txt', {type:'text/plain'});
    await addFiles([sample]);
  } catch (error) {status(error.message, true);}
});
for (const id of ['cleanup', 'timestamps', 'metadata', 'log']) $(id).addEventListener('change', () => {
  $('cleanup-note').textContent = {light:'Keeps filler words and performance markers; normalizes whitespace.', balanced:'Removes filler words and common performance markers.', aggressive:'Also removes selected stutters and repeated fragments.'}[$('cleanup').value];
  render();
});
$('cancel-export').addEventListener('click', () => {cancelExport(); status('Export cancelled.');});
exportButton.addEventListener('click', () => {
  if (!model || worker) return;
  exportButton.disabled = true; $('cancel-export').hidden = false;
  const name = ($('filename').value.replace(/\.docx$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().replace(/[. ]+$/, '') || 'client-review-transcript') + '.docx';
  try {
    worker = new Worker(new URL('./export-worker.js', import.meta.url), {type:'module'});
    const fail = message => {cancelExport(); status(message, true);};
    worker.onerror = () => fail('Could not start the exporter. Reload the page and try again.');
    worker.onmessageerror = () => fail('Could not receive the document. Please try again.');
    worker.onmessage = ({data}) => {
      if (data.error) {fail('Export failed. ' + data.error); return;}
      if (data.status) {status(data.status); return;}
      if (data.bytes) {
        const blob = new Blob([data.bytes], {type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
        const url = URL.createObjectURL(blob), link = node('a');
        link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        cancelExport(); status('DOCX ready. Your download has started.');
      }
    };
    exportTimer = setTimeout(() => fail('Export timed out. Try again or choose a smaller batch.'), 120000);
    status('Preparing document exporter…');
    worker.postMessage({json:JSON.stringify(model)});
  } catch (error) {cancelExport(); status(error.message, true);}
});
