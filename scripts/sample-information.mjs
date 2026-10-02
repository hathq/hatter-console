// Isolated display sample only. All reads/writes use the running product's CLI.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
const home=process.env.HATTER_SAMPLE_HOME
if(!home||!/^\/.*\/hatter-sample\.[A-Za-z0-9]+$/.test(home))throw Error('Explicit isolated HATTER_SAMPLE_HOME required')
const cli=process.env.HATTER_TEST_BINARY_DIRECTORY+'/hatter'
if(!cli.startsWith('/'))throw Error('Absolute HATTER_TEST_BINARY_DIRECTORY required')
const run=promisify(execFile)
const command=async args=>{const r=await run(cli,args,{env:{...process.env,HATTER_HOME:home},timeout:15000,maxBuffer:1048576});if(r.stderr.trim())throw Error(r.stderr);return JSON.parse(r.stdout)}
const text=process.argv[2],roleId=process.argv[3]??'runtime-role:sample-role-1'
if(!text||text.length>256||!/^runtime-role:sample-role-[123]$/.test(roleId))throw Error('Usage: node add-information.mjs "sample text" [runtime-role:sample-role-1]')
const seed=JSON.parse(await readFile(home+'/sample-seed.json','utf8'))
if(seed.fixtureKind!=='explicit-owner-knowledge-only')throw Error('Not an isolated sample')
const {roles}=await command(['inference','roles'])
const role=roles.find(r=>r.roleRef.id===roleId);if(!role)throw Error('Sample role missing')
const state=await command(['inference','restore','--request-json',JSON.stringify({roleRef:role.roleRef})])
const id=randomUUID(),node=()=>randomUUID().replaceAll('-','')
const request={control:{operation_id:'sample:cli:'+id,expected_commit_revision:state.controlCommitRevision},roleRef:role.roleRef,restoration:state.restoration,
 input:{reference:'source:sample:'+id,root:'root',nodes:[{identity:'root',locator:'sample.contact',shape:{Record:['kind','value']}},{identity:'kind',locator:'sample.kind',shape:{Value:{Text:'@'}}},{identity:'value',locator:'sample.value',shape:{Value:{Text:text}}}],constraints:[],
 context:{subject:role.subjectRef,evidence:[],at:null,locale:'en',semantic_revision:state.semanticRevision,context_refs:[],context_scope:'CurrentRequest',observation_evidence:[]},
 budget:{max_nodes:128,max_edges:256,max_candidates:128,max_steps:32768,max_depth:32,max_bytes:65536}},
 packetId:node(),claimId:node(),decisionRef:'decision:sample:'+id,observedAt:Date.now(),packet:{operation_id:'sample:packet:'+id,expected_commit_revision:state.runtimeCommitRevision,expected_semantic_digest:state.runtimeSemanticDigest}}
const args=['inference','source','--request-json',JSON.stringify(request)]
const accepted=await command(args)
if(!accepted.commit||accepted.resolution.reason!==null)throw Error(JSON.stringify(accepted))
// Replaying the exact same command must return the same canonical result.
const replay=await command(args)
if(JSON.stringify(replay)!==JSON.stringify(accepted))throw Error('Replay diverged')
console.log(JSON.stringify({text,accepted,replay:'identical'}))

