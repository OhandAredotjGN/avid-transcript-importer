"""Editable transcript DOCX, using only the Python standard library.

Adapted from Beau Scheier's custom JSON-to-OOXML document pipeline.
No resume schema, personal content, or Google Docs normalization is included.
"""
import argparse
from io import BytesIO
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
C = 'http://schemas.openxmlformats.org/package/2006/content-types'
ET.register_namespace('w', W)
ET.register_namespace('r', R)
INVALID = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]')


def w(name):
    return '{' + W + '}' + name


def child(parent, tag, **attrs):
    return ET.SubElement(parent, w(tag), {w(k): str(v) for k, v in attrs.items()})


def text(value, label):
    if not isinstance(value, str) or len(value) > 5_000_000 or INVALID.search(value):
        raise ValueError(label + ' must be valid XML-compatible text.')
    return value


def validate(model):
    if not isinstance(model, dict) or type(model.get('schemaVersion')) is not int or model['schemaVersion'] != 1:
        raise ValueError('Unsupported transcript schema version.')
    docs = model.get('documents')
    if not isinstance(docs, list) or not 1 <= len(docs) <= 50:
        raise ValueError('Provide 1 to 50 transcripts.')
    options = model.get('options', {})
    if not isinstance(options, dict):
        raise ValueError('Invalid export options.')
    for key in ('showTimestamps', 'includeMeta', 'includeImportLog'):
        if key in options and type(options[key]) is not bool:
            raise ValueError(key + ' must be a boolean.')
    count = 0
    total_blocks = 0
    for doc in docs:
        if not isinstance(doc, dict):
            raise ValueError('Invalid transcript.')
        for key in ('sourceFile', 'title', 'project', 'clipName'):
            count += len(text(doc.get(key, ''), key))
        blocks = doc.get('blocks')
        if not isinstance(blocks, list) or not blocks:
            raise ValueError('Each transcript needs dialogue.')
        total_blocks += len(blocks)
        for block in blocks:
            if not isinstance(block, dict):
                raise ValueError('Invalid speaker turn.')
            for key in ('speaker', 'timestamp', 'text'):
                count += len(text(block.get(key, ''), key))
            if not block.get('text', '').strip():
                raise ValueError('Empty dialogue block.')
        if options.get('includeImportLog'):
            report = doc.get('report', {})
            if not isinstance(report, dict):
                raise ValueError('Invalid preflight report.')
            count += len(text(report.get('status', 'Not checked'), 'status'))
            warnings = report.get('warnings', [])
            if not isinstance(warnings, list) or len(warnings) > 1000:
                raise ValueError('Invalid preflight warnings.')
            for warning in warnings:
                count += len(text(warning, 'warning'))
            stats = report.get('stats', {})
            if not isinstance(stats, dict):
                raise ValueError('Invalid preflight statistics.')
            for key in ('lines', 'speakerTurns', 'timestamps'):
                if key in stats and (type(stats[key]) is not int or not 0 <= stats[key] <= 5_000_000):
                    raise ValueError('Invalid ' + key + ' count.')
    if count > 5_000_000 or total_blocks > 50_000:
        raise ValueError('Transcript batch is too large.')
    return docs, options


def run(parent, value, size=22, bold=False, color='222222'):
    r = child(parent, 'r')
    props = child(r, 'rPr')
    child(props, 'rFonts', ascii='Arial', hAnsi='Arial', eastAsia='Arial', cs='Arial')
    if bold:
        child(props, 'b')
    child(props, 'color', val=color)
    child(props, 'sz', val=size)
    child(props, 'szCs', val=size)
    # Newlines and tabs need OOXML elements rather than literal whitespace.
    for part in re.split('(\n|\t)', value):
        if part == '\n':
            child(r, 'br')
        elif part == '\t':
            child(r, 'tab')
        elif part:
            t = child(r, 't')
            t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
            t.text = part
    return r


def paragraph(parent, value='', size=22, bold=False, color='222222', before=0,
              after=120, line=276, keep=False, indent=0, style=None, page=False):
    p = child(parent, 'p')
    props = child(p, 'pPr')
    if style:
        child(props, 'pStyle', val=style)
    if keep:
        child(props, 'keepNext')
    if page:
        child(props, 'pageBreakBefore')
    child(props, 'widowControl')
    child(props, 'spacing', before=before, after=after, line=line, lineRule='auto')
    if indent:
        child(props, 'ind', left=indent)
    mark = child(props, 'rPr')
    child(mark, 'rFonts', ascii='Arial', hAnsi='Arial', eastAsia='Arial', cs='Arial')
    child(mark, 'sz', val=size)
    child(mark, 'szCs', val=size)
    run(p, value, size=size, bold=bold, color=color)
    return p


def cell(table):
    row = child(table, 'tr')  # Allow long dialogue to split across pages.
    tc = child(row, 'tc')
    props = child(tc, 'tcPr')
    child(props, 'tcW', w=9360, type='dxa')
    child(props, 'vAlign', val='top')
    return tc


