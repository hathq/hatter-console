// Hatter downstream 2026: notices follow the resolved product closure, not the
// historical renderer. No source-repository lookup or runtime dependency fallback.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex')
export async function stageDeliveryLicenses(repository,destination){
 const packages=new Map(),queue=[{root:repository,manifest:JSON.parse(await fs.readFile(repository+'/package.json'))}],inventory=[]
 while(queue.length){
  const parent=queue.shift(),require=createRequire(parent.root+'/package.json')
  for(const name of Object.keys(parent.manifest.dependencies??{})){
   if(!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name))throw Error('LicensePackageIdentityInvalid')
   let root,manifest
   for(const directory of require.resolve.paths(name)??[]){
    try{root=await fs.realpath(path.join(directory,name));manifest=JSON.parse(await fs.readFile(root+'/package.json'));break}
    catch(error){if(error.code!=='ENOENT')throw error}
   }
   if(!manifest||manifest.name!==name||!root.includes('/node_modules/'))throw Error('LicenseResolvedPackageMissing')
   if(packages.has(name)){if(packages.get(name)!==manifest.version)throw Error('LicensePackageVersionConflict');continue}
   packages.set(name,manifest.version);queue.push({root,manifest})
   const directory=name.replace('@',''),files=[];await fs.mkdir(destination+'/'+directory,{recursive:true})
   for(const file of ['LICENSE','LICENSE.md','LICENSE-MIT','LICENSE-APACHE','NOTICE']){
    let bytes;try{bytes=await fs.readFile(root+'/'+file)}catch(error){if(error.code==='ENOENT')continue;throw error}
    await fs.writeFile(destination+'/'+directory+'/'+file,bytes,{flag:'wx'});files.push({path:directory+'/'+file,digest:sha(bytes)})
   }
   let selectedLicense=manifest.license
   if(!files.some(f=>path.basename(f.path).startsWith('LICENSE'))){
    // An SPDX Apache grant refers to the standard license text. Dual MIT OR
    // Apache grants can be distributed under Apache, without inventing an MIT
    // copyright holder. Preserve the owner's original expression in inventory.
    if(!['Apache-2.0','MIT OR Apache-2.0','Apache-2.0 OR MIT'].includes(manifest.license))throw Error('LicenseTextMissing:'+name)
    selectedLicense='Apache-2.0';const bytes=await fs.readFile(repository+'/licenses/hatter/LICENSE')
    await fs.writeFile(destination+'/'+directory+'/LICENSE-APACHE',bytes,{flag:'wx'});files.push({path:directory+'/LICENSE-APACHE',digest:sha(bytes)})
   }
   inventory.push({name,version:manifest.version,license:manifest.license,selectedLicense,files})
  }
 }
 inventory.sort((a,b)=>a.name.localeCompare(b.name))
 await fs.writeFile(destination+'/inventory.json',JSON.stringify({schema:'hatter/delivery/licenses/1',packages:inventory},null,2)+'\n',{flag:'wx'})
 return inventory
}
