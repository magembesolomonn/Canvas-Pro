const VISUAL_EXTENSIONS="'jpg','jpeg','jfif','jpe','png','webp','gif','avif','heic','heif','tiff','tif','bmp','svg','psd','eps','pdf','mp4','mov','m4v','webm'";
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');const execute=promisify(execFile);
const MODEL='clip-vit-base-patch32-q8-v1';
const visualRetryDelays=[1,5,30,60].map(minutes=>minutes*60000);
const colors={red:[210,55,55],orange:[225,135,40],yellow:[220,205,60],green:[65,150,75],blue:[50,110,200],purple:[135,75,175],pink:[215,125,165],brown:[125,90,55],black:[25,25,25],white:[235,235,235],grey:[135,135,135]};
function palette(image){if(!image||image.isEmpty())return [];const {width,height}=image.getSize(),scale=Math.min(1,64/Math.max(width,height));const tiny=scale===1?image:image.resize({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))});const bytes=tiny.toBitmap(),bins=new Map();for(let i=0;i<bytes.length;i+=4){if(bytes[i+3]<128)continue;const b=bytes[i],g=bytes[i+1],r=bytes[i+2],key=(r>>5)*64+(g>>5)*8+(b>>5),bin=bins.get(key)||[0,0,0,0];bin[0]+=r;bin[1]+=g;bin[2]+=b;bin[3]++;bins.set(key,bin);}const chosen=[];for(const bin of [...bins.values()].sort((a,b)=>b[3]-a[3])){const rgb=bin.slice(0,3).map(v=>Math.round(v/bin[3]));if(chosen.some(c=>c.rgb.reduce((n,v,i)=>n+(v-rgb[i])**2,0)<1800))continue;const hex='#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');let color='grey',distance=Infinity;for(const [name,value]of Object.entries(colors)){const d=value.reduce((n,v,i)=>n+(v-rgb[i])**2,0);if(d<distance){distance=d;color=name;}}chosen.push({hex,name:color,rgb});if(chosen.length===6)break;}return chosen.map(({hex,name})=>({hex,name}));}
function terms(value){return String(value).toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)||[];}
// Names that say nothing about what is inside the file. These are the ones
// that get a real name once the local analysis has read the picture.
const MEANINGLESS_NAMES=[
 /^image\s*\d*\.?$/i,/^img[\s_-]?\d*\.?$/i,/^photo\s*\d*\.?$/i,/^picture\s*\d*\.?$/i,
 /^pic\s*\d*\.?$/i,/^file\s*\d*\.?$/i,/^untitled(\s*\d*)?$/i,/^unknown(\s*\d*)?$/i,
 /^download(\s*\d*)?$/i,/^temp(\s*\d*)?$/i,/^tmp[\s_-]?\d*$/i,/^scan[\s_-]?\d*$/i,
 /^new[\s_-]?file(\s*\d*)?$/i,/^screenshot(\s*\d+)?$/i,/^screen[\s_-]?shot(\s*\d+)?$/i,
 /^wechat[\s_-]?image.*$/i,/^pxl[\s_-]?\d+$/i,/^dsc[\s_-]?\d+$/i,/^img[\s_-]?\d+$/i,
 /^screenshot\s+\d{4}-\d{2}-\d{2}.*$/i,/^screen[\s_-]?shot.*$/i,/^\d+$/];
