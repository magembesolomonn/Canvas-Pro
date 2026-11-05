(function(root){
function ratioOf(item,ratioFor){const value=ratioFor(item);return Number.isFinite(value)&&value>0?value:1;}
function createColumns(items,width,target=230,ratioFor=a=>a.aspectRatio||1,mode='masonry',footerHeight=()=>48){
 const gap=18,pad=22,available=Math.max(1,width-pad*2),columns=Math.max(1,Math.floor((available+gap)/(target+gap))),tile=(available-gap*(columns-1))/columns,heights=Array(columns).fill(pad),columnItems=Array.from({length:columns},()=>[]),positions=[],byId=new Map();
 for(let index=0;index<items.length;index++){
  let column=mode==='waterfall'?index%columns:0;
  if(mode==='masonry')for(let c=1;c<columns;c++)if(heights[c]<heights[column])column=c;
  const ratio=ratioOf(items[index],ratioFor),surfaceHeight=Math.max(.000001,tile/ratio),height=surfaceHeight+footerHeight(items[index]);
  const position={index,id:items[index].id,column,x:pad+column*(tile+gap),y:heights[column],width:tile,surfaceHeight,height};
  positions.push(position);byId.set(position.id,position);columnItems[column].push(position);heights[column]+=height+gap;
 }
 return {mode,positions,byId,columnItems,columns,tile,gap,pad,height:Math.max(pad,...heights)+pad,items,width,target};
}
function createMasonry(items,width,target=230,ratioFor=a=>a.aspectRatio||1){return createColumns(items,width,target,ratioFor,'masonry');}
function createJustified(items,width,target=230,ratioFor=a=>a.aspectRatio||1,footerHeight=()=>48){
 const gap=18,pad=22,available=Math.max(1,width-pad*2),positions=[],byId=new Map(),columnItems=[],rowItems=[];
 let row=[],sum=0,y=pad;
 function flush(fill){
  if(!row.length)return;
  const fitted=(available-gap*(row.length-1))/sum,surfaceHeight=fill?fitted:Math.min(target,fitted),height=surfaceHeight+Math.max(...row.map(item=>footerHeight(items[item.index])));
  let x=pad;const placed=[];
  for(let column=0;column<row.length;column++){
   const item=row[column],tileWidth=item.ratio*surfaceHeight;
   const position={index:item.index,id:items[item.index].id,column,row:rowItems.length,x,y,width:tileWidth,surfaceHeight,height};
   positions.push(position);byId.set(position.id,position);(columnItems[column]||(columnItems[column]=[])).push(position);placed.push(position);x+=tileWidth+gap;
  }
  rowItems.push(placed);y+=height+gap;row=[];sum=0;
 }
 for(let index=0;index<items.length;index++){
  if(row.length&&gap*row.length>=available)flush(false);
  const ratio=ratioOf(items[index],ratioFor);row.push({index,ratio});sum+=ratio;
  if(sum*target+gap*(row.length-1)>=available)flush(true);
 }
 flush(false);
 return {mode:'justified',positions,byId,columnItems,rowItems,columns:Math.max(1,columnItems.length),tile:target,gap,pad,height:Math.max(pad,y)+pad,items,width,target};
}
function createLayout(mode,items,width,target=230,ratioFor=a=>a.aspectRatio||1,footerHeight){
 return mode==='justified'?createJustified(items,width,target,ratioFor,footerHeight):createColumns(items,width,target,ratioFor,mode==='waterfall'?'waterfall':'masonry',footerHeight);
}
function verticalNeighbor(layout,id,step){
 const position=layout.byId.get(id);if(!position)return null;
 if(layout.mode==='justified'){
  const row=layout.rowItems[position.row+step];if(!row)return position.index;
  const center=position.x+position.width/2;let closest=row[0];
  for(const candidate of row)if(Math.abs(candidate.x+candidate.width/2-center)<Math.abs(closest.x+closest.width/2-center))closest=candidate;
  return closest.index;
 }
 const column=layout.columnItems[position.column],index=column.findIndex(p=>p.id===id);
 return column[index+step]?.index??position.index;
}
function visibleIndices(layout,scrollTop,height,overscan=400){
 const top=Math.max(0,scrollTop-overscan),bottom=scrollTop+height+overscan,result=[];
 for(const column of layout.columnItems){let low=0,high=column.length;while(low<high){const mid=(low+high)>>>1;if(column[mid].y+column[mid].height<top)low=mid+1;else high=mid;}
  for(let i=low;i<column.length&&column[i].y<=bottom;i++)result.push(column[i].index);
 }
 return result.sort((a,b)=>a-b);
}
function anchorAt(layout,scrollTop,height){if(!layout)return null;const candidates=visibleIndices(layout,scrollTop,height,0);let best=null;for(const index of candidates){const p=layout.positions[index];if(!best||Math.abs(p.y-scrollTop)<Math.abs(best.y-scrollTop))best=p;}return best?{id:best.id,offset:scrollTop-best.y,width:best.width}:null;}
const api={createMasonry,createLayout,createJustified,verticalNeighbor,visibleIndices,anchorAt};if(typeof module!=='undefined')module.exports=api;else root.AssetLayout=api;
})(globalThis);
