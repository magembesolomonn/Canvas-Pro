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
  if(current){
    if(!priority||current.priority)return withPlaybackDimensions(a,await current.request);
    // A priority request supersedes a non-priority one that is still in flight
    // (typically a deferred lookup). Fall through to start a fresh priority
    // request and replace the in-flight entry, so the player never waits on
    // the slow deferred request. The identity checks below still keep the old
    // request from overwriting the cache or deleting the replacement entry.
  }
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
function audioTile(a,surface){const canvas=document.createElement('canvas');canvas.className='tile-wave';canvas.hidden=true;surface.classList.add('audio-tile');surface.append(canvas);const label=document.createElement('span');label.className='wave-status';label.textContent='Reading audio…';surface.append(label);let peaks=[];const observer=new ResizeObserver(()=>waveCanvas(canvas,peaks));observer.observe(surface);getMediaInfo(a).then(info=>{if(!surface.isConnected)return;peaks=info.peaks||[];label.textContent=info.unavailable?'Audio preview unavailable':'';rememberRatio(a,info.artwork?1:3.5);if(info.artwork){surface.classList.add('has-art');canvas.remove();observer.disconnect();const cover=document.createElement('img');cover.alt='Embedded cover art';cover.src='asset://art/'+a.id;surface.prepend(cover);}else{canvas.hidden=false;}waveCanvas(canvas,peaks);const duration=surface.parentElement.querySelector('.duration');if(duration&&info.duration)duration.textContent=timecode(info.duration);}).catch(()=>{});return ()=>observer.disconnect();}
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
    const art=document.createElement('div');art.className='cover-art';art.append(glyph('audio'));stage.append(art);
    if(!compact){
      const fallback=a.name.replace(/\.[^.]+$/,'');
      const uuid=/^[0-9a-f-]{20,}$/i.test(fallback)&&fallback.includes('-');
      const named=a.captureMetadata?.title||a.captureMetadata?.linkPreview?.title||(uuid?'':fallback);
      const title=document.createElement('h2');title.textContent=named||'Untitled audio';
      if(named)title.title=a.name;
      stage.append(title);
      const caption=document.createElement('p');caption.className='audio-caption';caption.textContent=named?(a.ext.toUpperCase()+' audio'):'';stage.append(caption);
    }
    // Add a waveform only after metadata confirms there is no cover art.
  }
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const controls=node('div','player-controls cinematic-controls');root.append(controls);
  function button(icon,label,fn,cls=''){const b=node('button','player-button'+(cls?' '+cls:''));b.type='button';b.title=label;b.setAttribute('aria-label',label);b.append(glyph(icon));b.onclick=e=>{e.stopPropagation();fn();};return b;}
  const toggle=button('play','Play',()=>media.paused?play():media.pause());controls.append(toggle);
  const mute=button(muted?'mute':'volume',muted?'Unmute':'Mute',()=>{media.muted=!media.muted;mute.replaceChildren(glyph(media.muted?'mute':'volume'));mute.setAttribute('aria-label',media.muted?'Unmute':'Mute');});controls.append(mute);
  const elapsed=node('span','player-time','0:00');controls.append(elapsed);
  const seekWrap=node('div','player-seek-wrap');
  const seek=node('input','seek');seek.type='range';seek.min=0;seek.max=1000;seek.value=0;seek.step=1;seek.setAttribute('aria-label','Playback position');
  seekWrap.append(seek);controls.append(seekWrap);
  const remaining=node('span','player-time player-remaining','-0:00');controls.append(remaining);
  let speedIndex=1;const rates=[0.5,1,1.5,2];
  if(!compact){
    const speed=node('button','player-button player-speed',rates[speedIndex]+'×');speed.type='button';speed.title='Playback speed';speed.setAttribute('aria-label','Playback speed');
    speed.onclick=e=>{e.stopPropagation();speedIndex=(speedIndex+1)%rates.length;media.playbackRate=rates[speedIndex];speed.textContent=rates[speedIndex]+'×';};
    controls.append(speed);
  }
  let volume=null;
  if(!compact){
    volume=node('input','volume');volume.type='range';volume.min=0;volume.max=1;volume.step=.01;volume.value=media.volume;volume.setAttribute('aria-label','Volume');
    volume.oninput=()=>{media.volume=Number(volume.value);media.muted=false;mute.replaceChildren(glyph('volume'));mute.setAttribute('aria-label','Mute');};
    controls.append(volume);
    const showVolume=on=>controls.classList.toggle('volume-open',on);
    mute.addEventListener('pointerenter',()=>showVolume(true));
    mute.addEventListener('pointerleave',()=>{if(!controls.contains(document.activeElement))showVolume(false);});
    mute.addEventListener('focus',()=>showVolume(true));
    mute.addEventListener('blur',()=>{if(!controls.matches(':hover'))showVolume(false);});
  }
  if(kind(a)==='video'){
    media.loop=localStorage.getItem('video-loop')!=='false';
    const loop=button('loop','Loop video',()=>{media.loop=!media.loop;loop.setAttribute('aria-pressed',String(media.loop));localStorage.setItem('video-loop',String(media.loop));},'player-loop');
    loop.setAttribute('aria-pressed',String(media.loop));controls.append(loop);
    if(!compact){
      controls.append(button('expand','Full screen',()=>stage.requestFullscreen()));
      const floating=button('file','Floating player',()=>{
        const state={id:a.id,time:media.currentTime,paused:media.paused,rate:media.playbackRate,muted:media.muted,volume:media.volume,loop:media.loop,aspectRatio:(media.videoWidth&&media.videoHeight)?media.videoWidth/media.videoHeight:(a.aspectRatio||16/9)};
        media.pause();
        safe(async()=>{await window.library?.floating?.('open',state);window.closePreview?.();});
      },'player-floating');
      const pip=document.createElementNS('http://www.w3.org/2000/svg','svg');
      pip.setAttribute('viewBox','0 0 24 24');pip.setAttribute('class','pip-glyph');
      pip.setAttribute('fill','none');pip.setAttribute('stroke','currentColor');pip.setAttribute('stroke-width','1.8');pip.setAttribute('stroke-linejoin','round');
      for(const [x,y,w,h,opacity] of [[3,4.5,18,13,1],[12.5,10.5,6.5,5,0.25]]){
        const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
        rect.setAttribute('x',x);rect.setAttribute('y',y);rect.setAttribute('width',w);rect.setAttribute('height',h);
        rect.setAttribute('rx','2.5');rect.setAttribute('fill',opacity===1?'none':'currentColor');rect.setAttribute('fill-opacity',opacity);
        pip.append(rect);
      }
      floating.replaceChildren(pip);
      controls.append(floating);
    }
  }
  const error=node('div','player-notice');root.append(error);
  async function play(){try{await media.play();if(!media.error)error.textContent='';}catch(e){if(!disposed&&e.name!=='AbortError'&&!media.error)error.textContent='Press Play to start playback.';}}
  function draw(){waveCanvas(canvas,peaks,media.duration?media.currentTime/media.duration:0);}
  function durationValue(){return Number.isFinite(media.duration)&&media.duration>0?media.duration:(info.duration||0);}
  function sync(){
    const total=durationValue(),position=pendingSeek??activeSeek??media.currentTime;
    elapsed.textContent=timecode(position);
    remaining.textContent='-'+timecode(Math.max(0,total-position));
    if(!dragging)seek.value=total?Math.round(position/total*1000):0;
    const pct=(Number(seek.value)/10)+'%';
    seek.style.setProperty('--position',pct);seekWrap.style.setProperty('--position',pct);
    canvas.setAttribute('aria-valuenow',String(Math.round(Number(seek.value)/10)));
    draw();
  }
  media.addEventListener('loadedmetadata',sync);media.addEventListener('timeupdate',sync);media.addEventListener('durationchange',sync);
  function paused(){toggle.replaceChildren(glyph(media.paused?'play':'pause'));toggle.setAttribute('aria-label',media.paused?'Play':'Pause');toggle.title=media.paused?'Play':'Pause';root.classList.toggle('playing',!media.paused);}
  media.addEventListener('play',paused);media.addEventListener('pause',paused);
  media.addEventListener('error',()=>{error.textContent='This codec needs macOS Quick Look.';});
  seek.oninput=e=>{e.stopPropagation();if(Number.isFinite(media.duration)){requestSeek(Number(seek.value)/1000*media.duration);}};
  const scrub=e=>{const r=canvas.getBoundingClientRect();if(Number.isFinite(media.duration)&&r.width){media.currentTime=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*media.duration;sync();}};
  canvas.onpointerdown=e=>{e.stopPropagation();canvas.setPointerCapture(e.pointerId);dragging=true;scrub(e);};canvas.onpointermove=e=>{if(dragging)scrub(e);};canvas.onpointerup=()=>dragging=false;canvas.onpointercancel=()=>dragging=false;
  canvas.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();if(Number.isFinite(media.duration)){media.currentTime=e.key==='Home'?0:e.key==='End'?media.duration:Math.min(media.duration,Math.max(0,media.currentTime+(e.key==='ArrowRight'?5:-5)));sync();}}};
  for(const control of [seek,volume,...controls.querySelectorAll('input')].filter(Boolean))control.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))e.stopPropagation();});
  getMediaInfo(a,!compact).then(data=>{if(disposed)return;info=data;peaks=data.peaks||[];if(data.artwork){root.classList.add('has-art');canvas.remove();const art=stage.querySelector('.cover-art');if(art){const img=document.createElement('img');img.src='asset://art/'+a.id;img.alt='Embedded cover art';art.replaceChildren(img);art.classList.add('has-cover');}}else if(kind(a)==='audio'){stage.classList.add('no-cover');stage.append(canvas);}if(data.unavailable&&kind(a)==='audio')stage.querySelector('.audio-caption')?.append(' · waveform unavailable');sync();}).catch(()=>{});
  const observer=new ResizeObserver(()=>{draw();fitVideo();});observer.observe(stage);if(!compact&&kind(a)==='video')requestAnimationFrame(()=>{if(root.parentElement)observer.observe(root.parentElement);fitVideo();});queueMicrotask(play);
  return {element:root,media,dispose(){disposed=true;if(seekFrame)cancelAnimationFrame(seekFrame);pendingSeek=null;observer.disconnect();media.pause?.();media.removeAttribute?.('src');media.load?.();root.remove();}};
}
