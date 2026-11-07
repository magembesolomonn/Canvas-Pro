const dns=require('node:dns');
const http=require('node:http');
const https=require('node:https');
const {isIP}=require('node:net');
const {Readable}=require('node:stream');
const zlib=require('node:zlib');

function isPublicAddress(address){
  if(isIP(address)===4){
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||
      a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||
      a===192&&(b===168||b===0&&(c===0||c===2)||b===88&&c===99)||
      a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
  }
  if(isIP(address)!==6)return false;
  const [first,second]=address.split(':').map(part=>parseInt(part||'0',16));
  return first>=0x2000&&first<0x4000&&first!==0x2002&&first!==0x3fff&&
    !(first===0x2001&&(second<0x200||second===0xdb8));
}

function publicLookup(host,options,done){
  dns.lookup(host,{all:true},(error,addresses)=>{
    if(error)return done(error);
    const usable=addresses.filter(entry=>(!options.family||entry.family===options.family)&&isPublicAddress(entry.address));
    if(!usable.length)return done(new Error('Automatic previews require a public address.'));
    if(options.all)return done(null,usable);
    done(null,usable[0].address,usable[0].family);
  });
}

async function publicFetch(value,{signal,headers,timeout=12000}={}){
  let url=new URL(value);
  const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  for(let redirects=0;redirects<=5;redirects++){
    const host=url.hostname.replace(/^\[|\]$/g,'');
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||
       isIP(host)&&!isPublicAddress(host))throw new Error('Automatic previews require a public HTTP address.');
    const transport=url.protocol==='https:'?https:http;
    // Lookup filters the actual socket destination, including after redirects.
    const incoming=await new Promise((resolve,reject)=>{
      const req=transport.get(url,{lookup:publicLookup,signal:deadline,headers:{
        'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        ...headers,'Accept-Encoding':'identity'
      }},resolve);
      req.once('error',reject);
    });
    const status=incoming.statusCode;
    if([301,302,303,307,308].includes(status)&&incoming.headers.location){
      incoming.destroy();
      url=new URL(incoming.headers.location,url);
      continue;
    }
    const encoding=String(incoming.headers['content-encoding']||'').toLowerCase();
    const decoded=encoding==='gzip'?incoming.pipe(zlib.createGunzip())
      :encoding==='deflate'?incoming.pipe(zlib.createInflate())
      :encoding==='br'?incoming.pipe(zlib.createBrotliDecompress()):incoming;
    const body=[204,205,304].includes(status)?null:Readable.toWeb(decoded);
    if(!body)incoming.resume();
    const responseHeaders={...incoming.headers};
    delete responseHeaders['content-encoding'];
    delete responseHeaders['content-length'];
    const response=new Response(body,{status,headers:responseHeaders});
    Object.defineProperty(response,'url',{value:url.href});
    return response;
  }
  throw new Error('Too many preview redirects.');
}

module.exports={publicFetch,isPublicAddress};
