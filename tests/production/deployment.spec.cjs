const {test, expect} = require('@playwright/test');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');

test('exact product route, metadata, OG image and compiled exporter work', async ({page, request}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('/TranscriptTamer');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-transform');
  await expect(page.getByRole('heading', {name:'TranscriptTamer', exact:true})).toBeVisible();
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://tools.observe.report/TranscriptTamer');
  const image = await request.get('/TranscriptTamer/assets/transcripttamer-og-v1.png');
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toContain('image/png');
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await page.getByRole('button', {name:'Try a sample'}).click();
  await expect(page.locator('.speaker')).toHaveCount(2);
  await page.getByLabel('Show timestamps').check();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', {name:'Download .docx'}).click();
  const file = await (await downloaded).path();
  const result = execFileSync('python3', ['-c', `import sys,xml.etree.ElementTree as ET
from zipfile import ZipFile
with ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 content=''.join(ET.fromstring(z.read('word/document.xml')).itertext())
 assert '01:00:20:00' in content and 'Alex' in content and 'Jamie' in content
 print('ok')`, file], {encoding:'utf8'});
  expect(result.trim()).toBe('ok');
  expect(errors).toEqual([]);
});

test('no loose source files or maps are deployed; wrong routes and uploads fail', async ({request}) => {
  for (const file of ['transcript_docx.py', 'parser.js', 'composer.js', 'app.js.map', 'Code.gs', '.env']) {
    const response = await request.get('/TranscriptTamer/' + file);
    expect(response.status()).toBe(404);
  }
  expect((await request.post('/TranscriptTamer', {data:'synthetic'})).status()).toBe(405);
  expect((await request.get('/unknown-tool')).status()).toBe(404);
  const alias = await request.get('/transcripttamer/', {maxRedirects:0});
  expect(alias.status()).toBe(308);
  expect(new URL(alias.headers().location).pathname).toBe('/TranscriptTamer');
  const root = await request.get('/', {maxRedirects:0});
  expect(root.status()).toBe(308);
  const names = fs.readdirSync('.site-dist/TranscriptTamer');
  expect(names).toContain('transcript_docx.pyc');
  expect(names).not.toContain('transcript_docx.py');
});

test('production mobile layout fits', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.goto('/TranscriptTamer');
  await page.getByRole('button', {name:'Try a sample'}).click();
  await expect(page.locator('.speaker')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
