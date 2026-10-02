// Test process only: pause existing production boundaries, never replace their
// return values or source readers. Parent kills this exact process and restarts.
import fs from 'node:fs'
import path from 'node:path'
const {ProjectionRuntime}=await import(new URL('../.output/server/node_modules/@hathq/projection-runtime/src/runtime.mjs',import.meta.url))
const {FileProjectionStore}=await import(new URL('../.output/server/node_modules/@hathq/projection-runtime/src/store.mjs',import.meta.url))
const mode=process.env.HATTER_PP_CRASH_MODE,home=process.env.HATTER_HOME
function pause(phase){
  const arm=path.join(home,'publication-crash-arm')
  if(mode!==phase||!fs.existsSync(arm))return
  fs.unlinkSync(arm);fs.writeFileSync(path.join(home,'publication-crash-ready'),phase,{flag:'wx'})
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20000)
  throw Error('test crash boundary deadline exceeded')
}
const submit=ProjectionRuntime.prototype.submit
ProjectionRuntime.prototype.submit=function(...args){pause('before-submit');return submit.apply(this,args)}
const pending=FileProjectionStore.prototype.pending
FileProjectionStore.prototype.pending=function(...args){const result=pending.apply(this,args);pause('during-submit');return result}
const publish=FileProjectionStore.prototype.publish
FileProjectionStore.prototype.publish=function(...args){
  if(fs.existsSync(path.join(home,'publication-write-unavailable')))
    throw Object.assign(Error('ProjectionStoreBusy'),{code:'ProjectionStoreBusy'})
  const result=publish.apply(this,args);pause('after-acceptance');return result
}
