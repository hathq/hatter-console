// Hatter downstream 2026: independent trusted delivery, no frontend framework.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDeliveryServer} from '@hathq/delivery-server'
import {createHatterSite} from './site.mjs'
import {readHandoff} from '../server/lib/handoff.mjs'
import {DiagnosticStore} from '../server/lib/diagnostic-store.mjs'
// One existing diagnostic store, created before pre-listen waits. Closed bounded
// records are also observable when HTTP is not yet reachable. Never authority.
const diagnosticsStore=new DiagnosticStore()
const mark=stage=>{try{
 const observation=diagnosticsStore.recordStartup(stage)
 if(observation)process.stderr.write(JSON.stringify({code:'hatter-console-startup-observed',...observation})+'\n')
}catch{}}
mark('EntryStarted')
const directory=path.dirname(fileURLToPath(import.meta.url)),manifest=JSON.parse(fs.readFileSync(path.join(directory,'delivery.json')))
mark('HandoffStart')
await readHandoff(process.env)
mark('HandoffReady');mark('SiteStart')
const site=await createHatterSite(process.env,manifest.site,{diagnosticsStore,onStartupStage:mark})
mark('SiteConstructed')
const assets=manifest.assets.map(descriptor=>({...descriptor,bytesLength:descriptor.bytes,bytes:fs.readFileSync(path.join(directory,'../public',descriptor.path))}))
const delivery=createDeliveryServer({origin:process.env.HATTER_CONSOLE_ORIGIN??'http://localhost:4213',site,assets,readinessToken:process.env.HATTER_CONSOLE_READINESS_TOKEN,
 // The current delivery owner returns 204 only from its token-checked liveness
 // route; this is transport readiness, never semantic or product readiness.
 onOutcome:value=>{site.onOutcome(value);if(!readinessObserved&&value.owner==='hatter/delivery'&&value.httpStatus===204){readinessObserved=true;mark('ReadinessResponseFinished')}},
 onFailure:failure=>process.stderr.write(JSON.stringify(failure)+'\n')})
let readinessObserved=false
site.watch(()=>delivery.notify());mark('ListenStart');await delivery.listen();mark('SocketBound')
let stopping
const close=()=>stopping??=delivery.close().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'DeliveryCloseFailed'})+'\n');process.exitCode=1})
process.once('SIGINT',close);process.once('SIGTERM',close)
