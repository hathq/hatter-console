// Fault injection only: kill the actual immutable store helper after fsync and
// before rename. No replacement store, payload or owner transport is supplied.
import fs from 'node:fs'
import {syncBuiltinESMExports} from 'node:module'
if(process.argv[3]==='publish'){
  const rename=fs.renameSync
  fs.renameSync=(from,to)=>{
    if(String(from).endsWith('/derived/projections/projection.next')&&String(to).endsWith('/projection.json')){
      process.kill(process.ppid,'SIGKILL')
      // The actual kernel parent-death guard must terminate this writer before
      // it can perform the prepared rename. A surviving helper is a test failure.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500)
    }
    return rename(from,to)
  }
  syncBuiltinESMExports()
}
