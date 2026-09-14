const {test,expect}=require('@playwright/test');
test.use({hasTouch:true});
for(const [width,height] of [[320,568],[390,844],[600,960],[768,1024],[820,1180],[1024,768]]){
 test(`responsive workflow ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height});await page.goto('/TranscriptTamer');
  await expect(page.locator('.mascot')).toBeVisible();
  await page.getByRole('button',{name:'Try a sample'}).click();
  await expect(page.locator('.speaker')).toHaveCount(2);
  await page.getByLabel('Show timestamps').check();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  for(const id of ['share','export','cleanup','filename'])expect((await page.locator('#'+id).boundingBox()).height).toBeGreaterThanOrEqual(44);
 });
}
test('native share receives only canonical public link in user activation',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'share',{value:async data=>{window.shared={data,active:navigator.userActivation.isActive}}});Object.defineProperty(navigator,'canShare',{value:()=>true});});
 await page.goto('/TranscriptTamer?private=never-share');await page.getByRole('button',{name:'Share',exact:true}).click();
 expect(await page.evaluate(()=>window.shared)).toEqual({active:true,data:{title:'TranscriptTamer',text:'Avid transcripts. Ready for review.',url:'https://tools.observe.report/TranscriptTamer'}});
 await expect(page.locator('#share-dialog')).not.toBeVisible();await expect(page.locator('#share')).toBeEnabled();
});
for(const mode of ['missing','error','cancel'])test(`share ${mode}`,async({page})=>{
 await page.addInitScript(mode=>{Object.defineProperty(navigator,'share',{value:mode==='missing'?undefined:async()=>{throw new DOMException('test',mode==='cancel'?'AbortError':'NotAllowedError')}});Object.defineProperty(navigator,'canShare',{value:()=>true});Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text}}});},mode);
 await page.goto('/TranscriptTamer');await page.locator('#share').click();
 if(mode==='cancel'){await expect(page.locator('#share-dialog')).not.toBeVisible();return;}
 await expect(page.getByRole('dialog')).toBeVisible();await page.locator('#copy-link').click();await expect(page.locator('#share-status')).toHaveText('Link copied.');expect(await page.evaluate(()=>window.copied)).toBe('https://tools.observe.report/TranscriptTamer');
 await page.getByRole('button',{name:'Close share sheet'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('#share')).toBeFocused();
});
test('clipboard denial offers manual selection and Escape closes',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'share',{value:undefined});Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied')}}});});
 await page.goto('/TranscriptTamer');await page.locator('#share').click();await page.locator('#copy-link').click();await expect(page.locator('#share-status')).toHaveText('Copy the selected link.');expect(await page.locator('#share-url').evaluate(x=>x.selectionEnd-x.selectionStart)).toBeGreaterThan(10);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('feedback links select public issue forms',async({page})=>{await page.goto('/TranscriptTamer');await expect(page.getByRole('link',{name:'Report a bug'})).toHaveAttribute('href',/issues\/new\?template=bug_report.yml$/);await expect(page.getByRole('link',{name:'Request a feature'})).toHaveAttribute('href',/issues\/new\?template=feature_request.yml$/);});
