const iconPaths={loop:'M18 3l3 3-3 3 M21 6H7a4 4 0 0 0-4 4 M6 21l-3-3 3-3 M3 18h14a4 4 0 0 0 4-4',canvas:'M4 4h16v16H4z M8 8h5v5H8z M15 14h3v4h-3z',hand:'M7 12V5a2 2 0 0 1 4 0v6 M11 10V3a2 2 0 0 1 4 0v8 M15 11V5a2 2 0 0 1 4 0v9 M19 12a2 2 0 0 1 3 1v3c0 5-3 7-7 7h-2c-3 0-4-2-6-4l-4-5a2 2 0 0 1 3-2l3 3',cursor:'M5 3l15 10-7 1-3 7z',text:'M4 5h16 M12 5v15 M8 20h8',rectangle:'M3 5h18v14H3z',ellipse:'M22 12a10 8 0 1 1-20 0 10 8 0 1 1 20 0',undo:'M9 5 3 10l6 5 M3 10h11a6 6 0 0 1 0 12',redo:'m15 5 6 5-6 5 M21 10H10a6 6 0 0 0 0 12',chevronLeft:'m14 5-7 7 7 7',chevronRight:'m10 5 7 7-7 7',settings:'M10 3h4l.5 2L17 6.5l2-.5 2 3.5-1.5 1.5v2L21 14.5 19 18l-2-.5-2.5 1.5-.5 2h-4l-.5-2L7 17.5 5 18l-2-3.5L4.5 13v-2L3 9.5 5 6l2 .5L9.5 5z M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0',activity:'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M12 7v5l3 2',health:'M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6z M8 12l3 3 5-6',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',folder:'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3z',image:'M3 3h18v18H3z M3 16l5-5 4 4 3-3 6 6 M8 7h.01',video:'M3 5h13v14H3z M16 10l5-3v10l-5-3',audio:'M4 14v-3a8 8 0 0 1 16 0v3 M4 13H2v7h5v-7z M20 13h2v7h-5v-7z',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',tag:'M3 3h8l10 10-8 8L3 11z M7 7h.01',trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',link:'M10 14l4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',play:'m9 5 11 7-11 7z',pause:'M8 5v14 M16 5v14',volume:'m11 5-6 4H2v6h3l6 4z M15 8a6 6 0 0 1 0 8 M18 4a11 11 0 0 1 0 16',mute:'m11 5-6 4H2v6h3l6 4z M16 9l6 6 M22 9l-6 6',expand:'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',file:'M5 2h9l5 5v15H5z M14 2v6h5',sidebar:'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z M9 4v16',plus:'M12 5v14 M5 12h14',search:'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'};
function glyph(name){const span=document.createElement('span');span.className='sf-symbol';span.style.setProperty('--symbol','url("assets/symbols/'+(iconPaths[name]||['layout','heart','lightbulb','briefcase','paintbrush','camera','book','leaf','sparkles','house','flag','archive','download','export','keyboard','close','reload','pencil','arrow','sticky','list','filter','sort','appearance','extensions','developers','about','experimental','importing','heading','checklist','toggle','table','tracker','minus'].includes(name)?name:'file')+'.png")');span.setAttribute('aria-hidden','true');return span;}
const mediaMetadata=new Map(),mediaInFlight=new Map();
const playbackDimensions=new WeakMap();
function withPlaybackDimensions(asset, metadata){
  const dimensions=playbackDimensions.get(asset);
  return dimensions&&(!metadata.width||!metadata.height)?{...metadata,...dimensions}:metadata;
}
async function getMediaInfo(a,priority=false){
  if(mediaMetadata.has(a.id)){
    const result=mediaMetadata.get(a.id);
    mediaMetadata.delete(a.id);
    mediaMetadata.set(a.id,result);
    return withPlaybackDimensions(a,result);
  }
  const current=mediaInFlight.get(a.id);
  if(current&&(!priority||current.priority))return withPlaybackDimensions(a,await current.request);
  const entry={priority};
  entry.request=window.library.mediaInfo(a.id,priority).then(result=>{
    if(mediaInFlight.get(a.id)===entry&&!result.deferred&&!result.unavailable){
      mediaMetadata.set(a.id,result);
      if(mediaMetadata.size>192)mediaMetadata.delete(mediaMetadata.keys().next().value);
    }
    return result;
  }).finally(()=>{if(mediaInFlight.get(a.id)===entry)mediaInFlight.delete(a.id);});
  mediaInFlight.set(a.id,entry);
  return withPlaybackDimensions(a,await entry.request);
}
function timecode(n){if(!Number.isFinite(n))return '0:00';n=Math.max(0,Math.floor(n));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');}
function waveCanvas(canvas,peaks,progress=0){
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;const scale=Math.min(2,window.devicePixelRatio||1),w=rect.width,h=rect.height;
  if(canvas.width!==Math.round(w*scale)||canvas.height!==Math.round(h*scale)){canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);}
  const ctx=canvas.getContext('2d');ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,w,h);const count=Math.floor(w/3),mid=h/2;
  if(!peaks?.length){ctx.fillStyle='#57595d';ctx.fillRect(0,mid,w,1);return;}
  for(let i=0;i<count;i++){let peak=0;const begin=Math.floor(i*peaks.length/count),end=Math.max(begin+1,Math.floor((i+1)*peaks.length/count));for(let j=begin;j<end;j++)peak=Math.max(peak,peaks[j]||0);const amplitude=Math.max(1,peak*(h*.44));ctx.fillStyle=progress>0&&i/count<progress?'#c8ccd2':'#666a72';ctx.fillRect(i*3,mid-amplitude,2,amplitude*2);}
}
function audioTile(a,surface){const canvas=document.createElement('canvas');canvas.className='tile-wave';canvas.hidden=true;surface.classList.add('audio-tile');surface.append(canvas);const label=document.createElement('span');label.className='wave-status';label.textContent='Reading audio…';surface.append(label);let peaks=[];const observer=new ResizeObserver(()=>waveCanvas(canvas,peaks));observer.observe(surface);getMediaInfo(a).then(info=>{if(!surface.isConnected)return;peaks=info.peaks||[];label.textContent=info.unavailable?'Audio preview unavailable':'';rememberRatio(a,info.artwork?1:3.5);if(info.artwork){surface.classList.add('has-art');canvas.remove();observer.disconnect();const cover=document.createElement('img');cover.alt='Embedded cover art';cover.src='asset://art/'+a.id;surface.prepend(cover);}else{canvas.hidden=false;}waveCanvas(canvas,peaks);const duration=surface.parentElement.querySelector('.duration');if(duration&&info.duration)duration.textContent=timecode(info.duration);});return ()=>observer.disconnect();}
function createPlayer(a,{compact=false,muted=false,scrubHover=true}={}){
  const root=document.createElement('div');root.className='media-player '+(compact?'compact-player':'full-player')+' '+kind(a)+'-player';
  const media=document.createElement(kind(a));media.preload='metadata';media.src='asset://file/'+a.id;media.muted=muted;media.loop=compact;media.playsInline=true;media.controls=false;
  const stage=document.createElement('div');stage.className='media-stage';root.append(stage);
  const canvas=document.createElement('canvas');canvas.className='player-wave';canvas.tabIndex=0;canvas.setAttribute('role','slider');canvas.setAttribute('aria-label','Scrub audio');canvas.setAttribute('aria-valuemin','0');canvas.setAttribute('aria-valuemax','100');
  let disposed=false,peaks=[],info={},dragging=false,pendingSeek=null,activeSeek=null,seekFrame=0;
  function requestSeek(time){if(!Number.isFinite(media.duration)||media.duration<=0)return;pendingSeek=Math.max(0,Math.min(media.duration-.001,time));sync();if(!seekFrame)seekFrame=requestAnimationFrame(flushSeek);}
  function flushSeek(){seekFrame=0;if(disposed||pendingSeek===null||media.seeking)return;const target=pendingSeek;pendingSeek=null;activeSeek=target;if(Math.abs(media.currentTime-target)<.015){activeSeek=null;sync();return;}media.currentTime=target;}
  media.addEventListener('seeked',()=>{activeSeek=null;if(pendingSeek!==null&&!seekFrame)seekFrame=requestAnimationFrame(flushSeek);sync();});
  media.addEventListener('loadedmetadata',()=>{if(kind(a)==='video'&&media.videoWidth&&media.videoHeight){playbackDimensions.set(a,{width:media.videoWidth,height:media.videoHeight});rememberRatio(a,media.videoWidth/media.videoHeight);root.style.setProperty('--video-ratio',String(media.videoWidth/media.videoHeight));if(!compact)fitVideo();}});
  function fitVideo(){
    if(compact||kind(a)!=='video'||!root.parentElement)return;
    const rect=root.parentElement.getBoundingClientRect();
    const ratio=media.videoWidth/media.videoHeight||a.aspectRatio||16/9;
    const width=Math.max(1,Math.min(rect.width,Math.max(1,rect.height-16)*ratio));
    stage.style.width=width+'px';
    // Give the controls room on very narrow videos while keeping the picture at its natural ratio.
    root.style.width=Math.max(width,Math.min(rect.width,260))+'px';
    root.style.height=(width/ratio)+'px';
  }
  if(kind(a)==='video'){stage.append(media);media.poster='asset://thumb/'+a.id;if(!compact)media.addEventListener('click',()=>media.paused?play():media.pause());if(compact&&scrubHover)stage.addEventListener('pointermove',event=>{if(event.pointerType==='touch')return;if(window.CanvasWorkspace?.gesture)return;const bounds=stage.getBoundingClientRect();if(bounds.width)requestSeek(Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width))*media.duration);});}
  else {
    stage.classList.add('audio-stage');stage.append(media);
    const art=document.createElement('div');art.className='cover-art';art.append(glyph('audio'));stage.append(art);if(!compact){const title=document.createElement('h2');title.textContent=a.name.replace(/\.[^.]+$/,'');stage.append(title);const caption=document.createElement('p');caption.className='audio-caption';caption.textContent=a.ext.toUpperCase()+' audio';stage.append(caption);}
    // Add a waveform only after metadata confirms there is no cover art.
  }
  const controls=document.createElement('div');controls.className='player-controls';root.append(controls);
  function button(icon,label,fn){const b=document.createElement('button');b.className='icon-button';b.title=label;b.setAttribute('aria-label',label);b.append(glyph(icon));b.onclick=e=>{e.stopPropagation();fn();};return b;}
  const toggle=button('play','Play',()=>media.paused?play():media.pause());controls.append(toggle);
  const elapsed=document.createElement('span');elapsed.className='elapsed';elapsed.textContent='0:00';controls.append(elapsed);
  const seek=document.createElement('input');seek.type='range';seek.className='seek';seek.min=0;seek.max=1000;seek.value=0;seek.step=1;seek.setAttribute('aria-label','Playback position');controls.append(seek);
  const duration=document.createElement('span');duration.className='total-time';duration.textContent='0:00';controls.append(duration);
  const mute=button(muted?'mute':'volume',muted?'Unmute':'Mute',()=>{media.muted=!media.muted;mute.replaceChildren(glyph(media.muted?'mute':'volume'));mute.setAttribute('aria-label',media.muted?'Unmute':'Mute');});controls.append(mute);
  if(!compact){const volume=document.createElement('input');volume.type='range';volume.className='volume';volume.min=0;volume.max=1;volume.step=.01;volume.value=1;volume.setAttribute('aria-label','Volume');volume.oninput=()=>{media.volume=Number(volume.value);media.muted=false;mute.replaceChildren(glyph('volume'));};controls.append(volume);if(kind(a)==='video')controls.append(button('expand','Full screen',()=>stage.requestFullscreen()));}
  if(kind(a)==='video'){media.loop=localStorage.getItem('video-loop')!=='false';const loop=button('loop','Loop video',()=>{media.loop=!media.loop;loop.setAttribute('aria-pressed',String(media.loop));localStorage.setItem('video-loop',String(media.loop));});loop.classList.add('loop-toggle');loop.setAttribute('aria-pressed',String(media.loop));controls.append(loop);}
  const error=document.createElement('div');error.className='player-notice';root.append(error);
  async function play(){try{await media.play();if(!media.error)error.textContent='';}catch(e){if(!disposed&&e.name!=='AbortError'&&!media.error)error.textContent='Press Play to start playback.';}}
  function draw(){waveCanvas(canvas,peaks,media.duration?media.currentTime/media.duration:0);}
  function sync(){const position=pendingSeek??activeSeek??media.currentTime;elapsed.textContent=timecode(position);duration.textContent=timecode(media.duration||info.duration);if(!dragging)seek.value=Number.isFinite(media.duration)&&media.duration>0?Math.round(position/media.duration*1000):0;seek.style.setProperty('--position',(Number(seek.value)/10)+'%');canvas.setAttribute('aria-valuenow',String(Math.round(Number(seek.value)/10)));draw();}
  media.addEventListener('loadedmetadata',sync);media.addEventListener('timeupdate',sync);media.addEventListener('durationchange',sync);
  function paused(){toggle.replaceChildren(glyph(media.paused?'play':'pause'));toggle.setAttribute('aria-label',media.paused?'Play':'Pause');root.classList.toggle('playing',!media.paused);}
  media.addEventListener('play',paused);media.addEventListener('pause',paused);
  media.addEventListener('error',()=>{error.textContent='This codec needs macOS Quick Look.';});
  seek.oninput=e=>{e.stopPropagation();if(Number.isFinite(media.duration)){requestSeek(Number(seek.value)/1000*media.duration);}};
  const scrub=e=>{const r=canvas.getBoundingClientRect();if(Number.isFinite(media.duration)&&r.width){media.currentTime=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*media.duration;sync();}};
  canvas.onpointerdown=e=>{e.stopPropagation();canvas.setPointerCapture(e.pointerId);dragging=true;scrub(e);};canvas.onpointermove=e=>{if(dragging)scrub(e);};canvas.onpointerup=()=>dragging=false;canvas.onpointercancel=()=>dragging=false;
  canvas.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();if(Number.isFinite(media.duration)){media.currentTime=e.key==='Home'?0:e.key==='End'?media.duration:Math.min(media.duration,Math.max(0,media.currentTime+(e.key==='ArrowRight'?5:-5)));sync();}}};
  for(const control of [seek,...controls.querySelectorAll('input')])control.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))e.stopPropagation();});
  getMediaInfo(a,!compact).then(data=>{if(disposed)return;info=data;peaks=data.peaks||[];if(data.artwork){root.classList.add('has-art');canvas.remove();const art=stage.querySelector('.cover-art');if(art){const img=document.createElement('img');img.src='asset://art/'+a.id;img.alt='Embedded cover art';art.replaceChildren(img);art.classList.add('has-cover');}}else if(kind(a)==='audio'){stage.classList.add('no-cover');stage.append(canvas);}if(data.unavailable&&kind(a)==='audio')stage.querySelector('.audio-caption')?.append(' · waveform unavailable');sync();});
  const observer=new ResizeObserver(()=>{draw();fitVideo();});observer.observe(stage);if(!compact&&kind(a)==='video')requestAnimationFrame(()=>{if(root.parentElement)observer.observe(root.parentElement);fitVideo();});queueMicrotask(play);
  return {element:root,media,dispose(){disposed=true;if(seekFrame)cancelAnimationFrame(seekFrame);pendingSeek=null;observer.disconnect();media.pause?.();media.removeAttribute?.('src');media.load?.();root.remove();}};
}
