// Public source validation; owner-source parity stays in test:owner-source.
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
const root=path.resolve(import.meta.dirname,'..')
const ownerTests=new Set(['management-protocol-projection.test.mjs','protocol-contract.test.mjs','repository-identity.test.mjs','rpc-policy.test.mjs'])
const tests=fs.readdirSync(path.join(root,'test')).filter(name=>name.endsWith('.test.mjs')&&!ownerTests.has(name)).sort().map(name=>'test/'+name)
if(!tests.length)throw Error('Public test set is empty')
const result=spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'})
if(result.error)throw result.error
process.exitCode=result.status??1
