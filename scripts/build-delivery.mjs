// Hatter downstream 2026: finite framework-neutral entrypoint closure.
import fs from 'node:fs'
import path from 'node:path'
import {build,transform} from 'esbuild'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const root=path.resolve(import.meta.dirname,'..'),output=root+'/.output'
const budgets=JSON.parse(fs.readFileSync(root+'/build-policy.json','utf8')).budgets
const stage=fs.mkdtempSync(root+'/.delivery-build-')
const hash=value=>createHash('sha256').update(value).digest('hex')
const browser=await build({entryPoints:[root+'/delivery/client.mjs'],bundle:true,platform:'browser',target:['es2022'],format:'esm',minify:true,write:false,metafile:true,legalComments:'inline',logLevel:'silent'})
if(browser.warnings.length)throw Error('DeliveryBuildWarnings')
const server=await build({entryPoints:[root+'/delivery/server.mjs'],bundle:true,platform:'node',target:'node22',format:'esm',write:false,metafile:true,
 external:['@hathq/projection-runtime','@hathq/projection-runtime/*','@hathq/projection-contracts','@hathq/projection-contracts/*','@zixcel/interaction','@zixcel/interaction/*'],
 banner:{js:"import {createRequire as deliveryRequire} from 'node:module'; const require=deliveryRequire(import.meta.url);"},legalComments:'inline',logLevel:'silent'})
if(server.warnings.length)throw Error('DeliveryBuildWarnings')
const inputs=[...Object.keys(browser.metafile.inputs),...Object.keys(server.metafile.inputs)]
if(inputs.some(p=>/(?:^|\/)(?:nuxt|nitro(?:pack)?|vue|@nuxt|@vue|@nuxtjp)(?:\/|$)/.test(p)))throw Error('ForbiddenDeliveryDependency')
fs.mkdirSync(stage+'/server');fs.mkdirSync(stage+'/public/assets',{recursive:true})
const stylesheet=await transform(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.resolve('@hathq/dom-renderer'))),'style.css'),'utf8'),{loader:'css',minify:true,target:['es2022'],legalComments:'inline'})
if(stylesheet.warnings.length)throw Error('DeliveryStyleWarnings')
const style=Buffer.from(stylesheet.code)
const assets=[['client',Buffer.from(browser.outputFiles[0].contents),'script','js'],['style',style,'style','css']].map(([name,bytes,kind,ext])=>{
 const digest=hash(bytes),asset='/assets/'+name+'-'+digest.slice(0,16)+'.'+ext
 if(bytes.length>(kind==='script'?budgets.largestClientJavaScriptBytes:budgets.clientCssBytes))throw Error('DeliveryAssetBudgetExceeded')
 fs.writeFileSync(stage+'/public'+asset,bytes,{flag:'wx'});return {path:asset,digest,bytes:bytes.length,kind}
})
fs.writeFileSync(stage+'/server/index.mjs',server.outputFiles[0].contents,{flag:'wx'})
const site={id:'hatter:console',revision:hash(JSON.stringify({assets,server:hash(server.outputFiles[0].contents)}))}
fs.writeFileSync(stage+'/server/delivery.json',JSON.stringify({site,assets})+'\n',{flag:'wx'})
// Preserve the superseded output as audit evidence, never a runtime fallback.
if(fs.existsSync(output)){
 const evidence=path.resolve(root,'../../../../../../../.artifacts/verification'),prior=fs.mkdtempSync(evidence+'/delivery-prior-')
 fs.renameSync(output,prior+'/output')
}
fs.renameSync(stage,output)
process.stdout.write(JSON.stringify({site,assets,serverBytes:server.outputFiles[0].contents.length,inputs:inputs.length,frameworkRuntimeInputs:0})+'\n')
