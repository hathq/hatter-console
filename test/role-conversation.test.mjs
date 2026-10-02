import test from 'node:test'
import assert from 'node:assert/strict'
import {conversationViews} from '../delivery/role-conversation.mjs'
test('conversation navigation is role-scoped published state, not inferred execution success or approval',()=>{
 const stream=(key,roleId,view,state)=>({key,roleId,view,status:{state}})
 const streams=[stream('self','a','subject','Published'),stream('confirmation','a','resolution','Published'),stream('work','a','operation','Published'),stream('foreign','b','operation','Published'),stream('waiting','a','operation','Pending'),stream('failed','a','operation','FailedTyped')]
 assert.deepEqual(conversationViews(streams,'a','self'),[{key:'confirmation',label:'Review a confirmation'},{key:'work',label:'Review an execution'}])
 assert.deepEqual(conversationViews(streams,'missing'),[])
 assert.equal(conversationViews(Array.from({length:9},(_,i)=>stream(String(i),'a','operation','Published')),'a').length,8)
 assert.equal(JSON.stringify(conversationViews(streams,'a')).includes('Succeeded'),false)
})