def speaker_turn(body, block, timestamps):
    table = child(body, 'tbl')
    props = child(table, 'tblPr')
    child(props, 'tblW', w=9360, type='dxa')
    borders = child(props, 'tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        child(borders, edge, val='nil')
    child(props, 'tblLayout', type='fixed')
    margins = child(props, 'tblCellMar')
    for edge in ('top', 'left', 'bottom', 'right'):
        child(margins, edge, w=0, type='dxa')
    grid = child(table, 'tblGrid')
    child(grid, 'gridCol', w=9360)
    tc = cell(table)
    label = block.get('speaker') or 'Transcript'
    if timestamps and block.get('timestamp'):
        label += '  ' + block['timestamp']
    paragraph(tc, label, size=20, bold=True, color='1F4E79', after=40, line=240, keep=True)
    paragraph(tc, block['text'], indent=240)
    paragraph(body, size=2, after=40, line=240)


def xml(element):
    return ET.tostring(element, encoding='utf-8', xml_declaration=True)


def relationships(items):
    root = ET.Element('Relationships', xmlns=P)
    for name, kind, target in items:
        ET.SubElement(root, 'Relationship', Id=name, Type=R + '/' + kind, Target=target)
    return xml(root)


def render_docx(model):
    docs, options = validate(model)
    document = ET.Element(w('document'))
    body = child(document, 'body')
    for index, doc in enumerate(docs):
        paragraph(body, doc.get('title') or 'Transcript', size=48, color='1F4E79', after=80,
                  keep=True, style='Title', page=index > 0)
        paragraph(body, 'Client Review Transcript', size=28, color='666666', after=240, keep=True)
        if options.get('includeMeta'):
            metadata = []
            if doc.get('project'):
                metadata.append('Project: ' + doc['project'])
            if doc.get('clipName'):
                metadata.append('Clip: ' + doc['clipName'])
            metadata.append('Source file: ' + doc.get('sourceFile', ''))
            paragraph(body, '\n'.join(metadata), size=18, color='777777', after=320, keep=True)
        paragraph(body, 'Transcript', size=20, bold=True, color='6D7782', before=160, after=200, keep=True)
        for block in doc['blocks']:
            speaker_turn(body, block, options.get('showTimestamps'))
    if options.get('includeImportLog'):
        paragraph(body, 'Import Log', size=32, bold=True, page=True, keep=True, style='Heading1')
        for doc in docs:
            paragraph(body, doc.get('sourceFile', ''), bold=True, keep=True)
            report = doc.get('report', {})
            stats = report.get('stats', {})
            details = ['Status: ' + report.get('status', 'Not checked')]
            for key, label in [('lines', 'Lines'), ('speakerTurns', 'Speaker turns'), ('timestamps', 'Timestamps')]:
                details.append(label + ': ' + str(stats.get(key, 'Not checked')))
            details.append('Warnings: ' + ('; '.join(report.get('warnings', [])) or 'None'))
            paragraph(body, '\n'.join(details), size=18, color='666666', after=200)
    section = child(body, 'sectPr')
    child(section, 'pgSz', w=12240, h=15840)
    child(section, 'pgMar', top=1440, right=1440, bottom=1440, left=1440, header=720, footer=720, gutter=0)
    styles = ET.Element(w('styles'))
    defaults = child(styles, 'docDefaults')
    rp = child(child(defaults, 'rPrDefault'), 'rPr')
    child(rp, 'rFonts', ascii='Arial', hAnsi='Arial', eastAsia='Arial', cs='Arial')
    child(rp, 'sz', val=22)
    pp = child(child(defaults, 'pPrDefault'), 'pPr')
    child(pp, 'spacing', after=120, line=276, lineRule='auto')
    normal = child(styles, 'style', type='paragraph', default=1, styleId='Normal')
    child(normal, 'name', val='Normal')
    for ident, name in [('Title', 'Title'), ('Heading1', 'heading 1')]:
        s = child(styles, 'style', type='paragraph', styleId=ident)
        child(s, 'name', val=name)
        child(s, 'basedOn', val='Normal')
        if ident == 'Heading1':
            child(child(s, 'pPr'), 'outlineLvl', val=0)
    types = ET.Element('Types', xmlns=C)
    ET.SubElement(types, 'Default', Extension='rels', ContentType='application/vnd.openxmlformats-package.relationships+xml')
    ET.SubElement(types, 'Default', Extension='xml', ContentType='application/xml')
    for part, suffix in [('document', 'document.main'), ('styles', 'styles')]:
        ET.SubElement(types, 'Override', PartName='/word/' + part + '.xml', ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.' + suffix + '+xml')
    entries = {'[Content_Types].xml':xml(types), '_rels/.rels':relationships([('document', 'officeDocument', 'word/document.xml')]),
               'word/document.xml':xml(document), 'word/styles.xml':xml(styles),
               'word/_rels/document.xml.rels':relationships([('styles', 'styles', 'styles.xml')])}
    buffer = BytesIO()
    with ZipFile(buffer, 'w', ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    payload = render_docx(json.loads(args.input.read_text(encoding='utf-8')))
    with args.output.open('xb') as target:
        target.write(payload)
