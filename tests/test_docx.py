from copy import deepcopy
from io import BytesIO
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET
from zipfile import ZipFile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'exporter'))
from transcript_docx import render_docx, w


def fixture():
    return {'schemaVersion': 1, 'options': {'showTimestamps': True, 'includeMeta': True, 'includeImportLog': True},
            'documents': [{'title': 'Synthetic & review', 'sourceFile': 'demo.txt', 'project': 'Fictional', 'clipName': 'Demo',
                           'blocks': [{'speaker': 'Alex!', 'timestamp': '01:00:00:00 - 01:00:02:00', 'text': 'A & B <tag> "quoted" café 東京.\nNew line\ttab.'}],
                           'report': {'status': 'Importable', 'warnings': [], 'stats': {'lines': 5, 'speakerTurns': 1, 'timestamps': 1}}}]}


def unpack(model):
    with ZipFile(BytesIO(render_docx(model))) as z:
        assert z.testzip() is None
        return {n: ET.fromstring(z.read(n)) for n in z.namelist()}


class DocxTests(unittest.TestCase):
    def test_package_relationships_and_text(self):
        parts = unpack(fixture())
        self.assertEqual(len(parts), 5)
        doc = parts['word/document.xml']
        values = [t.text for t in doc.iter(w('t'))]
        self.assertIn('A & B <tag> "quoted" café 東京.', values)
        self.assertIn('New line', values)
        self.assertEqual(len(list(doc.iter(w('tab')))), 1)
        self.assertTrue(list(doc.iter(w('br'))))
        self.assertIn('Alex!  01:00:00:00 - 01:00:02:00', values)
        self.assertIn('Import Log', values)
        self.assertTrue(any(s.get(w('line')) == '276' and s.get(w('lineRule')) == 'auto' for s in doc.iter(w('spacing'))))
        self.assertFalse(list(doc.iter(w('cantSplit'))))
        self.assertTrue(list(doc.iter(w('keepNext'))))
        rels = parts['word/_rels/document.xml.rels']
        self.assertTrue(all('word/' + rel.get('Target') in parts for rel in rels))

    def test_multiple_files_and_long_turn(self):
        model = fixture()
        long = deepcopy(model['documents'][0])
        long['blocks'][0]['text'] = 'Long dialogue. ' * 3000
        model['documents'].append(long)
        doc = unpack(model)['word/document.xml']
        self.assertEqual(len(list(doc.iter(w('tbl')))), 2)
        self.assertEqual(len(list(doc.iter(w('pageBreakBefore')))), 2)  # second file and log
        self.assertIn(long['blocks'][0]['text'], [t.text for t in doc.iter(w('t'))])

    def test_options_off(self):
        model = fixture(); model['options'] = {}
        doc = unpack(model)['word/document.xml']
        content = ''.join(doc.itertext())
        for value in ('01:00:00:00', 'Project:', 'Import Log', 'Source file:'):
            self.assertNotIn(value, content)

    def test_validation_and_reentrant_generation(self):
        for mutate in [lambda m:m.update(schemaVersion=2), lambda m:m.update(documents=[]),
                       lambda m:m['documents'][0]['blocks'][0].update(text='bad\x00text'),
                       lambda m:m['options'].update(showTimestamps='false'),
                       lambda m:m['documents'][0].update(report={'warnings':['bad\x00warning']}),
                       lambda m:m['documents'][0]['blocks'][0].update(text='')]:
            model = fixture(); mutate(model)
            with self.assertRaises(ValueError): render_docx(model)
        first = unpack(fixture())['word/document.xml']
        model = fixture(); model['documents'][0]['blocks'][0]['speaker'] = 'Second'
        second = unpack(model)['word/document.xml']
        self.assertNotIn('Second', ''.join(first.itertext()))
        self.assertNotIn('Alex!', ''.join(second.itertext()))

if __name__ == '__main__': unittest.main()
