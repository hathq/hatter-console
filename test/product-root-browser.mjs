// Hatter 2026: real default CLI composition and built delivery, isolated state.
// Canonical Missing is asserted, not substituted with fixture success.
import assert from 'node:assert/strict'
import {mkdtemp, readFile, lstat, rm, mkdir, writeFile} from 'node:fs/promises'
import {generateKeyPairSync,sign,createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join, isAbsolute, resolve} from 'node:path'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import {spawnParentBound} from '@crowsi/transport-foundation/process'
import {chromium,expect} from '@playwright/test'

const directory=process.env.HATTER_TEST_BINARY_DIRECTORY
assert.ok(isAbsolute(directory??''),'exact current binary directory required')
const home=await mkdtemp(join(tmpdir(),'hatter-default-product-'))
async function command(args){
 const child=spawnParentBound(join(directory,'hatter'),args,{cwd:home,env:{HOME:home,HATTER_HOME:home},stdio:['ignore','pipe','pipe']})
 let stdout='',stderr='';child.stdout.on('data',b=>{stdout=(stdout+b).slice(-16384)});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16384)})
 const closed=once(child,'close'),deadline=setTimeout(()=>child.kill('SIGKILL'),10000)
 try{const [code,signal]=await closed;assert.equal(signal,null);return {code,stdout,stderr}}
 finally{clearTimeout(deadline);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed}
}
const root=spawnParentBound(join(directory,'hatter'),[],{cwd:home,
  env:{HOME:home,HATTER_HOME:home,HATTER_CONSOLE_EXECUTABLE:process.env.HATTER_TEST_CONSOLE_EXECUTABLE??resolve('bin/hatter-console'),
    HATTER_CONSOLE_NODE_EXECUTABLE:process.execPath},stdio:['ignore','pipe','pipe']})
