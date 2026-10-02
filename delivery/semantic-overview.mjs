// Hatter 2026: read-only presentation of observed contracts, not meaning classification.
export function semanticOverview(documents){
 const find=id=>documents.find(d=>d.id===id)
 const array=id=>Array.isArray(find(id)?.value)?find(id):null
 const definitions=array('definitions'),bindings=array('bindings'),claims=array('claims'),memory=array('shortTerm')
 const measure=(doc,value,unit)=>({documentId:doc?.id??null,value:doc?value:null,unit,partial:doc?.source?.truncated===true})
 const modules=definitions?.value??[],lexemes=modules.flatMap(m=>m.lexical_bindings??[])
 const languages=[...new Set(lexemes.flatMap(b=>String(b.language_tag).split(',')))].sort()
 return {
  title:'Meaning and memory',
  note:'Observed data for the selected role. Package ownership is not declared by these read contracts; names are not used to guess it.',
  groups:[
   {id:'source',title:'Language foundation',state:'Not observed',note:'Source-built universal definitions are not exposed by this role inventory.',measures:[]},
   {id:'extension',title:'Language and regional extensions',state:definitions?'Observed expressions':'Unavailable',note:'Expressions are visible; regional or publisher ownership is not verified.',measures:[measure(definitions,lexemes.length,'language expressions'),measure(definitions,languages.length,'declared languages')],values:languages},
   {id:'application',title:'Hatter application connections',state:bindings?'Observed bindings':'Unavailable',note:'A meaning-to-capability binding is not proof of installation, a running model or permission. Definition ownership remains unclassified.',measures:[measure(bindings,bindings?.value.length,'adopted capability bindings')]},
   {id:'personal',title:'Information in this role',state:claims&&memory?'Observed memory':'Partially observed',note:'Recorded facts and short-term context are separate. A record does not identify who authored or approved it without its source evidence.',measures:[measure(claims,claims?.value.length,'recorded facts'),measure(memory,memory?.value.length,'short-term records')]}
  ],
  modules:modules.map(m=>({id:m.vocabulary_id,version:m.version,dependencies:m.dependencies??[],terms:m.terms?.length??0,expressions:m.lexical_bindings?.length??0})),
  modulesAvailable:Boolean(definitions),modulesPartial:definitions?.source?.truncated===true
 }
}
