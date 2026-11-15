const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{analyzePage}=require('../electron/smart-page.cjs'),{Library}=require('../electron/library.cjs'),{SmartIndex,expand}=require('../electron/smart-index.cjs');
function page(data){return '<title>Fixture</title><script type="application/ld+json">'+JSON.stringify(data)+'</script>';}
test('smart page metadata distinguishes books, films, music, products and recipes without inventing details',()=>{for(const [schema,type]of [['Book','book'],['Movie','movie'],['TVSeries','series'],['MusicAlbum','album'],['MusicRecording','song'],['MusicPlaylist','playlist'],['Product','product'],['Recipe','recipe']]){const r=analyzePage(page({'@type':schema,name:'Fixture',image:'/cover.jpg',aggregateRating:{ratingValue:8.4,bestRating:10},duration:'PT2H8M'}),'https://example.com/page');assert.equal(r.type,type);assert.equal(r.imageURL,'https://example.com/cover.jpg');assert.equal(r.details.rating,'8.4');assert.equal(r.details.runtime,'PT2H8M');}const noDetails=analyzePage('<title>Unknown</title>','https://example.com');assert.equal(noDetails.imageURL,'');assert.deepEqual(noDetails.details,{});assert.equal(analyzePage('<title>Track</title>','https://open.spotify.com/track/abc').type,'song');assert.equal(analyzePage('<title>Post</title>','https://x.com/person/status/123').type,'social');});
test('recipe JSON-LD flattens sections, ingredient objects and newline lists in order',()=>{
 const nested={'@type':'Recipe',name:'Chili',recipeIngredient:[{name:'Salt'},{text:'Pepper'},'Onion\nGarlic'],recipeInstructions:[
  {'@type':'HowToSection',name:'Prep',itemListElement:[{'@type':'HowToStep',text:'Chop.'},{'@type':'HowToStep',text:'Mix.'}]},
  {'@type':'HowToStep',text:'Cook.\nRest.'}
 ]};
 const r=analyzePage(page(nested),'https://example.com/recipe');
 assert.equal(r.type,'recipe');
 assert.deepEqual(r.details.ingredients,['Salt','Pepper','Onion','Garlic']);
 assert.deepEqual(r.details.instructions,['Chop.','Mix.','Cook.','Rest.']);
});
test('a Page object beside a Recipe does not win the page',()=>{
 const graph={'@graph':[{'@type':'WebPage',name:'Wrapper'},{'@type':'Recipe',name:'Dinner',recipeIngredient:['Salt'],recipeInstructions:['Cook.']}]};
 const r=analyzePage(page(graph),'https://example.com/recipe');
 assert.equal(r.type,'recipe');
 assert.equal(r.title,'Dinner');
 assert.deepEqual(r.details.ingredients,['Salt']);
});
test('recipe microdata is read when no Recipe JSON-LD exists',()=>{
 const html='<html><head><title>Chili | Example</title></head><body><h1>Dragon Chili</h1>'+
  '<div class="recipe-ingredients"><h2>Ingredients</h2><ul><li>2 lb beef</li><li>1 onion</li></ul></div>'+
  '<div class="recipe-method"><h2>Method</h2><ol><li>Brown the beef.</li><li>Simmer.</li></ol></div>'+
  '<div itemprop="totalTime" content="PT1H"></div><div itemprop="recipeYield">Serves 8</div></body></html>';
 const r=analyzePage(html,'https://example.com/recipe');
 assert.equal(r.type,'recipe');
 assert.equal(r.title,'Dragon Chili');
 assert.deepEqual(r.details.ingredients,['2 lb beef','1 onion']);
 assert.deepEqual(r.details.instructions,['Brown the beef.','Simmer.']);
 assert.equal(r.details.servings,'8');
 assert.equal(r.details.prepTime,'PT1H');
});
test('a page that only mentions ingredients stays an article',()=>{
 const r=analyzePage('<html><head><title>How to shop</title></head><body><h1>How to shop</h1><ul class="ingredients"><li>Milk</li></ul></body></html>','https://example.com/shop');
 assert.notEqual(r.type,'recipe');
});
test('an anti-bot interstitial is reported instead of parsed as a recipe',()=>{
 const r=analyzePage('<html><head><title>Access Denied</title></head><body><H1>Access Denied</H1></body></html>','https://example.com/recipe');
 assert.equal(r.type,'webpage');
 assert.equal(r.state,'fallback');
 assert.match(r.error,/blocked/);
});
test('reader mode extracts article blocks without scripts, ads or markup execution',()=>{const r=analyzePage('<html><title>Story</title><body><nav>BUY NOW</nav><article><h1>Story</h1>'+('<p>This is a detailed article about electric cars and their batteries, written for people interested in technology and transport. There are useful facts about the world here.</p>'.repeat(8))+'<script>global.evil=1</script></article><aside>ADVERTISER</aside></body></html>','https://example.com/article');assert.equal(r.type,'article');assert.ok(r.article.blocks.length>2);assert.ok(!JSON.stringify(r.article.blocks).includes('ADVERTISER'));assert.ok(!JSON.stringify(r.article.blocks).includes('global.evil'));assert.equal(global.evil,undefined);});
test('local search indexes recognized text, categories and vectors, and removes deleted records',async()=>{const root=fs.mkdtempSync('/private/tmp/canvas-smart-unit-'),lib=new Library(path.join(root,'Library'));let index;try{const file=path.join(root,'photo.png');fs.writeFileSync(file,'fixture');const id=(await lib.importFile(file)).imported;index=new SmartIndex({library:lib,thumbnail:async()=>null,nativeImage:{},testMode:true});index.put(id,{text:'A smartphone on a desk',summary:{tags:['product','phone'],palette:[{hex:'#2266bb',name:'blue'}]},vector:Array.from({length:512},(_,i)=>i===0?1:0),version:1});assert.ok((await index.search('iphones')).includes(id));assert.ok((await index.search('product')).includes(id));assert.ok((await index.search('unmatched',Array.from({length:512},(_,i)=>i===0?1:0))).includes(id));lib.update(id,{trash:true});assert.deepEqual(await index.search('phone'),[]);await lib.permanentDelete([id]);assert.equal(lib.db.prepare('SELECT COUNT(*) n FROM asset_analysis').get().n,0);assert.equal(lib.db.prepare('SELECT COUNT(*) n FROM smart_fts').get().n,0);}finally{await index?.close();lib.close();fs.rmSync(root,{recursive:true,force:true});}});
const {LocalModel}=require('../electron/local-model.cjs');
test('local model rejects unverified downloads and exposes only pinned model files',async()=>{const root=fs.mkdtempSync('/private/tmp/canvas-model-unit-');try{const model=new LocalModel({root,fetcher:async()=>({ok:true,body:(async function*(){yield Buffer.from('invalid');})()})}).define('clip',require('../electron/clip-manifest.json'));assert.equal(model.file('/clip/../../library.sqlite'),null);assert.equal(model.file('/other/config.json'),null);await assert.rejects(model.download(),/checksum/);assert.equal(model.state().ready,false);assert.equal(model.state().state,'failed');assert.equal(fs.existsSync(path.join(root,'clip','ready.json')),false);}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('descriptive search over 20000 indexed items yields to the event loop',async()=>{const root=fs.mkdtempSync('/private/tmp/canvas-search-scale-'),lib=new Library(path.join(root,'Library')),index=new SmartIndex({library:lib,thumbnail:async()=>null,nativeImage:{},testMode:true});try{const crypto=require('node:crypto'),insert=lib.db.prepare('INSERT INTO assets(id,name,ext,size,hash,stored,created,imported) VALUES(?,?,?,?,?,?,?,?)'),fts=lib.db.prepare('INSERT INTO smart_fts(id,body) VALUES(?,?)'),analysis=lib.db.prepare('INSERT INTO asset_analysis(id,vector,model,version) VALUES(?,?,?,1)'),vector=Array.from({length:512},(_,i)=>i===0?1:0),blob=Buffer.from(new Float32Array(vector).buffer);lib.db.exec('BEGIN');for(let n=0;n<20000;n++){const id=crypto.randomUUID();insert.run(id,'Photo '+n,'jpg',1,'scale-'+n,'originals/fixture.jpg',0,n);fts.run(id,n%3?'a vehicle product':'a smartphone phone');analysis.run(id,blob,'clip-vit-base-patch32-q8-v1');}lib.db.exec('COMMIT');let yielded=false;setImmediate(()=>{yielded=true;});const started=performance.now(),results=await index.search('iphones',vector),elapsed=performance.now()-started;assert.equal(results.length,1500);assert.equal(yielded,true);assert.ok(elapsed<3000,'Search took '+elapsed+' ms');console.log('SMART_SEARCH_20000_ITEMS_MS',Math.round(elapsed));}finally{await index.close();lib.close();fs.rmSync(root,{recursive:true,force:true});}});

test('visual saves leave text search intact and missing previews are reported as unavailable',async()=>{
 const root=fs.mkdtempSync('/private/tmp/canvas-index-state-');
 const library=new Library(path.join(root,'Library'));
 const index=new SmartIndex({library,thumbnail:async()=>null,nativeImage:{},testMode:true});
 try{
  const file=path.join(root,'reference.png');fs.writeFileSync(file,'fixture');
  const id=(await library.importFile(file)).imported;
  index.put(id,{text:'original searchable caption',version:1});
  const before=library.db.prepare('SELECT total_changes() AS n').get().n;
  const vector=Array(512).fill(0);vector[0]=1;
  index.put(id,{vector});
  assert.equal(library.db.prepare('SELECT total_changes() AS n').get().n-before,1);
  const now=Date.now();
  const retry=index.deferVisual(id,now);
  assert.equal(retry.visualRetry,now+60000);
  assert.equal(index.deferVisual(id,now+60000).visualRetry,now+360000);
  index.put(id,{vector});
  assert.equal(index.info(id).visualRetry,undefined);
  assert.equal(index.info(id).visualAttempts,undefined);
  assert.deepEqual(await index.search('caption'),[id]);
  await index.analyze(id);
  assert.equal(index.info(id).state,'unavailable');
  assert.equal(index.state().failed,1);
  assert.deepEqual(await index.search('caption'),[id]);
  assert.deepEqual(await index.search('unmatched',vector),[id]);
 }finally{await index.close();library.close();fs.rmSync(root,{recursive:true,force:true});}
});
