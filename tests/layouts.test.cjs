const {test}=require('node:test'),assert=require('node:assert/strict');const Layout=require('../src/layout.js');
const items=Array.from({length:10000},(_,id)=>({id:String(id),aspectRatio:[.6,1,16/9,2.5][id%4]}));
for(const mode of ['masonry','waterfall','justified'])test(`${mode} preserves proportions, fits bounds and virtualizes 10000 items`,()=>{
 for(const width of [360,900,1500]){
  const layout=Layout.createLayout(mode,items,width,230);assert.equal(layout.mode,mode);assert.equal(layout.positions.length,items.length);
  for(const p of layout.positions){assert.ok(Number.isFinite(p.x+p.y+p.width+p.height)&&p.width>0&&p.surfaceHeight>0);assert.ok(Math.abs(p.width/p.surfaceHeight-items[p.index].aspectRatio)<.00001);assert.ok(p.x>=layout.pad-.001&&p.x+p.width<=width-layout.pad+.001);}
  for(const column of layout.columnItems)for(let i=1;i<column.length;i++)assert.ok(column[i].y>=column[i-1].y+column[i-1].height+layout.gap-.001);
  const first=Layout.visibleIndices(layout,0,800),last=Layout.visibleIndices(layout,layout.height-800,800);assert.ok(first.length<100);assert.ok(last.length<100);assert.ok(last.includes(items.length-1));
  if(mode==='justified')for(const row of layout.rowItems){for(let i=1;i<row.length;i++)assert.ok(Math.abs(row[i].x-row[i-1].x-row[i-1].width-layout.gap)<.001);assert.ok(row.every(p=>Math.abs(p.surfaceHeight-row[0].surfaceHeight)<.001));}
 }
});
test('waterfall keeps sequential columns while masonry balances heights',()=>{const data=items.slice(0,20);const waterfall=Layout.createLayout('waterfall',data,1000),masonry=Layout.createLayout('masonry',data,1000);assert.deepEqual(waterfall.positions.map(p=>p.column),data.map((_,i)=>i%waterfall.columns));assert.notDeepEqual(waterfall.positions.map(p=>p.y),masonry.positions.map(p=>p.y));});
test('vertical keyboard movement follows adjacent justified rows',()=>{const layout=Layout.createLayout('justified',items.slice(0,30),1000);const first=layout.rowItems[0][1],next=Layout.verticalNeighbor(layout,first.id,1);assert.ok(layout.rowItems[1].some(p=>p.index===next));assert.equal(Layout.verticalNeighbor(layout,layout.rowItems[0][0].id,-1),layout.rowItems[0][0].index);});
