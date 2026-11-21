const AppSelect=(()=>{
 const CHECK='\u2713';
 const instances=new WeakMap();
 const live=new Set();
  let optionCounter=0;
 document.addEventListener('click',event=>{
  for(const api of live){
   if(!api.root.isConnected){live.delete(api);continue;}
   if(api.isOpen()&&!api.root.contains(event.target))api.close();
  }
 });
 addEventListener('resize',()=>{for(const api of live)if(api.isOpen())api.position();});

 function chevron(){
  const span=el('span','select-indicator');
  span.setAttribute('aria-hidden','true');
  return span;
 }

 function create(config={}){
  const state={
   options:config.options||[],
   multiple:!!config.multiple,
   placeholder:config.placeholder||'Select…',
   onChange:config.onChange||(()=>{}),
   selected:new Set(config.multiple?[...(config.value||[])]:config.value!==undefined&&config.value!==null&&config.value!==''?[config.value]:[]),
   open:false,
  };

  const root=el('div','select');
  const trigger=el('button','select-trigger');
  trigger.type='button';
  trigger.setAttribute('aria-haspopup','listbox');
  trigger.setAttribute('aria-expanded','false');
  const accessibleName=config.label||config.placeholder||'';
  if(accessibleName)trigger.setAttribute('aria-label',accessibleName);
  const valueBox=el('span','select-value');
  const indicator=chevron();
  trigger.append(valueBox,indicator);
  const popover=el('div','select-popover');
  popover.setAttribute('popover','auto');
  popover.setAttribute('role','listbox');
  if(state.multiple)popover.setAttribute('aria-multiselectable','true');
  const list=el('div','select-list');
  popover.append(list);
  root.append(trigger,popover);

  function labelFor(value){
   const option=state.options.find(one=>one.value===value);
   return option?option.label:String(value);
  }

  function renderValue(){
   valueBox.replaceChildren();
   if(!state.selected.size){
    valueBox.classList.add('is-placeholder');
    valueBox.textContent=state.placeholder;
    return;
   }
   valueBox.classList.remove('is-placeholder');
   if(!state.multiple){
    valueBox.textContent=labelFor([...state.selected][0]);
    return;
   }
   for(const value of state.selected){
    const chip=el('span','select-chip',labelFor(value));
    const remove=el('button','select-chip-remove');
    remove.type='button';
    remove.setAttribute('aria-label','Remove '+labelFor(value));
    remove.textContent='\u00d7';
    remove.onclick=event=>{event.stopPropagation();pick(value,false);};
    chip.append(remove);
    valueBox.append(chip);
   }
  }

  function renderList(){
   list.replaceChildren();
   for(const option of state.options){
    const item=el('button','select-item');
    item.id='select-item-'+(++optionCounter);
    item.type='button';
    item.setAttribute('role','option');
    const chosen=state.selected.has(option.value);
    item.setAttribute('aria-selected',String(chosen));
    if(chosen)item.classList.add('is-selected');
    item.dataset.value=option.value;
    item.append(el('span','select-item-label',option.label));
    if(option.description)item.append(el('span','select-item-description',option.description));
    const tick=el('span','select-item-tick');
    tick.setAttribute('aria-hidden','true');
    tick.textContent=CHECK;
    item.append(tick);
    item.onclick=event=>{event.stopPropagation();pick(option.value);};
    list.append(item);
   }
   if(!state.options.length)list.append(el('p','select-empty','Nothing to choose yet'));
  }

  function render(){
   renderValue();
   renderList();
  }

  function pick(value,close=true){
   if(state.multiple){
    if(state.selected.has(value))state.selected.delete(value);
    else state.selected.add(value);
   }else{
    state.selected=new Set([value]);
   }
   render();
   state.onChange([...state.selected]);
   if(close&&!state.multiple)closeList();
   else if(close)position();
  }

  function position(){
   const rect=trigger.getBoundingClientRect();
   const width=Math.max(rect.width,180);
   const wanted=(list.scrollHeight||0)+12;
   const below=innerHeight-rect.bottom-18;
   const above=rect.top-18;
   const flip=below<Math.min(wanted,above)&&above>below;
   const room=Math.max(150,Math.min(wanted,flip?above:below));
   popover.style.width=width+'px';
   popover.style.left=Math.max(8,Math.min(innerWidth-width-8,rect.left))+'px';
   popover.style.maxHeight=room+'px';
   popover.style.top=(flip?rect.top-room-6:rect.bottom+6)+'px';
  }

  function openList(){
   if(state.open||trigger.disabled)return;
   state.open=true;
   trigger.setAttribute('aria-expanded','true');
   root.classList.add('is-open');
   render();
   position();
   live.add(api);
   popover.showPopover();
   position();
   const selected=[...list.querySelectorAll('.select-item')].find(item=>item.getAttribute('aria-selected')==='true');
   const first=list.querySelector('.select-item');
   (selected||first)?.focus();
  }

  function closeList(){
   if(!state.open)return;
   state.open=false;
   trigger.setAttribute('aria-expanded','false');
   root.classList.remove('is-open');
   live.delete(api);
   popover.hidePopover();
  }

  function items(){
   return [...list.querySelectorAll('.select-item')];
  }

  function move(step){
   const all=items();
   if(!all.length)return;
   const index=all.indexOf(document.activeElement);
   const next=all[Math.max(0,Math.min(all.length-1,(index<0?0:index+step)))];
   next.focus();
  }

  let typed='';
  let typedTimer=0;
  function typeahead(character){
   typed+=character.toLowerCase();
   clearTimeout(typedTimer);
   typedTimer=setTimeout(()=>{typed='';},600);
   const match=items().find(item=>item.querySelector('.select-item-label').textContent.toLowerCase().startsWith(typed));
   if(match)match.focus();
  }

  trigger.onclick=()=>state.open?closeList():openList();
  trigger.onkeydown=event=>{
   if(event.key==='ArrowDown'||event.key==='Enter'||event.key===' '){event.preventDefault();openList();}
   else if(event.key.length===1&&!event.metaKey&&!event.ctrlKey)typeahead(event.key);
  };
  list.onkeydown=event=>{
   if(event.key==='ArrowDown'){event.preventDefault();move(1);}
   else if(event.key==='ArrowUp'){event.preventDefault();move(-1);}
   else if(event.key==='Home'){event.preventDefault();items()[0]?.focus();}
   else if(event.key==='End'){event.preventDefault();items().at(-1)?.focus();}
   else if(event.key==='Tab')closeList();
   else if(event.key.length===1&&!event.metaKey&&!event.ctrlKey)typeahead(event.key);
  };
  list.addEventListener('focusin',event=>{const item=event.target.closest?.('.select-item');if(item)popover.setAttribute('aria-activedescendant',item.id);});
   popover.addEventListener('toggle',event=>{if(event.newState==='closed'&&state.open){popover.removeAttribute('aria-activedescendant');state.open=false;trigger.setAttribute('aria-expanded','false');root.classList.remove('is-open');live.delete(api);}});

  render();
  const api={
   root,
   trigger,
   popover,
   get value(){return state.multiple?[...state.selected]:[...state.selected][0]??'';},
   get values(){return [...state.selected];},
   set values(next){
    state.selected=new Set(Array.isArray(next)?next:next==null?[]:[next]);
    render();
    state.onChange([...state.selected]);
   },
   setValues(next){
    state.selected=new Set(Array.isArray(next)?next:next==null?[]:[next]);
    render();
   },
   setOptions(options){state.options=options||[];render();},
   setPlaceholder(text){state.placeholder=text;renderValue();},
   open:openList,
   close:closeList,
   position,
   isOpen:()=>state.open,
  };
  instances.set(root,api);
  return api;
 }

 function attach(select,{multiple=false,placeholder='Select…'}={}){
  const read=()=>[...select.options].map(option=>({value:option.value,label:option.textContent}));
  const api=create({
   options:read(),
   value:multiple?[...select.selectedOptions].map(option=>option.value):select.value,
   multiple,
   placeholder,
   label:select.getAttribute('aria-label')||'',
   onChange:values=>{
    if(multiple){for(const option of select.options)option.selected=values.includes(option.value);}
    else select.value=values[0]??'';
    select.dispatchEvent(new Event('change',{bubbles:true}));
   },
  });
  select.classList.add('select-native');
  if(select.parentNode)select.parentNode.insertBefore(api.root,select);
  api.root.append(select);
  select.focus=()=>api.trigger.focus();
  const syncDisabled=()=>{
   api.trigger.disabled=select.disabled;
   api.trigger.setAttribute('aria-disabled',String(select.disabled));
  };
  syncDisabled();
  new MutationObserver(syncDisabled).observe(select,{attributes:true,attributeFilter:['disabled']});
  select.addEventListener('change',()=>{
   api.setValues(multiple?[...select.selectedOptions].map(option=>option.value):(select.selectedIndex>=0?[select.value]:[]));
  });
  return{
   ...api,
   refresh(){api.setOptions(read());},
  };
 }

 function anyOpen(){return [...live].some(api=>api.isOpen()&&api.root.isConnected);}

 return {create,attach,instances,anyOpen};
})();
