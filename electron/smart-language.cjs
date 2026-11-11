// The language of a library.
//
// Three questions live here, and they belong together because they are all
// about words: what a file should be called, what words describe what is
// inside it, and how a sentence is read when someone searches for it.
const STOPWORDS=new Set(['a','an','the','of','from','in','on','at','to','for','with','and','or','but','my','our','your','their','its','his','her','this','that','these','those','is','are','was','were','be','been','being','do','does','did','have','has','had','i','me','we','us','you','they','them','he','she','it','as','by','so','if','not','no','yes','all','any','some','there','here','when','where','what','which','who','how','about','into','over','under','up','down','out','off','again','just','very','more','most','less','also','than','then','too','can','will','would','could','should','get','got','make','made','like','want','need']);
const SYNONYMS=[
 ['iphone','iphones','smartphone','smartphones','cellphone','cellular','phone','phones'],
 ['car','cars','automobile','vehicle','vehicles'],
 ['movie','movies','film','films','cinema'],
 ['series','tv','television','show','shows'],
 ['album','albums','song','songs','track','tracks','music','playlist'],
 ['book','books','reading','novel'],
 ['product','products','shopping'],
 ['recipe','recipes','cooking','food'],
 ['grey','gray'],
 ['screenshot','screenshots','screen shot','screen capture','app screenshot'],
 ['dark','dim','moody','low light','night'],
 ['light','bright','airy']];
// Names that say nothing about what is inside the file. These are the ones
// that get a real name once the local analysis has read the picture.
const MEANINGLESS_NAMES=[
 /^image\s*\d*\.?$/i,/^img[\s_-]?\d*\.?$/i,/^photo\s*\d*\.?$/i,/^picture\s*\d*\.?$/i,
 /^pic\s*\d*\.?$/i,/^file\s*\d*\.?$/i,/^untitled(\s*\d*)?$/i,/^unknown(\s*\d*)?$/i,
 /^download(\s*\d*)?$/i,/^temp(\s*\d*)?$/i,/^tmp[\s_-]?\d*$/i,/^scan[\s_-]?\d*$/i,
 /^new[\s_-]?file(\s*\d*)?$/i,/^screenshot(\s*\d+)?$/i,/^screen[\s_-]?shot(\s*\d+)?$/i,
 /^wechat[\s_-]?image.*$/i,/^pxl[\s_-]?\d+$/i,/^dsc[\s_-]?\d+$/i,/^img[\s_-]?\d+$/i,
 /^screenshot\s+\d{4}-\d{2}-\d{2}.*$/i,/^screen[\s_-]?shot.*$/i,/^\d+$/];
function terms(value){return String(value).toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)||[];}
function meaninglessName(name){
 const base=String(name||'').replace(/\.[^.]+$/,'').trim();
 if(!base)return true;
 return MEANINGLESS_NAMES.some(pattern=>pattern.test(base));
}
// A sentence is not a list of keywords. The words that carry the meaning are
// kept and the rest are dropped, so "dark moody screenshots from the app"
// looks for dark, moody, screenshots and app.
function expand(query){
 const words=[...new Set(terms(query))];
 const meaningful=words.filter(term=>!STOPWORDS.has(term));
 return (meaningful.length?meaningful:words).slice(0,40)
  .map(term=>SYNONYMS.find(group=>group.includes(term))||[term]);
}
// Words a picture answers to that are not in its name: how bright it is and
// how colourful it is. "dark moody screenshots" needs these to be findable.
function moodWords(palette){
 const words=[];
 let luminance=0,saturation=0,count=0;
 for(const swatch of palette||[]){
  const hex=String(swatch.hex||'').replace('#','');
  if(hex.length<6)continue;
  const r=parseInt(hex.slice(0,2),16)/255,g=parseInt(hex.slice(2,4),16)/255,b=parseInt(hex.slice(4,6),16)/255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b);
  luminance+=0.2126*r+0.7152*g+0.0722*b;
  saturation+=(max-min)/(max||1);
  count++;
 }
 if(!count)return words;
 const brightness=luminance/count,colour=saturation/count;
 words.push(brightness<0.32?'dark':brightness>0.72?'light':'mid tone');
 words.push(colour<0.18?'muted':colour>0.45?'vivid':'soft colour');
 return words;
}
// The name the file should have: what the text in it says, or what the model
// sees in it, and only then the kind of file and the day it arrived.
function proposedName(asset,text,labels){
 const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 for(const line of lines.slice(0,8)){
  let cleaned=line.replace(/https?:\/\/\S+/g,' ').replace(/[^\p{L}\p{N} ,.'’\-&()/]+/gu,' ').replace(/\s+/g,' ').trim();
  // A cut-off word at the end of a line is not part of the name.
  cleaned=cleaned.replace(/\s\S$/,'').trim();
  const words=cleaned.split(' ').filter(Boolean);
  if(cleaned.length>=3&&words.length<=10&&cleaned.length<=64)return cleaned;
 }
 const day=new Date(asset.imported||Date.now()).toISOString().slice(0,10);
 if(labels&&labels.length){
  const names=labels.map(label=>String(label.label||'').trim()).filter(label=>label&&label.length<=40).slice(0,2);
  if(names.length)return names.join(' · ')+' · '+day;
 }
 const kind={image:'Image',pdf:'Document',video:'Video',audio:'Audio',txt:'Note',md:'Note',csv:'Table'}[asset.ext]||'File';
 return kind+' · '+day;
}
module.exports={expand,moodWords,meaninglessName,proposedName};
