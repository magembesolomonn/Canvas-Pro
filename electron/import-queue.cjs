const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function importError(error){
 const messages={ENOENT:'The source file is no longer available. Locate it and retry.',EACCES:'Canvas Pro could not read this file. Check its permissions and retry.',EPERM:'Canvas Pro could not read this file. Check its permissions and retry.',ENOSPC:'There is not enough disk space to import this file.',EMFILE:'Too many files are open. Wait a moment and retry.'};
 return messages[error.code]||error.message;
}
class ImportQueue {
  constructor({library,onChange=()=>{}}){this.library=library;this.onChange=onChange;this.jobs=new Map();this.waiting=[];this.active=null;this.closing=false;this.lastEvent=0;}
  enqueue(paths,folder=null){
    if(this.closing)throw new Error('Canvas Pro is closing.');
    if(!Array.isArray(paths)||!paths.length||paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw new Error('Choose valid files or folders.');
    if(this.waiting.length>=20)throw new Error('The import queue is full. Wait for an import to finish.');
    const job={id:crypto.randomUUID(),paths:[...paths],folder,folderId:folder?this.library.folderRecords().find(f=>f.name===folder)?.id:null,state:'queued',entries:[],failedPaths:[],controller:new AbortController(),result:{imported:0,duplicates:0,errors:[],skipped:0,ids:[],cancelled:false},processed:0,name:''};
    job.done=new Promise(resolve=>job.resolve=resolve);this.jobs.set(job.id,job);this.waiting.push(job);this.emit(true);this.pump();return job;
  }
  snapshot(){return [...this.jobs.values()].slice(-20).reverse().map(j=>({id:j.id,state:j.state,name:j.name,processed:j.processed,imported:j.result.imported,duplicates:j.result.duplicates,skipped:j.result.skipped,failed:j.result.errors.length,error:j.error||'',canRetry:j.failedPaths.length>0||['cancelled','failed'].includes(j.state),entries:(j.entries.length?j.entries.slice(-50):j.paths.slice(0,50).map(p=>({path:p,name:path.basename(p),state:j.state}))).map(e=>({...e}))}));}
  emit(force=false){if(force||Date.now()-this.lastEvent>=100){this.lastEvent=Date.now();this.onChange(this.snapshot());}}
  cancel(id){const job=this.jobs.get(id);if(!job||!['queued','running'].includes(job.state))return;job.controller.abort();if(job.state==='running')job.state='cancelling';if(job.state==='queued'){this.waiting=this.waiting.filter(j=>j!==job);job.state='cancelled';job.result.cancelled=true;job.resolve(job.result);}this.emit(true);}
  destination(job){if(!job.folderId)return job.folder;const folder=this.library.folderRecords().find(f=>f.id===job.folderId);if(!folder)throw new Error('The destination collection no longer exists.');return folder.name;}
  retry(id){const job=this.jobs.get(id);if(!job||!['completed','cancelled','failed'].includes(job.state))throw new Error('This import cannot be retried yet.');return this.enqueue(job.state==='cancelled'||!job.failedPaths.length?job.paths:job.failedPaths,this.destination(job));}
  async visit(source,job){
    const signal=job.controller.signal;signal.throwIfAborted();
    let entry;
    try{
      const stat=await fs.promises.lstat(source);signal.throwIfAborted();
      if(stat.isSymbolicLink()){job.result.skipped++;return;}
      if(stat.isDirectory()){
        const directory=await fs.promises.opendir(source);
        for await(const item of directory){signal.throwIfAborted();if(!item.name.startsWith('.'))await this.visit(path.join(source,item.name),job);}
        return;
      }
      if(!stat.isFile()){job.result.skipped++;return;}
      entry={path:source,name:path.basename(source),state:'importing'};job.entries.push(entry);if(job.entries.length>300)job.entries.shift();job.name=entry.name;this.emit();
      const result=await this.library.importFile(source,this.destination(job),{signal});
      if(result.imported){job.result.imported++;job.result.ids.push(result.imported);entry.state='completed';}
      else if(result.duplicate){job.result.duplicates++;job.result.ids.push(result.duplicate);entry.state='duplicate';}
      else{job.result.skipped++;entry.state='skipped';}
      job.processed++;
    }catch(error){
      if(signal.aborted){if(entry)entry.state='cancelled';throw error;}
      if(!entry){entry={path:source,name:path.basename(source)};job.entries.push(entry);if(job.entries.length>300)job.entries.shift();}
      entry.state='failed';entry.error=importError(error);job.failedPaths.push(source);job.result.errors.push(entry.name+': '+entry.error);job.processed++;
    }
    this.emit();
  }
  pump(){
    if(this.active||this.closing)return;
    const job=this.waiting.shift();if(!job)return;this.active=job;job.state='running';this.emit(true);
    this.task=(async()=>{try{if(job.folder&&!this.library.folders().includes(this.destination(job)))throw new Error('The destination collection no longer exists.');for(const source of job.paths)await this.visit(source,job);job.state='completed';}catch(error){job.state=job.controller.signal.aborted?'cancelled':'failed';job.result.cancelled=job.state==='cancelled';if(!job.result.cancelled){job.error=error.message;job.result.errors.push(error.message);}}
    finally{this.active=null;job.resolve(job.result);this.emit(true);for(const [id,old]of this.jobs){if(this.jobs.size<=30)break;if(!['queued','running'].includes(old.state))this.jobs.delete(id);}this.pump();}})();
  }
  async close(){this.closing=true;for(const job of this.waiting.slice())this.cancel(job.id);if(this.active)this.cancel(this.active.id);await this.task;}
}
module.exports={ImportQueue};
