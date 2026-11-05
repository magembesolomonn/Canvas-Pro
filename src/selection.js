(function(root){
class FileSelection {
 constructor(){this.ids=new Set();this.focus=null;this.anchor=null;this.order=[];this.index=new Map();}
 sync(order){this.order=order;this.index=new Map(order.map((id,i)=>[id,i]));for(const id of this.ids)if(!this.index.has(id))this.ids.delete(id);if(!this.index.has(this.focus))this.focus=this.ids.values().next().value||null;if(!this.index.has(this.anchor))this.anchor=this.focus;}
 clear(){this.ids.clear();this.focus=null;this.anchor=null;}
 select(id,{shiftKey=false,metaKey=false,ctrlKey=false}={}){if(!this.index.has(id))return;const additive=metaKey||ctrlKey;if(shiftKey&&this.index.has(this.anchor)){const a=this.index.get(this.anchor),b=this.index.get(id);if(!additive)this.ids.clear();for(let i=Math.min(a,b);i<=Math.max(a,b);i++)this.ids.add(this.order[i]);}else if(additive){if(this.ids.has(id))this.ids.delete(id);else this.ids.add(id);this.anchor=id;}else{this.ids=new Set([id]);this.anchor=id;}this.focus=this.ids.has(id)?id:(this.ids.values().next().value||null);}
 all(){this.ids=new Set(this.order);this.focus=this.focus||this.order[0]||null;this.anchor=this.focus;}
 values(){return [...this.ids];}
}
if(typeof module!=='undefined')module.exports={FileSelection};else root.FileSelection=FileSelection;
})(globalThis);