function meaninglessName(name){
 const base=String(name||'').replace(/\.[^.]+$/,'').trim();
 if(!base)return true;
 return MEANINGLESS_NAMES.some(pattern=>pattern.test(base));
}
// The name the file should have: what the text in it says, or what the model
// sees in it, and only then the kind of file and the day it arrived.
function proposedName(asset,text,labels){
 const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 for(const line of lines.slice(0,8)){
  let cleaned=line.replace(/https?:\/\/\S+/g,' ').replace(/[^\p{L}\p{N} ,.'\u2019\-&()/]+/gu,' ').replace(/\s+/g,' ').trim();
  // A cut-off word at the end of a line is not part of the name.
  cleaned=cleaned.replace(/\s\S$/,'').trim();
  const words=cleaned.split(' ').filter(Boolean);
  if(cleaned.length>=3&&words.length<=10&&cleaned.length<=64)return cleaned;
 }
 const day=new Date(asset.imported||Date.now()).toISOString().slice(0,10);
 if(labels&&labels.length){
  const names=labels.map(label=>String(label.label||'').trim()).filter(label=>label&&label.length<=40).slice(0,2);
  if(names.length)return names.join(' \u00b7 ')+' \u00b7 '+day;
 }
 const kind={image:'Image',pdf:'Document',video:'Video',audio:'Audio',txt:'Note',md:'Note',csv:'Table'}[asset.ext]||'File';
 return kind+' \u00b7 '+day;
}
function expand(query){const groups=[['iphone','iphones','smartphone','smartphones','cellphone','cellular','phone','phones'],['car','cars','automobile','vehicle','vehicles'],['movie','movies','film','films','cinema'],['series','tv','television','show','shows'],['album','albums','song','songs','track','tracks','music','playlist'],['book','books','reading','novel'],['product','products','shopping'],['recipe','recipes','cooking','food'],['grey','gray']];return [...new Set(terms(query))].slice(0,40).map(term=>groups.find(g=>g.includes(term))||[term]);}
class SmartIndex{
 constructor({library,thumbnail,nativeImage,onUpdate=()=>{},onWork=()=>{},delay=()=>650,testMode=false}){Object.assign(this,{library,thumbnail,nativeImage,onUpdate,onWork,delay});this.db=library.db;this.closed=false;this.paused=testMode;this.powerPause=null;this.queue=new Set();this.db.exec(`CREATE TABLE IF NOT EXISTS asset_analysis(id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,summary TEXT NOT NULL DEFAULT '{}',text TEXT NOT NULL DEFAULT '',vector BLOB,model TEXT,version INTEGER NOT NULL DEFAULT 0);CREATE VIRTUAL TABLE IF NOT EXISTS smart_fts USING fts5(id UNINDEXED,body,tokenize='unicode61');CREATE TRIGGER IF NOT EXISTS smart_delete AFTER DELETE ON assets BEGIN DELETE FROM smart_fts WHERE id=old.id;END;`);this.db.prepare("UPDATE asset_analysis SET summary=json_set(summary,'$.visualRetry',MIN(json_extract(summary,'$.visualRetry'),?), '$.visualAttempts',1) WHERE json_extract(summary,'$.visualRetry') IS NOT NULL AND json_extract(summary,'$.visualAttempts') IS NULL").run(Date.now()+visualRetryDelays[0]);library.onAssetChanged=id=>this.changed(id);this.timer=setTimeout(()=>this.pump(),1500);this.timer.unref();}
 info(id){const row=this.db.prepare('SELECT summary FROM asset_analysis WHERE id=?').get(id);return row?JSON.parse(row.summary):null;}
 changed(id){if(this.closed)return;try{const smart=this.indexText(id);this.onUpdate({id,smart});if(this.info(id)?.state!=='indexed'||(['url','webloc'].includes(this.library.asset(id).ext)&&!this.info(id)?.palette?.length))this.queue.add(id);}catch{}this.schedule();this.onWork();}
 indexText(id){const a=this.library.asset(id),analysis=this.db.prepare('SELECT summary,text FROM asset_analysis WHERE id=?').get(id),meta=this.db.prepare('SELECT json FROM capture_metadata WHERE id=?').get(id),m=meta?JSON.parse(meta.json):{},info=m.linkPreview||{},tags=[...new Set([...(analysis?JSON.parse(analysis.summary).tags||[]:[]),...(info.tags||[]),...(m.kind==='content'?[m.selection?'quote':'note','text']:[])])];const summary={...(analysis?JSON.parse(analysis.summary):{}),tags};this.db.prepare("INSERT INTO asset_analysis(id,summary) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary").run(id,JSON.stringify(summary));let articleText='';if(info.article){try{articleText=JSON.parse(fs.readFileSync(path.join(this.library.root,'thumbnails',id+'.reader.json'),'utf8')).blocks.map(b=>b.text).join(' ').slice(0,50000);}catch{}}const body=[articleText,a.name,a.notes,a.url,a.tags,a.folders,m.pageTitle,m.author,m.description,m.textExcerpt,info.title,info.description,JSON.stringify(info.details||{}),...tags,analysis?.text||''].filter(Boolean).join(' ').slice(0,120000);this.db.exec('SAVEPOINT smart_text');try{this.db.prepare('DELETE FROM smart_fts WHERE id=?').run(id);this.db.prepare('INSERT INTO smart_fts(id,body) VALUES(?,?)').run(id,body);this.db.exec('RELEASE smart_text');}catch(e){this.db.exec('ROLLBACK TO smart_text; RELEASE smart_text');throw e;}return summary;}
 put(id,patch){
   if(this.library.deleting.has(id))return;
   this.library.asset(id);
   const old=this.db.prepare('SELECT * FROM asset_analysis WHERE id=?').get(id);
   const summary={...(old?JSON.parse(old.summary):{}),...patch.summary};
   if(summary.tags)summary.tags=[...new Set(summary.tags)].slice(0,50);
   let vector=old?.vector||null;
   if(patch.vector){
     if(!Array.isArray(patch.vector)||patch.vector.length!==512||patch.vector.some(v=>!Number.isFinite(v)))throw Error('Invalid visual index vector.');
     vector=Buffer.from(new Float32Array(patch.vector).buffer);
     delete summary.visualRetry;
     delete summary.visualAttempts;
   }
   this.db.prepare('INSERT INTO asset_analysis(id,summary,text,vector,model,version) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary,text=excluded.text,vector=excluded.vector,model=excluded.model,version=excluded.version').run(
     id,JSON.stringify(summary),patch.text===undefined?old?.text||'':String(patch.text).slice(0,50000),vector,patch.vector?MODEL:old?.model||null,patch.version??old?.version??0);
   // Embedding writes and retry bookkeeping cannot change the searchable text.
   if(old&&patch.text===undefined&&Object.keys(patch.summary||{}).every(key=>key==='visualRetry'||key==='visualAttempts'))return summary;
   const result=this.indexText(id);
   this.onUpdate({id,smart:result});
   return result;
 }
 state(){const total=this.db.prepare('SELECT COUNT(*) n FROM assets WHERE trash=0').get().n,indexed=this.db.prepare('SELECT COUNT(*) n FROM asset_analysis s JOIN assets a ON a.id=s.id WHERE s.version=1 AND a.trash=0').get().n,visual=this.db.prepare('SELECT COUNT(*) n FROM asset_analysis s JOIN assets a ON a.id=s.id WHERE s.model=? AND s.vector IS NOT NULL AND a.trash=0').get(MODEL).n;const visualRemaining=this.db.prepare(`SELECT COUNT(*) n FROM assets a LEFT JOIN asset_analysis s ON s.id=a.id
     WHERE a.trash=0 AND (s.vector IS NULL OR s.model IS NOT ?) AND a.ext IN (${VISUAL_EXTENSIONS})`).get(MODEL).n;const failed=this.db.prepare("SELECT COUNT(*) n FROM asset_analysis s JOIN assets a ON a.id=s.id WHERE a.trash=0 AND json_extract(s.summary,'$.state')='unavailable'").get().n;return {total,indexed,visual,visualRemaining,failed,paused:this.paused,powerPause:this.powerPause,running:!!this.active};}
 pause(value){this.paused=!!value;if(this.paused)this.activeController?.abort();this.schedule();this.onWork();return this.state();}
 setPowerPause(reason){
   if(this.powerPause===reason)return;
   this.powerPause=reason;
   if(reason)this.activeController?.abort();
   this.schedule();
   this.onWork();
 }
 schedule(){clearTimeout(this.timer);if(!this.closed&&!this.paused&&!this.powerPause)this.timer=setTimeout(()=>this.pump(),this.delay());}
 async pump(){if(this.closed||this.paused||this.powerPause||this.active)return;let id=this.queue.values().next().value;if(id)this.queue.delete(id);else id=this.db.prepare('SELECT a.id FROM assets a LEFT JOIN asset_analysis s ON s.id=a.id WHERE a.trash=0 AND COALESCE(s.version,0)<1 LIMIT 1').get()?.id;if(!id)return;const controller=this.activeController=new AbortController();this.active=this.analyze(id,controller.signal);try{await this.active;}finally{if(controller.signal.aborted&&!this.closed)this.queue.add(id);this.activeController=null;this.active=null;this.schedule();}}
 async analyze(id,signal){
   try{
     signal?.throwIfAborted();
     const a=this.library.asset(id);
     if(a.trash||this.library.deleting.has(id))return;
     let extracted='',labels=[],swatches=[],error;
     if(['txt','md','csv','json','html','htm','xml','log','js','css','ts'].includes(a.ext)&&a.size<2*1024*1024){
       extracted=(await fs.promises.readFile(this.library.file(id),{encoding:'utf8',signal})).slice(0,50000);
     }
     const visual=/^(png|jpe?g|jfif|jpe|webp|avif|gif|heic|heif|tiff?|psd|eps|bmp|svg|pdf|mp4|mov|m4v|webm|mp3|m4a|wav|flac|aac|url|webloc)$/.test(a.ext);
     if(visual){
       const file=await this.thumbnail(id);
       signal?.throwIfAborted();
       if(file&&!this.closed){
         swatches=palette(this.nativeImage.createFromPath(file));
         try{
           const {stdout}=await execute(path.join(__dirname,'../bin/analysis-tool'),[this.library.file(id),file],{timeout:7000,killSignal:'SIGKILL',maxBuffer:512*1024,signal});
           const info=JSON.parse(stdout);
           extracted=info.text?.trim()||extracted;
           labels=info.labels||[];
           error=info.ocrError;
         }catch(failure){
           signal?.throwIfAborted();
           error=failure.killed?'Text analysis timed out.':'Text analysis could not read this file.';
         }
       }else if(!file&&!/^(url|webloc|mp3|m4a|wav|flac|aac)$/.test(a.ext)){
         error='No preview was available for text analysis.';
       }
     }
     if(this.closed||signal?.aborted)return;
     // A file called image.jpeg gets a real name, chosen from what is in it.
     let renamed='';
     if(meaninglessName(a.name)){
      const proposed=proposedName(a,extracted,labels);
      if(proposed&&proposed!==a.name&&proposed.length<=120){
       try{this.library.update(id,{name:proposed});renamed=proposed;}catch{}
      }
     }
     const old=this.info(id)||{};
     this.put(id,{text:error&&!extracted?undefined:extracted,summary:{
       palette:swatches.length?swatches:old.palette||[],
       ...(error&&!extracted?{}:{excerpt:extracted.replace(/\s+/g,' ').slice(0,500)}),
       tags:[...(old.tags||[]),...labels.map(label=>label.label),...swatches.map(color=>color.name)],
       state:error?'unavailable':'indexed',error,analyzedAt:Date.now()
     },version:1});
     // Tell the window about the new name so the card shows it at once.
     if(renamed)this.onUpdate({id,smart:this.indexText(id),name:renamed});
   }catch(error){
     if(!this.closed&&!signal?.aborted){
       try{this.put(id,{summary:{state:'unavailable',error:error.message},version:1});}catch{}
     }
   }
 }
 async search(query,vector){
   const tokens=expand(query),scores=new Map();
   if(tokens.length){
     const match=tokens.map(group=>'('+group.map(term=>'"'+term+'"*').join(' OR ')+')').join(' AND ');
     for(const row of this.db.prepare('SELECT f.id,bm25(smart_fts) rank FROM smart_fts f JOIN assets a ON a.id=f.id WHERE smart_fts MATCH ? AND a.trash=0 ORDER BY rank LIMIT 1500').all(match)){
       scores.set(row.id,1+Math.min(2,-row.rank));
     }
   }
   if(vector){
     if(!Array.isArray(vector)||vector.length!==512||vector.some(v=>!Number.isFinite(v)))throw Error('Invalid search vector.');
     const queryNorm=vector.reduce((sum,value)=>sum+value*value,0);
     const batchSize=400;
     const lastRow=this.db.prepare('SELECT MAX(rowid) AS id FROM asset_analysis').get().id;
     const select=this.db.prepare(`SELECT s.rowid AS cursor,s.id,s.vector FROM asset_analysis s
       JOIN assets a ON a.id=s.id WHERE s.rowid>? AND s.rowid<=?
       AND s.model=? AND s.vector IS NOT NULL AND a.trash=0 ORDER BY s.rowid LIMIT ?`);
     let cursor=0;
     while(!this.closed&&cursor<lastRow){
       const rows=select.all(cursor,lastRow,MODEL,batchSize);
       for(const row of rows){
         const bytes=row.vector;
         if(bytes.byteLength!==2048)continue;
         const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
         let dot=0,norm=0;
         for(let i=0;i<512;i++){
           const v=view.getFloat32(i*4,true);
           dot+=v*vector[i];norm+=v*v;
         }
         const similarity=dot/Math.sqrt(norm*queryNorm);
         if(similarity>=.23)scores.set(row.id,(scores.get(row.id)||0)+similarity);
       }
       if(rows.length<batchSize)break;
       cursor=rows.at(-1).cursor;
       await new Promise(resolve=>setImmediate(resolve));
     }
   }
   return [...scores].sort((a,b)=>b[1]-a[1]).slice(0,1500).map(([id])=>id);
 }
 deferVisual(id,now=Date.now()){
   const previous=this.info(id)?.visualAttempts||0;
   const index=Math.min(previous,visualRetryDelays.length-1);
   return this.put(id,{summary:{visualRetry:now+visualRetryDelays[index],visualAttempts:index+1}});
 }

 nextVisualWork(){
   const paused=this.paused?'manual':this.powerPause;
   if(paused)return {paused};
   const eligible=`FROM assets a LEFT JOIN asset_analysis s ON s.id=a.id
     WHERE a.trash=0 AND (s.vector IS NULL OR s.model IS NOT ?)
     AND a.ext IN (${VISUAL_EXTENSIONS})`;
   const retry="COALESCE(json_extract(s.summary,'$.visualRetry'),0)";
   const now=Date.now();
   const rows=this.db.prepare(`SELECT a.id ${eligible} AND ${retry}<=? LIMIT 16`).all(MODEL,now);
   if(rows.length)return {ids:rows.map(row=>row.id)};
   return this.db.prepare(`SELECT MIN(${retry}) AS retryAt ${eligible} AND ${retry}>?`).get(MODEL,now);
 }

 async close(){this.closed=true;clearTimeout(this.timer);this.activeController?.abort();await this.active;}
}
module.exports={SmartIndex,palette,expand,MODEL};
