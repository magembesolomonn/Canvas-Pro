const dns=require('node:dns');
const {isIP}=require('node:net');
const {isPublicAddress,publicFetch}=require('./public-fetch.cjs');

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
      if(!(addresses||[]).length||!(addresses||[]).every(entry=>isPublicAddress(entry.address)))return reject(new Error('Automatic previews require a public address.'));
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
      if(!response.url)Object.defineProperty(response,'url',{value:url.href});
      return response;
    }
    throw new Error('Too many preview redirects.');
  };
}
let chromeFetch;
function browserFetch(url,options){
  if(!chromeFetch){
    const {net}=require('electron');
    chromeFetch=createBrowserFetch(net);
  }
  return chromeFetch(url,options);
}
async function previewFetch(url,options){
  try{return await browserFetch(url,options);}
  catch(error){
    if(/require a public/i.test(error?.message||''))throw error;
    return publicFetch(url,options);
  }
}

module.exports={browserFetch,previewFetch,createBrowserFetch,assertWebURL,assertPublicHost};
