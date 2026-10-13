// Hatter 2026: explicitly borrow and dispose the existing Management connection.
import {ManagementConnection} from '../server/lib/management-connection.mjs'
import {SourceOwnerClient} from '../server/runtime/source-owner-client.mjs'
export function sourceObserver(environment,options={}){
 const connection=new ManagementConnection({environment})
 const owner=new SourceOwnerClient({connection,...options})
 return {
  call:(...args)=>owner.call(...args),
  async close(){await owner.close();await connection.close()},
 }
}
