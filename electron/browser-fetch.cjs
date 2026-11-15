const dns=require('node:dns');
const {isIP}=require('node:net');
const {isPublicAddress,publicFetch}=require('./public-fetch.cjs');

// Chromium's network stack sends a real browser TLS/HTTP2 fingerprint, which is
// what Cloudflare-protected recipe sites require. The raw node:https fetcher in
// public-fetch.cjs is rejected by them (403/402) even with browser headers.
//
// Chromium does not pin DNS the way a custom `lookup` does, so the guard has to
// happen here instead: every hop is resolved first and refused unless it points
// at a public address. That keeps the same SSRF rule as public-fetch.cjs while
// the request itself goes through the browser stack.
function assertWebURL(value){
  let url;
  try{url=new URL(value);}catch{throw new Error('Automatic previews require a public HTTP address.');}
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Automatic previews require a public HTTP address.');
  if(isIP(host)&&!isPublicAddress(host))throw new Error('Automatic previews require a public address.');
  return url;
}
function assertPublicHost(host){
  return new Promise((resolve,reject)=>{
    dns.lookup(host,{all:true},(error,addresses)=>{
      if(error)return reject(error);
      if(!(addresses||[]).some(entry=>isPublicAddress(entry.address)))return reject(new Error('Automatic previews require a public address.'));
      resolve();
    });
  });
}
function createBrowserFetch(net){
  return async function browserFetch(value,{signal,headers,timeout=15000}={}){
    let url=assertWebURL(value);
    const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
    for(let redirects=0;redirects<=5;redirects++){
      await assertPublicHost(url.hostname.replace(/^\[|\]$/g,''));
      const response=await net.fetch(url.href,{signal:deadline,headers,credentials:'omit',redirect:'manual'});
      const location=response.headers.get('location');
      if([301,302,303,307,308].includes(response.status)&&location){
        await response.body?.cancel();
        url=assertWebURL(new URL(location,url).href);
        continue;
      }
      // Chromium leaves url empty for a manually followed redirect, and the
      // parser needs the final address to resolve relative images and links.
      if(!response.url)Object.defineProperty(response,'url',{value:url.href});
      return response;
    }
    throw new Error('Too many preview redirects.');
  };
}
let chromeFetch;
// Only the prepared module instance is reused; the Electron import stays lazy so
// unit tests can load this file without an app.
function browserFetch(url,options){
  if(!chromeFetch){
    const {net}=require('electron');
    chromeFetch=createBrowserFetch(net);
  }
  return chromeFetch(url,options);
}
// Chromium is the one that gets past the block, but a machine with a proxy or a
// broken browser network should still fall back to the guarded Node fetch
// rather than fail closed. Address refusals are never retried: the Node path
// enforces the same rule and would reject them too.
async function previewFetch(url,options){
  try{return await browserFetch(url,options);}
  catch(error){
    if(/require a public/i.test(error?.message||''))throw error;
    return publicFetch(url,options);
  }
}

module.exports={browserFetch,previewFetch,createBrowserFetch,assertWebURL,assertPublicHost};
