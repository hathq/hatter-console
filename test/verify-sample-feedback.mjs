// Hatter: explicit installed-product read-only acceptance, not a release entrypoint.
// No mock, mutation or screenshot.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
const [origin,resultsPath]=process.argv.slice(2)
const expected=JSON.parse(await fs.readFile(resultsPath,'utf8'))
assert.equal(expected.sampleOnly,true);assert.equal(expected.results.length,3)
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const errors=[]
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(15000)
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text())})
  assert.equal((await page.goto(origin)).status(),200)
  await expect(page.locator('.mind-world')).toHaveAttribute('data-gpu','ready')
  for(const result of expected.results){
   // The in-space directory remains reachable when projected labels overlap.
   // Exercise this real user route, never a forced click on a hidden label.
   await page.locator('.world-nearby > summary').click()
   await page.locator('[data-directory-id="'+result.roleRef.id+'"]').getByRole('button',{name:/^Talk to /}).click()
   await page.getByRole('dialog',{name:/^Conversation with /}).getByRole('button',{name:'Open conversation',exact:true}).click()
   const dialog=page.getByRole('dialog',{name:'Conversation',exact:true})
   await expect(dialog).toBeVisible()
   await expect(dialog.getByText('Questions and choices',{exact:true})).toHaveCount(0)
   await expect(dialog.getByRole('button',{name:'Provide an observation',exact:true})).toBeVisible()
   await expect(dialog.locator('[data-inference-request]').first()).not.toBeVisible()
   await dialog.getByRole('button',{name:'Review status',exact:true}).click()
   const work=dialog.locator('[data-inference-request="'+result.requestRef+'"]')
   await expect(work).toHaveAttribute('data-inference-state','Completed');await work.locator('summary').click()
   await expect(work).toContainText(result.resultRef)
   const location=new URL(await page.locator('#app').getAttribute('data-focus-location'),origin)
   const response=await page.request.get(new URL('/api/document?'+new URLSearchParams({path:location.pathname,query:location.search.slice(1)}),origin).href)
   assert.equal(response.status(),200)
   const document=await response.json()
   assert.equal(document.envelope.readiness.state,'Ready',JSON.stringify(document.envelope.readiness))
   assert.deepEqual(document.bootstrap.speaker.roleRef,result.roleRef)
   // The explicit sample authoring adopted one execution binding, not zero.
   assert.deepEqual(document.bootstrap.speaker.preparation.facts.map(f=>f.value),[1,0,0,1])
   const continuation=document.envelope.snapshot.data.items.find(item=>item.value?.kind==='continuation'&&item.value.reference.id===result.published.continuationRef.id)
   assert.deepEqual(continuation?.value.reference,result.published.continuationRef)
   assert.deepEqual(continuation?.value.value,result.published.continuation)
   assert(document.envelope.snapshot.data.unresolved.some(item=>item.reason==='UnknownExpression'))
   await dialog.getByRole('button',{name:'Back to conversation'}).click()
   await dialog.getByRole('button',{name:'Why this needs review',exact:true}).click()
   await expect(dialog.getByRole('region',{name:'Information needing clarification'})).toBeVisible()
   await page.getByRole('button',{name:'Close panel',exact:true}).click()
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight))
  await page.close()
 }
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({status:'PASS',viewports:[1280,390],roles:3,realRequests:3,exactReceipts:true,ownerContext:true,unresolvedVisible:true,screenshots:0}))
}finally{await browser.close()}
