(()=>{
const $=selector=>document.querySelector(selector);
const api=window.library;
let navigate=()=>{},filter='all',feedId=null,unreadOnly=false,feeds=[],selectedId=null,selectedFeedId=null,request=0,refreshing=false,workspaceActive=false,listRequest=0,readerCache=new Map();
const root=$('#rss-workspace');
const escapeURL=(value,base)=>{try{const url=new URL(value,base);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}};
const displayFeedName=value=>{
 const name=String(value||'').trim();
 if(name.length<=48)return name;
 const prefix=name.match(/^(.{2,48}?)\s*[:|]\s+\S/);
 return prefix?prefix[1].trim():name.slice(0,45).trimEnd()+'…';
};
function navItem(label,mark,count,active,handler,iconURL='',contextMenu=null){
 const button=document.createElement('button');button.className=active?'active':'';
 const icon=document.createElement('span');icon.className='rss-nav-mark';icon.setAttribute('aria-hidden','true');
 if(iconURL){
  const image=document.createElement('img');image.className='rss-nav-icon';image.src=iconURL;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';
  image.onerror=()=>{image.hidden=true;icon.classList.add('rss-nav-mark-failed');};
  icon.append(image);
 }else icon.textContent=mark;
 const name=document.createElement('span');name.textContent=label;
 button.append(icon,name);
 if(count){const badge=document.createElement('span');badge.className='badge';badge.textContent=String(count);button.append(badge);}
 button.title=label;button.setAttribute('aria-current',active?'page':'false');button.onclick=handler;
 if(contextMenu)button.addEventListener('contextmenu',event=>{event.preventDefault();contextMenu(event);});
 return button;
}
function openView(nextFilter='all',nextFeed=null){
 filter=nextFilter;feedId=nextFeed;selectedId=null;selectedFeedId=null;
 navigate({filter,feedId});
}
async function renderNav(active=workspaceActive){
 workspaceActive=active;
 const nav=$('#rss-navigation');
 try{
  feeds=await api.rssFeeds();
  if(feedId&&!feeds.some(feed=>feed.id===feedId)){
   filter='all';feedId=null;selectedId=null;selectedFeedId=null;navigate({filter,feedId});$('#rss-reader-pane').replaceChildren(emptyReader());
  }else if(selectedFeedId&&!feeds.some(feed=>feed.id===selectedFeedId)){
   selectedId=null;selectedFeedId=null;$('#rss-reader-pane').replaceChildren(emptyReader());
  }
  const counts=await api.rssSummary();
  const rows=[
   navItem('All Articles','▤',counts.total,workspaceActive&&filter==='all'&&!feedId,()=>openView('all')),
   navItem('Starred','☆',counts.starred,workspaceActive&&filter==='starred',()=>openView('starred')),
   navItem('Today','◷',counts.today,workspaceActive&&filter==='today',()=>openView('today'))
  ];
  const label=document.createElement('div');label.className='rss-sidebar-label';label.textContent='FEEDS';
  const feedRows=feeds.map(feed=>{
   const siteURL=escapeURL(feed.site_url,feed.url);
   const iconURL=siteURL?'asset://rss-image/?url='+encodeURIComponent(new URL('/favicon.ico',siteURL).href):'';
   const button=navItem(displayFeedName(feed.title),'◦',feed.unread_count,workspaceActive&&feedId===feed.id,()=>openView('all',feed.id),iconURL,()=>api.rssFeedContextMenu(feed.id).catch(showError));
   button.title=feed.title;
   return button;
  });
  nav.replaceChildren(...rows,label,...feedRows);
 }catch(error){nav.replaceChildren();$('#rss-list-status').textContent=error.message||String(error);}
}
function dateLabel(value){
 if(!value)return '';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
 const now=new Date();
 if(date.toDateString()===now.toDateString())return date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
 if(date.toDateString()===yesterday.toDateString())return 'Yesterday';
 return date.toLocaleDateString([],{month:'short',day:'numeric'});
}
function timeElement(value){
 const time=document.createElement('time');time.textContent=dateLabel(value);
 if(value&&!Number.isNaN(Date.parse(value)))time.dateTime=new Date(value).toISOString();
 return time;
}
function safeContent(html,baseURL){
 const output=document.createDocumentFragment();
 if(!html)return output;
 const documentParser=new DOMParser().parseFromString('<!doctype html><body>'+html,'text/html');
 const allowed=new Set(['p','h2','h3','h4','blockquote','ul','ol','li','pre','code','strong','b','em','i','s','del','br','hr','figure','figcaption','img','a','table','thead','tbody','tr','th','td','sup','sub','dl','dt','dd']);
 const blocked=new Set(['script','style','form','iframe','object','embed','svg','math','template','video','audio','source','input','button']);
 const copy=(source,parent)=>{
  for(const node of [...source.childNodes]){
   if(node.nodeType===Node.TEXT_NODE){parent.append(document.createTextNode(node.textContent));continue;}
   if(node.nodeType!==Node.ELEMENT_NODE)continue;
   const tag=node.localName;
   if(blocked.has(tag))continue;
   if(!allowed.has(tag)){copy(node,parent);continue;}
   if(tag==='img'){
    const srcset=(node.getAttribute('srcset')||node.getAttribute('data-srcset')||'').split(',')[0].trim().split(/\s+/)[0];
    const url=escapeURL(node.getAttribute('src')||node.getAttribute('data-src')||node.getAttribute('data-lazy-src')||node.getAttribute('data-original')||srcset,baseURL);
    if(!url)continue;
    const image=document.createElement('img');image.src='asset://rss-image/?url='+encodeURIComponent(url);
    image.alt=(node.getAttribute('alt')||'').slice(0,300);image.loading='lazy';image.referrerPolicy='no-referrer';
    image.onerror=()=>image.remove();
    parent.append(image);continue;
   }
   const element=document.createElement(tag);
   if(tag==='a'){
    const url=escapeURL(node.getAttribute('href'),baseURL);
    if(url){element.href='#';element.dataset.sourceUrl=url;element.rel='noreferrer';}
   }
   if(tag==='th'||tag==='td'){
    const colspan=Number(node.getAttribute('colspan'));if(colspan>1&&colspan<=8)element.colSpan=colspan;
   }
   copy(node,element);parent.append(element);
  }
 };
 copy(documentParser.body,output);
 return output;
}
function readableTime(article){
 const section=document.createElement('div');section.className='rss-reader-meta';
 const values=[article.readerByline||article.author,displayFeedName(article.feed_title),dateLabel(article.readerPublishedAt||article.published_at)];
 for(const value of values)if(value){const span=document.createElement('span');span.textContent=value;section.append(span);}
 return section;
}
function renderReader(article){
 const pane=$('#rss-reader-pane');pane.replaceChildren();
 const head=document.createElement('div');head.className='rss-reader-heading';
 const actions=document.createElement('div');actions.className='rss-reader-actions';
 const star=document.createElement('button');star.type='button';star.className='rss-icon-button'+(article.is_starred?' is-starred':'');star.textContent=article.is_starred?'★':'☆';star.title=article.is_starred?'Remove star':'Star article';star.setAttribute('aria-label',star.title);star.setAttribute('aria-pressed',String(!!article.is_starred));
 star.onclick=async()=>{try{await api.rssSetState(article.id,{starred:!article.is_starred});readerCache.delete(article.id);await loadReader(article.id,false);}catch(error){showError(error);}};
 const read=document.createElement('button');read.type='button';read.className='rss-state-button';read.textContent=article.is_read?'Mark unread':'Mark as read';read.onclick=async()=>{try{await api.rssSetState(article.id,{read:!article.is_read});readerCache.delete(article.id);await loadReader(article.id,false);await renderNav();await renderList();}catch(error){showError(error);}};
 actions.append(star,read);head.append(readableTime(article),actions);pane.append(head);
 const title=document.createElement('h1');title.className='rss-reader-title';title.textContent=article.readerTitle||article.title;pane.append(title);
 if(article.readerDescription){const description=document.createElement('p');description.className='rss-reader-description';description.textContent=article.readerDescription;pane.append(description);}
 if(article.readerStatus==='pending'||article.readerStatus==='running'){
  const status=document.createElement('p');status.className='rss-extraction-status';status.setAttribute('role','status');status.textContent=article.automaticExtraction?'Retrieving the full article in the background…':'Automatic extraction is off. The feed content is shown.';pane.append(status);
  if(!article.automaticExtraction&&article.readerStatus==='pending'){
   const retry=document.createElement('button');retry.type='button';retry.className='rss-extraction-action';retry.textContent='Extract this article';
   retry.onclick=async()=>{retry.disabled=true;try{await api.rssRetryExtraction(article.id,false);}catch(error){showError(error);retry.disabled=false;}};pane.append(retry);
  }
 }else if(article.readerStatus==='failed'){
  const status=document.createElement('div');status.className='rss-extraction-status';status.setAttribute('role','status');
  if(article.readerSource!=='paywall'){const message=document.createElement('p');message.textContent=(article.readerError||'The full article could not be retrieved.')+' Showing the content available in the feed.';status.append(message);}
  const retry=document.createElement('button');retry.type='button';retry.className='rss-extraction-action';retry.textContent='Retry extraction';
  retry.onclick=async()=>{retry.disabled=true;try{await api.rssRetryExtraction(article.id,false);}catch(error){showError(error);retry.disabled=false;}};status.append(retry);pane.append(status);
 }else if(article.readerStatus==='complete'){
  const refresh=document.createElement('button');refresh.type='button';refresh.className='rss-extraction-action';refresh.textContent='Refresh extracted article';
  refresh.onclick=async()=>{refresh.disabled=true;try{await api.rssRetryExtraction(article.id,true);}catch(error){showError(error);refresh.disabled=false;}};pane.append(refresh);
 }
 const content=document.createElement('div');content.className='rss-reader-content';content.append(safeContent(article.readerHTML,article.link||article.site_url));
 pane.append(content);
 const sourceURL=escapeURL(article.link,article.site_url);
 if(sourceURL){
  const googleNews=new URL(sourceURL).hostname==='news.google.com'&&/^\/rss\/articles\//.test(new URL(sourceURL).pathname);
  const source=document.createElement('button');source.type='button';source.className='rss-source-link';source.textContent=googleNews?'Open in Google News ↗':'Open at publisher ↗';
  source.onclick=()=>api.rssOpenURL(sourceURL).catch(showError);pane.append(source);
 }
}
function renderArticle(item){
 const button=document.createElement('button');button.type='button';button.className='rss-article'+(selectedId===item.id?' selected':'')+(!item.is_read?' unread':'');button.dataset.articleId=item.id;button.setAttribute('role','option');button.setAttribute('aria-selected',String(selectedId===item.id||!item.is_read));
 const top=document.createElement('div');top.className='rss-article-top';
 const dot=document.createElement('span');dot.className='rss-unread-mark';dot.setAttribute('aria-hidden','true');top.append(dot);
 const feed=document.createElement('span');feed.className='rss-article-feed';feed.textContent=displayFeedName(item.feed_title);feed.title=item.feed_title;top.append(feed,timeElement(item.published_at||item.first_seen));
 const title=document.createElement('strong');title.className='rss-article-title';title.textContent=item.title;
 const summary=document.createElement('span');summary.className='rss-article-summary';summary.textContent=item.summary||item.author||'';
 button.append(top,title,summary);
 const thumbnail=escapeURL(item.image_url,item.link||item.site_url);
 if(thumbnail){
  const image=document.createElement('img');image.className='rss-article-image';image.src='asset://rss-image/?url='+encodeURIComponent(thumbnail);
  image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';image.onerror=()=>image.remove();button.prepend(image);
 }
 button.onclick=()=>{selectedFeedId=item.feed_id;loadReader(item.id,true);};
 return button;
}
function showError(error){$('#rss-list-status').textContent=error?.message||String(error);}
async function removeSubscription(id){
 const feed=feeds.find(item=>item.id===id);if(!feed||!confirm('Unsubscribe from “'+feed.title+'”? Its articles will be removed from this library.'))return;
 try{await api.rssRemoveFeed(id);await renderNav();await renderList();}catch(error){showError(error);}
}
async function renderList(){
 if(!root||root.hidden)return;
 const generation=++listRequest,requestedFilter=filter,requestedFeed=feedId,requestedUnread=unreadOnly;
 const list=$('#rss-articles'),status=$('#rss-list-status');
 status.textContent='';
 let title=filter==='starred'?'Starred':filter==='today'?'Today':'All Articles';
 if(feedId){const feed=feeds.find(item=>item.id===feedId);if(feed)title=displayFeedName(feed.title);}
 $('#rss-list-title').textContent=title;
 $('#rss-list-subtitle').textContent=feedId?(feeds.find(item=>item.id===feedId)?.source_kind==='site'?'Reader-only site':'Subscription'):'';
 const remove=$('#rss-remove-feed');
 if(remove)remove.remove();
 if(feedId){
  const button=document.createElement('button');button.id='rss-remove-feed';button.type='button';button.className='rss-unsubscribe';button.textContent='Unsubscribe';
  button.onclick=()=>removeSubscription(feedId);
  $('#rss-list-subtitle').append(' ',button);
 }
 document.querySelectorAll('[data-rss-unread]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.rssUnread===''?unreadOnly:!unreadOnly)));
 try{
  const articles=await api.rssArticles({filter:requestedFilter,feedId:requestedFeed,unreadOnly:requestedUnread});
  if(generation!==listRequest||requestedFilter!==filter||requestedFeed!==feedId||requestedUnread!==unreadOnly)return;
  list.replaceChildren(...articles.map(renderArticle));
  if(!articles.length){
   const empty=document.createElement('div');empty.className='rss-list-empty';
   if(!feeds.length){empty.append(document.createTextNode('Add a feed to start reading. '));const add=document.createElement('button');add.type='button';add.textContent='Add feed';add.onclick=openFeedDialog;empty.append(add);}
   else empty.textContent=unreadOnly?'No unread articles.':'No articles here yet.';
   list.append(empty);
  }
  const failedFeed=feeds.find(feed=>feed.id===feedId&&feed.last_error);
  const errorFeeds=feeds.filter(feed=>feed.last_error);
  if(failedFeed)status.textContent=failedFeed.last_error;
  else if(errorFeeds.length)status.textContent=errorFeeds.length+' feed'+(errorFeeds.length===1?'':'s')+' could not refresh. Open the subscription in the sidebar for details.';
  if(selectedId&&!articles.some(article=>article.id===selectedId))selectedId=null;
 }catch(error){showError(error);}
}
function emptyReader(){
 const empty=document.createElement('div');empty.className='rss-reader-empty';
 const mark=document.createElement('span');mark.setAttribute('aria-hidden','true');mark.textContent='↗';
 const title=document.createElement('h2');title.textContent='Choose an article';
 const note=document.createElement('p');note.textContent='Your subscribed feeds stay in this library.';
 empty.append(mark,title,note);return empty;
}
async function loadReader(id,markRead){
 const same=selectedId===id&&readerCache.has(id);selectedId=id;const token=++request;
 try{
  let article=readerCache.get(id);
  if(!article){article=await api.rssRead(id);if(token!==request)return;readerCache.set(id,article);}
  selectedFeedId=article.feed_id;
  if(markRead&&!article.is_read){
   const state=await api.rssSetState(id,{read:true});if(token!==request)return;
   article={...article,is_read:state.is_read??1};readerCache.set(id,article);
  }
  renderReader(article);
  if(markRead&&!same){await renderNav();if(unreadOnly)await renderList();else markReadInList(id);}
 }catch(error){if(token===request)showError(error);}
}
function markReadInList(id){
 const button=$('#rss-articles [data-article-id="'+id+'"]');if(!button)return;
 button.classList.remove('unread');button.setAttribute('aria-selected',String(selectedId===id));
}
async function refresh(){
 if(refreshing)return;
 refreshing=true;const button=$('#rss-refresh');button.disabled=true;button.classList.add('spinning');$('#rss-list-status').textContent='Refreshing feeds…';
 try{
  const results=await api.rssRefresh();await renderNav();await renderList();
  const failures=results.filter(item=>!item.ok);
  if(failures.length)$('#rss-list-status').textContent=failures.length+' of '+results.length+' feeds could not be refreshed.';
  else $('#rss-list-status').textContent=results.length?'Feeds are up to date.':'Add a feed to start reading.';
 }catch(error){showError(error);}
 finally{refreshing=false;button.disabled=false;button.classList.remove('spinning');}
}
function openFeedDialog(){
 const dialog=$('#rss-feed-dialog');$('#rss-feed-error').textContent='';$('#rss-feed-url').value='';dialog.showModal();$('#rss-feed-url').focus();
}
function init(options={}){
 navigate=options.navigate||navigate;
 $('#rss-add-feed').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openFeedDialog();});
 $('#rss-feed-cancel').onclick=()=>$('#rss-feed-dialog').close();
 $('#rss-feed-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#rss-feed-submit'),error=$('#rss-feed-error');button.disabled=true;button.textContent='Finding articles…';error.textContent='';
  try{const feed=await api.rssAddFeed($('#rss-feed-url').value.trim());$('#rss-feed-dialog').close();await renderNav();openView('all',feed.id);}
  catch(reason){error.textContent=reason.message||String(reason);}
  finally{button.disabled=false;button.textContent='Find feed or articles';}
 });
 $('#rss-refresh').onclick=refresh;
 $('#rss-articles').addEventListener('keydown',event=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  const rows=[...$('#rss-articles').querySelectorAll('[role="option"]')];if(!rows.length){$('#rss-list-status').textContent='No articles to navigate.';return;}
  event.preventDefault();event.stopPropagation();
  const index=rows.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?rows.length-1:
   Math.max(0,Math.min(rows.length-1,(index<0?0:index)+(event.key==='ArrowDown'?1:-1)));
  rows[next].focus();rows[next].click();
 });
 $('#rss-reader-pane').addEventListener('click',event=>{
  const link=event.target.closest('a[data-source-url]');if(!link)return;
  event.preventDefault();api.rssOpenURL(link.dataset.sourceUrl).catch(showError);
 });
 document.querySelectorAll('[data-rss-unread]').forEach(button=>button.onclick=()=>{unreadOnly=button.dataset.rssUnread==='';renderList();});
 api.onRSSUnsubscribeRequested(id=>removeSubscription(id));
 api.onRSSChanged(async()=>{readerCache.clear();await renderNav();if(!root.hidden){await renderList();if(selectedId)loadReader(selectedId,false);}});
}
function show(active){
 workspaceActive=active;root.hidden=!active;document.body.classList.toggle('rss-active',active);
 if(active){renderNav();renderList();}
}
window.RSSReader={init,show,renderNav,refresh};
})();
