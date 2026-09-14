# Third-party notices

The browser build serves an unmodified Pyodide 314.0.7 runtime, copied from the pinned npm package at build time. It runs the Python exporter locally; no transcript content is sent to Pyodide or a conversion service.

- **Pyodide 314.0.7** — Mozilla Public License 2.0. [License](licenses/Pyodide-MPL-2.0.txt). Corresponding source and build recipes: <https://github.com/pyodide/pyodide/tree/314.0.7>. No Pyodide source modifications are made by this project.
- **CPython 3.14.2**, included in Pyodide — [Python license](licenses/Python-3.14.2.txt), [additional notices](licenses/Python-third-party.rst). Corresponding upstream source: <https://github.com/python/cpython/tree/v3.14.2>; Pyodide's source above includes its build configuration and patches.
- **Emscripten 5.0.3**, used by the runtime — [license and bundled component notices](licenses/Emscripten.txt). Source: <https://github.com/emscripten-core/emscripten/tree/5.0.3>.

Development tools are installed separately through npm. Their licenses are recorded in package metadata and their distributions. No font binaries are bundled; DOCX files request Arial and document readers may substitute an installed font.
