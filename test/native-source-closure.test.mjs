// Hatter: product reachability, not a list of historical UI expectations.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {build} from 'esbuild'
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(d+'/'+e.name):[d+'/'+e.name])
test('only current native product sources remain; every local module has a production or packaging consumer',async()=>{
 for(const p of ['nuxt.config.ts','tsconfig.json','playwright.config.mjs'])assert.equal(fs.existsSync(p),false,p)
 for(const directory of ['app','server/api','server/plugins','server/middleware','server/routes'])if(fs.existsSync(directory))assert.deepEqual(files(directory),[],directory)
 const entryPoints=['delivery/server.mjs','delivery/client.mjs','bin/hatter-console.mjs','bin/hatter-release-verify.mjs',...files('scripts').filter(p=>p.endsWith('.mjs'))]
 const result=await build({entryPoints,bundle:true,platform:'node',format:'esm',write:false,outdir:'/tmp/not-written',metafile:true,logLevel:'silent'})
 assert.deepEqual(result.warnings,[])
 const inputs=new Set(Object.keys(result.metafile.inputs))
 for(const path of [...files('server'),...files('shared')])assert(inputs.has(path),'unowned local module: '+path)
 for(const path of inputs)assert.doesNotMatch(path,/(?:^|\/)(?:nuxt|vue|nitropack|h3)(?:\/|$)/)
 const manifest=JSON.parse(fs.readFileSync('package.json'));assert.equal(manifest.version,'0.10.0')
 for(const [name,ref] of Object.entries(manifest.dependencies))assert.match(ref,/^file:.*\/npm\/[a-f0-9]{64}\/[^/]+-0\.10\.0\.tgz$/,name)
})