let output='',diagnostics='',browser,page,children=[]
root.stdout.on('data',b=>{output=(output+b).slice(-65536)})
root.stderr.on('data',b=>{diagnostics=(diagnostics+b).slice(-65536)})
const closed=once(root,'close'),deadline=setTimeout(()=>root.kill('SIGKILL'),120000)
try{
  const until=Date.now()+60000
  while(!output.includes('http://localhost:4213/\n')&&root.exitCode===null&&root.signalCode===null&&Date.now()<until)await delay(50)
  assert.ok(output.includes('http://localhost:4213/\n'),`delivery did not become ready: ${diagnostics}`)
  children=(await readFile(`/proc/${root.pid}/task/${root.pid}/children`,'utf8')).trim().split(/\s+/u).filter(Boolean)
  assert.equal(children.length,5,'four canonical owners plus exactly one Node delivery helper')
  {
    const {code,stdout,stderr}=await command(['source','--request-json',JSON.stringify({operation:'targets',maximumItems:16})])
    assert.notEqual(code,0);assert.equal(stdout,'')
    const failure=JSON.parse(stderr.trim().replace(/^Error: /u,''))
    assert.equal(failure.parameters.sourceOwner,'hatter/control')
    assert.deepEqual(JSON.parse(failure.parameters.ownerFailure),{Unavailable:'Missing'})
  }
  const offline=await command(['state','initialize','--replace-development-data'])
  assert.notEqual(offline.code,0);assert.match(offline.stderr,/owner area is in use/u)
  await assert.rejects(lstat(join(home,'product-state.json')),{code:'ENOENT'})
  browser=await chromium.launch({headless:true})
  page=await browser.newPage();const errors=[],documents=new Map()
  // In-place scene navigation does not rewrite the initial hydration script.
  // Compare the current UI to its actual owner response, not that old document.
  await page.route('**/api/document?**',async route=>{
    const response=await route.fetch(),body=await response.body(),doc=JSON.parse(body.toString('utf8'))
    if(doc.bootstrap?.liveDocument){documents.set(doc.bootstrap.liveDocument.revision,doc);if(documents.size>32)documents.delete(documents.keys().next().value)}
    await route.fulfill({response,body})
  })
  page.on('websocket',socket=>socket.on('framereceived',({payload})=>{const frame=JSON.parse(payload.toString());if(frame.kind==='MESSAGE'&&frame.class==='STATE'){const doc=JSON.parse(Buffer.from(frame.payload,'base64').toString('utf8'));if(doc.bootstrap?.liveDocument){documents.set(doc.bootstrap.liveDocument.revision,doc);if(documents.size>32)documents.delete(documents.keys().next().value)}}}))
  // Capture the real response before forwarding it to the browser. CDP may
  // discard a completed response body on document navigation; never retry the
  // mutation or replace its payload with an expected fixture to recover it.
const systemMenu=async()=>{const group=page.getByRole('dialog').locator('details').filter({has:page.getByText('System and connection',{exact:true})});if(!await group.evaluate(n=>n.open))await group.locator('summary').click()}
const panel=async name=>{if(['System data','View and time'].includes(name)){await panel('Context');if(name==='System data')await systemMenu();await page.getByRole('dialog').getByRole('button',{name:name==='System data'?'Inspect current data':name,exact:true}).click();return}if(name==='Notifications'){await page.getByRole('button',{name:'Connection and notifications',exact:true}).click();return}const button=name==='Context'?page.locator('.frame-dock [data-panel=settings]'):page.getByRole('navigation',{name:'Window tools'}).getByRole('button',{name,exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click()}
  const go=async name=>{if(name==='World'){await page.getByRole('navigation',{name:'Window tools'}).getByRole('button',{name:'Home',exact:true}).click()}else{await panel('Context');await page.getByRole('dialog').getByRole('button',{name,exact:true}).click()}await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false')}
  const focused=async path=>{await expect(page.locator('#app')).toHaveAttribute('data-focus-location',path);assert.equal(page.url(),'http://localhost:4213/','tools stay inside the garden, not browser navigation')}
  async function action(label){
    await panel('Context')
    let accept,reject
    const captured=new Promise((resolve,rejected)=>{accept=resolve;reject=rejected})
    const handler=async route=>{
      try{
        const response=await route.fetch({maxRedirects:0,maxRetries:0,timeout:15000})
        const body=await response.body()
        await route.fulfill({response,body})
        accept({status:response.status(),body:JSON.parse(body.toString('utf8'))})
      }catch(error){reject(error);await route.abort().catch(()=>{})}
    }
    await page.route('**/api/site-actions',handler,{times:1})
    try{await page.getByRole('button',{name:label,exact:true}).click();return await captured}
    finally{await page.unroute('**/api/site-actions',handler)}
  }
  page.on('pageerror',error=>errors.push(error.message))
  const response=await page.goto('http://localhost:4213/',{waitUntil:'networkidle',timeout:15000})
  assert.equal(response.status(),200)
  await page.waitForTimeout(250)
  await page.getByRole('button',{name:'Close panel',exact:true}).click()
  const text=await page.locator('body').innerText()
  assert.ok(text.trim().length>0,'browser renders actual site content')
  await expect(page.locator('.mind-world')).toHaveAttribute('data-objects','0')
  await expect(page.locator('.mind-world')).toHaveAttribute('data-gpu','ready')
  assert.deepEqual(await page.locator('.frame-dock button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),['Home','Menu'])
  assert.equal(await page.locator('.world-empty-guide').count(),0,'unavailable canonical storage must not masquerade as a confirmed empty garden')
  assert.equal(await page.locator('[data-item-id]').count(),0,'visual scaffolding is not synthetic personal data')
  await panel('Context')
  assert.equal(await page.getByRole('dialog').getAttribute('aria-label'),'Menu')
  assert.equal(await page.getByRole('button',{name:'Settings',exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'Language and information',exact:true}).count(),0,'language must come from personal definitions, not a static settings panel')
  const initial=JSON.parse(await page.locator('#delivery-state').textContent())
  for(const link of initial.bootstrap.navigation.filter(n=>n.href!=='/'))assert.equal(await page.getByRole('dialog').getByRole('button',{name:link.label,exact:true}).count(),1)
  await page.getByRole('button',{name:'Close panel',exact:true}).click()
  for(const viewport of [{width:1280,height:800},{width:390,height:844}]){
    await page.setViewportSize(viewport)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true)
    assert(Number(await page.locator('.mind-world').getAttribute('data-buffer-pixels'))<=1440000)
    if(process.env.HATTER_SCENE_EVIDENCE_DIRECTORY)await page.screenshot({path:join(process.env.HATTER_SCENE_EVIDENCE_DIRECTORY,'home-empty-'+viewport.width+'.png'),fullPage:true})
  }
  const documentResponse=await page.context().request.get('http://localhost:4213/api/document?path=/')
  assert.equal(documentResponse.status(),200)
  const document=await documentResponse.json()
  const systemBefore=await page.context().request.get('http://localhost:4213/api/document?path=/system')
  assert.equal(systemBefore.status(),200)
  const originalOwners=(await systemBefore.json()).bootstrap.data.runtime.owners
  assert.deepEqual(originalOwners.map(o=>o.owner).sort(),['hatter/admission','hatter/control','sem-lang'])
  for(const owner of originalOwners){
    assert.equal(owner.failure,null)
    assert.equal(owner.observation.availability.process_alive,true)
    assert.deepEqual(owner.observation.availability.owner_ready,{Unavailable:'Missing'})
  }
  assert.equal(document.envelope.snapshot,null,'missing canonical state is not a synthetic Scene')
  assert.equal(document.envelope.readiness.state,'Unavailable')
  assert.equal(document.bootstrap.world,undefined)
  assert.equal(document.envelope.readiness.requirements.find(value=>value.ref==='hatter:worldLabels').state,'Unavailable')
  for(const operation of ['targets','startup']){
    const requirement=document.envelope.readiness.requirements.find(value=>value.ref==='hatter:'+operation)
    assert.equal(requirement.owner,'hatter/control')
    assert.equal(requirement.failure.detail.parameters.sourceOwner,'hatter/control')
    assert.deepEqual(JSON.parse(requirement.failure.detail.parameters.ownerFailure),{Unavailable:'Missing'})
  }
  await go('System')
  await focused('/system')
  await panel('Context');await page.getByRole('button',{name:'Provision source retention registries',exact:true}).waitFor()
  await go('World')
  await focused('/')
  await panel('Notifications');await page.getByRole('button',{name:'Set up hatter/control',exact:true}).waitFor()
  assert.deepEqual(errors,[],'no browser exception during initial rendering')
  process.stdout.write(JSON.stringify({stage:'BrowserRendered',canonicalState:'Missing',navigation:true})+'\n')
  await go('System')
  await focused('/system')
  for(const [owner,label] of [['hatter/control','Prepare control storage'],['hatter/admission','Prepare HAT storage'],['sem-lang','Prepare semantic storage']]){
    const reply=await action(label)
    assert.equal(reply.status,200,JSON.stringify(reply.body))
    assert.deepEqual(reply.body,{owner,storage:'Ready'})
    await page.locator('#app[aria-busy="false"]').waitFor()
    const repeated=await command(['storage','--request-json',JSON.stringify({operation:'initialize',owner})])
    assert.equal(repeated.code,0,repeated.stderr)
    assert.deepEqual(JSON.parse(repeated.stdout),{owner,storage:'Ready'})
  }
  const provisioned=await action('Provision source retention registries')
  assert.equal(provisioned.status,200,JSON.stringify(provisioned.body))
  assert.deepEqual(provisioned.body,{state:'Ready',owner:'hatter/control',operation:'provision'})
  const targets=await command(['source','--request-json',JSON.stringify({operation:'targets',maximumItems:16})])
  assert.equal(targets.code,0,targets.stderr)
  assert.deepEqual(JSON.parse(targets.stdout).targets,[],'setup does not invent roles or subjects')
  const systemAfter=await page.context().request.get('http://localhost:4213/api/document?path=/system')
  assert.equal(systemAfter.status(),200)
  const readyOwners=(await systemAfter.json()).bootstrap.data.runtime.owners
  assert.equal(readyOwners.length,originalOwners.length)
  const workStatus=await (await page.context().request.get('http://localhost:4213/api/document?path=/system')).json()
  const cliWork=await command(['inference','execute','--request-json',JSON.stringify({operation:'scheduler'})])
  assert.equal(cliWork.code,0,cliWork.stderr)
  const canonicalWork=JSON.parse(cliWork.stdout)
  assert.deepEqual(workStatus.bootstrap.data.work.scheduler,canonicalWork.scheduler)
  assert.deepEqual(workStatus.bootstrap.data.work.controlRevision,canonicalWork.controlRevision)
  assert.deepEqual(workStatus.bootstrap.data.work.driver,canonicalWork.driver,'CLI and Console observe the same Management driver')
  const simultaneous=await Promise.all(Array.from({length:2},()=>command(['inference','execute','--request-json',JSON.stringify({operation:'scheduler'})])))
  for(const result of simultaneous){
    assert.equal(result.code,0,result.stderr)
    assert.deepEqual(JSON.parse(result.stdout),canonicalWork,'separate CLI observers share the same process-lifetime Work state')
  }
  assert.equal(workStatus.bootstrap.data.work.driver.workerCreated,false)
  assert.equal(workStatus.bootstrap.data.work.driver.failure,null)
  assert.equal(workStatus.bootstrap.data.work.driver.cleanupFailure,null)
  assert.equal(workStatus.bootstrap.actions.some(a=>a.id==='hatter:work:recover'),false,'inspection never starts or offers recovery of a healthy idle driver')
  for(const owner of readyOwners){
    assert.equal(owner.failure,null)
    assert.equal(owner.observation.availability.owner_ready,'Ready')
    assert.deepEqual(owner.observation.process,originalOwners.find(o=>o.owner===owner.owner).observation.process,
      'setup transitions the original owner, never a replacement process or inferred topology')
  }
  // Actual owner and built browser, with a signed local distribution fixture.
  // No public network, installed-package mutation or production trust change.
  const distribution=join(home,'distribution'),catalogDirectory=join(distribution,'catalog/v2')
  await mkdir(catalogDirectory,{recursive:true})
  const {publicKey,privateKey}=generateKeyPairSync('ed25519')
  const publicKeyHex=publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex')
  const catalog=JSON.parse(await readFile(resolve('../../../../../../../ecosystem/providers/hathq/services/hat-registry/repositories/ihat-registry-site/public/catalog/v2/index.json'),'utf8'))
  catalog.origin='https://browser-test.invalid';catalog.signing_key_id='browser-test'
  const catalogBytes=Buffer.from(JSON.stringify(catalog)),signature=sign(null,catalogBytes,privateKey).toString('hex')
  const configured=await command(['hat','catalog-source-set','--source-id','browser-test','--label','Browser test source','--kind','local-directory',
   '--location',distribution,'--logical-origin',catalog.origin,'--signing-key-id','browser-test','--public-key-hex',publicKeyHex,'--expected-revision','0','--select'])
  assert.equal(configured.code,0,configured.stderr)
  await go('Add capabilities')
  await focused('/store')
  await panel('Context');await page.getByRole('button',{name:'Register distribution source',exact:true}).waitFor()
  await page.locator('#app[aria-busy="false"]').waitFor()
  const absentResponse=await page.context().request.get('http://localhost:4213/api/document?path=/store')
  const absent=await absentResponse.json(),failure=absent.envelope.readiness.requirements.find(r=>r.owner==='hatter/catalog').failure
  assert.equal(failure.code,'hat-catalog-unavailable',JSON.stringify(failure))
  assert.equal(absent.bootstrap.data.distribution.selectedSourceId,'browser-test')
  assert.equal(absent.envelope.snapshot,null)
  await panel('Context');await page.getByRole('button',{name:'Register distribution source',exact:true}).click()
  for(const [label,value]of [['Source ID','browser-test'],['Display name','Browser source configured in UI'],['HTTPS address or absolute directory path',distribution],
   ['Signed catalog origin (HTTPS)',catalog.origin],['Signing key ID','browser-test'],['Trusted public key (64 hexadecimal characters)',publicKeyHex]])
   await page.getByLabel(label,{exact:true}).fill(value)
  await page.getByLabel('Source type',{exact:true}).selectOption('local_directory')
  await page.getByLabel('Use this source',{exact:true}).check()
  const save=page.waitForResponse(r=>r.url().endsWith('/api/site-actions')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Submit',exact:true}).click()
  assert.equal((await save).status(),200)
  await page.locator('form:not(.world-create)').waitFor({state:'detached'})
  const sourceRead=await command(['hat','catalog-sources'])
  assert.equal(sourceRead.code,0,sourceRead.stderr)
  const sources=JSON.parse(sourceRead.stdout)
  assert.equal(sources.revision,2);assert.equal(sources.selected_source_id,'browser-test')
  const source=sources.sources.find(s=>s.source_id==='browser-test')
  assert.equal(source.label,'Browser source configured in UI');assert.equal(source.public_key_hex,publicKeyHex)
  assert.equal(source.location,distribution)
  await writeFile(join(catalogDirectory,'index.json'),catalogBytes)
  await writeFile(join(catalogDirectory,'index.signature.hex'),signature)
  await panel('Context');await systemMenu();await page.getByRole('button',{name:'Read current state',exact:true}).click()
  await page.locator('[data-render-revision]').waitFor({state:'attached'})
  await expect(page.locator('.mind-world')).toHaveAttribute('data-pattern','garden')
  const catalogResponse=await page.context().request.get('http://localhost:4213/api/catalog'),observed=await catalogResponse.json()
  assert.equal(catalogResponse.status(),200,JSON.stringify(observed))
  assert.equal(observed.catalog.catalogDigestSha256,createHash('sha256').update(catalogBytes).digest('hex'))
  assert.equal(observed.source.revision,2);assert.equal(observed.catalog.artifactAcquisitionAvailable,true)
  assert.deepEqual(observed.catalog.candidates.map(p=>[p.repositoryId,p.version,p.packageSha256]).sort(),catalog.entries.map(p=>[p.repository_id,p.version,p.package_sha256]).sort())
  assert.equal(await page.locator('[data-item-id]').count(),Math.min(16,catalog.entries.length))
  for(const candidate of observed.catalog.candidates.slice(0,16)){
    const card=page.locator(`[data-item-id="${candidate.packageSha256}"]`)
    assert.equal(await card.locator('[data-kind=select]').textContent(),candidate.name)
    assert.equal(await card.locator('[data-item-summary]').textContent(),candidate.summary)
  }
  for(const viewport of [{width:1280,height:800},{width:390,height:844}]){
    await page.setViewportSize(viewport)
    const ids=await page.locator('[data-item-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.itemId))
    const revision=await page.locator('[data-render-revision]').getAttribute('data-render-revision')
    await expect(page.locator('.mind-world')).toHaveAttribute('data-gpu','ready')
    await expect.poll(()=>page.evaluate(()=>{
      const host=document.querySelector('.mind-world'),canvas=host.querySelector('canvas'),stage=document.querySelector('.window-stage').getBoundingClientRect(),panel=document.querySelector('.frame-panel:not([hidden])')?.getBoundingClientRect()
      return stage.width===innerWidth&&stage.height===innerHeight&&canvas.width===Math.floor(stage.width)&&canvas.height===Math.floor(stage.height)&&Number(host.dataset.bufferPixels)===canvas.width*canvas.height&&(!panel||panel.left>=0&&panel.top>=0&&panel.right<=innerWidth&&panel.bottom<=innerHeight)
    })).toBe(true)
    await page.evaluate(()=>{window.originalCard=document.querySelector('[data-item-id]')})
    if(await page.getByRole('button',{name:'Close panel',exact:true}).isVisible())await page.getByRole('button',{name:'Close panel',exact:true}).click()
    await expect(page.locator('.mind-world')).toHaveAttribute('data-buffer-pixels',String(viewport.width*viewport.height))
    const beforeZoom=JSON.parse(await page.locator('.mind-world').getAttribute('data-pose')).z
    await page.getByRole('group',{name:'Space controls',exact:true}).getByRole('button',{name:'Zoom in',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.originalCard===document.querySelector('[data-item-id]')),true)
    await expect.poll(async()=>JSON.parse(await page.locator('.mind-world').getAttribute('data-pose')).z).toBeLessThan(beforeZoom)
    await page.getByRole('group',{name:'Space controls',exact:true}).getByRole('button',{name:'View all',exact:true}).click()
    await panel('View and time')
    await page.getByRole('button',{name:'List view',exact:true}).click()
    assert.deepEqual(await page.locator('[data-item-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.itemId)),ids)
    await page.getByRole('button',{name:'Spatial view',exact:true}).click()
    assert.equal(await page.locator('[data-render-revision]').getAttribute('data-render-revision'),revision)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true)
    if(process.env.HATTER_SCENE_EVIDENCE_DIRECTORY){
      await page.getByRole('button',{name:'Close panel',exact:true}).click()
      await page.screenshot({path:join(process.env.HATTER_SCENE_EVIDENCE_DIRECTORY,'catalog-spatial-'+viewport.width+'.png')})
    }
  }
  // Compare visible owner data without requiring a semantic Scene.
  const scalars=v=>v===null||typeof v!=='object'?[JSON.stringify(v)]:Object.values(v).flatMap(scalars)
  for(const [name,path] of [['Inference','/models'],['System','/system'],['World','/']]){
    await go(name);await focused(path)
    const exact=documents.get(await page.locator('#app').getAttribute('data-document-revision'))
    assert.ok(exact,'current navigation must match its received owner document')
    assert.equal(await page.locator('.frame-panel:visible').count(),exact.envelope.readiness.state==='Ready'&&path==='/'?0:1)
    await panel('System data')
    for(const [key,value]of Object.entries(exact.bootstrap.data??{})){
      const group=page.locator('[data-information-key='+JSON.stringify(key)+']')
      if(!await group.evaluate(n=>n.open))await group.locator(':scope > summary').click()
      await page.waitForFunction(key=>{const n=[...document.querySelectorAll('[data-information-key]')].find(n=>n.dataset.informationKey===key);return n?.querySelector(':scope > div')?.childNodes.length>0},key)
      const displayed=await page.evaluate(key=>{const group=[...document.querySelectorAll('[data-information-key]')].find(n=>n.dataset.informationKey===key);return {revision:document.querySelector('#app').dataset.documentRevision,values:[...group.querySelectorAll('[data-projection-scalar]')].map(n=>n.dataset.projectionScalar)}},key)
      const delivered=documents.get(displayed.revision);assert.ok(delivered,'exact rendered document must have been received')
      assert.deepEqual(displayed.values,scalars(delivered.bootstrap.data[key]),name+'/'+key)
    }
    if(path==='/')assert.equal(await page.locator('.empty-explanation').isVisible(),true)
  }
  await go('Add capabilities');await focused('/store')
  // Reachable corrupt evidence must never be replaced by the verified cache.
  await writeFile(join(catalogDirectory,'index.signature.hex'),'00'.repeat(64))
  await panel('Context');await systemMenu();await page.getByRole('button',{name:'Read current state',exact:true}).click()
  await page.locator('[data-render-revision]').waitFor({state:'detached'})
  const corrupt=await (await page.context().request.get('http://localhost:4213/api/document?path=/store')).json()
  assert.equal(corrupt.envelope.readiness.requirements.find(r=>r.owner==='hatter/catalog').failure.code,'hat-catalog-verification-failed')
  assert.equal(await page.locator('[data-item-id]').count(),0)
  // The same owner observations and navigation must remain usable on mobile;
  // a successful document API is not evidence that the viewport can show it.
  for(const viewport of [{width:390,height:844},{width:1280,height:800}]){
    await page.setViewportSize(viewport)
    await go('World')
    await focused('/')
    await go('System')
    await focused('/system')
    await page.locator('#app[aria-busy="false"]').waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true,
      `owner status or navigation overflows ${viewport.width}px`)
    await panel('Context');await page.getByRole('button',{name:'Prepare semantic storage',exact:true}).scrollIntoViewIfNeeded()
    assert.equal(await page.getByRole('button',{name:'Prepare semantic storage',exact:true}).isVisible(),true)
    await go('Add capabilities')
    await focused('/store')
    await panel('Context');await page.getByRole('button',{name:'Choose distribution source',exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),true)
    if(process.env.HATTER_SCENE_EVIDENCE_DIRECTORY)await page.screenshot({path:join(process.env.HATTER_SCENE_EVIDENCE_DIRECTORY,'catalog-unavailable-'+viewport.width+'.png'),fullPage:true})
    await go('System')
    await focused('/system')
  }
  assert.deepEqual(errors,[])
  await browser.close();browser=null
  assert.deepEqual((await readFile(`/proc/${root.pid}/task/${root.pid}/children`,'utf8')).trim().split(/\s+/u).filter(Boolean),children)
  root.kill('SIGTERM')
  assert.deepEqual(await closed,[0,null],diagnostics)
  for(const pid of children)await assert.rejects(lstat(`/proc/${pid}`),{code:'ENOENT'})
  await assert.rejects(lstat(join(home,'product-routes.json')),{code:'ENOENT'})
  for(const name of ['digital-twin/v1.redb','hats/v2/control.redb'])assert.ok((await lstat(join(home,name))).isFile())
  assert.ok((await lstat(join(home,'sem-lang/repository'))).isDirectory())
  process.stdout.write(JSON.stringify({status:'PASS',actualChildren:5,browserErrors:0,explicitEmptyStorage:true,semanticBootstrap:false,cliReplay:true,catalogSourceUi:true,catalogCandidates:catalog.entries.length,corruptSourceRefused:true,childrenReaped:true})+'\n')
}catch(error){
  const evidence=await mkdtemp(join(tmpdir(),'hatter-browser-failure-'))
  await writeFile(join(evidence,'failure.json'),JSON.stringify({error:String(error),diagnostics,output,page:await page?.locator('#app').textContent().catch(()=>null)},null,2))
  if(process.env.HATTER_CAPTURE_SCREENSHOTS==='1')await page?.screenshot({path:join(evidence,'page.png'),fullPage:true}).catch(()=>{})
  process.stderr.write(JSON.stringify({evidence})+'\n');throw error
}finally{
  await browser?.close()
  if(root.exitCode===null&&root.signalCode===null)root.kill('SIGTERM')
  await closed;clearTimeout(deadline)
  await rm(home,{recursive:true,force:true})
}
