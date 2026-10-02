// Hatter downstream 2026: preserve only the two installed immutable Projection
// packages, whose workers and implementation digests require original files.
// No package installation, dependency resolution or owner source checkout copy.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=path.resolve(import.meta.dirname,'..')
const names=['@hathq/projection-contracts','@hathq/projection-runtime','@zixcel/interaction']
let count=0,bytes=0
for(const name of names){
  const source=path.resolve(path.dirname(fileURLToPath(import.meta.resolve(name))),'..')
  const manifest=JSON.parse(fs.readFileSync(source+'/package.json'))
  assert.equal(manifest.name,name);assert.equal(manifest.version,'0.10.0')
  // ohash is used only by the browser condition and is bundled by Vite. Node
  // resolves the native hash module; it does not need a duplicate ohash tree.
  assert.ok(Object.keys(manifest.dependencies??{}).every(n=>names.includes(n)
    || (name==='@hathq/projection-contracts'&&n==='ohash'&&manifest.dependencies[n]==='2.0.11')))
  const target=root+'/.output/server/node_modules/'+name
  function copy(directory,relative=''){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const from=directory+'/'+entry.name,to=target+'/'+relative+entry.name
      if(entry.isDirectory())copy(from,relative+entry.name+'/')
      else {
        assert.ok(entry.isFile(),'package contains non-regular entry')
        assert.ok(++count<=32,'review package file budget before expansion')
        const content=fs.readFileSync(from);bytes+=content.length
        assert.ok(bytes<=131072,'bounded standalone Projection closure')
        fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to)
        assert.deepEqual(fs.readFileSync(to),content)
      }
    }
  }
  copy(source)
}
process.stdout.write(JSON.stringify({projection_packages:names,files:count,bytes})+'\n')
