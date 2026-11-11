const VISUAL_EXTENSIONS="'jpg','jpeg','jfif','jpe','png','webp','gif','avif','heic','heif','tiff','tif','bmp','svg','psd','eps','pdf','mp4','mov','m4v','webm'";
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');const execute=promisify(execFile);
const {expand,moodWords,meaninglessName,proposedName}=require('./smart-language.cjs');
// macOS can compare sentences on its own. The native helper turns a piece of
// text into the vector that comparison uses, so documents and notes can be
// searched in plain language without downloading a model.
const TEXT_MODEL='natural-language-en-v1';
const TEXT_CHUNKS=12;
// A document is understood in pieces: one vector for the whole file would
// average a note about files and a note about tomatoes into nothing.
function textChunks(text){
  const value=String(text||'');
  if(!value.trim())return [];
  // Sentences first: a paragraph that mixes two subjects is two things, and
  // only one of them is what the reader is looking for.
  const sentences=[];
  for(const paragraph of value.split(/\n\s*\n/)){
    const clean=paragraph.replace(/\s+/g,' ').trim();
    if(!clean)continue;
    for(const sentence of clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\u201c])/))
      if(sentence.trim())sentences.push(sentence.trim());
  }
  // Then small pieces of a few sentences each.
  const parts=[];
  let current='';
  for(const sentence of sentences){
    if(current&&current.length+sentence.length>700){parts.push(current);current='';}
    current+=(current?' ':'')+sentence;
    if(parts.length>=TEXT_CHUNKS)break;
  }
  if(current&&parts.length<TEXT_CHUNKS)parts.push(current);
  return parts.slice(0,TEXT_CHUNKS);
}
const textTool=path.join(__dirname,'../bin/text-tool');
let textDimensions=0;
function normalise(values){
  let length=0;
  for(const v of values)length+=v*v;
  length=Math.sqrt(length)||1;
  return values.map(v=>v/length);
}
function embedText(text){
  const value=String(text||'').trim();
  if(!value)return null;
  try{
    const stdout=execFileSync(textTool,['embed',value.slice(0,4000)],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
    const values=JSON.parse(stdout);
    if(!Array.isArray(values)||!values.length)return null;
    textDimensions=values.length;
    // The comparison is a dot product, so the vector is normalised once.
    return normalise(values);
  }catch(error){
    return null;
  }
}
// Several texts in one call: a document is a dozen pieces, and a dozen
// processes for it is a dozen times the work.
function embedTexts(texts){
  const lines=texts.map(text=>String(text||'').replace(/\s+/g,' ').trim()).filter(Boolean);
  if(!lines.length)return [];
  try{
    const stdout=execFileSync(textTool,['embed-many'],{input:lines.join('\n'),encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
    const values=JSON.parse(stdout);
    if(!Array.isArray(values))return [];
    return values.filter(Array.isArray).map(normalise);
  }catch(error){
    return [];
  }
}
const MODEL='clip-vit-base-patch32-q8-v1';
const visualRetryDelays=[1,5,30,60].map(minutes=>minutes*60000);
const colors={red:[210,55,55],orange:[225,135,40],yellow:[220,205,60],green:[65,150,75],blue:[50,110,200],purple:[135,75,175],pink:[215,125,165],brown:[125,90,55],black:[25,25,25],white:[235,235,235],grey:[135,135,135]};
function palette(image){if(!image||image.isEmpty())return [];const {width,height}=image.getSize(),scale=Math.min(1,64/Math.max(width,height));const tiny=scale===1?image:image.resize({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))});const bytes=tiny.toBitmap(),bins=new Map();for(let i=0;i<bytes.length;i+=4){if(bytes[i+3]<128)continue;const b=bytes[i],g=bytes[i+1],r=bytes[i+2],key=(r>>5)*64+(g>>5)*8+(b>>5),bin=bins.get(key)||[0,0,0,0];bin[0]+=r;bin[1]+=g;bin[2]+=b;bin[3]++;bins.set(key,bin);}const chosen=[];for(const bin of [...bins.values()].sort((a,b)=>b[3]-a[3])){const rgb=bin.slice(0,3).map(v=>Math.round(v/bin[3]));if(chosen.some(c=>c.rgb.reduce((n,v,i)=>n+(v-rgb[i])**2,0)<1800))continue;const hex='#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');let color='grey',distance=Infinity;for(const [name,value]of Object.entries(colors)){const d=value.reduce((n,v,i)=>n+(v-rgb[i])**2,0);if(d<distance){distance=d;color=name;}}chosen.push({hex,name:color,rgb});if(chosen.length===6)break;}return chosen.map(({hex,name})=>({hex,name}));}
class SmartIndex{
 constructor({library,thumbnail,nativeImage,onUpdate=()=>{},onWork=()=>{},delay=()=>650,testMode=false}){Object.assign(this,{library,thumbnail,nativeImage,onUpdate,onWork,delay});this.db=library.db;this.closed=false;this.paused=testMode;this.powerPause=null;this.queue=new Set();this.db.exec(`CREATE TABLE IF NOT EXISTS asset_analysis(id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,summary TEXT NOT NULL DEFAULT '{}',text TEXT NOT NULL DEFAULT '',vector BLOB,model TEXT,version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS asset_chunks(id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,chunk INTEGER NOT NULL,vector BLOB NOT NULL,model TEXT NOT NULL);CREATE VIRTUAL TABLE IF NOT EXISTS smart_fts USING fts5(id UNINDEXED,body,tokenize='unicode61');CREATE TRIGGER IF NOT EXISTS smart_delete AFTER DELETE ON assets BEGIN DELETE FROM smart_fts WHERE id=old.id;END;`);this.db.prepare("UPDATE asset_analysis SET summary=json_set(summary,'$.visualRetry',MIN(json_extract(summary,'$.visualRetry'),?), '$.visualAttempts',1) WHERE json_extract(summary,'$.visualRetry') IS NOT NULL AND json_extract(summary,'$.visualAttempts') IS NULL").run(Date.now()+visualRetryDelays[0]);library.onAssetChanged=id=>this.changed(id);this.timer=setTimeout(()=>this.pump(),1500);this.timer.unref();}
 info(id){const row=this.db.prepare('SELECT summary FROM asset_analysis WHERE id=?').get(id);return row?JSON.parse(row.summary):null;}
 changed(id){if(this.closed)return;try{const smart=this.indexText(id);this.onUpdate({id,smart});if(this.info(id)?.state!=='indexed'||(['url','webloc'].includes(this.library.asset(id).ext)&&!this.info(id)?.palette?.length))this.queue.add(id);}catch{}this.schedule();this.onWork();}
 indexText(id){const a=this.library.asset(id),analysis=this.db.prepare('SELECT summary,text FROM asset_analysis WHERE id=?').get(id),meta=this.db.prepare('SELECT json FROM capture_metadata WHERE id=?').get(id),m=meta?JSON.parse(meta.json):{},info=m.linkPreview||{},tags=[...new Set([...(analysis?JSON.parse(analysis.summary).tags||[]:[]),...(info.tags||[]),...(m.kind==='content'?[m.selection?'quote':'note','text']:[])])];const summary={...(analysis?JSON.parse(analysis.summary):{}),tags};this.db.prepare("INSERT INTO asset_analysis(id,summary) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary").run(id,JSON.stringify(summary));let articleText='';if(info.article){try{articleText=JSON.parse(fs.readFileSync(path.join(this.library.root,'thumbnails',id+'.reader.json'),'utf8')).blocks.map(b=>b.text).join(' ').slice(0,50000);}catch{}}const body=[articleText,a.name,summary.originalName||'',summary.caption||'',a.notes,a.url,a.tags,a.folders,m.pageTitle,m.author,m.description,m.textExcerpt,info.title,info.description,JSON.stringify(info.details||{}),...tags,...moodWords(summary.palette),analysis?.text||''].filter(Boolean).join(' ').slice(0,120000);this.db.exec('SAVEPOINT smart_text');try{this.db.prepare('DELETE FROM smart_fts WHERE id=?').run(id);this.db.prepare('INSERT INTO smart_fts(id,body) VALUES(?,?)').run(id,body);this.db.exec('RELEASE smart_text');}catch(e){this.db.exec('ROLLBACK TO smart_text; RELEASE smart_text');throw e;}return summary;}
 put(id,patch){
   if(this.library.deleting.has(id))return;
   this.library.asset(id);
   const old=this.db.prepare('SELECT * FROM asset_analysis WHERE id=?').get(id);
   const summary={...(old?JSON.parse(old.summary):{}),...patch.summary};
   if(summary.tags)summary.tags=[...new Set(summary.tags)].slice(0,50);
   let vector=old?.vector||null;
   let model=old?.model||null;
   if(patch.vector){
     if(!Array.isArray(patch.vector)||patch.vector.length!==512||patch.vector.some(v=>!Number.isFinite(v)))throw Error('Invalid index vector.');
     vector=Buffer.from(new Float32Array(patch.vector).buffer);
     model=patch.model||MODEL;
     if(model===MODEL){delete summary.visualRetry;delete summary.visualAttempts;}
   }
   this.db.prepare('INSERT INTO asset_analysis(id,summary,text,vector,model,version) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary,text=excluded.text,vector=excluded.vector,model=excluded.model,version=excluded.version').run(
     id,JSON.stringify(summary),patch.text===undefined?old?.text||'':String(patch.text).slice(0,50000),vector,patch.vector?(patch.model||MODEL):old?.model||null,patch.version??old?.version??0);
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
     // The meaning of a document, as macOS understands it.
     let textVector=null;
     if(!error&&extracted){
      const chunks=textChunks(extracted);
      const vectors=embedTexts(chunks);
      if(vectors.length){
       textVector=vectors[0];
       this.putChunks(id,vectors);
      }
     }
     // A file called image.jpeg gets a real name, chosen from what is in it.
     let renamed='',originalName='';
     if(meaninglessName(a.name)){
      const proposed=proposedName(a,extracted,labels);
      if(proposed&&proposed!==a.name&&proposed.length<=120){
       originalName=a.name;
       try{this.library.update(id,{name:proposed});renamed=proposed;}catch{}
      }
     }
     const old=this.info(id)||{};
     this.put(id,{text:error&&!extracted?undefined:extracted,summary:{
       palette:swatches.length?swatches:old.palette||[],
       ...(error&&!extracted?{}:{excerpt:extracted.replace(/\s+/g,' ').slice(0,500)}),
       tags:[...(old.tags||[]),...labels.map(label=>label.label),...swatches.map(color=>color.name)],
       state:error?'unavailable':'indexed',error,analyzedAt:Date.now(),
       ...(originalName?{originalName}:{})
     },version:1,...(textVector?{vector:textVector,model:TEXT_MODEL}:{})});
     // Tell the window about the new name so the card shows it at once.
     if(renamed)this.onUpdate({id,smart:this.indexText(id),name:renamed});
   }catch(error){
     if(!this.closed&&!signal?.aborted){
       try{this.put(id,{summary:{state:'unavailable',error:error.message},version:1});}catch{}
     }
   }
 }
 putChunks(id,vectors){
  this.db.prepare('DELETE FROM asset_chunks WHERE id=?').run(id);
  const statement=this.db.prepare('INSERT INTO asset_chunks(id,chunk,vector,model) VALUES(?,?,?,?)');
  vectors.forEach((vector,chunk)=>statement.run(id,chunk,Buffer.from(new Float32Array(vector).buffer),TEXT_MODEL));
 }
 async search(query,vector){
   const tokens=expand(query),scores=new Map();
   if(tokens.length){
     const match=tokens.map(group=>'('+group.map(term=>'"'+term+'"*').join(' OR ')+')').join(' OR ');
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
   // The sentence, understood: compare the words with the documents that
   // macOS embedded. This is what makes a whole sentence findable in a file.
   const understood=await this.understand(query);
   if(understood){
     const rows=this.db.prepare('SELECT id,vector FROM asset_chunks WHERE model=?').all(TEXT_MODEL);
     for(const row of rows){
       const bytes=row.vector;
       if(bytes.byteLength!==2048)continue;
       const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
       let dot=0,norm=0;
       for(let i=0;i<512;i++){
         const v=view.getFloat32(i*4,true);
         dot+=v*understood[i];norm+=v*v;
       }
       const similarity=dot/Math.sqrt(norm||1);
       if(similarity<.25)continue;
       const current=scores.get(row.id)||0;
       // The best piece of a file is what matches, not the sum of them.
       scores.set(row.id,Math.max(current,similarity));
     }
   }
   return [...scores].sort((a,b)=>b[1]-a[1]).slice(0,1500).map(([id])=>id);
 }
 // The meaning of the query, as macOS understands it. Nothing is embedded
 // when the library holds no documents, so the cost is only paid when it
 // helps.
 async understand(query){
   const count=this.db.prepare('SELECT COUNT(*) n FROM asset_chunks WHERE model=?').get(TEXT_MODEL).n;
   if(!count)return null;
   return embedText(query);
 }
 // A caption is one sentence about a picture. It is stored beside the rest
 // of what is known about the file, so its words can be found by a search.
 caption(id,text){
  const value=String(text||'').trim().slice(0,400);
  if(!value)return null;
  const summary={...(this.info(id)||{}),caption:value};
  // The version belongs to the index: a caption must not mark a file as
  // analysed, or the palette and the recognised text would never be read.
  this.put(id,{summary:{caption:value}});
  return summary;
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
