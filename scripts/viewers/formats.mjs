import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {ThreeMFLoader} from 'three/addons/loaders/3MFLoader.js';
import {ColladaLoader} from 'three/addons/loaders/ColladaLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {unzipSync,strFromU8} from 'fflate';
const models=['3ds','3mf','dae','ifc','ply','stl','glb'];
const documents=['epub','html','htm','mhtml','mht'];
function unpack(bytes){let total=0;return unzipSync(bytes,{filter:f=>{total+=f.originalSize;if(f.originalSize>32*1024*1024||total>100*1024*1024)throw Error('This archive is too large to preview.');return true;}});}
function safeDocument(html,resolveImage=()=>null){
 const parsed=new DOMParser().parseFromString(html,'text/html');
 parsed.querySelectorAll('script,style,link,meta,base,iframe,object,embed,form,input,button,svg,math,video,audio,source').forEach(e=>e.remove());
 for(const node of parsed.body.querySelectorAll('*')){
   const source=node.tagName==='IMG'?resolveImage(node.getAttribute('src')||''):null;
   for(const attr of [...node.attributes])node.removeAttribute(attr.name);
   if(node.tagName==='IMG'){if(source&&/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(source))node.src=source;else node.remove();}
 }
 const article=document.createElement('article');article.className='document-reader';article.append(...parsed.body.childNodes);return article;
}
function dataImage(bytes,name){const ext=name.split('.').at(-1).toLowerCase();const mime={jpg:'jpeg',jpeg:'jpeg',png:'png',gif:'gif',webp:'webp',avif:'avif'}[ext];if(!mime)return null;let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return 'data:image/'+mime+';base64,'+btoa(binary);}
function archivePath(base,href){const url=new URL(href,'https://archive.invalid/'+base);return decodeURIComponent(url.pathname.slice(1));}
function epub(bytes,root){
 const files=unpack(bytes),xml=name=>new DOMParser().parseFromString(strFromU8(files[name]||new Uint8Array()),'application/xml');
 const packageName=xml('META-INF/container.xml').getElementsByTagName('rootfile')[0]?.getAttribute('full-path');if(!packageName||!files[packageName])throw Error('The EPUB package could not be read.');
 const pkg=xml(packageName),manifest=new Map([...pkg.getElementsByTagName('item')].map(i=>[i.getAttribute('id'),archivePath(packageName,i.getAttribute('href'))]));
 const chapters=[...pkg.getElementsByTagName('itemref')].map(i=>manifest.get(i.getAttribute('idref'))).filter(n=>files[n]);if(!chapters.length)throw Error('This EPUB has no readable chapters.');
 const bar=document.createElement('div');bar.className='reader-toolbar';const prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');prev.textContent='Previous chapter';next.textContent='Next chapter';bar.append(prev,label,next);root.append(bar);let page=0,article;
 const show=()=>{article?.remove();const name=chapters[page];article=safeDocument(strFromU8(files[name]),src=>{const file=archivePath(name,src);return files[file]?dataImage(files[file],file):null;});root.append(article);label.textContent=`${page+1} / ${chapters.length}`;prev.disabled=page===0;next.disabled=page===chapters.length-1;};prev.onclick=()=>{page--;show();};next.onclick=()=>{page++;show();};show();
}
function decodePart(body,encoding){if(/base64/i.test(encoding))return Uint8Array.from(atob(body.replace(/\s/g,'')),c=>c.charCodeAt(0));if(/quoted-printable/i.test(encoding))body=body.replace(/=\r?\n/g,'').replace(/=([a-f\d]{2})/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));return Uint8Array.from(body,c=>c.charCodeAt(0));}
function mhtml(bytes,root){
 const text=new TextDecoder('latin1').decode(bytes),boundary=/boundary="?([^"\r\n;]+)/i.exec(text)?.[1];
 if(!boundary)throw Error('The web archive has no MIME boundary.');
 let html='',htmlLocation='https://archive.invalid/';const images=[],indexed=new Map();
 for(const part of text.split('--'+boundary)){
   const split=part.search(/\r?\n\r?\n/);if(split<0)continue;
   const headers=part.slice(0,split),body=part.slice(split).replace(/^\r?\n\r?\n/,'').trim();
   const type=/Content-Type:\s*([^;\r\n]+)/i.exec(headers)?.[1];
   const encoding=/Content-Transfer-Encoding:\s*([^\r\n]+)/i.exec(headers)?.[1]||'';
   const location=/Content-Location:\s*([^\r\n]+)/i.exec(headers)?.[1];
   const cid=/Content-ID:\s*<([^>]+)>/i.exec(headers)?.[1];
   const data=decodePart(body,encoding);
   if(type==='text/html'&&!html){html=new TextDecoder().decode(data);if(location)htmlLocation=location.trim();}
   if(type?.startsWith('image/'))images.push({location,cid,image:dataImage(data,'image.'+type.split('/')[1])});
 }
 if(!html)throw Error('No HTML page was found in this archive.');
 const canonical=reference=>{try{const url=new URL(reference,htmlLocation);url.hash='';return url.href;}catch{return reference;}};
 for(const {location,cid,image}of images){if(location)indexed.set(canonical(location.trim()),image);if(cid)indexed.set('cid:'+cid,image);}
 root.append(safeDocument(html,src=>indexed.get(canonical(src))));
}

