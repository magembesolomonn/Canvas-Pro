let actionTarget=null;
function showActionDialog(mode,ids=[],name=''){
 stopHover();const icon=$('#action-form .creation-icon');if(icon)icon.hidden=mode!=='new-collection';const titles={tags:'Add tags',rename:'Rename file','new-collection':'New collection','rename-collection':'Rename collection'};actionTarget={mode,ids:[...ids],name};$('#action-title').textContent=titles[mode];$('#action-description').textContent=mode==='tags'?'Add tags to '+ids.length+' selected '+(ids.length===1?'file.':'files.'):mode==='new-collection'?'Create a collection and add the selected files.':mode==='rename-collection'?'Files and their metadata stay in this collection.':'Change the display name in your library.';const input=$('#action-value');input.value=mode==='rename'?(assetById.get(ids[0])?.name||''):name;input.maxLength=mode==='tags'?2000:mode==='rename'?255:120;input.placeholder=mode==='tags'?'Tags, separated by commas':'Name';input.setAttribute('aria-label',mode==='tags'?'Tags':'Name');$('#action-error').textContent='';$('#action-dialog').showModal();input.focus();input.select();
}
async function deleteSelectedPermanently(ids=selection.values()){
 stopHover();if(!$('#preview').hidden)closePreview();notify('Waiting for deletion confirmation…');try{const result=await api.deletePermanently(ids);if(result.cancelled){notify('Deletion cancelled');return;}for(const id of result.ids||[]){mediaMetadata.delete(id);mediaInFlight.delete(id);}await refreshCurrent();notify(result.deleted+' '+(result.deleted===1?'file':'files')+' permanently deleted.');}finally{}
}
async function emptyTrash(){stopHover();if(!$('#preview').hidden)closePreview();const result=await api.emptyTrash();if(result.cancelled)return;mediaMetadata.clear();mediaInFlight.clear();await refreshCurrent();if(result.deleted)notify('Trash emptied · '+result.deleted+' files permanently deleted.');}
async function handleContextAction(command){
 const ids=command.ids||[];if(!$('#preview').hidden&&['tags','rename','new-collection','collection','remove-collection','trash','restore','delete-permanently'].includes(command.action))closePreview();switch(command.action){
 case 'choose-icon':await WorkbenchUI.pickIcon(command.key);break;
 case 'similar':await WorkbenchUI.similar(ids[0]);break;
 case 'canvas-rename':CanvasWorkspace.rename(command.boardId);break;
 case 'canvas-delete':await CanvasWorkspace.removeBoard(command.boardId);break;
 case 'canvas-add':await CanvasWorkspace.addAssets(command.boardId,ids,null,true);break;
 case 'canvas-new':CanvasWorkspace.choose({ids,forceNew:true});break;
 case 'canvas-collection':CanvasWorkspace.choose({collectionName:command.name});break;
 case 'favorite':await setFavorites(ids,command.favorite);break;
 case 'preview':selection.clear();for(const id of ids)selection.ids.add(id);selected=ids[0];selection.focus=selected;selection.anchor=selected;paintSelection();renderInspector();openPreview();break;
 case 'tags':case 'rename':case 'new-collection':showActionDialog(command.action,ids);break;
 case 'collection':case 'remove-collection':case 'trash':case 'restore':{
  const operation=command.action==='collection'?{type:'collection',folder:command.folder}:command.action==='remove-collection'?{type:'removeCollection',folder:command.folder}:{type:'trash',trash:command.action==='trash'};await api.bulkUpdate(ids,operation);await refreshCurrent();notify(command.action==='trash'?'Moved '+ids.length+' files to Trash.':command.action==='restore'?'Restored '+ids.length+' files.':'Updated '+ids.length+' files.');break;}
 case 'copy':await api.copyFiles(ids);notify(ids.length+' files copied.');break;
 case 'export':{const count=await api.exportFiles(ids);if(count)notify(count+' copies exported.');break;}
 case 'share':await api.shareFiles(ids);break;
 case 'reveal':await api.reveal(ids[0]);break;
 case 'copy-path':await api.copyPath(ids[0]);notify('Path copied');break;
 case 'open':await api.openFile(ids[0]);break;
 case 'source':await api.openLink(ids[0]);break;
 case 'copy-source':await api.copySource(ids[0]);notify('Source URL copied.');break;
 case 'delete-permanently':await deleteSelectedPermanently(ids);break;
 case 'rename-collection':showActionDialog('rename-collection',[],command.name);break;
 case 'delete-collection':{const result=await api.removeCollection(command.name);if(result.removed){if(view==='folder'&&collection===command.name)setView('all');await refreshCurrent();notify('Collection removed. Its files remain in your library.');}break;}
 }
}
function renderEmptyState(){
 const empty=$('#empty'),icon=empty.querySelector('.empty-icon'),heading=empty.querySelector('h2'),description=empty.querySelector('p'),button=$('#empty-import'),small=empty.querySelector('small');const trashCount=pagedCatalog?navStats?.counts.trash||0:assets.filter(a=>a.trash).length;$('#empty-trash').hidden=view!=='trash';$('#import').hidden=view==='trash';$('#import-folder').hidden=view==='trash';$('#empty-trash').disabled=!trashCount;
 icon.replaceChildren();empty.classList.toggle('trash-empty',view==='trash'&&!trashCount);button.hidden=false;small.hidden=false;button.onclick=()=>importDialog();button.textContent=assets.length?'Import files':'Import your first files';const openLibrary=$('#empty-open-library');openLibrary.hidden=view==='trash';openLibrary.onclick=()=>safe(()=>api.switchLibrary('open'));
 if(view==='trash'&&!trashCount){const image=el('img');image.src='assets/trash-empty.png';image.alt='Empty macOS Trash';icon.append(image);heading.textContent='Trash is empty';description.textContent='Files you move to Trash appear here. You can restore them, or permanently delete their library originals, thumbnails, and cached previews.';button.hidden=true;small.textContent='Deleting from Trash cannot be undone.';}
 else if(view==='trash'){icon.append(glyph('search'));heading.textContent='No matching files in Trash';description.textContent='Try a different search or file type. Items elsewhere in Trash are still available to restore.';button.hidden=false;button.textContent='Clear filters';button.onclick=()=>{$('#search').value='';$('#type').value='all';render();};small.hidden=true;}
 else if(view==='favorites'&&!(pagedCatalog?navStats?.counts.favorites:assets.some(a=>!a.trash&&a.favorite))){icon.append(glyph('star'));heading.textContent='No favourites yet';description.textContent='Click the star on a file, or choose Add to Favourites from its right-click menu.';button.hidden=false;small.hidden=false;}
 else if(view==='tags'&&!(pagedCatalog?navStats?.counts.tags:assets.some(a=>!a.trash&&a.tags.length))){icon.append(glyph('tag'));heading.textContent='No tags yet';description.textContent='Add tags to your files to find them here.';button.hidden=false;small.hidden=false;}
 else if((pagedCatalog?navStats?.counts.all:assets.length)){icon.append(glyph('search'));heading.textContent='No matching files';description.textContent='Try a different search, collection, or file type.';button.textContent='Import files';small.hidden=true;}
 else{icon.append(glyph('grid'));heading.textContent='Bring your files together';description.textContent='Drop files or folders here, import them, or copy in Finder and press ⌘V.';small.textContent='Images · videos · PDFs · design files · and everything else';}
 empty.hidden=visible.length>0;
}
function initContextUI(){
$('#preview-content').oncontextmenu=event=>{event.preventDefault();if(selected)safe(()=>api.contextMenu([selected],view==='folder'?collection:null));};
$('#action-cancel').onclick=()=>$('#action-dialog').close();$('#action-form').onsubmit=event=>{event.preventDefault();safe(async()=>{const target=actionTarget;if(!target)return;const value=$('#action-value').value.trim();if(!value){$('#action-error').textContent='Enter '+(target.mode==='tags'?'at least one tag.':'a name.');return;}const button=$('#action-save');button.disabled=true;try{if(target.mode==='tags'){const tags=value.split(',').map(t=>t.trim()).filter(Boolean);if(!tags.length)throw new Error('Enter at least one tag.');await api.bulkUpdate(target.ids,{type:'tags',tags});}else if(target.mode==='rename'){await api.update(target.ids[0],{name:value});}else if(target.mode==='new-collection'){await api.addFolder(value);if(target.ids.length)await api.bulkUpdate(target.ids,{type:'collection',folder:value});}else if(target.mode==='rename-collection'){await api.renameCollection(target.name,value);if(view==='folder'&&collection===target.name)collection=value;}$('#action-dialog').close();await refreshCurrent();notify('Changes saved.');if(target.mode==='new-collection'){const f=CanvasWorkspace.folderRecords.find(f=>f.name===value);if(f)await WorkbenchUI.created('folder:'+f.id,'collection');}}catch(e){$('#action-error').textContent=e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');}finally{button.disabled=false;}});};
$('#empty-trash').onclick=()=>safe(emptyTrash);api.onContextAction(command=>safe(()=>handleContextAction(command)));

}
