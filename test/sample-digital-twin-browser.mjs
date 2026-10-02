// Hatter downstream 2026: installed-product fictional data journey.
// Original CLI writes, owner memory and live browser pages must agree.
// No screenshots, mocks, account connection or external requests.
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {chromium,expect} from '@playwright/test'

const home=process.env.HATTER_SAMPLE_HOME,cli=process.env.HATTER_TEST_CLI,origin=process.env.HATTER_TEST_ORIGIN??'http://localhost:4213'
assert.match(home??'',/^\/.*\/hatter-sample\.[A-Za-z0-9]+$/)
assert.match(cli??'',/^\//)
assert.match(origin,/^http:\/\/localhost:[0-9]+$/)
const run=promisify(execFile),errors=[]
async function command(args){
 const result=await run(cli,args,{env:{...process.env,HATTER_HOME:home},timeout:15000,maxBuffer:1048576})
 assert.equal(result.stderr,'')
 return JSON.parse(result.stdout)
}
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
try{
 const page=await browser.newPage({viewport:{width:1280,height:844}})
 page.on('pageerror',error=>errors.push(error.message))
 page.on('console',message=>{if(['warning','error'].includes(message.type()))errors.push(message.text())})
 page.on('request',request=>{if(new URL(request.url()).origin!==origin)errors.push('Unexpected external request')})
 assert.equal((await page.goto(origin)).status(),200)
 await expect(page.locator('.mind-world')).toHaveAttribute('data-gpu','ready')
 await expect(page.locator('[data-world-kind=character]')).toHaveCount(3)
 await page.locator('[data-world-selector] summary').click()
 await expect(page.locator('.world-picker-options')).toBeVisible()
 await expect(page.locator('[data-world-selector]')).not.toContainText('Empty preview')
 await expect(page.locator('[data-world-selector]')).not.toContainText('Fictional sample')
 await page.getByRole('button',{name:'Your world',exact:true}).click()
 await expect(page.getByRole('button',{name:/Open people/})).toBeVisible()
 assert(await page.locator('.world-nearby').evaluate(node=>[...node.children].indexOf(node.querySelector('.world-directory'))<[...node.children].indexOf(node.querySelector('.world-layout'))),'people are presented before view configuration')
 const map=page.locator('.world-map');await map.locator('summary').click()
 await map.locator('[data-map-id="runtime-role:sample-role-1"]').click()
 await expect(page.locator('.mind-world')).toHaveAttribute('data-selected-id','runtime-role:sample-role-1')
 await map.getByRole('button',{name:'Mark selected',exact:true}).click()
 await expect(page.locator('.mind-world')).toHaveAttribute('data-marked-id','runtime-role:sample-role-1')
 await map.locator('summary').click()
 await page.getByRole('button',{name:/Open people/}).click()
 await page.locator('[data-directory-id="runtime-role:sample-role-1"]').getByRole('button',{name:/^Talk to /}).click()
 await page.getByRole('dialog',{name:/^Conversation with /}).getByRole('button',{name:'Open conversation',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Conversation',exact:true}),lead=dialog.getByRole('region',{name:'Information to review'}),personInfo=dialog.getByRole('region',{name:'Information about this person'})
 await expect(dialog.locator('.conversation-deck')).toHaveAttribute('data-topic','choices')
 await expect(personInfo).toBeHidden()
 await expect(lead).toBeVisible()
 await expect(dialog.locator('.conversation-prompts')).toBeVisible()
 await dialog.locator('.conversation-related summary').click()
 await dialog.getByRole('button',{name:'Provide an observation',exact:true}).click()
 await expect(dialog.locator('.operation-guidance')).toContainText('not a confirmed fact')
 await expect(dialog.locator('.operation-example')).toContainText('I booked a dental visit today')
 assert.deepEqual(await dialog.locator('form label').allTextContents(),[
  'Information to understand','Language tag','Retention','Evaluation instant (optional; defined by the adopted knowledge)'])
 await expect(dialog.getByLabel('Information to understand',{exact:true})).toHaveJSProperty('tagName','TEXTAREA')
 const visual=await dialog.evaluate(node=>({button:getComputedStyle(node.querySelector('.conversation-back')).backgroundColor,
  padding:parseFloat(getComputedStyle(node.querySelector('.frame-panel-body')).paddingLeft)}))
 assert.match(visual.button,/^rgba\(/,'conversation controls have a translucent surface')
 assert(visual.padding>=10,'conversation panel has usable inner spacing')
 await dialog.getByRole('button',{name:'Back to conversation'}).click()
 const seeded=await run(process.execPath,[new URL('../scripts/sample-digital-twin-observations.mjs',import.meta.url).pathname],
  {env:{...process.env,HATTER_SAMPLE_HOME:home,HATTER_TEST_CLI:cli},timeout:270000,maxBuffer:1048576})
 assert.equal(seeded.stderr,'')
 const inserted=JSON.parse(seeded.stdout)
 assert.equal(inserted.sampleOnly,true)
 assert.equal(inserted.results.length,6)
 assert(inserted.results.every(item=>['Retained','AlreadyRetained'].includes(item.state)))
 const roles=await command(['inference','roles','--maximum-items','8'])
 const roleRef=roles.roles.find(role=>role.roleRef.id==='runtime-role:sample-role-1')?.roleRef
 assert(roleRef)
 const memory=await command(['inference','memory','--request-json',JSON.stringify({roleRef})])
 const scheduler=await command(['inference','execute','--request-json','{"operation":"scheduler"}'])
 const results=new Set(Object.values(scheduler.scheduler.works).filter(work=>work.spec.roleRef.id===roleRef.id)
  .map(work=>work.state?.Completed?.result_ref).filter(Boolean))
 const received=memory.shortTerm.slice(-16).reverse().filter(item=>typeof item.surface==='string'&&!results.has(item.input_ref))
 assert(inserted.results.every(item=>received.some(entry=>entry.surface===item.text)))
 const location=new URL(await page.locator('#app').getAttribute('data-focus-location'),origin)
 const documentUrl=origin+'/api/document?'+new URLSearchParams({path:location.pathname,query:location.search.slice(1)})
 await expect.poll(async()=>{
  const response=await page.request.get(documentUrl),value=await response.json()
  return value.bootstrap.speaker?.observations?.length??0
 },{timeout:20000}).toBe(memory.shortTerm.slice(-16).length)
 const current=await (await page.request.get(documentUrl)).json()
 assert.deepEqual(current.bootstrap.speaker.observations,memory.shortTerm.slice(-16).reverse())
 assert.equal(current.envelope.snapshot.data.focus,roleRef.id)
 await dialog.getByRole('button',{name:'Information about this person',exact:true}).click()
 const published=current.envelope.snapshot.data,placed=new Set(published.regions.flatMap(region=>region.itemIds))
 const expectedShelves=published.regions.filter(region=>region.itemIds.length).map(region=>({id:region.id,ids:region.itemIds}))
 const unplaced=published.items.map(item=>item.id).filter(id=>!placed.has(id))
 if(unplaced.length)expectedShelves.push({id:'unplaced',ids:unplaced})
 const shownShelves=await personInfo.locator('[data-person-shelf]').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.personShelf,ids:[...node.querySelectorAll('[data-person-information-id]')].map(item=>item.dataset.personInformationId)})))
 assert.deepEqual(shownShelves,expectedShelves,'the person panel must show exactly the current published Scene records')
 assert.equal(await page.locator('[data-world-kind="group"],[data-world-kind="record"]').count(),0,'the garden must not duplicate shelves or records as 3D objects')
 await dialog.getByRole('button',{name:'Back to conversation'}).click()
 await expect(dialog.getByRole('button',{name:'See available actions',exact:true})).toHaveCount(0)
 await expect(dialog.getByRole('button',{name:'UnknownExpression',exact:true})).toHaveCount(0)
 const activity=current.bootstrap.inference,personal=activity.roles.filter(work=>work.kind==='inference'&&work.roleRef.id===roleRef.id)
 const reserved=personal.some(work=>work.state==='Running')
 const expectedReviewState=!activity.available?'Unavailable':reserved?(activity.driverFailed?'Uncertain':'AwaitingResult'):
  personal.some(work=>work.state==='Blocked'&&work.detail==='InputUnavailable')?'InputNeeded':
  personal.some(work=>work.state==='Blocked')?'Waiting':personal.some(work=>work.state==='Runnable')?(activity.driverFailed?'Paused':'Queued'):
  activity.driverFailed?'Paused':personal.at(-1)?.state??'Idle'
 await expect(page.locator('.world-name[data-world-id="'+roleRef.id+'"]')).toHaveAttribute('data-activity',expectedReviewState)
 await dialog.getByRole('button',{name:'Review status',exact:true}).click()
 await expect(dialog.locator('[data-inference-role="'+roleRef.id+'"]').first()).toHaveAttribute('data-review-state',expectedReviewState)
 if(activity.driverFailed)await expect(dialog).toContainText('dispatcher')
 await dialog.getByRole('button',{name:'Back to conversation'}).click()
 const priority=current.bootstrap.speaker.reviewPriority
 const proposed=priority?.state==='Proposed'&&priority.order.every(ref=>received.some(item=>item.reference===ref))
 const expected=proposed?[...priority.order.map(ref=>received.find(item=>item.reference===ref)),...received.filter(item=>!priority.order.includes(item.reference))]:received
 assert(expected.length>=6)
 await expect(lead).toHaveAttribute('data-order',proposed?'proposed':'source',{timeout:20000})
 await expect.poll(()=>lead.locator('nav span').textContent(),{timeout:20000}).toContain(`/ ${expected.length}`)
 // The user's current page may be preserved across STATE; navigate from its
 // exact reference rather than silently resetting their reading position.
 const currentRef=await lead.getAttribute('data-reference')
 let index=expected.findIndex(item=>item.reference===currentRef)
 assert(index>=0)
 while(index>0){await lead.getByRole('button',{name:'← Previous'}).click();index--}
 for(const [number,item] of expected.entries()){
  await expect(lead).toHaveAttribute('data-reference',item.reference)
  await expect(lead).toContainText(item.surface)
  await expect(lead).toContainText(`${number+1} / ${expected.length}`)
  if(number+1<expected.length)await lead.getByRole('button',{name:'Next →'}).click()
 }
 await page.setViewportSize({width:390,height:844})
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight))
 await expect(lead).toHaveAttribute('data-reference',expected.at(-1).reference)
 await dialog.getByRole('button',{name:'Information about this person',exact:true}).click()
 const readable=published.presentation.find(entry=>entry.fields.length>0&&expectedShelves.some(shelf=>shelf.ids.includes(entry.itemId)))
 assert(readable,'a published information item must be readable without an invented world object')
 const shelf=personInfo.locator('[data-person-shelf="'+expectedShelves.find(shelf=>shelf.ids.includes(readable.itemId)).id+'"]')
 await shelf.locator('summary').click()
 await shelf.locator('[data-person-information-id="'+readable.itemId+'"]').click()
 assert.deepEqual(errors,[],'opening a published record must not raise a browser error')
 await expect(page.locator('#app')).toHaveAttribute('data-panel','details')
 const book=page.locator('[data-book-id="'+readable.itemId+'"]')
 await expect(book).toBeVisible();await expect(book.locator('h2')).toHaveText(readable.title)
 await expect(book.locator('.game-book-object')).toHaveCount(1)
 for(let pageIndex=0;pageIndex<Math.ceil(readable.fields.length/2);pageIndex++){
  await expect(book).toHaveAttribute('data-book-page',String(pageIndex))
  const fields=readable.fields.slice(pageIndex*2,pageIndex*2+2)
  assert.deepEqual(await book.locator('dt').allTextContents(),fields.map(field=>field.label))
  assert.deepEqual(await book.locator('dd').allTextContents(),fields.map(field=>field.value===null?'Not set':String(field.value)))
  if(pageIndex+1<Math.ceil(readable.fields.length/2))await book.getByRole('button',{name:'Next pages',exact:true}).click()
 }
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight))
 await page.locator('[data-world-selector] summary').click()
 assert(await page.getByRole('button',{name:'Your world',exact:true}).evaluate(node=>{
  const bounds=node.getBoundingClientRect(),hit=document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2)
  return node===hit||node.contains(hit)
 }),'the World selector stays above an open information book')
 await page.getByRole('button',{name:'Your world',exact:true}).click()
 await expect(page.locator('[data-world-kind=character]')).toHaveCount(3)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({status:'PASS',observations:received.length,pages:expected.length,priority:priority?.state??'SourceOrder',
  seeded:inserted.results.map(item=>item.state),mapSelection:true,personReviewState:expectedReviewState,book:true,live:true,mobile:true,externalRequests:0,screenshots:0}))
}finally{await browser.close()}
