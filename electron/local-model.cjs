const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

// The models the app can download.
//
// Each one lives in its own folder inside the app's model directory and is
// verified file by file, so a download that stops half way is resumed rather
// than restarted, and a file that changed upstream is refused.
class LocalModel{
 constructor({root,fetcher,onProgress=()=>{}}){
  this.root=root;this.fetcher=fetcher;this.onProgress=onProgress;
  this.models=new Map();
 }
 // Register a model: its manifest, and the name the app knows it by.
 define(name,manifest){
  this.models.set(name,{name,manifest,progress:{state:'idle',bytes:0,total:manifest.files.reduce((sum,file)=>sum+file.size,0)},task:null,controller:null});
  return this;
 }
 model(name){return this.models.get(name);}
 state(name){
  name=name||'clip';
  const entry=this.model(name);
  if(!entry)return {state:'unknown',ready:false,bytes:0,total:0};
  const {manifest}=entry;
  const ready=fs.existsSync(path.join(this.root,name,'ready.json'))&&manifest.files.every(file=>{
   try{return fs.statSync(path.join(this.root,name,file.path)).size===file.size;}catch{return false;}
  });
  return {...entry.progress,ready,name,model:manifest.title||name,repository:manifest.repository};
 }
 // The file the worker asked for: '/clip/config.json' or '/florence-2/…'.
 file(relative){
  const path_=String(relative||'').replace(/^\//,'');
  const slash=path_.indexOf('/');
  if(slash<0)return null;
  const name=path_.slice(0,slash),filename=path_.slice(slash+1);
  const entry=this.model(name);
  if(!entry)return null;
  if(!entry.manifest.files.some(file=>file.path===filename))return null;
  const target=path.join(this.root,name,filename);
  return fs.existsSync(target)?target:null;
 }
 notify(name){this.onProgress(this.state(name));}
 async download(name){
  name=name||'clip';
  const entry=this.model(name);
  if(!entry)throw Error('Unknown model.');
  if(entry.task)return entry.task;
  entry.controller=new AbortController();
  entry.task=this.run(entry,entry.controller.signal).finally(()=>{entry.task=null;entry.controller=null;});
  return entry.task;
 }
 async run(entry,signal){
  const {manifest}=entry;
  const progress=entry.progress;
  progress.state='downloading';progress.bytes=0;progress.error='';
  this.notify(entry.name);
  try{
   for(const file of manifest.files){
    signal.throwIfAborted();
    const target=path.join(this.root,entry.name,file.path);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    let existing;
    try{existing=await fs.promises.readFile(target);}catch{}
    const hash=bytes=>file.algorithm==='git-sha1'
     ?crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')
     :crypto.createHash('sha256').update(bytes).digest('hex');
    if(existing&&existing.length===file.size&&hash(existing)===file.hash){progress.bytes+=file.size;this.notify(entry.name);continue;}
    const response=await this.fetcher('https://huggingface.co/'+manifest.repository+'/resolve/'+manifest.revision+'/'+file.path,{signal,credentials:'omit'});
    if(!response.ok)throw Error('Model download failed ('+response.status+').');
    const chunks=[];let count=0,last=0;
    for await(const chunk of response.body){
     signal.throwIfAborted();
     count+=chunk.length;
     if(count>file.size)throw Error('Unexpected model file size.');
     chunks.push(Buffer.from(chunk));
     progress.bytes+=chunk.length;
     if(Date.now()-last>200){last=Date.now();this.notify(entry.name);}
    }
    const bytes=Buffer.concat(chunks);
    if(bytes.length!==file.size||hash(bytes)!==file.hash)throw Error('Model checksum verification failed. Retry the download.');
    await fs.promises.writeFile(target+'.part',bytes);
    await fs.promises.rename(target+'.part',target);
    this.notify(entry.name);
   }
   await fs.promises.writeFile(path.join(this.root,entry.name,'ready.json'),JSON.stringify({revision:manifest.revision}));
   progress.state='ready';
   this.notify(entry.name);
   return this.state(entry.name);
  }catch(error){
   progress.state=signal.aborted?'cancelled':'failed';
   progress.error=error.message;
   this.notify(entry.name);
   throw error;
  }
 }
 cancel(name){
  name=name||'clip';
  const entry=this.model(name);
  if(!entry)return {state:'unknown',ready:false};
  entry.controller?.abort();
  return this.state(name);
 }
 async close(){
  for(const entry of this.models.values()){
   entry.controller?.abort();
   await entry.task?.catch(()=>{});
  }
 }
}
module.exports={LocalModel};