function workerModel(bytes,ext,ownCleanup){
 return new Promise((resolve,reject)=>{
  const worker=new Worker('model-worker.js');let settled=false;
  const finish=(error,data)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();if(error){reject(error);return;}
   try{
    const geometries=data.geometries.map(item=>{const geometry=new THREE.BufferGeometry();for(const [name,a]of Object.entries(item.attributes))geometry.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));if(item.index)geometry.setIndex(new THREE.BufferAttribute(item.index,1));for(const g of item.groups)geometry.addGroup(g.start,g.count,g.materialIndex);geometry.boundingBox=new THREE.Box3(new THREE.Vector3().fromArray(item.bounds.min),new THREE.Vector3().fromArray(item.bounds.max));geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3().fromArray(item.sphere.center),item.sphere.radius);return geometry;});
    const group=new THREE.Group();for(const item of data.meshes){const materials=item.materials.map(m=>new THREE.MeshStandardMaterial(m));const mesh=new THREE.Mesh(geometries[item.geometry],materials.length===1?materials[0]:materials);mesh.name=item.name;mesh.matrixAutoUpdate=false;mesh.matrix.fromArray(item.matrix);group.add(mesh);}resolve(group);
   }catch(error){reject(error);}
  };
  const timer=setTimeout(()=>finish(Error('Model decoding exceeded its time limit.')),60000);
  ownCleanup(()=>finish(new DOMException('Preview closed','AbortError')));
  worker.onmessage=event=>{if(event.data.type==='result')finish(null,event.data);else if(event.data.type==='error')finish(Error(event.data.error));};
  worker.onerror=event=>finish(Error(event.message||'The model worker could not be started.'));
  worker.postMessage({bytes,ext},[bytes.buffer]);
 });
}
async function model(bytes,ext,root,isDisposed,ownCleanup){
 const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(!url.startsWith('data:')&&!url.startsWith('blob:'))throw Error('External model resources are unavailable. Use embedded textures.');return url;});let object;
 if(['stl','ply','3ds','ifc'].includes(ext))object=await workerModel(bytes,ext,ownCleanup);
 else if(ext==='3mf')object=new ThreeMFLoader(manager).parse(bytes.buffer);
 else if(ext==='dae')object=new ColladaLoader(manager).parse(new TextDecoder().decode(bytes),'').scene;
 else if(ext==='glb')object=(await new GLTFLoader(manager).parseAsync(bytes.buffer,'')).scene;
 if(isDisposed())return ()=>{};
 const scene=new THREE.Scene();scene.add(object);scene.add(new THREE.HemisphereLight(0xffffff,0x555566,2.4));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(2,4,3);scene.add(light);
 const box=new THREE.Box3().setFromObject(object),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),radius=Math.max(size.x,size.y,size.z);if(!Number.isFinite(radius)||radius<=0)throw Error('No displayable model geometry.');object.position.sub(center);
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));root.append(renderer.domElement);const camera=new THREE.PerspectiveCamera(45,1,radius/1000,radius*100);camera.position.set(radius*1.3,radius*.9,radius*1.6);const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;const render=()=>renderer.render(scene,camera);controls.addEventListener('change',render);const resize=new ResizeObserver(()=>{const w=root.clientWidth,h=root.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();render();});resize.observe(root);render();
 return ()=>{resize.disconnect();controls.dispose();scene.traverse(o=>{o.geometry?.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material])if(material){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose();}});renderer.dispose();renderer.forceContextLoss();};
}

