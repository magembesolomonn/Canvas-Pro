const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function writeIfChanged(file,data,mode=0o644){
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
  try{
    if(fs.readFileSync(file).equals(bytes)&&(fs.statSync(file).mode&0o777)===mode)return;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{
    fs.writeFileSync(temporary,bytes,{mode,flag:'wx'});
    fs.chmodSync(temporary,mode);
    fs.renameSync(temporary,file);
  }finally{fs.rmSync(temporary,{force:true});}
}
function syncExtension(source,target){
  fs.mkdirSync(target,{recursive:true});
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
    if(entry.name.startsWith('.'))continue;
    const from=path.join(source,entry.name),to=path.join(target,entry.name);
    if(entry.isDirectory())syncExtension(from,to);
    else if(entry.isFile())writeIfChanged(to,fs.readFileSync(from));
  }
}
function installExtension({ appPath = '/Applications/Canvas Pro.app', extensionSource = path.join(__dirname, '../chrome-extension'), homeDirectory = os.homedir(), applicationsDirectory = '/Applications' } = {}) {
  appPath = path.resolve(appPath);
  const runtime = path.join(appPath, 'Contents/MacOS/Electron');
  const hostScript = path.join(appPath, 'Contents/Resources/app/electron/native-host.cjs');
  if (!fs.existsSync(runtime) || !fs.existsSync(hostScript)) throw new Error('Install Canvas Pro in Applications first, then run this installer again.');
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionSource, 'manifest.json'), 'utf8'));
  const publicKey = Buffer.from(manifest.key, 'base64');
  const id = [...crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16).toString('hex')].map(n => String.fromCharCode(97 + parseInt(n, 16))).join('');
  const support = path.join(homeDirectory, 'Library/Application Support/Canvas Pro');
  const bridge = path.join(support, 'Bridge');
  const extension = path.join(support, 'Browser Extension');
  fs.mkdirSync(bridge, { recursive: true, mode: 0o700 });
  if(path.resolve(extensionSource)!==extension)syncExtension(extensionSource,extension);
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const launcher = path.join(bridge, 'canvas-pro-host');
  const installedApp = path.join(applicationsDirectory, 'Canvas Pro.app');
  writeIfChanged(launcher, '#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\n' +
    'app=' + quote(appPath) + '\n' +
    'if [ ! -x "$app/Contents/MacOS/Electron" ] || [ ! -f "$app/Contents/Resources/app/electron/native-host.cjs" ]; then\n' +
    '  app=' + quote(installedApp) + '\nfi\n' +
    'export CANVAS_APP_PATH="$app"\n' +
    'exec "$app/Contents/MacOS/Electron" "$app/Contents/Resources/app/electron/native-host.cjs" "$@"\n', 0o755);
  const host = { name: 'com.canvaspro.capture', description: 'Canvas Pro local capture bridge', path: launcher, type: 'stdio', allowed_origins: ['chrome-extension://' + id + '/'] };
  // Registration can precede Chrome installation. No browser preferences are edited.
  const directories = ['Google/Chrome', 'net.imput.helium'].map(browser =>
    path.join(homeDirectory, 'Library/Application Support', browser, 'NativeMessagingHosts'));
  const installed = [], failures = [];
  for (const directory of directories) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      writeIfChanged(path.join(directory, host.name + '.json'), JSON.stringify(host, null, 2) + '\n');
      installed.push(directory);
    } catch (error) { failures.push(directory + ': ' + error.message); }
  }
  if (!installed.length) throw new Error('The browser connection could not be registered. ' + failures.join('\n'));
  return { installed, failures, extension, id };
}

function runInstaller(){
  try {
    const result = installExtension({ appPath: process.argv[2] || undefined, extensionSource: process.argv[3] || undefined });
    console.log('Browser connection installed.\nExtension folder: ' + result.extension + '\nExtension ID: ' + result.id + '\nIn Chrome: chrome://extensions → Developer mode → Load unpacked → select the extension folder above.');
    if (result.failures.length) console.warn(result.failures.join('\n'));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
if(require.main===module)runInstaller();
module.exports={installExtension,runInstaller};
