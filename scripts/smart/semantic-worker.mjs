import {env,AutoTokenizer,AutoProcessor,CLIPTextModelWithProjection,CLIPVisionModelWithProjection,Florence2Processor,Florence2ForConditionalGeneration,RawImage} from '@huggingface/transformers';
env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath='asset://ai/';env.useBrowserCache=false;env.backends.onnx.wasm.wasmPaths=new URL('vendor/onnx/',self.location.href).href;env.backends.onnx.wasm.numThreads=1;

// The worker does three jobs: it embeds a picture, it embeds a sentence, and
// it describes a picture in one sentence. The first two make search work; the
// third is what names a file, suggests its tags and makes it findable by what
// it shows.
let visionReady,textReady,captionReady;
let chain=Promise.resolve();
function normalize(values){let length=0;for(const v of values)length+=v*v;length=Math.sqrt(length)||1;return Array.from(values,v=>v/length);}
function loadVision(){
 visionReady??=Promise.all([
  AutoProcessor.from_pretrained('clip'),
  CLIPVisionModelWithProjection.from_pretrained('clip',{dtype:'q8',device:'wasm'})
 ]).catch(error=>{visionReady=null;throw error;});
 return visionReady;
}
function loadText(){
 textReady??=Promise.all([
  AutoTokenizer.from_pretrained('clip'),
  CLIPTextModelWithProjection.from_pretrained('clip',{dtype:'q8',device:'wasm'})
 ]).catch(error=>{textReady=null;throw error;});
 return textReady;
}
function loadCaption(){
 captionReady??=Promise.all([
  Florence2Processor.from_pretrained('florence-2'),
  Florence2ForConditionalGeneration.from_pretrained('florence-2',{dtype:'q8',device:'wasm'})
 ]).catch(error=>{captionReady=null;throw error;});
 return captionReady;
}
self.onmessage=({data})=>{
 chain=chain.then(async()=>{
  try{
   let vector,caption;
   if(data.type==='text'){
    const [tokenizer,model]=await loadText();
    const inputs=tokenizer(data.text,{padding:true,truncation:true,max_length:77});
    vector=normalize((await model(inputs)).text_embeds.data);
   }else if(data.type==='image'){
    const response=await fetch('asset://thumb/'+data.assetId+'?v=2');
    if(!response.ok)throw Error('No preview available');
    const [processor,model]=await loadVision();
    const image=await RawImage.fromBlob(await response.blob());
    vector=normalize((await model(await processor(image))).image_embeds.data);
   }else if(data.type==='caption'){
    const response=await fetch('asset://thumb/'+data.assetId+'?v=2');
    if(!response.ok)throw Error('No preview available');
    const [processor,model]=await loadCaption();
    const image=await RawImage.fromBlob(await response.blob());
    const inputs=await processor(image,'<CAPTION>');
    const ids=await model.generate({...inputs,max_new_tokens:64,num_beams:1,do_sample:false});
    caption=processor.batch_decode(ids,{skip_special_tokens:false})[0].replace(/<.*?>/g,'').trim();
   }else await loadVision();
   self.postMessage({id:data.id,vector,caption,ready:true});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
 });
};
