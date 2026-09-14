// Python and the exporter are served as static assets. Transcript data stays here.
let runtime;
async function initialize() {
  const {loadPyodide} = await import('./vendor/pyodide/pyodide.mjs');
  const py = await loadPyodide({indexURL:new URL('./vendor/pyodide/', import.meta.url).href});
  const response = await fetch(new URL('./transcript_docx.py', import.meta.url));
  if (!response.ok) throw new Error('Could not load the DOCX exporter.');
  const source = await response.text();
  py.FS.writeFile('/home/pyodide/transcript_docx.py', source);
  py.runPython('from transcript_docx import render_docx\nimport json');
  return py;
}
self.onmessage = async ({data}) => {
  try {
    self.postMessage({status:'Preparing document exporter…'});
    runtime ||= initialize();
    const py = await runtime;
    self.postMessage({status:'Creating DOCX…'});
    py.globals.set('transcript_json', data.json);
    let result;
    try {
      result = py.runPython('render_docx(json.loads(transcript_json))');
      const bytes = result.toJs();
      self.postMessage({bytes}, [bytes.buffer]);
    } finally {
      result?.destroy();
      py.globals.delete('transcript_json');
    }
  } catch (error) {
    runtime = null;
    self.postMessage({error:error.message || 'DOCX export failed.'});
  }
};
