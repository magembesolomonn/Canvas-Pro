(function(root){
function intersects(a,b){return a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;}
function bounds(items){let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;for(const item of items){const d=item.data||item;left=Math.min(left,d.x);top=Math.min(top,d.y);right=Math.max(right,d.x+d.width);bottom=Math.max(bottom,d.y+d.height);}return left===Infinity?null:{x:left,y:top,width:right-left,height:bottom-top};}
class SpatialIndex{
 constructor(items=[],size=1024){this.size=size;this.cells=new Map();this.items=new Map();this.keys=new Map();this.large=new Set();for(const item of items)this.update(item);}
 range(rect){return [Math.floor(rect.x/this.size),Math.floor(rect.y/this.size),Math.floor((rect.x+rect.width)/this.size),Math.floor((rect.y+rect.height)/this.size)];}
 update(item){this.remove(item.id);this.items.set(item.id,item);const [x,y,r,b]=this.range(item.data);if((r-x+1)*(b-y+1)>64){this.large.add(item.id);return;}const keys=[];for(let i=x;i<=r;i++)for(let j=y;j<=b;j++){const key=i+':'+j;let cell=this.cells.get(key);if(!cell)this.cells.set(key,cell=new Set());cell.add(item.id);keys.push(key);}this.keys.set(item.id,keys);}
 remove(id){for(const key of this.keys.get(id)||[]){const cell=this.cells.get(key);cell?.delete(id);if(!cell?.size)this.cells.delete(key);}this.keys.delete(id);this.large.delete(id);this.items.delete(id);}
 query(rect){const [x,y,r,b]=this.range(rect),ids=new Set(this.large);if((r-x+1)*(b-y+1)>4096)return [...this.items.values()].filter(item=>intersects(item.data,rect));for(let i=x;i<=r;i++)for(let j=y;j<=b;j++)for(const id of this.cells.get(i+':'+j)||[])ids.add(id);return [...ids].map(id=>this.items.get(id)).filter(item=>item&&intersects(item.data,rect));}
 hit(x,y){return this.query({x,y,width:0,height:0}).sort((a,b)=>b.z-a.z)[0]||null;}
}
function screenToWorld(point,camera){return {x:(point.x-camera.x)/camera.zoom,y:(point.y-camera.y)/camera.zoom};}
function zoomAt(camera,point,zoom){zoom=Math.max(.01,Math.min(8,zoom));const world=screenToWorld(point,camera);return {x:point.x-world.x*zoom,y:point.y-world.y*zoom,zoom};}
function fit(items,width,height,padding=70){const b=bounds(items);if(!b)return {x:80,y:80,zoom:1};const zoom=Math.max(.01,Math.min(2,(width-padding*2)/Math.max(1,b.width),(height-padding*2)/Math.max(1,b.height)));return {x:(width-b.width*zoom)/2-b.x*zoom,y:(height-b.height*zoom)/2-b.y*zoom,zoom};}
function snap(rect,items,tolerance){
 const result={dx:0,dy:0,guides:{}};
 for(const [axis,size,delta] of [['x','width','dx'],['y','height','dy']]){
  let best=tolerance;
  for(const {data} of items)for(const target of [data[axis],data[axis]+data[size]/2,data[axis]+data[size]]){
   for(const edge of [rect[axis],rect[axis]+rect[size]/2,rect[axis]+rect[size]]){
    const distance=target-edge;
    if(Math.abs(distance)>best)continue;
    best=Math.abs(distance);result[delta]=distance;result.guides[axis]=target;
   }
  }
 }
 return result;
}
function strokePath(data){
 const points=(data.points||[]).map(([x,y])=>[x*data.width,y*data.height]);
 if(!points.length)return '';
 const path='M'+points.map(([x,y])=>x+','+y).join(' L');
 if(data.shape!=='arrow'||points.length<2)return points.length===1?path+' l.01 0':path;
 const [[x,y],[endX,endY]]=points;
 const angle=Math.atan2(endY-y,endX-x),head=Math.min(15,Math.hypot(endX-x,endY-y)/3);
 const wing=offset=>[endX-head*Math.cos(angle+offset),endY-head*Math.sin(angle+offset)].join(',');
 return path+' M'+wing(-.55)+' L'+endX+','+endY+' L'+wing(.55);
}
const api={SpatialIndex,intersects,bounds,screenToWorld,zoomAt,fit,snap,strokePath};if(typeof module!=='undefined')module.exports=api;else root.CanvasGeometry=api;
})(globalThis);
