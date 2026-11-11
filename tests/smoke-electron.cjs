// Isolated integration tests: no user's clipboard or library is modified.
process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR='/private/tmp/asset-library-upgrade-test-'+Date.now();
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {app,clipboard,ClipboardItem}=require('electron');const {Library}=require('../electron/library.cjs');const {DatabaseSync}=require('node:sqlite');
require(process.env.ASSET_LIBRARY_MAIN||'../electron/main.cjs');
(async()=>{
  const lib=new Library(path.join(process.env.AGAGWU_DATA_DIR,'Library'));
  const sourceRoot='/Users/solomon/Library/Application Support/Asset Library/Library';
  if(fs.existsSync(path.join(sourceRoot,'library.sqlite'))){const source=new DatabaseSync(path.join(sourceRoot,'library.sqlite'),{readOnly:true});for(const a of source.prepare('SELECT * FROM assets LIMIT 8').all()){const r=await lib.importFile(path.join(sourceRoot,a.stored));lib.update(r.imported||r.duplicate,{name:a.name});}source.close();}
  await lib.importFile(path.join(__dirname,'fixtures/test-tone.wav'));
  for(const name of ['Portrait','Square','Landscape']){const result=await lib.importFile(path.join(__dirname,'fixtures',name+'.png'));lib.update(result.imported,{name:name+' study.png'});}
  // Synthetic metadata reuses one tiny managed image; only this isolated database is populated.
  const tiny=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPa0AAAAASUVORK5CYII=','base64');
  fs.writeFileSync(path.join(lib.root,'originals','fixture.png'),tiny);
  const insert=lib.db.prepare('INSERT INTO assets(id,name,ext,size,hash,stored,created,imported) VALUES(?,?,?,?,?,?,?,?)');lib.db.exec('BEGIN');for(let i=0;i<10000;i++)insert.run(crypto.randomUUID(),'Performance fixture '+i+'.png','png',tiny.length,'fixture-'+i,'originals/fixture.png','2020-01-01','2020-01-01');lib.db.exec('COMMIT');lib.close();
  await app.whenReady();
  const win=global.assetTestWindow;if(win.webContents.isLoading())await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error'&&!event.message.startsWith('Failed to load resource'))errors.push(event.message);});
  const evalJS=code=>win.webContents.executeJavaScript(code);
  await evalJS('refresh()');
  const perf=await evalJS(`(()=>{const times=[];for(let i=0;i<30;i++){const t=performance.now();$('#gallery').scrollTop=i*7000;renderWindow();times.push(performance.now()-t);}$('#gallery').scrollTop=0;renderWindow();return {total:assets.length,mounted:document.querySelectorAll('.card').length,maxMs:Math.max(...times),averageMs:times.reduce((a,b)=>a+b)/times.length};})()`);
  console.log('GALLERY',JSON.stringify(perf));
  if(perf.mounted>100)throw new Error('Gallery did not virtualize');
  const previewLayout=await evalJS(`(async()=>{setView('all');const a=assets.find(a=>a.name==='Portrait study.png');select(a.id);openPreview();const image=$('#preview-content img');if(!image.naturalWidth)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Photo preview did not load within eight seconds')),8000);image.addEventListener('load',()=>{clearTimeout(timer);resolve();},{once:true});});const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(150);const previous=$('#previous').getBoundingClientRect(),counter=$('#preview-index').getBoundingClientRect(),next=$('#next').getBoundingClientRect(),body=$('.preview-body').getBoundingClientRect(),footer=$('.preview-bottom').getBoundingClientRect();const original=selected;$('#next').click();const changed=selected!==original;$('#previous').click();const restored=selected===original;return {noHeader:!document.querySelector('.preview-top'),noFilename:!document.querySelector('#preview-name'),arrowsInFooter:$('#previous').parentElement===$('.preview-bottom')&&$('#next').parentElement===$('.preview-bottom'),horizontal:previous.right<=counter.left&&counter.right<=next.left,footerBelow:footer.top>=body.bottom-1,counter:$('#preview-index').textContent,changed,restored};})()`);console.log('PREVIEW_LAYOUT',JSON.stringify(previewLayout));if(!previewLayout.noHeader||!previewLayout.noFilename||!previewLayout.arrowsInFooter||!previewLayout.horizontal||!previewLayout.footerBelow||!previewLayout.changed||!previewLayout.restored||!previewLayout.counter.includes(' / '))throw new Error('Minimal preview layout or navigation failed');await new Promise(r=>setTimeout(r,150));fs.writeFileSync('/private/tmp/canvas-minimal-preview.png',(await win.webContents.capturePage()).toPNG());await evalJS('closePreview()');
  const video=await evalJS("assets.find(a=>kind(a)==='video')?.id");
  if(video){const result=await evalJS(`(async()=>{select('${video}');openPreview();const m=previewPlayer.media;await new Promise((resolve,reject)=>{if(m.readyState>=1)return resolve();m.addEventListener('loadedmetadata',resolve,{once:true});m.addEventListener('error',()=>reject(new Error('Video load failed')),{once:true});});m.currentTime=Math.min(8,m.duration/2);await new Promise(resolve=>m.addEventListener('seeked',resolve,{once:true}));const info=await getMediaInfo(assetById.get('${video}'),true);return {duration:m.duration,playing:!m.paused,seek:m.currentTime,poster:info.poster,width:info.width,height:info.height};})()`);console.log('VIDEO',JSON.stringify(result));if(!result.width||!result.height)throw new Error('Video dimensions were not extracted');await evalJS('closePreview()');}
  if(video){
    win.webContents.setBackgroundThrottling(false);
    const result=await evalJS(`(async()=>{
      setView('video');await getMediaInfo(assetById.get('${video}'),true);await new Promise(r=>setTimeout(r,300));$('#gallery').scrollTop=0;renderWindow();
      const card=document.querySelector('.card'),surface=card.querySelector('.surface');
      card.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
      const player=hoverPlayer,m=player.media;
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<100&&m.readyState<2;i++)await wait(50);
      await wait(200);
      const stage=player.element.querySelector('.media-stage'),controls=player.element.querySelector('.player-controls');
      const stageRect=stage.getBoundingClientRect(),rootRect=player.element.getBoundingClientRect();
      const ratios={stage:stageRect.width/stageRect.height,native:m.videoWidth/m.videoHeight};
      const samples=[];
      for(const fraction of [.2,.5,.8]){
        const bounds=stage.getBoundingClientRect();
        stage.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:bounds.left+bounds.width*fraction}));
        await wait(350);samples.push({fraction,actual:m.currentTime/m.duration});
      }
      m.dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait(100);
      const playing=!m.paused,overlay=getComputedStyle(controls).position==='absolute',fullHeight=Math.abs(stageRect.height-rootRect.height)<1;
      card.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));
      select('${video}');openPreview();
      const toolbarRemoved=!document.querySelector('#native-preview'),focusOnDialog=document.activeElement===$('#preview');
      closePreview();
      return {ratios,samples,playing,overlay,fullHeight,toolbarRemoved,focusOnDialog};
    })()`);
    console.log('HOVER_SCRUB',JSON.stringify(result));
    if(!result.overlay||!result.fullHeight||Math.abs(result.ratios.stage-result.ratios.native)>.02||!result.playing||!result.toolbarRemoved||!result.focusOnDialog||result.samples.some(s=>Math.abs(s.actual-s.fraction)>.05))throw new Error('Hover aspect, live scrubbing or preview toolbar regression');
  }
  const audio=await evalJS("assets.find(a=>a.ext==='m4a')?.id");
  if(audio){const result=await evalJS(`(async()=>{select('${audio}');openPreview();const info=await window.library.mediaInfo('${audio}',true);return {duration:info.duration,peaks:info.peaks?.length,artwork:info.artwork,playing:!previewPlayer.media.paused,controls:!!document.querySelector('.full-player .seek'),nativeControls:previewPlayer.media.controls};})()`);console.log('AUDIO',JSON.stringify(result));if(result.peaks!==512)throw new Error('Audio waveform was not generated');await evalJS('closePreview()');}
  await evalJS("setView('audio')");
  const hover=await evalJS(`(async()=>{const card=document.querySelector('.card');card.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));await new Promise(resolve=>setTimeout(resolve,400));const playing=!!hoverPlayer&&!hoverPlayer.media.paused;card.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));return {playing,released:hoverPlayer===null};})()`);console.log('HOVER',JSON.stringify(hover));if(!hover.playing||!hover.released)throw new Error('Hover playback failed');await new Promise(resolve=>setTimeout(resolve,1000));
  // Artwork-specific hover checks require an M4A fixture; the WAV fallback is covered below.
  if(audio){const audioSpace=await evalJS(`(async()=>{
    const card=document.querySelector('.card[data-id="${audio}"]');card.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
    await new Promise(r=>setTimeout(r,250));
    const noHoverWave=!hoverPlayer.element.querySelector('canvas'),cover=!!hoverPlayer.element.querySelector('.cover-art');
    const art=hoverPlayer.element.querySelector('.cover-art img');if(art){const tile=hoverPlayer.element.parentElement.getBoundingClientRect(),bounds=art.getBoundingClientRect();if(Math.abs(tile.width-bounds.width)>2||Math.abs(tile.height-bounds.height)>2)throw Error('Hover artwork shrinks inside the audio tile');}const hovered=hoverPlayer.id,seek=hoverPlayer.element.querySelector('.seek');seek.focus();
    seek.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));
    const opened=!$('#preview').hidden&&selected===hovered&&!!previewPlayer&&hoverPlayer===null;
    closePreview();return {noHoverWave,cover,opened};
  })()`);console.log('AUDIO_SPACE',JSON.stringify(audioSpace));if(!audioSpace.noHoverWave||!audioSpace.cover||!audioSpace.opened)throw new Error('Audio hover or Space preview regression');}
  fs.writeFileSync('/private/tmp/asset-library-gallery.png',(await win.webContents.capturePage()).toPNG());
  if(audio){await evalJS(`select('${audio}');openPreview()`);await new Promise(resolve=>setTimeout(resolve,500));const coverOnly=await evalJS("!document.querySelector('.full-player .cover-art img')||!document.querySelector('.full-player .player-wave')");if(!coverOnly)throw Error('Audio artwork still has a waveform in the viewer');console.log('AUDIO_ARTWORK_WITHOUT_WAVEFORM_OK');fs.writeFileSync('/private/tmp/asset-library-audio.png',(await win.webContents.capturePage()).toPNG());}
  const noArt=await evalJS(`(async()=>{const a=assets.find(a=>a.ext==='wav');select(a.id);openPreview();await window.library.mediaInfo(a.id,true);await new Promise(resolve=>setTimeout(resolve,100));return {noCover:!!document.querySelector('.audio-stage.no-cover'),peaks:(await getMediaInfo(a,true)).peaks?.length};})()`);console.log('NO_ART_AUDIO',JSON.stringify(noArt));if(!noArt.noCover||noArt.peaks!==512)throw new Error('Waveform fallback failed');
  const polish=await evalJS(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const waveHeight=document.querySelector('.full-player .player-wave').getBoundingClientRect().height;
    const fallbackVisible=getComputedStyle(document.querySelector('.full-player .cover-art')).display!=='none';
    closePreview();renderInspector();await wait(100);
    const inspectorFallback=!!document.querySelector('.inspector-audio .file-placeholder .sf-symbol');
    const art=assets.find(a=>a.ext==='m4a');let inspectorArtwork=true;
    if(art){setView('audio');select(art.id);renderInspector();await wait(400);inspectorArtwork=!!document.querySelector('.inspector-audio img');}
    setView('image');await wait(200);const image=visible.find(a=>a.name==='Landscape study.png');if(!image)throw Error('Landscape fixture is missing');select(image.id);renderInspector();await wait(250);
    const img=document.querySelector('.inspector-media>img');if(!img)throw Error('Image inspector preview is missing');const rect=img.getBoundingClientRect();
    const naturalRatio=Math.abs(rect.width/rect.height-img.naturalWidth/img.naturalHeight)<.02;
    const dimensions=[...document.querySelectorAll('.properties dt')].find(dt=>dt.textContent==='Dimensions')?.nextElementSibling?.textContent||'';
    $('#search').focus();const searchOutline=getComputedStyle($('#search')).outlineStyle;
    return {waveHeight,fallbackVisible,inspectorFallback,inspectorArtwork,naturalRatio,dimensions,searchOutline};
  })()`);console.log('PREVIEW_POLISH',JSON.stringify(polish));
  if(polish.waveHeight>64||!polish.fallbackVisible||!polish.inspectorFallback||!polish.inspectorArtwork||!polish.naturalRatio||!/^\d+ × \d+$/.test(polish.dimensions)||polish.searchOutline!=='none')throw new Error('Audio, inspector, dimensions or search styling regression');
  await evalJS(`setView('all');const fixture=assets.find(a=>a.ext==='wav');select(fixture.id);openPreview()`);

  const keyboard=await evalJS(`(()=>{const canvas=document.querySelector('.full-player canvas');canvas.focus();canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return {closed:document.querySelector('#preview').hidden};})()`);console.log('KEYBOARD',JSON.stringify(keyboard));if(!keyboard.closed)throw new Error('Escape failed after waveform focus');
  const zoom=await evalJS(`(()=>{setView('all');const g=$('#gallery');g.scrollTop=layout.height*.8;renderWindow();const before=AssetLayout.anchorAt(layout,g.scrollTop,g.clientHeight);$('#zoom').value=360;$('#zoom').dispatchEvent(new Event('input'));const position=layout.byId.get(before.id);return {mounted:mounted.size,anchorError:Math.abs(g.scrollTop-(position.y+before.offset*position.width/before.width))};})()`);console.log('ZOOM',JSON.stringify(zoom));if(zoom.anchorError>2||zoom.mounted>100)throw new Error('Zoom anchor failed');
  await evalJS(`setView('image');$('#search').value='study';render();`);
  await new Promise(resolve=>setTimeout(resolve,800));
  const masonry=await evalJS(`(()=>{const expected={Portrait:2/3,Square:1,Landscape:16/9};const values=visible.map(a=>({name:a.name,ratio:a.aspectRatio,height:layout.byId.get(a.id).surfaceHeight,expected:expected[a.name.split(' ')[0]]}));return {values,distinctHeights:new Set(values.map(a=>Math.round(a.height))).size};})()`);console.log('MASONRY',JSON.stringify(masonry));if(masonry.distinctHeights!==3||masonry.values.some(a=>Math.abs(a.ratio-a.expected)>.005))throw new Error('Native image aspect ratios were flattened');
  fs.writeFileSync('/private/tmp/asset-library-masonry.png',(await win.webContents.capturePage()).toPNG());
  const multiple=await evalJS(`(async()=>{setView('all');$('#gallery').scrollTop=0;$('#gallery').focus();select(visible[0].id);$('#gallery').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));$('#gallery').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));await new Promise(resolve=>requestAnimationFrame(resolve));const grown=selection.ids.size,stack=document.querySelectorAll('.stack-card').length;$('#gallery').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true}));const shrunk=selection.ids.size;select(visible[5].id,{metaKey:true});const additive=selection.ids.size;await bulkAction({type:'tags',tags:['Integration selection']});return {grown,stack,shrunk,additive,tagged:selection.values().every(id=>assetById.get(id).tags.includes('Integration selection'))};})()`);console.log('MULTI_SELECTION',JSON.stringify(multiple));if(multiple.grown!==3||multiple.stack!==3||multiple.shrunk!==2||multiple.additive!==3||!multiple.tagged)throw new Error('Multi-selection or bulk actions failed');
  const sidebar=await evalJS(`(()=>{const width=$('#gallery').clientWidth;$('#toggle-sidebar').click();renderWindow();const hidden=document.body.classList.contains('hide-sidebar'),expanded=$('#gallery').clientWidth>width;$('#toggle-sidebar').click();renderWindow();return {hidden,expanded,restored:!document.body.classList.contains('hide-sidebar')};})()`);console.log('SIDEBAR',JSON.stringify(sidebar));if(!sidebar.hidden||!sidebar.expanded||!sidebar.restored)throw new Error('Sidebar toggle failed');
  await new Promise(resolve=>setTimeout(resolve,100));fs.writeFileSync('/private/tmp/canvas-pro-selection.png',(await win.webContents.capturePage()).toPNG());
  console.log('RENDERER_ERRORS',JSON.stringify(errors));console.log('SMOKE_OK',process.env.AGAGWU_DATA_DIR);app.quit();
})().catch(e=>{console.error('SMOKE_FAILED',e);app.exit(1);});
