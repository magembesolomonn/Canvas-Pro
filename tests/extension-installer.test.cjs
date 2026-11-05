const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {installExtension}=require('../scripts/install-extension-bridge.cjs');
test('portable extension setup registers native host in a fresh account without Node or repository paths',()=>{const root=fs.mkdtempSync('/private/tmp/canvas-extension-setup-');try{const appPath=path.join(root,"Apps with spaces/Canvas Pro's.app"),source=path.join(__dirname,'../chrome-extension'),runtime=path.join(appPath,'Contents/MacOS/Electron'),hostScript=path.join(appPath,'Contents/Resources/app/electron/native-host.cjs');for(const p of [runtime,hostScript]){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'fixture');}const homeDirectory=path.join(root,'Fresh Account'),result=installExtension({appPath,extensionSource:source,homeDirectory,applicationsDirectory:path.join(root,'Apps')});assert.equal(result.id,'lgcmnmpcbfdjmhjkejjkbimaiipobfkn');assert.equal(result.installed.length,2);assert.ok(fs.existsSync(path.join(result.extension,'worker.js')));const host=JSON.parse(fs.readFileSync(path.join(result.installed[0],'com.canvaspro.capture.json')));assert.deepEqual(host.allowed_origins,['chrome-extension://'+result.id+'/']);const launcher=fs.readFileSync(host.path,'utf8');assert.ok(launcher.includes('ELECTRON_RUN_AS_NODE=1'));assert.ok(launcher.includes("Canvas Pro'\\''s.app"));assert.ok(!launcher.includes('/Users/solomon/Documents/eagle'));assert.equal(fs.statSync(host.path).mode&0o777,0o755);const repeat=installExtension({appPath,extensionSource:source,homeDirectory,applicationsDirectory:path.join(root,'Apps')});assert.equal(repeat.id,result.id);}finally{fs.rmSync(root,{recursive:true,force:true});}});

test('native host finds the Applications copy after the app is moved', () => {
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync('/private/tmp/canvas-extension-move-');
  try {
    const appPath = path.join(root, 'Temporary Canvas Pro.app');
    const applicationsDirectory = path.join(root, 'Applications');
    const runtime = path.join(appPath, 'Contents/MacOS/Electron');
    const hostScript = path.join(appPath, 'Contents/Resources/app/electron/native-host.cjs');
    fs.mkdirSync(path.dirname(runtime), { recursive: true });
    fs.mkdirSync(path.dirname(hostScript), { recursive: true });
    fs.mkdirSync(applicationsDirectory);
    fs.writeFileSync(runtime, '#!/bin/sh\nprintf "%s" "$CANVAS_APP_PATH"\n', { mode: 0o755 });
    fs.writeFileSync(hostScript, '');
    const result = installExtension({ appPath, applicationsDirectory, homeDirectory: root });
    const manifest = JSON.parse(fs.readFileSync(path.join(result.installed[0], 'com.canvaspro.capture.json')));
    const installed = path.join(applicationsDirectory, 'Canvas Pro.app');
    fs.renameSync(appPath, installed);
    assert.equal(execFileSync(manifest.path, { encoding: 'utf8' }), installed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
