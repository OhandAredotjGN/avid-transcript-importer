const {test, expect} = require('@playwright/test');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');

test('sample preview and real Python DOCX download without uploads', async ({page}) => {
  const outbound = [];
  page.on('request', r => {if(r.method() !== 'GET' || !r.url().startsWith('http://127.0.0.1:18797/')) outbound.push(r.url());});
  await page.goto('/');
  await page.getByRole('button', {name:'Try a sample'}).click();
  await expect(page.locator('.speaker')).toHaveCount(2);
  await page.getByLabel('Show timestamps').check();
  await page.getByLabel('Include source metadata').check();
  await page.getByLabel('Include preflight log').check();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name:'Download .docx'}).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('client-review-transcript.docx');
  const file = await download.path();
  const result = execFileSync('python3', ['-c', `from zipfile import ZipFile
import sys,xml.etree.ElementTree as ET
with ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 doc=ET.fromstring(z.read('word/document.xml'))
 content=''.join(doc.itertext())
 for value in ['Demo interview','Alex','Jamie','01:00:20:00','Import Log']: assert value in content,value
 print('ok')`, file], {encoding:'utf8'});
  expect(result.trim()).toBe('ok');
  expect(outbound).toEqual([]);
  await expect(page.getByRole('status')).toContainText('download has started');
});

test('bad file blocks export, removal recovers, and mobile layout fits', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.locator('#files').setInputFiles([
    {name:'good.txt',mimeType:'text/plain',buffer:Buffer.from('NOVA!:\n00:01\nSynthetic line.')},
    {name:'empty.txt',mimeType:'text/plain',buffer:Buffer.from('')}
  ]);
  await expect(page.getByRole('status')).toContainText('no dialogue');
  await expect(page.getByRole('button', {name:'Download .docx'})).toBeDisabled();
  await page.getByRole('button', {name:'Remove empty.txt'}).click();
  await expect(page.getByRole('button', {name:'Download .docx'})).toBeEnabled();
  await expect(page.locator('.speaker')).toHaveText('Nova!');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('export failure is visible and can be retried', async ({page}) => {
  await page.route('**/transcript_docx.py', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', {name:'Try a sample'}).click();
  await page.getByRole('button', {name:'Download .docx'}).click();
  await expect(page.getByRole('status')).toContainText('Export failed', {timeout:90000});
  await expect(page.getByRole('button', {name:'Download .docx'})).toBeEnabled();
});
