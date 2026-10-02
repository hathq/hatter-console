// Hatter: test-only Linux observation, never a process-management authority.
import fs from 'node:fs'
import assert from 'node:assert/strict'

function identity(pid) {
  try {
    const text=fs.readFileSync(`/proc/${pid}/stat`,'utf8')
    const fields=text.slice(text.lastIndexOf(')')+2).split(' ')
    return {pid:Number(pid),parent:Number(fields[1]),start:fields[19],state:fields[0]}
  } catch(error) {
    if(['ENOENT','ESRCH'].includes(error.code))return null
    throw error
  }
}

export function observeTree(pid) {
  const all=fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p)).map(identity).filter(Boolean)
  const owned=new Set([pid]);let size
  do{size=owned.size;for(const p of all)if(owned.has(p.parent))owned.add(p.pid)}while(owned.size!==size)
  return all.filter(p=>owned.has(p.pid))
}

export async function assertTreeStopped(observed) {
  const live=()=>observed.filter(p=>{
    const current=identity(p.pid)
    return current?.start===p.start&&!['Z','X'].includes(current.state)
  })
  const deadline=Date.now()+5000
  while(live().length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20))
  assert.deepEqual(live(),[],'the observed exact product descendants must stop before restart')
}
