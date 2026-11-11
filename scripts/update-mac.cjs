const fs=require('node:fs');const path=require('node:path');const{execFileSync}=require('node:child_process');
if(process.platform!=='darwin')throw new Error('Run on macOS.');
const root=path.resolve(__dirname,'..');let bundle=path.resolve(process.argv[2]||(fs.existsSync('/Applications/Canvas Pro.app')?'/Applications/Canvas Pro.app':fs.existsSync('/Applications/Asset Library.app')?'/Applications/Asset Library.app':path.join(root,'dist/Asset Library.app')));
const contents=path.join(bundle,'Contents');if(!fs.existsSync(path.join(contents,'Resources/app/package.json')))throw new Error('Asset Library.app was not found.');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));delete pkg.scripts;delete pkg.devDependencies;
const stamp=new Date().toISOString().replaceAll(':','-');const backup=path.join(root,'.updates',stamp);fs.mkdirSync(backup,{recursive:true});
const resources=path.join(contents,'Resources'),current=path.join(resources,'app'),staged=path.join(resources,'app-update-'+stamp);fs.mkdirSync(staged);
for(const entry of ['electron','src','bin','chrome-extension'])fs.cpSync(path.join(root,entry),path.join(staged,entry),{recursive:true});
fs.writeFileSync(path.join(staged,'package.json'),JSON.stringify(pkg,null,2));
for(const helper of ['media-tool','analysis-tool']) execFileSync('/usr/bin/codesign',['--force','--sign','-',path.join(staged,'bin',helper)]);
fs.copyFileSync(path.join(contents,'Info.plist'),path.join(backup,'Info.plist'));fs.cpSync(path.join(contents,'_CodeSignature'),path.join(backup,'_CodeSignature'),{recursive:true});
const priorIcon=path.join(resources,'AssetLibrary.icns'),hadIcon=fs.existsSync(priorIcon);if(hadIcon)fs.copyFileSync(priorIcon,path.join(backup,'AssetLibrary.icns'));
fs.renameSync(current,path.join(backup,'app'));fs.renameSync(staged,current);
try{
for(const key of ['CFBundleName','CFBundleDisplayName'])execFileSync('/usr/libexec/PlistBuddy',['-c','Set :'+key+' Canvas Pro',path.join(contents,'Info.plist')]);
fs.copyFileSync(path.join(root,'assets/AssetLibrary.icns'),path.join(resources,'AssetLibrary.icns'));
execFileSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIconFile AssetLibrary.icns',path.join(contents,'Info.plist')]);
execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :CFBundleShortVersionString ${pkg.version}`,path.join(contents,'Info.plist')]);
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',bundle],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'inherit'});
}catch(e){if(hadIcon)fs.copyFileSync(path.join(backup,'AssetLibrary.icns'),priorIcon);else fs.rmSync(priorIcon,{force:true});fs.renameSync(current,path.join(backup,'failed-update'));fs.renameSync(path.join(backup,'app'),current);fs.copyFileSync(path.join(backup,'Info.plist'),path.join(contents,'Info.plist'));fs.cpSync(path.join(backup,'_CodeSignature'),path.join(contents,'_CodeSignature'),{recursive:true});throw e;}
const renamed=path.join(path.dirname(bundle),'Canvas Pro.app');if(renamed!==bundle){if(fs.existsSync(renamed))throw new Error('Canvas Pro.app already exists; updated app remains at '+bundle);fs.renameSync(bundle,renamed);bundle=renamed;}
if(bundle.startsWith('/Applications/'))execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',bundle]);
console.log('Updated '+bundle+'\nPrevious app code: '+backup+'\nQuit and reopen the app to load the update. The library was not changed.');
