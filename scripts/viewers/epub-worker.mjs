// EPUB archives are decompressed in a disposable worker so a crafted DEFLATE
// stream cannot block the renderer's main thread. The declared size cap still
// bounds allocation, and the actual decompressed bytes are checked as well.
import {unzipSync} from 'fflate';

self.onmessage=event=>{
 try{
  const bytes=new Uint8Array(event.data.bytes);
  let declared=0;
  const files=unzipSync(bytes,{filter:entry=>{
   declared+=entry.originalSize;
   if(entry.originalSize>32*1024*1024||declared>100*1024*1024)throw Error('This archive is too large to preview.');
   return true;
  }});
  let actual=0;
  for(const file of Object.values(files)){
   actual+=file.length;
   if(actual>100*1024*1024)throw Error('This archive is too large to preview.');
  }
  const buffers=Object.values(files).map(file=>file.buffer);
  self.postMessage({type:'result',files},buffers);
 }catch(error){
  self.postMessage({type:'error',error:error.message||'The EPUB could not be decompressed.'});
 }
};
