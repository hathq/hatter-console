// Hatter 2026: installed owner data, exact CLI equality, no seeded browser response.
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {chromium,expect} from '@playwright/test'
const home=process.env.HATTER_SAMPLE_HOME,output=process.env.HATTER_GRAPH_EVIDENCE_DIRECTORY
assert.match(home??'',/^\/.*\/hatter-sample\.[A-Za-z0-9]+$/)
const command=async args=>JSON.parse((await promisify(execFile)('/workspace/example/bin/hatter',args,{env:{...process.env,HATTER_HOME:home},maxBuffer:1048576,timeout:15000})).stdout)
const {roles}=await command(['inference','roles']);assert(roles.length>1)
const ref=roles[0].roleRef,params=JSON.stringify({roleRef:ref,maximumItems:256})
const dictionary=await command(['profile','dictionary','--request-json',params])
// Use the same explicit headless software WebGL backend as renderer acceptance.
// No pixel readback/screenshots; driver warnings remain test failures.
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),errors=[],results=[]
try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:844}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text())})
 await page.goto('http://localhost:4213/system/semantic')
 const initial=JSON.parse(await page.locator('#delivery-state').textContent()),view=initial.bootstrap.inspection
 assert.equal(initial.envelope.readiness.state,'Ready',JSON.stringify(initial.envelope.readiness))
 assert.deepEqual(view.documents.find(d=>d.id==='definitions').value,dictionary.definitions)
 assert.deepEqual(view.documents.find(d=>d.id==='bindings').value,dictionary.bindings)
 assert.deepEqual(view.documents.find(d=>d.id==='definitions').source.roleRef,ref)
  await expect(page.getByRole('region',{name:'Semantic structure graph'})).toBeVisible()
 await expect(page.getByRole('tabpanel',{name:'Responsibility overview'})).toBeVisible()
 await expect(page.locator('[data-responsibility]')).toHaveCount(4)
 const overview=view.overview
 assert.equal(overview.groups[0].state,'Not observed')
 assert.equal(overview.modules.length,dictionary.definitions.length)
 assert.equal(overview.groups[1].measures[0].value,dictionary.definitions.reduce((n,m)=>n+m.lexical_bindings.length,0))
 assert.equal(overview.groups[2].measures[0].value,dictionary.bindings.length)
 const entries=await command(['profile','list','--request-json',params])
 assert.equal(overview.groups[3].measures[0].value,entries.claims.length)
 for(const group of overview.groups)for(const measure of group.measures){
  const row=page.locator(`[data-responsibility="${group.id}"] [data-measure="${measure.unit}"]`)
  await expect(row.locator('strong')).toHaveText(measure.value===null?'Unavailable':String(measure.value)+(measure.partial?' +':''))
 }
 await page.getByRole('button',{name:'Inspect adopted capability bindings',exact:true}).click()
 await expect(page.getByRole('tab',{name:'Structure',exact:true})).toHaveAttribute('aria-selected','true')
 await expect(page.getByRole('combobox',{name:'Component',exact:true})).toHaveValue('bindings')
 await page.getByRole('tab',{name:'Overview',exact:true}).click()
 await expect(page.getByRole('tabpanel',{name:'Responsibility overview'})).toBeVisible()
 await page.getByRole('tab',{name:'Structure',exact:true}).click()
 await expect(page.locator('[data-world-kind=character]')).toHaveCount(roles.length)
 await expect(page.locator('.mind-world')).toHaveAttribute('data-pattern','garden')
 const component=page.getByRole('combobox',{name:'Component',exact:true})
 await component.selectOption('definitions');assert(await page.locator('[data-graph-node]').count()>1)
 assert((await page.locator('[data-graph-node]').evaluateAll(ns=>ns.map(n=>n.dataset.graphNode))).every(id=>id.startsWith('definitions:')))
 await page.getByRole('combobox',{name:'Structure depth'}).selectOption('1')
 await expect(page.getByRole('status').last()).toContainText('Depth or node limit')
 await page.getByRole('searchbox',{name:'Filter graph'}).fill('nothing-matches-this-value')
 await expect(page.locator('[data-graph-node]')).toHaveCount(0)
 await page.getByRole('searchbox',{name:'Filter graph'}).fill('')
 await page.locator('[data-graph-node]').first().click();await expect(page.getByText('profile/dictionary/read',{exact:true})).toBeVisible()
 await page.getByRole('combobox',{name:'Role',exact:true}).selectOption(roles[1].roleRef.id)
 assert.equal(page.url(),'http://localhost:4213/system/semantic')
 await expect(page.locator('#app')).toHaveAttribute('data-focus-location','/system/semantic?'+new URLSearchParams({role:roles[1].roleRef.id}))
 await expect(page.getByRole('combobox',{name:'Role',exact:true})).toHaveValue(roles[1].roleRef.id)
 await expect(page.locator('#app')).toHaveAttribute('aria-busy','false')
 await expect(page.getByRole('tabpanel',{name:'Responsibility overview'})).toBeVisible()
 await expect(page.locator('[data-graph-node]')).not.toHaveCount(0)
 await expect(page.locator('[aria-label="Owner readiness"] [role="alert"]')).toHaveCount(0)
 assert.equal(await page.locator('[aria-label="Owner readiness"]').getAttribute('role'),null,'role change must not silently pass an owner failure')
 const response=await page.request.get('http://localhost:4213/api/document?'+new URLSearchParams({path:'/system/semantic',query:new URLSearchParams({role:roles[1].roleRef.id}).toString()})),second=await response.json()
 assert.equal(second.envelope.readiness.state,'Ready',JSON.stringify(second.envelope.readiness))
 const secondDictionary=await command(['profile','dictionary','--request-json',JSON.stringify({roleRef:roles[1].roleRef,maximumItems:256})])
 assert.deepEqual(second.bootstrap.inspection.documents.find(d=>d.id==='definitions').value,secondDictionary.definitions)
 assert.equal(second.bootstrap.liveDocument,undefined,'inspection is explicit refresh, not repeated background semantic reads')
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('#app')).toHaveAttribute('aria-busy','false')
 await expect(page.getByRole('tabpanel',{name:'Responsibility overview'})).toBeVisible()
 await page.getByRole('tab',{name:'Structure',exact:true}).click()
 await expect(page.locator('[data-graph-node]')).not.toHaveCount(0)
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight))
 if(output)await page.screenshot({path:output+'/semantic-'+width+'.png'})
 await page.getByRole('navigation',{name:'Window tools'}).getByRole('button',{name:'Home',exact:true}).click()
 await expect(page.locator('[data-world-object]')).toHaveCount(3)
 await expect(page.getByRole('region',{name:'Semantic structure graph'})).toHaveCount(0)
 results.push({width,exactCliDefinitions:true,filterAndRoleSelection:true,worldSeparate:true});await page.close()
}assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',results,errors}))}finally{await browser.close()}
