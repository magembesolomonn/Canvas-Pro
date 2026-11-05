const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const {DatabaseSync}=require('node:sqlite');const {managedPath}=require('./deletion.cjs');
async function checkLibrary(root,{signal,onProgress=()=>{}}={}){
  const db=new DatabaseSync(path.join(root,'library.sqlite'),{readOnly:true});let records;
  try{records=db.prepare('SELECT id,name,stored,size,hash FROM assets').all();}finally{db.close();}
  const result={total:records.length,checked:0,healthy:0,issues:[],started:new Date().toISOString()};let last=0;
  for(const record of records){
    signal?.throwIfAborted();let issue;
    try{
      const file=managedPath({root},record.stored),originals=path.resolve(root,'originals')+path.sep;
      if(!file.startsWith(originals))throw new Error('Original is outside the originals folder.');
      const before=await fs.promises.lstat(file);if(before.isSymbolicLink()||!before.isFile())throw new Error('Original is not a regular managed file.');
      const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file,{signal}))hash.update(chunk);
      const digest=hash.digest('hex'),after=await fs.promises.stat(file);
      if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)issue={type:'changed',detail:'File changed during checking. Run the check again.'};
      else if(after.size!==record.size||digest!==record.hash)issue={type:'mismatch',detail:'Stored bytes differ from the recorded size or hash.'};
    }catch(error){if(signal?.aborted)throw error;issue={type:error.code==='ENOENT'?'missing':/outside|symbolic|regular|Original/.test(error.message)?'unsafe':'unreadable',detail:error.message};}
    result.checked++;if(issue)result.issues.push({id:record.id,name:record.name,...issue});else result.healthy++;
    if(Date.now()-last>150){last=Date.now();onProgress({...result,issues:result.issues.slice(0,200)});}
  }
  result.finished=new Date().toISOString();return result;
}
module.exports={checkLibrary};
