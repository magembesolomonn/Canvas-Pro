const NoteTrackers = (() => {
  const fieldTypes = ['text','number','money','date','url','file','canvas'];
  const layouts = [['table','Table'],['gallery','Gallery'],['board','Board']];
  const newView = (name, layout) => ({name,layout,query:'',status:'',sort:'recent',month:''});
  const btn = (label, click) => {
    const button = el('button','',label);
    button.type = 'button';
    button.onclick = click;
    return button;
  };
  function selectField(label, options, value) {
    const input = el('select');
    input.setAttribute('aria-label',label);
    for (const [key,name] of options) input.add(new Option(name,key));
    input.value = value;
    return input;
  }
  function field(label, type, value = '') {
    const input = el('input');
    input.type = type;
    input.value = value;
    input.setAttribute('aria-label',label);
    input.placeholder = label;
    return input;
  }
  function modal(title, className = '') {
    const dialog = el('dialog','note-tracker-dialog '+className);
    dialog.setAttribute('aria-label',title);
    dialog.append(el('h2','',title));
    document.body.append(dialog);
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    return dialog;
  }
  function pickReference({notes, kinds = ['note','file','canvas']}) {
    const dialog = modal('Link a page or library item');
    const names = {note:'Notes',file:'Library files',canvas:'Canvases'};
    const kind = selectField('Link type',kinds.map(key=>[key,names[key]]),kinds[0]);
    const search = field('Find an item','search'), results = el('div','tracker-reference-results');
    const more = btn('Load more',()=>load(true)), cancel = btn('Cancel',()=>dialog.close());
    let selected, request = 0, timer, offset = 0;
    async function load(append = false) {
      const version = ++request, type = kind.value, query = search.value.trim();
      more.hidden = true;
      if (!append) { offset = 0; results.replaceChildren(); }
      try {
        const page = type === 'file' ? await api.libraryPage({query,offset,limit:48}) : null;
        if (!dialog.open || version !== request) return;
        const entries = page ? page.assets : (type === 'note' ? notes : CanvasWorkspace.boards)
          .filter(item=>(item.title||item.name).toLowerCase().includes(query.toLowerCase()));
        for (const item of entries) {
          const label = (item.title||item.name||'Untitled').slice(0,300);
          results.append(btn(label,()=>{ selected = {kind:type,id:item.id,label}; dialog.close(); }));
        }
        offset += entries.length;
        more.hidden = !page || offset >= page.total;
        if (!offset) results.append(el('p','hint','No matches.'));
      } catch (error) { if (dialog.open && version === request) results.textContent = error.message; }
    }
    kind.onchange = () => load();
    search.oninput = () => { request++; clearTimeout(timer); results.replaceChildren(); more.hidden = true; timer = setTimeout(load,150); };
    dialog.append(kind,search,results,more,cancel);
    return new Promise(resolve=>{
      dialog.addEventListener('close',()=>{ clearTimeout(timer); resolve(selected); },{once:true});
      dialog.showModal();
      load();
    });
  }
  function isVideoThumbnail(block, field) {
    return block.preset === 'videos' && field.type === 'file' && field.key === 'f1';
  }
  function isMoviePoster(block, field) {
    return block.preset === 'movies' && field.type === 'file' && field.key === 'f7';
  }
  function movieProperties(info) {
    return {f0:info.type,f1:info.year,f2:info.genre,f6:info.url,
      f7:info.cover ? {id:info.id,label:info.title||'Saved bookmark',bookmarkCover:true} : undefined};
  }
  function thumbnail(attachment) {
    const image = el('img','tracker-thumbnail');
    image.src = 'asset://'+(attachment.bookmarkCover?'link-cover':'thumb')+'/'+attachment.id;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.onerror = () => image.remove();
    return image;
  }
  function editRecord(block, record, persist, remove) {
    const dialog = modal(record.id?'Edit record':'New record','tracker-record-panel');
    const form = el('form'), feedback = el('p','dialog-error');
    feedback.setAttribute('role','status');
    const title = field('Title','text',record.title);
    title.required = true;
    title.maxLength = 200;
    const status = selectField('Status',block.statuses.map(value=>[value,value]),record.status || block.statuses[0]);
    const properties = {...record.properties};
    function labeled(label, control) {
      const line = el('div','tracker-property');
      line.append(el('span','',label),control);
      form.append(line);
    }
    labeled('Title',title);
    if (block.statuses.length) labeled('Status',status);
    const inputs = new Map();
    let updatePoster;
    for (const property of block.fields) {
      const {key,label,type} = property;
      if (type === 'file' || type === 'canvas') {
        const group = el('div','tracker-tools');
        const poster = isMoviePoster(block,property);
        const visual = poster || isVideoThumbnail(block, property);
        const pick = btn('',async()=>{
          const chosen = visual ? await NotesWorkspace.pickThumbnail(poster?'Choose a poster':undefined) : await pickReference({kinds:[type]});
          if (!chosen) return;
          properties[key] = {id:chosen.id,label:chosen.label || chosen.name};
          showChoice();
        });
        function showChoice() {
          const attachment = properties[key];
          pick.replaceChildren();
          if (visual && attachment) pick.append(thumbnail(attachment));
          pick.append(el('span','',attachment?.label || (poster ? 'Choose poster…' : visual ? 'Choose thumbnail…' : 'Choose…')));
        }
        if (visual) pick.classList.add('tracker-thumbnail-choice');
        if (poster) updatePoster = showChoice;
        showChoice();
        group.append(pick,btn('Open',()=>{ if (properties[key]) safe(()=>type==='file'?api.openFile(properties[key].id):CanvasWorkspace.open(properties[key].id)); }),
          btn('Clear',()=>{ delete properties[key]; showChoice(); }));
        labeled(label,group);
      } else {
        const stored = properties[key];
        const value = type === 'money' && stored != null ? stored/100 : stored ?? '';
        const input = field(label,type==='money'?'number':type,value);
        if (type === 'money' || type === 'number') input.step = type==='money'?'0.01':'any';
        input.maxLength = 2000;
        inputs.set(key,input);
        labeled(label,input);
      }
    }
    const source = block.preset==='movies' ? inputs.get('f6') : null;
    let lookup = 0;
    if (source) {
      const sourceStatus = el('p','hint');
      sourceStatus.setAttribute('role','status');
      const fetchPoster = btn('Fetch title and poster',async()=>{
        if (!source.value.trim() || !source.checkValidity()) { source.focus(); return; }
        const version = ++lookup, url = source.value.trim(), previous = properties.f7;
        save.disabled = true;
        sourceStatus.textContent = 'Looking for the title and poster…';
        try {
          const info = await api.noteMovieLink(url);
          if (!dialog.open || lookup!==version || source.value.trim()!==url) return;
          const values = movieProperties(info);
          if (!title.value.trim() && info.title) title.value = info.title;
          for (const key of ['f0','f1','f2']) {
            const input = inputs.get(key);
            if (input && !input.value && values[key]!=null) input.value = values[key];
          }
          if (values.f7 && updatePoster && properties.f7===previous) {
            properties.f7 = values.f7;
            updatePoster();
          }
          sourceStatus.textContent = info.cover?'Poster found. Save the record to keep it.':'No poster found. You can choose one yourself.';
        } catch (error) {
          if (dialog.open && lookup===version && source.value.trim()===url)
            sourceStatus.textContent = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        } finally {
          if (lookup===version) save.disabled = false;
        }
      });
      source.oninput = () => { lookup++; save.disabled = false; sourceStatus.textContent = ''; };
      source.onpaste = event => {
        const url = URL.parse(event.clipboardData?.getData('text').trim() || '');
        if (url && /^https?:$/.test(url.protocol) && /(^|\.)(imdb\.com|letterboxd\.com|rottentomatoes\.com|themoviedb\.org)$/i.test(url.hostname))
          setTimeout(()=>{if(dialog.open)fetchPoster.click();},0);
      };
      const tools = el('div');
      tools.append(fetchPoster,sourceStatus);
      labeled('',tools);
    }
    const body = el('textarea');
    body.setAttribute('aria-label','Record notes');
    body.placeholder = block.preset==='videos'?'Script, production notes and publishing checklist':'Write notes or a review…';
    body.value = record.body || '';
    body.maxLength = 40000;
    labeled(block.preset==='videos'?'Script and notes':'Notes',body);
    const checklist = record.checklist || (block.preset==='videos' ?
      ['Review final cut','Prepare thumbnail and title','Add description and captions','Schedule publication'].map(text=>({text,done:false})) : []);
    if (block.preset==='videos' || checklist.length) {
      const items = el('div','tracker-checklist');
      const add = btn('Add checklist item',()=>{if(checklist.length<30){checklist.push({text:'',done:false});renderChecklist();items.lastChild.querySelector('input[type=text]').focus();}});
      function renderChecklist() {
        items.replaceChildren(...checklist.map((item,index)=>{
          const line = el('div','tracker-tools'), text = field('Checklist item','text',item.text);
          const check = noteSpringCheck('Complete checklist item', item.done, checked => { item.done = checked; });
          text.maxLength = 300;
          text.oninput = ()=>{item.text=text.value;};
          line.append(check,text,btn('Remove',()=>{checklist.splice(index,1);renderChecklist();}));
          return line;
        }));
        add.disabled = checklist.length>=30;
      }
      const section = el('div');
      section.append(items,add);
      labeled('Publishing checklist',section);
      renderChecklist();
    }
    const actions = el('div','dialog-actions');
    let pending = false;
    dialog.oncancel = event => { if (pending) event.preventDefault(); };
    async function submit(action) {
      if (pending) return;
      pending = true;
      form.inert = true;
      try { await action(); dialog.close(); }
      catch (error) { feedback.textContent = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
      finally { pending = false; form.inert = false; }
    }
    if (record.id) actions.append(btn('Delete…',()=>{
      if (window.confirm('Delete this tracker record?')) submit(remove);
    }));
    const save = el('button','primary','Save record');
    save.type = 'submit';
    actions.append(btn('Cancel',()=>dialog.close()),save);
    form.append(feedback,actions);
    form.onsubmit = event => {
      event.preventDefault();
      if (save.disabled) return;
      for (const [key,input] of inputs) properties[key] = input.type==='number' && input.value ? input.valueAsNumber : input.value;
      submit(()=>persist({id:record.id,title:title.value,status:status.value,properties,body:body.value,checklist}));
    };
    dialog.append(form);
    dialog.showModal();
  }
  function settings(block, commit) {
    const dialog = modal('Tracker settings');
    const name = field('Tracker title','text',block.title);
    name.maxLength = 120;
    const currency = field('Currency code (e.g. USD or UGX)','text',block.currency||'');
    currency.maxLength = 3;
    const rows = el('div','tracker-settings-fields');
    function append(label = '', type = 'text', key = '') {
      const row = el('div','tracker-tools'), input = field('Field name','text',label);
      input.maxLength = 80;
      const types = selectField('Field type',fieldTypes.map(type=>[type,type]),type);
      types.disabled = !!key;
      row.dataset.key = key;
      row.append(input,types,btn('Remove',()=>row.remove()));
      rows.append(row);
    }
    block.fields.forEach(({label,type,key})=>append(label,type,key));
    const actions = el('div','dialog-actions');
    actions.append(btn('Cancel',()=>dialog.close()),btn('Save settings',async()=>{
      let sequence = block.nextField;
      const fields = [...rows.children].map(row=>({
        key:row.dataset.key || 'f'+sequence++,label:row.firstChild.value.trim(),type:row.children[1].value
      })).filter(item=>item.label);
      const code = currency.value.trim().toUpperCase();
      if (code && !/^[A-Z]{3}$/.test(code)) { feedback.textContent = 'Use a three-letter currency code.'; return; }
      try { await commit({title:name.value.trim()||'Tracker',fields,nextField:sequence,currency:code}); dialog.close(); }
      catch (error) { feedback.textContent = error.message; }
    }));
    const feedback = el('p','dialog-error');
    dialog.append(name,...(block.fields.some(f=>f.type==='money')?[currency]:[]),rows,btn('Add field',()=>{ if (rows.children.length<12) append(); }),feedback,actions);
    dialog.showModal();
  }
  function mount(block, noteId, changed, flush) {
    const root = el('section','note-tracker'), tools = el('div','tracker-tools'), content = el('div','tracker-results');
    const tabs = el('div','tracker-tools'), controls = el('div','tracker-tools'), heading = el('h3','',block.title);
    const message = el('p','hint'), more = btn('Load more',()=>load(true));
    const totals = el('div','tracker-totals');
    const undo = btn('Undo move',()=>safe(async()=>{
      if (!lastMove) return;
      await call('move',lastMove);
      lastMove = null;
      undo.hidden = true;
      await load();
    }));
    let generation = 0, rows = [], timer, dragged, lastMove;
    undo.hidden = more.hidden = true;
    const call = (op,data)=>api.noteTracker(op,noteId,block.id,data);
    const current = ()=>block.views[block.active];
    const commit = async patch=>{
      Object.assign(block,patch);
      changed();
      await flush();
      if (root.isConnected) { setup(); await load(); }
    };
    const showRecord = async row=>{
      const record = row ? await call('get',row.id) : {title:'',properties:{},status:current().status};
      if (!root.isConnected) return;
      editRecord(block,record,async data=>{await call('save',data);await load();},
        async()=>{await call('delete',record.id);await load();});
    };
    async function movieLink() {
      const dialog = modal('Add movie or series by link'), form = el('form');
      const input = field('IMDb, Letterboxd, Rotten Tomatoes or TMDB URL','url'), status = el('p','hint');
      input.required = true;
      const submit = el('button','primary','Import link');
      submit.type = 'submit';
      form.append(input,status,submit,btn('Cancel',()=>dialog.close()));
      form.onsubmit = async event=>{
        event.preventDefault();
        submit.disabled = true;
        status.textContent = 'Fetching title and poster…';
        try {
          const info = await api.noteMovieLink(input.value.trim());
          if (!dialog.open) return;
          const values = movieProperties(info);
          const properties = Object.fromEntries(block.fields.map(field=>[field.key,values[field.key]]));
          dialog.close();
          editRecord(block,{title:info.title,properties,status:current().status},async data=>{await call('save',data);await load();});
        } catch (error) { status.textContent = error.message; submit.disabled = false; }
      };
      dialog.append(form);
      dialog.showModal();
    }
    function display(field, row) {
      const value = row.properties[field.key];
      if (value == null) return '';
      if (field.type==='money') {
        const format = {minimumFractionDigits:2,maximumFractionDigits:2};
        if (block.currency) Object.assign(format,{style:'currency',currency:block.currency});
        return (value/100).toLocaleString(undefined,format);
      }
      return typeof value==='object'?value.label:String(value);
    }
    function card(row, poster) {
      const item = btn('',()=>safe(()=>showRecord(row)));
      item.className = 'tracker-card';
      item.oncontextmenu = event => { event.preventDefault(); safe(()=>showRecord(row)); };
      const imageField = block.fields.find(f=>f.type==='file' && row.properties[f.key]);
      if (poster && imageField) {
        const image = el('img');
        image.loading = 'lazy';
        image.alt = '';
        image.onerror = () => image.remove();
        const attachment = row.properties[imageField.key];
        image.src = 'asset://'+(attachment.bookmarkCover?'link-cover':'thumb')+'/'+attachment.id;
        item.append(image);
      }
      item.append(el('strong','',row.title));
      if (row.status) item.append(el('small','hint',row.status));
      return item;
    }
    function renderRows() {
      const {layout} = current();
      content.replaceChildren();
      if (layout==='table') {
        const table = el('table'), head = table.createTHead().insertRow(), body = table.createTBody();
        const labels = ['Title',...(block.statuses.length?['Status']:[]),...block.fields.map(f=>f.label)];
        labels.forEach(label=>head.append(el('th','',label)));
        for (const row of rows) {
          const line = body.insertRow();
          const title = btn(row.title,()=>safe(()=>showRecord(row)));
          line.oncontextmenu = event => {
            if (event.defaultPrevented) return;
            event.preventDefault();
            safe(()=>showRecord(row));
          };
          line.insertCell().append(title);
          if (block.statuses.length) line.insertCell().textContent = row.status;
          for (const field of block.fields) {
            const cell = line.insertCell();
            const value = row.properties[field.key];
            if (isVideoThumbnail(block,field)) {
              const preview = btn('',()=>safe(async()=>{
                const image = await NotesWorkspace.pickThumbnail();
                if (!image) return;
                await call('thumbnail',{id:row.id,assetId:image.id});
                await load();
              }));
              preview.className = 'tracker-thumbnail-cell';
              preview.setAttribute('aria-label',value?'Replace thumbnail for '+row.title:'Choose thumbnail for '+row.title);
              preview.title = value?.label || 'Choose thumbnail';
              if (value) preview.append(thumbnail(value));
              preview.append(el('span','',value?.label || 'Choose…'));
              preview.oncontextmenu = event => { event.preventDefault(); preview.click(); };
              cell.append(preview);
            } else cell.textContent = display(field,row);
          }
        }
        content.append(table);
      } else if (layout==='board' && block.statuses.length) {
        const board = el('div','tracker-board');
        for (const status of block.statuses.filter(status=>!current().status||status===current().status)) {
          const lane = el('section','tracker-lane');
          lane.append(el('strong','',status));
          for (const row of rows.filter(row=>row.status===status)) {
            const item = card(row,false);
            item.draggable = true;
            item.ondragstart = event=>{ dragged = row; event.dataTransfer.setData('application/x-canvaspro-note','record');event.dataTransfer.effectAllowed='move'; };
            item.ondragend = ()=>{ dragged = null; };
            lane.append(item);
          }
          lane.ondragover = event=>{if(dragged){event.preventDefault();event.dataTransfer.dropEffect='move';}};
          lane.ondrop = event=>{
            if (!dragged || dragged.status===status) return;
            event.preventDefault();
            event.stopPropagation();
            const row = dragged;
            dragged = null;
            const previous = row.status;
            row.status = status;
            renderRows();
            safe(async()=>{
              try {
                const old = await call('move',{id:row.id,status});
                lastMove = {id:row.id,status:old};
                undo.hidden = false;
              } catch (error) { row.status = previous; throw error; }
              finally { await load(); }
            });
          };
          board.append(lane);
        }
        content.append(board);
      } else {
        const gallery = el('div','tracker-gallery');
        gallery.append(...rows.map(row=>card(row,true)));
        content.append(gallery);
      }
    }
    async function load(append = false) {
      const request = ++generation;
      more.hidden = true;
      message.textContent = 'Loading records…';
      try {
        const page = await call('list',{...current(),offset:append?rows.length:0});
        if (!root.isConnected || request!==generation) return;
        rows = append?rows.concat(page.rows):page.rows;
        renderRows();
        more.hidden = !page.more;
        message.textContent = rows.length?'':'No matching records.';
        const summaries = page.totals.flatMap(group=>block.fields.filter(f=>f.type==='money'&&group[f.key]!=null)
          .map(f=>(group.status?group.status+' · ':'')+f.label+': '+display(f,{properties:group})));
        totals.textContent = summaries.join('   |   ');
      } catch (error) {
        if (root.isConnected && request===generation) message.textContent = error.message;
      }
    }
    function viewSettings(index) {
      const existing = block.views[index];
      const dialog = modal(existing?'Tracker view settings':'Add tracker view');
      const name = field('View name','text',existing?.name||'');
      name.maxLength = 60;
      const layout = selectField('View layout',layouts.filter(([key])=>key!=='board'||block.statuses.length),existing?.layout||'table');
      function apply(views, active) {
        block.views = views;
        block.active = active;
        changed();
        dialog.close();
        setup();
        load();
      }
      const actions = el('div','dialog-actions');
      if (existing) {
        const remove = btn('Delete view…',()=>{
          if (!window.confirm('Delete this view? Its records will remain in the tracker.')) return;
          const active = block.active === index ? Math.min(index,block.views.length-2) :
            block.active - Number(index<block.active);
          apply(block.views.filter((_,position)=>position!==index),active);
        });
        remove.disabled = block.views.length===1;
        if (remove.disabled) remove.title = 'Keep at least one view';
        actions.append(remove);
      }
      actions.append(btn('Cancel',()=>dialog.close()),btn(existing?'Save view':'Add view',()=>{
        const label = name.value.trim()||layouts.find(item=>item[0]===layout.value)[1];
        const views = [...block.views];
        if (existing) views[index] = {...existing,name:label,layout:layout.value};
        else views.push(newView(label,layout.value));
        apply(views,existing?block.active:views.length-1);
      }));
      dialog.append(name,layout,actions);
      dialog.showModal();
      name.select();
    }
    function setup() {
      heading.textContent = block.title;
      tabs.replaceChildren(...block.views.map((view,index)=>{
        const tab = btn(view.name,()=>{block.active=index;changed();setup();load();});
        tab.setAttribute('aria-pressed',String(index===block.active));
        tab.oncontextmenu = event => { event.preventDefault(); viewSettings(index); };
        return tab;
      }));
      addView.hidden = block.views.length>=12;
      const view = current(), search = field('Search records','search',view.query);
      search.maxLength = 120;
      const filter = selectField('Filter by status',[['','All statuses'],...block.statuses.map(value=>[value,value])],view.status);
      const sort = selectField('Sort records',[['recent','Recently edited'],['title','Title A–Z'],
        ...(block.fields.some(f=>f.type==='date')?[['date','Date']]:[]),...(block.preset==='movies'?[['rating','My rating']]:[])],view.sort);
      search.oninput = ()=>{view.query=search.value;changed();generation++;more.hidden=true;clearTimeout(timer);timer=setTimeout(load,150);};
      filter.onchange = ()=>{view.status=filter.value;changed();load();};
      sort.onchange = ()=>{view.sort=sort.value;changed();load();};
      controls.replaceChildren(search,...(block.statuses.length?[filter]:[]),sort);
      if (block.fields.some(f=>f.type==='date')) {
        const month = field('Filter by month','month',view.month);
        month.onchange = ()=>{view.month=month.value;changed();load();};
        controls.append(month);
      }
    }
    const options = el('details','tracker-options');
    const menu = el('div','tracker-option-menu');
    const addView = btn('+ View',()=>{options.open=false;viewSettings();});
    menu.append(addView,btn('View settings…',()=>{options.open=false;viewSettings(block.active);}),
      btn('Tracker settings…',()=>{options.open=false;settings(block,commit);}));
    options.append(el('summary','','Options'),menu);
    tools.classList.add('tracker-primary-tools');
    tools.append(btn('New record',()=>safe(()=>showRecord())));
    if (block.preset==='movies') tools.append(btn('Add from link',movieLink));
    tools.append(undo,options);
    root.append(heading,tools,tabs,controls,content,totals,message,more);
    setup();
    queueMicrotask(()=>{ if (root.isConnected) safe(async()=>{await flush();if(root.isConnected)await load();}); });
    return root;
  }
  return {mount,pickReference};
})();
