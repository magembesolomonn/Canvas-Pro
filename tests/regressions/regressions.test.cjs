// Release regressions. All writes use fresh temporary libraries.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {spawnSync}=require('node:child_process');const root=path.resolve(__dirname,'../..');
function run(runtime,name){const result=spawnSync(runtime,[path.join(__dirname,name)],{cwd:root,encoding:'utf8',timeout:60000});if(result.error)throw result.error;if(result.status!==0)throw Error('Diagnostic harness failed: '+result.stdout+'\n'+result.stderr);return result.stdout;}
const imported=JSON.parse(run(process.execPath,'import-reproduction.cjs'));
const metadata=JSON.parse(run(process.execPath,'metadata-reproduction.cjs'));
const ui=run(require(path.join(root,'node_modules/electron')),'ui-reproduction.cjs');
function record(name){const line=ui.split('\n').find(line=>line.startsWith(name+' '));assert.ok(line,'Missing '+name+' diagnostic result');return JSON.parse(line.slice(name.length+1));}
const tags=record('TAGS'),bulk=record('BULK'),repeat=record('SPACE_REPEAT'),mhtml=record('MHTML');
fs.writeFileSync(path.join(__dirname,'evidence','import-results.json'),JSON.stringify(imported,null,2)+'\n');fs.writeFileSync(path.join(__dirname,'evidence','metadata-results.json'),JSON.stringify(metadata,null,2)+'\n');fs.writeFileSync(path.join(__dirname,'evidence','ui-results.log'),ui);
test('P1: managed bytes must match the recorded import hash',()=>assert.equal(imported.recordedHash,imported.actualHash,'Source changed after hashing; the managed copy no longer matches its identity.'));
test('P2: a successful metadata retry must replace an unavailable cached result',()=>assert.equal(metadata.second.artwork,true,'The backend retry succeeded but the renderer still returned its first failure.'));
test('P2: bulk actions must handle a selection allowed by Select All',()=>assert.equal(bulk.error,null,bulk.error));
test('P2: Import files must work after the last Mac window closes',()=>assert.ok(ui.includes('MENU_AFTER_CLOSE no error'),'Import invoked a destroyed BrowserWindow.\n'+ui.slice(ui.indexOf('MENU_AFTER_CLOSE'))));
test('P2: relative embedded MHTML images must resolve against their page location',()=>assert.equal(mhtml['relative-image.mhtml'].images,mhtml['absolute-image.mhtml'].images,'Only the HTML image path changed; the relative version lost its embedded image.'));
test('P2: a held Space key must not repeatedly close and reopen the preview',()=>assert.deepEqual(repeat,[true,true,true]));
test('P3: displayed tags must match normalized database tags',()=>assert.deepEqual(tags.renderer,tags.database));

test('refresh keeps the visible gallery anchor after new imports',()=>assert.ok(record('REFRESH_ANCHOR').error<2,'New files shifted the current viewport.'));
