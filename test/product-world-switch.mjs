// Hatter downstream 2026: real product World selection, without screenshots or external access.
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,isAbsolute} from 'node:path'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import {spawnParentBound} from '@crowsi/transport-foundation/process'
import {chromium,expect} from '@playwright/test'

const directory=process.env.HATTER_TEST_BINARY_DIRECTORY
assert.ok(isAbsolute(directory??''),'exact product binary directory required')
const hub=await mkdtemp(join(tmpdir(),'hatter-world-product-'))
const another=join(tmpdir(),`hatter-world-product-${process.pid}-${Date.now()}`)
const root=spawnParentBound(join(directory,'hatter'),[],{cwd:hub,
 env:{HOME:hub,HATTER_HOME:hub,HATTER_CONSOLE_EXECUTABLE:process.env.HATTER_TEST_CONSOLE_EXECUTABLE??join(directory,'hatter-console'),
  HATTER_CONSOLE_NODE_EXECUTABLE:process.execPath},stdio:['ignore','pipe','pipe']})
let output='',diagnostics='',browser
root.stdout.on('data',chunk=>{output=(output+chunk).slice(-16384)})
root.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-16384)})
const closed=once(root,'close')
const deadline=setTimeout(()=>root.kill('SIGKILL'),90000)
async function command(args){
 const child=spawnParentBound(join(directory,'hatter'),args,{cwd:hub,env:{HOME:hub,HATTER_HOME:hub},stdio:['ignore','pipe','pipe']})
 let stdout='',stderr=''
 child.stdout.on('data',chunk=>{stdout+=chunk})
 child.stderr.on('data',chunk=>{stderr+=chunk})
 const [code]=await once(child,'close')
 assert.equal(code,0,stderr)
 return JSON.parse(stdout)
}
async function mounted(page,id){
 let consecutive=0
 const until=Date.now()+30000
 while(Date.now()<until){
  try{const worlds=await page.evaluate(()=>fetch('/api/worlds').then(response=>response.json()))
   consecutive=worlds.active===id&&worlds.mounted===id?consecutive+1:0
   if(consecutive===3)return
  }catch{consecutive=0}
  await delay(300)
 }
 throw Error(`WorldMountUnavailable:${id}:${diagnostics}`)
}
try{
 const until=Date.now()+30000
 while(!output.includes('http://localhost:4213/\n')&&root.exitCode===null&&Date.now()<until)await delay(50)
 assert.ok(output.includes('http://localhost:4213/\n'),diagnostics)
 browser=await chromium.launch({headless:true})
 const page=await browser.newPage({viewport:{width:1280,height:800}})
 await page.goto('http://localhost:4213/')
 const initial=await page.evaluate(()=>fetch('/api/worlds').then(response=>response.json()))
 assert.equal(initial.active,'home');assert.equal(initial.mounted,'home')
 assert.equal(JSON.stringify(initial).includes(hub),false,'browser must not receive host paths')
 const originalChildren=(await readFile(`/proc/${root.pid}/task/${root.pid}/children`,'utf8')).trim()
 await page.locator('[data-world-selector] summary').click()
 await page.getByRole('textbox',{name:'New world name'}).fill('Field world')
 await page.getByRole('textbox',{name:'World folder on this device'}).fill(another)
 await page.getByRole('button',{name:'Create and enter'}).click()
 await expect(page.locator('[data-world-selector] h1')).toHaveText('Field world',{timeout:30000})
 const created=await page.evaluate(()=>fetch('/api/worlds').then(response=>response.json()))
 const field=created.worlds.find(world=>world.name==='Field world')
 assert.ok(field);assert.equal(created.active,field.id);assert.equal(created.mounted,field.id)
 assert.equal(JSON.stringify(created).includes(another),false)
 assert.notEqual((await readFile(`/proc/${root.pid}/task/${root.pid}/children`,'utf8')).trim(),originalChildren,
  'switch must replace the owner group, not reuse old owners')
 const listed=await command(['world','list'])
 assert.equal(listed.active,field.id);assert.equal(listed.worlds.find(world=>world.id===field.id).home,another)
 await command(['world','select','home'])
 await mounted(page,'home');await page.reload()
 await expect(page.locator('[data-world-selector] h1')).toHaveText('Your world')
 await page.locator('[data-world-selector] summary').click()
 await page.locator(`[data-world-id="${field.id}"]`).click()
 await expect(page.locator('[data-world-selector] h1')).toHaveText('Field world',{timeout:30000})
 assert.equal((await command(['world','list'])).active,field.id)
 process.stdout.write(JSON.stringify({status:'PASS',worlds:2,uiCreate:true,cliSelect:true,uiSelect:true,ownerRestart:true,pathRedacted:true})+'\n')
}catch(error){
 process.stderr.write(JSON.stringify({error:String(error),rootExit:root.exitCode,diagnostics,output})+'\n')
 throw error
}finally{
 await browser?.close()
 if(root.exitCode===null&&root.signalCode===null)root.kill('SIGTERM')
 await closed;clearTimeout(deadline)
 await rm(hub,{recursive:true,force:true})
 await rm(another,{recursive:true,force:true})
}
