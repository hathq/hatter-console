// Hatter downstream 2026: explicitly populate the isolated fictional sample
// through the same owner-declared CLI interaction used by the browser.
// These are observations for review, not adopted profile facts or a default.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile} from 'node:fs/promises'

const home=process.env.HATTER_SAMPLE_HOME
const cli=process.env.HATTER_TEST_CLI
if(!home||!/^\/.*\/hatter-sample\.[A-Za-z0-9]+$/.test(home)||!cli?.startsWith('/'))throw Error('Provide isolated HATTER_SAMPLE_HOME and absolute HATTER_TEST_CLI')
const seed=JSON.parse(await readFile(home+'/sample-seed.json','utf8'))
if(seed.fixtureKind!=='explicit-owner-knowledge-only')throw Error('This is not the isolated fictional sample')
const run=promisify(execFile)
async function command(args){
 const result=await run(cli,args,{env:{...process.env,HATTER_HOME:home},timeout:15000,maxBuffer:1048576})
 if(result.stderr.trim())throw Error(result.stderr)
 return JSON.parse(result.stdout)
}
const roleId='runtime-role:sample-role-1'
const observations=[
 'Fictional example: I want help reviewing my personal information before making a plan.',
 'Fictional example: My sample residence is Tokyo, Japan; its jurisdiction has not been verified.',
 'Fictional example: I am learning a language and want a short practice task each day.',
 'Fictional example: Weekday evenings might be available for study, but no calendar availability is known.',
 'Fictional example: A project note needs review this week; no calendar is connected.',
 'Fictional example: I may connect email later, but I have not authorized any account connection.'
]
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function currentRole(){
 const result=await command(['inference','roles','--maximum-items','8'])
 const found=result.roles?.find(role=>role.roleRef.id===roleId)
 if(!found)throw Error('Fictional sample role is missing')
 return found.roleRef
}
const results=[]
for(const text of observations){
 const roleRef=await currentRole()
 const before=await command(['inference','memory','--request-json',JSON.stringify({roleRef})])
 if(before.shortTerm?.some(item=>item.surface===text)){results.push({text,state:'AlreadyRetained'});continue}
 const declared=await command(['interaction','--request-json',JSON.stringify({operation:'feedbackDescribe',roleRef})])
 const submitted=await command(['interaction','--request-json',JSON.stringify({operation:'feedbackSubmit',target:declared.interactionRef,
  generation:declared.generation,inputContractRef:declared.inputContractRef,values:{text,locale:'en',retention:'KeepForSession'}})])
 const receiptRef=submitted.receipt?.commit?.commit_ref,requestRef=submitted.assistance?.requestRef
 if(!receiptRef)throw Error(JSON.stringify({text,receiptRef,assistance:submitted.assistance}))
 let reviewState=submitted.assistance?.error?'Unavailable':'NotRequested'
 if(requestRef){
  let terminal=false
  for(let n=0;n<12;n++){
   const scheduler=await command(['inference','execute','--request-json','{"operation":"scheduler"}'])
   const work=scheduler.scheduler?.works?.[requestRef]
   if(work?.spec?.sourceReceiptRef!==receiptRef)throw Error('Work does not refer to the original observation receipt')
   if(work.state?.Completed){terminal=true;reviewState='Completed';break}
   if(work.state?.Failed||work.state?.Cancelled){terminal=true;reviewState='Unavailable';break}
   await pause(500)
  }
  if(!terminal)reviewState='Pending'
 }
 const after=await command(['inference','memory','--request-json',JSON.stringify({roleRef:await currentRole()})])
 if(!after.shortTerm?.some(item=>item.surface===text))throw Error('The accepted text did not reach semantic memory')
 results.push({text,state:'Retained',receiptRef,requestRef:requestRef??null,reviewState})
}
console.log(JSON.stringify({sampleOnly:true,roleId,results}))
