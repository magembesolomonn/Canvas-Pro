import * as THREE from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {TDSLoader} from 'three/addons/loaders/TDSLoader.js';
async function readIFC(bytes){const {IfcAPI}=await import('web-ifc');const api=new IfcAPI();api.SetWasmPath(new URL('vendor/ifc/',self.location.href).href);await api.Init();const id=api.OpenModel(bytes),group=new THREE.Group();try{api.StreamAllMeshes(id,mesh=>{for(let i=0;i<mesh.geometries.size();i++){const placed=mesh.geometries.get(i),geometry=api.GetGeometry(id,placed.geometryExpressID),vertices=api.GetVertexArray(geometry.GetVertexData(),geometry.GetVertexDataSize()),indices=api.GetIndexArray(geometry.GetIndexData(),geometry.GetIndexDataSize());const buffer=new THREE.BufferGeometry();buffer.setAttribute('position',new THREE.BufferAttribute(new Float32Array(Array.from({length:vertices.length/6*3},(_,i)=>vertices[Math.floor(i/3)*6+i%3])),3));buffer.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(Array.from({length:vertices.length/6*3},(_,i)=>vertices[Math.floor(i/3)*6+3+i%3])),3));buffer.setIndex(new THREE.BufferAttribute(indices.slice(),1));const color=placed.color,part=new THREE.Mesh(buffer,new THREE.MeshStandardMaterial({color:new THREE.Color(color.x,color.y,color.z),opacity:color.w,transparent:color.w<1,side:THREE.DoubleSide}));part.applyMatrix4(new THREE.Matrix4().fromArray(placed.flatTransformation));group.add(part);geometry.delete();}});}finally{api.CloseModel(id);}return group;}
function packObject(object){
 object.updateMatrixWorld(true);
 const meshes=[],geometries=[],known=new Map(),transfers=new Set();let totalBytes=0;
 const material=m=>({color:m?.color?.getHex()??0xbfc7d2,roughness:m?.roughness??.65,metalness:m?.metalness??0,opacity:m?.opacity??1,transparent:!!m?.transparent,vertexColors:!!m?.vertexColors,side:THREE.DoubleSide});
 object.traverse(part=>{
  if(!part.isMesh)return;
  if(meshes.length>=50000)throw Error('This model has too many meshes for an interactive preview.');
  const source=part.geometry;let index=known.get(source.uuid);
  if(index===undefined){
   index=geometries.length;known.set(source.uuid,index);const attributes={};
   for(const [name,attribute]of Object.entries(source.attributes)){
    if(attribute.isInterleavedBufferAttribute)throw Error('This model uses unsupported interleaved geometry.');
    totalBytes+=attribute.array.byteLength;transfers.add(attribute.array.buffer);
    attributes[name]={array:attribute.array,itemSize:attribute.itemSize,normalized:attribute.normalized};
   }
   if(source.index){totalBytes+=source.index.array.byteLength;transfers.add(source.index.array.buffer);}
   if(totalBytes>256*1024*1024)throw Error('Decoded model geometry exceeds the preview memory limit.');
   source.computeBoundingBox();source.computeBoundingSphere();
   geometries.push({attributes,index:source.index?.array,groups:source.groups,bounds:{min:source.boundingBox.min.toArray(),max:source.boundingBox.max.toArray()},sphere:{center:source.boundingSphere.center.toArray(),radius:source.boundingSphere.radius}});
  }
  meshes.push({geometry:index,name:part.name,matrix:part.matrixWorld.toArray(),materials:(Array.isArray(part.material)?part.material:[part.material]).map(material)});
 });
 if(!meshes.length)throw Error('No displayable model geometry.');
 return {data:{meshes,geometries},transfers:[...transfers]};
}
self.onmessage=async event=>{
 try{
  const {bytes,ext}=event.data;self.postMessage({type:'progress',label:'Decoding model…'});let object;
  if(ext==='ifc')object=await readIFC(bytes);
  else if(ext==='3ds'){
   const manager=new THREE.LoadingManager();manager.setURLModifier(()=>{throw Error('External textures are unavailable. Use embedded textures.');});object=new TDSLoader(manager).parse(bytes.buffer,'');
  }else{
   const geometry=ext==='stl'?new STLLoader().parse(bytes.buffer):new PLYLoader().parse(bytes.buffer);geometry.computeVertexNormals();
   object=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xbfc7d2,roughness:.65,side:THREE.DoubleSide,vertexColors:!!geometry.getAttribute('color')}));
  }
  const packed=packObject(object);self.postMessage({type:'result',...packed.data},packed.transfers);
 }catch(error){self.postMessage({type:'error',error:error.message||'This model could not be decoded.'});}
};
