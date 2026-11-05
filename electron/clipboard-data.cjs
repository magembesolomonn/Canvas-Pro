async function clipboardData(clipboard){
  let text='',html='',image=null;
  if(typeof clipboard.read==='function'){
    const items=await clipboard.read();
    for(const item of items){
      for(const type of item.types){
        if(!image&&['image/png','image/jpeg','image/webp','image/tiff'].includes(type)){const blob=await item.getType(type);image={buffer:Buffer.from(await blob.arrayBuffer()),mime:type};}
        else if(type==='text/plain'&&!text)text=await(await item.getType(type)).text();
        else if(type==='text/html'&&!html)html=await(await item.getType(type)).text();
        else if(type==='electron application/bookmark'&&!text)text=(await item.getType(type)).url;
      }
    }
  }else if(typeof clipboard.readImage==='function'){const img=clipboard.readImage();if(!img.isEmpty())image={buffer:img.toPNG(),mime:'image/png'};}
  if(!text&&typeof clipboard.readText==='function')text=await clipboard.readText();
  const direct=text.trim();
  const htmlImage=html.match(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i)?.[1]?.replaceAll('&amp;','&');
  let url=null;for(const candidate of [direct,htmlImage]){try{const u=new URL(candidate);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password){url=u.href;break;}}catch{}}
  return {image,url,text};
}
module.exports={clipboardData};
