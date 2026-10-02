// Opt-in user scenario against a running, explicitly populated isolated product.
// No browser mocks, DB writes, server imports or page reload after CLI mutation.
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {chromium,expect} from '@playwright/test'
const home=process.env.HATTER_SAMPLE_HOME
assert.match(home??'',/^\/.*\/hatter-sample\.[A-Za-z0-9]+$/,'explicit sample only')
const run=promisify(execFile),binary=process.env.HATTER_TEST_BINARY_DIRECTORY+'/hatter'
const command=async args=>{const result=await run(binary,args,{env:{...process.env,HATTER_HOME:home},timeout:15000,maxBuffer:1048576});assert.equal(result.stderr,'');return JSON.parse(result.stdout)}
const browser=await chromium.launch(),errors=[],evidence=[]
try{
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),peer=await context.newPage()
 for(const p of [page,peer])p.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://localhost:4213/')
 await expect(page.locator('[data-world-object]')).toHaveCount(3)
 assert.deepEqual(await page.locator('[data-world-object] strong').allTextContents(),['Sample — Personal','Sample — Learning','Sample — Project'])
 await expect(page.locator('[data-realtime-state]')).toHaveAttribute('data-realtime-state','Live')
 await page.screenshot({path:home+'/world-desktop.png'})
 await page.setViewportSize({width:390,height:844})
 assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth))
 await page.screenshot({path:home+'/world-mobile.png'})
 await page.setViewportSize({width:1280,height:800})
 await page.locator('.world-name').first().click()
 await expect(page.locator('[data-item-id]')).not.toHaveCount(0)
 await peer.goto(page.url())
 const before=await page.locator('[data-render-revision]').getAttribute('data-render-revision')
 for(const p of [page,peer])await p.evaluate(()=>window.acceptanceDocument=crypto.randomUUID())
 const identities=await Promise.all([page,peer].map(p=>p.evaluate(()=>window.acceptanceDocument)))
 const text='CLI live sample '+Date.now(),start=Date.now()
 const result=await run(process.execPath,[new URL('../scripts/sample-information.mjs',import.meta.url).pathname,text],{timeout:20000,maxBuffer:1048576})
 assert.equal(result.stderr,'');const accepted=JSON.parse(result.stdout);assert.equal(accepted.replay,'identical')
 for(const [index,p]of [page,peer].entries()){
  await expect(p.locator('.scene-items .object-fields dd').filter({hasText:text})).toHaveText(text,{timeout:20000})
  assert.equal(await p.evaluate(()=>window.acceptanceDocument),identities[index])
  assert.notEqual(await p.locator('[data-render-revision]').getAttribute('data-render-revision'),before)
 }
 evidence.push({operation:'CLI source admission and exact replay',text,latencyMs:Date.now()-start,commit:accepted.accepted.commit.commit_ref,browsers:2})
 const itemId=await page.locator('[data-item-id]').filter({hasText:text}).getAttribute('data-item-id')
 await page.locator('.world-nearby summary').click()
 await page.locator(`.world-directory [data-directory-id="${itemId}"]`).getByRole('button',{name:/^Inspect /}).click()
 await expect(page.getByRole('dialog',{name:'Details',exact:true})).toContainText(text)
 assert.equal(await page.locator('.entity-inspector details').count(),0,'raw record is not primary content')
 await page.getByRole('button',{name:'Close panel',exact:true}).click()
 await page.screenshot({path:home+'/information-live.png'})
 await page.getByRole('navigation',{name:'Window tools'}).getByRole('button',{name:'Home',exact:true}).click()
 await expect(page.locator('[data-world-object]')).toHaveCount(3)
 await page.locator('.world-name').nth(1).click()
 await expect(page.locator('.semantic-scene')).toContainText('learning@example.test',{timeout:20000})
 // Rename only an existing sample distribution label. Trust/address/key stay unchanged.
 await page.goto('http://localhost:4213/store')
 const registry=await command(['hat','catalog-sources']),source=registry.sources.find(s=>s.source_id===registry.selected_source_id)
 assert(source)
 const label='Sample distribution '+Date.now(),args=['hat','catalog-source-set','--source-id',source.source_id,'--label',label,'--kind',source.kind.replaceAll('_','-'),'--location',source.location,'--logical-origin',source.logical_origin,'--signing-key-id',source.signing_key_id,'--public-key-hex',source.public_key_hex,'--expected-revision',String(registry.revision),'--select']
 if(source.federation_signing_key_id)args.push('--federation-signing-key-id',source.federation_signing_key_id,'--federation-public-key-hex',source.federation_public_key_hex)
 await page.getByRole('button',{name:'Menu',exact:true}).click()
 await page.getByRole('button',{name:'Choose distribution source',exact:true}).click()
 await command(args)
 await expect(page.locator('form')).toHaveCount(0,{timeout:15000})
 await page.getByRole('button',{name:'Menu',exact:true}).click()
 await page.getByRole('button',{name:'Choose distribution source',exact:true}).click()
 assert((await page.getByLabel('Distribution source',{exact:true}).locator('option').allTextContents()).includes(label))
 evidence.push({operation:'CLI settings revision invalidates stale input and supplies new choices',label})
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({status:'PASS',evidence,errors}))
}finally{await browser.close()}
