const TagSuggestions=(()=>{
 function mount(asset,{add}){
  const results=el('div','ai-suggestions');
  const button=el('button','ai-suggest');
  button.type='button';
  button.setAttribute('aria-label','Suggest tags with the local model');
  button.title='Suggest tags with the local model';
  button.append(glyph('sparkles'));
  button.onclick=()=>safe(async()=>{
   if(button.disabled)return;
   button.disabled=true;
   results.replaceChildren(el('p','hint','Asking the local model…'));
   try{
    if(!asset.smart?.caption)await SmartSearch.describe(asset);
    await SmartSearch.suggestTags(asset,(list,message)=>{
     results.replaceChildren();
     if(message){results.append(el('p','hint',message));return;}
     if(!list.length){results.append(el('p','hint','No suggestions for this file.'));return;}
     for(const tag of list){
      const chip=el('button','chip chip-suggestion',tag);
      chip.type='button';
      chip.title='Add “'+tag+'”';
      chip.onclick=()=>safe(()=>add(tag));
      results.append(chip);
     }
     results.append(el('p','hint','Click a suggestion to add it as a tag.'));
    });
   }finally{
    button.disabled=false;
   }
  });
  return{button,results};
 }
 return{mount};
})();
