const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),{spawn,execFile}=require('node:child_process'),{pipeline}=require('node:stream/promises'),{Readable}=require('node:stream');

const YTDLP='yt-dlp_macos';
const YTDLP_URL='https://github.com/yt-dlp/yt-dlp/releases/latest/download/'+YTDLP;
// Static arm64 macOS build; gzipped to keep the on-demand download smaller.
const FFMPEG_URL='https://github.com/eugeneware/ffmpeg-static/releases/download/ffmpeg-darwin-arm64.gz';

function canRun(bin,args=['-version']){
  try{require('node:child_process').execFileSync(bin,args,{stdio:'ignore',timeout:3000});return true;}catch{return false;}
}
function findSystemFFmpeg(){
  const dirs=['', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  for(const dir of dirs){
    const bin=dir?path.join(dir,'ffmpeg'):'ffmpeg';
    if(canRun(bin,['-version'])) return bin;
  }
  return null;
}
function findJSRuntime(){
  const runtimes=[['node',['node']],['deno',['deno']],['bun',['bun']],['quickjs',['qjs','quickjs']]];
  const dirs=['', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  for(const [name,bins] of runtimes){
    for(const b of bins){
      for(const dir of dirs){
        const bin=dir?path.join(dir,b):b;
        if(canRun(bin,['--version'])) return name+(dir?':'+bin:'');
      }
    }
  }
  return null;
}

function hostname(value){
  try{return new URL(value).hostname.toLowerCase();}catch{return '';}
}
function isYouTube(value){
  const h=hostname(value); return /(^|\.)youtube\.com$/i.test(h)||h==='youtu.be';
}
function youTubeWatchURL(value){
  try{
    const u=new URL(value);
    if(u.hostname==='youtu.be'){const id=u.pathname.slice(1).split('/')[0]; return id?'https://www.youtube.com/watch?v='+id:'';}
    if(!/(^|\.)youtube\.com$/i.test(u.hostname)) return '';
    if(u.pathname==='/watch'&&u.searchParams.get('v')){return 'https://www.youtube.com/watch?v='+u.searchParams.get('v');}
    const m=u.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/); if(m) return 'https://www.youtube.com/watch?v='+m[2];
    return '';
  }catch{return '';}
}
function isReddit(value){
  const h=hostname(value); return /(^|\.)reddit\.com$/i.test(h)||h==='v.redd.it'||h==='redd.it';
}
function redditURL(value){
  try{
    const u=new URL(value);
    if(u.hostname==='v.redd.it'||u.hostname==='redd.it') return u.href;
    if(!/(^|\.)reddit\.com$/i.test(u.hostname)) return '';
    // prefer the post/comments permalink; yt-dlp resolves it to best A/V
    if(/\/comments\/[a-z0-9]+/i.test(u.pathname)){u.hash='';u.search='';return u.href;}
    return u.href;
  }catch{return '';}
}
function isFacebook(value){
  const h=hostname(value); return /(^|\.)facebook\.com$/i.test(h)||h==='fb.watch'||h==='fb.com'||/(^|\.)fb\.com$/i.test(h);
}
function facebookURL(value){
  try{
    const u=new URL(value);
    const h=u.hostname.toLowerCase();
    if(h==='fb.watch') return u.href;
    if(!/(^|\.)facebook\.com$/i.test(h)&&h!=='fb.com'&&!/(^|\.)fb\.com$/i.test(h)) return '';
    u.hash=''; return u.href;
  }catch{return '';}
}
function extractableVideoURL(value){
  return youTubeWatchURL(value)||redditURL(value)||facebookURL(value)||'';
}
function isExtractableVideo(value){
  return !!extractableVideoURL(value);
}

class YtDlp {
  constructor({root,fetcher}={}){
    this.root=root; this.fetcher=fetcher||globalThis.fetch;
    this.dir=path.join(root||require('node:os').tmpdir(),'tools');
    this.bin=path.join(this.dir,'yt-dlp');
    this.ffmpeg=path.join(this.dir,'ffmpeg');
    this.installing=null; this.installingFFmpeg=null;
    this.jsRuntime=findJSRuntime();
  }
  async ensure(signal){
    try{await fs.promises.access(this.bin,fs.constants.X_OK);return this.bin;}catch{}
    if(this.installing) return this.installing;
    this.installing=(async()=>{
      await fs.promises.mkdir(this.dir,{recursive:true});
      const tmp=this.bin+'.tmp-'+process.pid;
      const res=await this.fetcher(YTDLP_URL,{redirect:'follow',signal});
      if(!res.ok||!res.body) throw new Error('Could not download yt-dlp ('+res.status+').');
      await pipeline(Readable.fromWeb(res.body),fs.createWriteStream(tmp,{mode:0o755}),{signal});
      await fs.promises.chmod(tmp,0o755);
      await fs.promises.rename(tmp,this.bin);
      return this.bin;
    })().finally(()=>{this.installing=null;});
    return this.installing;
  }
  async ensureFFmpeg(signal){
    const system=findSystemFFmpeg();
    if(system) return system;
    try{
      await fs.promises.access(this.ffmpeg,fs.constants.X_OK);
      if(canRun(this.ffmpeg,['-version'])) return this.ffmpeg;
      await fs.promises.unlink(this.ffmpeg).catch(()=>{});
    }catch{}
    if(this.installingFFmpeg) return this.installingFFmpeg;
    this.installingFFmpeg=(async()=>{
      await fs.promises.mkdir(this.dir,{recursive:true});
      const tmp=this.ffmpeg+'.tmp-'+process.pid;
      const res=await this.fetcher(FFMPEG_URL,{redirect:'follow',signal});
      if(!res.ok||!res.body) throw new Error('Could not download ffmpeg ('+res.status+').');
      await pipeline(Readable.fromWeb(res.body), zlib.createGunzip(), fs.createWriteStream(tmp,{mode:0o755}),{signal});
      await fs.promises.chmod(tmp,0o755);
      await fs.promises.rename(tmp,this.ffmpeg);
      return this.ffmpeg;
    })().finally(()=>{this.installingFFmpeg=null;});
    return this.installingFFmpeg;
  }
  async download(url,outputDir,{signal,onProgress,title}={}){
    const bin=await this.ensure(signal);
    await fs.promises.mkdir(outputDir,{recursive:true});
    let ffmpeg=null;
    try{ ffmpeg=await this.ensureFFmpeg(signal); }catch{ ffmpeg=findSystemFFmpeg(); }
    const isYT=isYouTube(url);
    const base=['--no-playlist','--no-warnings','--newline','--no-colors',
      '--restrict-filenames','--windows-filenames',
      '--concurrent-fragments','4',
      '--print','after_move:filepath',
      '-P',outputDir];
    if(isYT) base.splice(6,0,'--extractor-args','youtube:player_client=visionos,default');
    if(this.jsRuntime) base.push('--js-runtimes', this.jsRuntime);
    if(ffmpeg) base.push('--ffmpeg-location', ffmpeg);
    // Best quality available, always MP4: prefer H.264 (avc1) video + AAC audio merged to MP4
    // for maximum quality with broad compatibility. Falls back to best available if needed.
    const attempts=ffmpeg
      ? [['-f','bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]/bv*[vcodec^=avc1]+ba[acodec^=mp4a]/bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b','--merge-output-format','mp4','-o','%(title).200B [%(id)s].%(ext)s'],
         ['-f','b[ext=mp4]/bv*+ba/best','-o','%(title).200B [%(id)s].%(ext)s']]
      : [['-f','b[ext=mp4]/b/bv*+ba/best','-o','%(title).200B [%(id)s].%(ext)s'],
         ['-f','best','-o','%(title).200B [%(id)s].%(ext)s']];
    let lastErr;
    for(const fmt of attempts){
      try{
        const file=await this.run(bin,[...base,...fmt,url],{signal,onProgress,title});
        if(file&&fs.existsSync(file)) return file;
      }catch(e){lastErr=e; if(signal?.aborted) throw e;}
    }
    throw lastErr||new Error('yt-dlp could not download this video.');
  }
  run(bin,args,{signal,onProgress,title}={}){
    return new Promise((resolve,reject)=>{
      const child=spawn(bin,args,{stdio:['ignore','pipe','pipe']});
      let out='',err='',file='';
      const kill=()=>{try{child.kill('SIGKILL');}catch{}};
      if(signal){ if(signal.aborted) kill(); else signal.addEventListener('abort',kill,{once:true}); }
      child.stdout.on('data',d=>{
        const text=String(d); out+=text;
        for(const line of text.split(/\r?\n/)){
          if(!line) continue;
          if(line.startsWith('/') || /^[A-Za-z]:\\/.test(line)) file=line.trim();
          const m=line.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+\s*\w+)(?:\s+at\s+([\d.]+\s*\w+\/s))?/i);
          if(m&&onProgress) onProgress({phase:'downloading',title:title||'Video',percent:parseFloat(m[1]),totalText:m[2],speedText:m[3]||''});
          if(/merger|extractaudio|fixup/i.test(line)&&onProgress) onProgress({phase:'importing',title:title||'Video'});
        }
      });
      child.stderr.on('data',d=>{err+=String(d);});
      child.on('error',e=>reject(new Error('yt-dlp could not run: '+e.message)));
      child.on('close',code=>{
        if(signal) signal.removeEventListener('abort',kill);
        if(signal?.aborted) return reject(Object.assign(new Error('Aborted'),{name:'AbortError'}));
        const printed=out.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).reverse().find(s=>s.startsWith('/')||/^[A-Za-z]:\\/.test(s));
        const chosen=printed||file;
        if(code===0 && chosen) return resolve(chosen);
        reject(new Error(this.friendlyError(err||out||('yt-dlp exited with code '+code))));
      });
    });
  }
  friendlyError(text){
    const t=String(text||'');
    if(/Sign in|login|cookies|private|members-only/i.test(t)) return 'This video requires sign-in or is not publicly accessible.';
    if(/Requested format is not available/i.test(t) && /No supported JavaScript runtime|JavaScript runtime/i.test(t)) return 'YouTube download needs a JavaScript runtime (Node.js). Install Node.js and try again.';
    if(/not available|unavailable|removed|deleted/i.test(t)) return 'This video is unavailable.';
    if(/Unsupported URL|No video formats|Requested format is not available/i.test(t)) return 'This page does not contain a downloadable video in a supported format.';
    if(/ffmpeg|merg/i.test(t)&&/not found|No such file/i.test(t)) return 'A required media tool was not found to merge the highest-quality streams.';
    return t.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(-2).join(' ')||'Could not download this video.';
  }
}

module.exports={YtDlp,isYouTube,youTubeWatchURL,isReddit,redditURL,isFacebook,facebookURL,extractableVideoURL,isExtractableVideo};