window.CanvasFormatEngines={supports:ext=>models.includes(ext)||documents.includes(ext)||ext==='swf'||ext==='eps',mount(asset){const root=document.createElement('div');root.className=models.includes(asset.ext)?'model-viewer':'document-viewer';const status=document.createElement('p');status.className='format-status';status.textContent='Preparing preview…';root.append(status);let disposed=false,cleanup=()=>{},controller=new AbortController();const ownCleanup=fn=>{if(disposed)fn();else cleanup=fn;};(async()=>{try{const response=await fetch('asset://file/'+asset.id,{signal:controller.signal});if(!response.ok)throw Error('Unable to read this file.');if(Number(response.headers.get('content-length'))>150*1024*1024)throw Error('This file exceeds the 150 MB interactive preview limit.');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>150*1024*1024)throw Error('This file exceeds the 150 MB interactive preview limit.');if(disposed)return;if(models.includes(asset.ext)){ownCleanup(await model(bytes,asset.ext,root,()=>disposed,ownCleanup));status.remove();return;}status.remove();if(asset.ext==='eps'){
 const worker=new Worker('eps-worker.js');let url;
 cleanup=()=>{worker.terminate();if(url)URL.revokeObjectURL(url);};
 const timer=setTimeout(()=>{worker.terminate();if(!disposed){root.replaceChildren(status);status.textContent='EPS preview exceeded its decoding time limit.';}},15000);
 const stop=cleanup;cleanup=()=>{clearTimeout(timer);stop();};
 worker.onmessage=event=>{clearTimeout(timer);worker.terminate();if(disposed)return;if(event.data.error){root.append(status);status.textContent=event.data.error;return;}url=URL.createObjectURL(new Blob([event.data.png],{type:'image/png'}));const img=document.createElement('img');img.className='image-preview';img.alt=asset.name;img.src=url;root.append(img);};
 worker.onerror=()=>{clearTimeout(timer);worker.terminate();if(!disposed){root.append(status);status.textContent='EPS decoder could not be loaded.';}};worker.postMessage(bytes.buffer,[bytes.buffer]);
 }else if(asset.ext==='epub')epub(bytes,root);else if(['mhtml','mht'].includes(asset.ext))mhtml(bytes,root);else if(asset.ext==='swf'){if(!window.RufflePlayer?.newest){window.RufflePlayer={config:{publicPath:new URL('vendor/ruffle/',document.baseURI).href,allowNetworking:'none',openUrlMode:'deny'}};await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='vendor/ruffle/ruffle.js';script.onload=resolve;script.onerror=()=>reject(Error('SWF engine unavailable.'));document.head.append(script);});}if(disposed)return;const ruffle=window.RufflePlayer?.newest();if(!ruffle)throw Error('The SWF preview engine could not be loaded.');const player=ruffle.createPlayer();root.append(player);await player.ruffle().load({data:bytes,autoplay:'on',allowScriptAccess:false,allowNetworking:'none',openUrlMode:'deny'});cleanup=()=>player.remove();}else root.append(safeDocument(new TextDecoder().decode(bytes),src=>src.startsWith('data:')?src:null));}catch(e){if(disposed)return;root.replaceChildren(status);status.textContent=e.message||'This file could not be previewed.';}})();return {element:root,dispose(){disposed=true;controller.abort();cleanup();root.remove();}};}};
