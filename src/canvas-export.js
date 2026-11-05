const CanvasExport=(()=>{
 const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 async function dataURL(url){
  try{
   const response=await fetch(url);
   if(!response.ok)return '';
   const blob=await response.blob();
   return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(blob);
   });
  }catch{return '';}
 }
 function textMarkup(text,{x,y,width,height,size,color,center=false},measure){
  measure.font=size+'px -apple-system';
  const lines=[];
  for(const paragraph of String(text||'').split('\n')){
   let line='';
   for(const word of paragraph.split(' ')){
    const next=line?line+' '+word:word;
    if(line&&measure.measureText(next).width>width){lines.push(line);line=word;}
    else line=next;
   }
   lines.push(line);
  }
  const lineHeight=size*1.2,visible=lines.slice(0,Math.max(1,Math.floor(height/lineHeight)));
  const start=center?y+Math.max(size,(height-visible.length*lineHeight)/2+size):y+size;
  const left=center?x+width/2:x;
  return `<text x="${left}" y="${start}" xml:space="preserve" text-anchor="${center?'middle':'start'}" font-family="-apple-system,system-ui,sans-serif" font-size="${size}" fill="${escape(color)}">${visible.map((line,i)=>`<tspan x="${left}" dy="${i?lineHeight:0}">${escape(line)}</tspan>`).join('')}</text>`;
 }
 async function build(selectedOnly=false){
  const doc=CanvasWorkspace.doc;
  if(!doc)throw Error('Open a canvas first.');
  const items=[...doc.items.values()].filter(item=>!selectedOnly||doc.selection.has(item.id)).sort((a,b)=>a.z-b.z);
  const bounds=CanvasGeometry.bounds(items);
  if(!bounds)throw Error('Add items to the canvas first.');
  const pad=24,width=Math.ceil(bounds.width+2*pad),height=Math.ceil(bounds.height+2*pad);
  if(width>16000||height>16000||width*height>64000000)throw Error('This board is too large to export at once. Select a smaller group of items.');
  const measure=document.createElement('canvas').getContext('2d');
  const light=document.body.classList.contains('light-mode');
  const defaultTextColor=getComputedStyle(document.body).getPropertyValue('--text').trim();
  let body='';
  for(const item of items){
   const d=item.data,x=d.x-bounds.x+pad,y=d.y-bounds.y+pad,w=d.width,h=d.height,a=assetById.get(item.assetId);
   if(item.kind==='text'){
    body+=textMarkup(d.text,{x:x+2,y:y+2,width:w-4,height:h,size:d.fontSize||28,color:d.color.toLowerCase()==='#e8e8e8'?defaultTextColor:d.color},measure);
   }else if(item.kind==='shape'){
    if(['draw','arrow'].includes(d.shape)){
     body+=`<path transform="translate(${x} ${y})" d="${CanvasGeometry.strokePath(d)}" fill="none" stroke="${escape(d.color)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
     continue;
    }
    const fill=escape(d.color||'#e4d6b6');
    if(d.shape==='line')body+=`<line x1="${x}" y1="${y+h/2}" x2="${x+w}" y2="${y+h/2}" stroke="${fill}" stroke-width="3"/>`;
    else if(d.shape==='section')body+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="none" stroke="${fill}" stroke-width="2"/>`;
    else if(d.shape==='ellipse')body+=`<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" fill="${fill}"/>`;
    else body+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}"/>`;
    if(d.text)body+=textMarkup(d.text,{x:x+14,y:y+14,width:w-28,height:h-28,size:d.fontSize||18,color:d.textColor||'#252525',center:!['sticky','list','section'].includes(d.shape)},measure);
   }else{
    const src=a?await dataURL('asset://'+(kind(a)==='link'?'link-cover/':kind(a)==='image'?'preview/':'thumb/')+a.id):'';
    if(src)body+=`<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="${src}"/>`;
    else{
     const name=a?.name||CanvasWorkspace.folderRecords.find(f=>f.id===item.collectionId)?.name||item.data.label||'Missing item';
     body+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#eceef2"/>`;
     body+=textMarkup(name,{x:x+10,y:y+10,width:w-20,height:h-20,size:16,color:'#252525'},measure);
    }
   }
  }
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${light?'#f0f1f3':'#202122'}"/>${body}</svg>`,width,height,name:doc.board.name};
 }
 async function rasterize(result,factor){
  const width=result.width*factor,height=result.height*factor;
  if(width>16000||height>16000||width*height>64000000)throw Error('Choose 1× resolution or a smaller selection.');
  const image=new Image(),url=URL.createObjectURL(new Blob([result.svg],{type:'image/svg+xml'}));
  try{
   image.src=url;
   await image.decode();
   const canvas=document.createElement('canvas');
   canvas.width=width;canvas.height=height;
   canvas.getContext('2d').drawImage(image,0,0,width,height);
   return canvas.toDataURL('image/png');
  }finally{URL.revokeObjectURL(url);}
 }
 function choose(saveToFiles=false){
  if(!CanvasWorkspace.doc)return;
  const dialog=el('dialog','workbench-dialog canvas-export-dialog'),title=el('h2','',saveToFiles?'Save moodboard to Files':'Export canvas');
  const name=el('input');
  name.value=CanvasWorkspace.doc.board.name;name.maxLength=120;name.required=true;
  const options=el('div','canvas-export-options'),format=el('select'),scale=el('select');
  for(const value of ['PNG','PDF']){
   const option=el('option','',value);option.value=value.toLowerCase();format.append(option);
  }
  for(const value of [1,2]){
   const option=el('option','',value+'×');option.value=value;scale.append(option);
  }
  function field(text,input){const label=el('label','canvas-export-field',text);label.append(input);return label;}
  const resolution=field('Resolution',scale);
  format.onchange=()=>resolution.hidden=format.value==='pdf';
  if(!saveToFiles)options.append(field('Format',format));
  options.append(resolution);
  const selected=el('input');selected.type='checkbox';selected.disabled=!CanvasWorkspace.doc.selection.size;
  const scope=el('label','canvas-export-scope');scope.append(selected,el('span','','Selected items only'));
  const footer=el('div','canvas-export-actions'),cancel=action('Cancel',()=>dialog.close()),status=el('p','hint');
  status.hidden=true;status.setAttribute('role','status');
  const submit=action(saveToFiles?'Save to Files':'Export…',async()=>{
   if(!name.reportValidity())return;
   submit.disabled=cancel.disabled=true;
   status.hidden=true;
   try{
    CanvasWorkspace.finishGesture();CanvasWorkspace.finishText();
    const result=await build(selected.checked);
    const png=format.value==='png'?await rasterize(result,Number(scale.value)):undefined;
    const saved=await api.canvasExport({
     width:result.width,height:result.height,name:name.value.trim()||result.name,format:format.value,
     ...(png?{png}:{svg:result.svg}),destination:saveToFiles?'library':'file'
    });
    if(saved.cancelled)return;
    dialog.close();
    if(saveToFiles)await refreshCaptured([saved.id]);
    notify(saveToFiles?(saved.duplicate?'This snapshot is already in Files.':'Moodboard saved to Files.'):'Canvas exported.');
   }catch(error){
    status.textContent=(error.message||String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
    status.hidden=false;
   }finally{submit.disabled=cancel.disabled=false;}
  },'primary');
  footer.append(cancel,submit);
  dialog.append(title,field('Name',name),options,scope,el('p','hint',saveToFiles?'Saves a PNG snapshot in your library. You can keep editing the original canvas.':'Images and videos use their cached previews. Text and shapes stay sharp in PDF.'),status,footer);
  dialog.addEventListener('cancel',event=>{if(submit.disabled)event.preventDefault();});
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.append(dialog);dialog.showModal();
 }
 return {choose,build};
})();
