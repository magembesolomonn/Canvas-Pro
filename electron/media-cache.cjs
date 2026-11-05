const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
class MediaCache {
  constructor(library, executable, {execute=run}={}) { this.execute=execute; this.library=library; this.executable=executable; this.pending=new Map(); this.queue=[]; this.running=0; this.visible=new Set(); this.blocked=new Set(); this.root=path.join(library.root,'media-v2'); fs.mkdirSync(this.root,{recursive:true}); }
  prefix(id) { this.library.asset(id); return path.join(this.root,id); }
  setVisible(ids) {
    this.visible=new Set(ids);
    for(const job of this.queue.slice())if(!job.priority&&!this.visible.has(job.id)){
      this.queue=this.queue.filter(candidate=>candidate!==job);this.pending.delete(job.id);job.resolve({deferred:true});
    }
    const active=this.current;
    if(active&&!active.priority&&!this.visible.has(active.id)){active.offscreen=true;active.child?.kill('SIGTERM');}
  }
  get(id, priority=false, ignoreCache=false) {
    if(this.blocked.has(id))return Promise.resolve({unavailable:true,peaks:[]});
    const prefix=this.prefix(id), json=prefix+'.json';
    if(!ignoreCache&&fs.existsSync(json))return fs.promises.readFile(json,'utf8').then(text=>{const info=JSON.parse(text);if(!info||typeof info!=='object'||Array.isArray(info))throw new Error('Invalid media cache');return info;}).catch(()=>this.get(id,priority,true));
    if(this.pending.has(id)) { const job=this.pending.get(id); if(job.offscreen)return job.promise.then(()=>this.get(id,priority)); if(priority){job.priority=true;const index=this.queue.indexOf(job);if(index>0){this.queue.splice(index,1);this.queue.unshift(job);}} return job.promise; }
    if(this.queue.length>=100 && !priority)return Promise.resolve({deferred:true});
    const job={id,priority}; job.promise=new Promise(resolve=>job.resolve=resolve); this.pending.set(id,job);
    if(priority)this.queue.unshift(job);else this.queue.push(job); this.pump(); return job.promise;
  }
  async cancelAndDrain(ids){const set=new Set(ids);for(const id of ids)this.blocked.add(id);const waits=[];for(const id of ids){const job=this.pending.get(id);if(job){waits.push(job.promise);if(job.child)job.child.kill('SIGTERM');else{this.queue=this.queue.filter(j=>j!==job);this.pending.delete(id);job.resolve({unavailable:true,peaks:[]});}}}await Promise.allSettled(waits);}
  unblock(ids){for(const id of ids)this.blocked.delete(id);}
  pump() {
    if(this.running>=1)return;
    const job=this.queue.shift(); if(!job)return;
    if(!job.priority&&!this.visible.has(job.id)){this.pending.delete(job.id);job.resolve({deferred:true});this.pump();return;}
    this.running++;this.current=job;
    (async()=>{try {
      const prefix=this.prefix(job.id);
      const execution=this.execute(this.executable,[this.library.file(job.id),prefix],{timeout:120000,maxBuffer:1024*1024});job.child=execution.child;await execution;
      job.resolve(JSON.parse(await fs.promises.readFile(prefix+'.json','utf8')));
    }catch{job.resolve(job.offscreen?{deferred:true}:{unavailable:true,peaks:[]});}
    finally {this.pending.delete(job.id);if(this.current===job)this.current=null;this.running--;this.pump();}})();
  }
}
module.exports={MediaCache};
