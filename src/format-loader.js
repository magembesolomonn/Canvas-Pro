// Load heavier document/model engines only when that type is opened.
let formatEnginePromise;
window.CanvasFormats={supports:ext=>['eps','3ds','3mf','dae','ifc','ply','stl','glb','epub','html','htm','mhtml','mht','swf'].includes(ext),mount(asset){
 const element=document.createElement('div');element.className='format-host';element.textContent='Preparing preview…';let disposed=false,viewer;
 if(!formatEnginePromise)formatEnginePromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='formats.js';script.onload=()=>resolve(window.CanvasFormatEngines);script.onerror=()=>{formatEnginePromise=null;reject(Error('Preview engine could not be loaded.'));};document.head.append(script);});
 formatEnginePromise.then(engine=>{if(disposed)return;viewer=engine.mount(asset);element.replaceChildren(viewer.element);}).catch(error=>{if(!disposed)element.textContent=error.message;});
 return {element,dispose(){disposed=true;viewer?.dispose();element.remove();}};
}};
