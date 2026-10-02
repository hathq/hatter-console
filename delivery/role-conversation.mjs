// Navigation to existing owner publications, never execution/approval inference.
export function conversationViews(streams,roleId,currentKey=null){
 const labels={subject:'Your information',resolution:'Review a confirmation',operation:'Review an execution'}
 return streams.filter(s=>s.roleId===roleId&&s.key!==currentKey&&Object.hasOwn(labels,s.view)&&s.status?.state==='Published')
  .slice(0,8).map(s=>({key:s.key,label:labels[s.view]}))
}
