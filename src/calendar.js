// A calendar for the notes section.
//
// The browser's own month and date controls draw a control that belongs to no
// other app on the Mac: a dark grid of years with a grey box around it. This
// is the same thing done properly — the app's own popover material, the same
// arrows, months and days, and a value that stays in the format the tracker
// stores ("YYYY-MM" and "YYYY-MM-DD").
const Calendar=(()=>{
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS=['Mo','Tu','We','Th','Fr','Sa','Su'];
  let popover=null, dismiss=null;

  function parts(value,mode){
    const now=new Date();
    const match=/^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(value||''));
    return {
      year:match?Number(match[1]):now.getFullYear(),
      month:match?Number(match[2]):now.getMonth()+1,
      day:match&&match[3]?Number(match[3]):(mode==='date'?now.getDate():1)
    };
  }
  function format(value,mode){
    const text=String(value||'');
    const match=/^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(text);
    if(!match)return '';
    const month=MONTHS[Number(match[2])-1]||'';
    if(mode==='month')return month+' '+match[1];
    return Number(match[3])+' '+month+' '+match[1];
  }
  function iso(year,month,day){
    const pad=number=>String(number).padStart(2,'0');
    return day==null?year+'-'+pad(month):year+'-'+pad(month)+'-'+pad(day);
  }
  function close(){
    if(!popover)return;
    popover.remove();
    popover=null;
    dismiss?.();
    dismiss=null;
  }
  function build(anchor,mode,value,onPick){
    const state=parts(value,mode);
    state.level=mode==='date'?'days':'months';
    const surface=el('div','calendar-popover');
    surface.setAttribute('role','dialog');
    surface.setAttribute('aria-label',mode==='month'?'Choose a month':'Choose a date');
    const header=el('div','calendar-header');
    const title=el('button','calendar-title');
    title.type='button';
    const back=el('button','calendar-nav');
    back.type='button';
    back.append(glyph('chevronLeft'));
    const forward=el('button','calendar-nav');
    forward.type='button';
    forward.append(glyph('chevronRight'));
    const body=el('div','calendar-body');
    const footer=el('div','calendar-footer');
    const clear=el('button','calendar-clear');
    clear.type='button';
    clear.textContent='Clear';
    const now=el('button','calendar-now');
    now.type='button';
    now.textContent=mode==='month'?'This month':'Today';
    footer.append(clear,now);
    header.append(back,title,forward);
    surface.append(header,body,footer);

    const selected=String(value||'');
    function pick(next){
      close();
      onPick(next);
    }
    function paint(){
      title.textContent=state.level==='months'?String(state.year):MONTHS[state.month-1]+' '+state.year;
      title.setAttribute('aria-label',state.level==='months'?'Year '+state.year:'Choose month');
      back.setAttribute('aria-label',state.level==='months'?'Previous year':'Previous month');
      forward.setAttribute('aria-label',state.level==='months'?'Next year':'Next month');
      body.replaceChildren();
      if(state.level==='months'){
        const grid=el('div','calendar-months');
        MONTHS.forEach((name,index)=>{
          const button=el('button','calendar-month'+(selected===iso(state.year,index+1)?' is-selected':''));
          button.type='button';
          button.textContent=name.slice(0,3);
          button.setAttribute('aria-label',name+' '+state.year);
          button.setAttribute('aria-pressed',String(selected===iso(state.year,index+1)));
          button.onclick=()=>{
            if(mode==='month'){pick(iso(state.year,index+1));return;}
            state.month=index+1;
            state.level='days';
            paint();
          };
          grid.append(button);
        });
        body.append(grid);
        return;
      }
      const weekdays=el('div','calendar-weekdays');
      for(const day of DAYS)weekdays.append(el('span','',day));
      const grid=el('div','calendar-days');
      const first=new Date(state.year,state.month-1,1);
      const offset=(first.getDay()+6)%7;
      const total=new Date(state.year,state.month,0).getDate();
      for(let index=0;index<offset;index++)grid.append(el('span','calendar-day is-empty'));
      const today=new Date();
      for(let day=1;day<=total;day++){
        const value=iso(state.year,state.month,day);
        const isToday=today.getFullYear()===state.year&&today.getMonth()===state.month-1&&today.getDate()===day;
        const button=el('button','calendar-day'+(selected===value?' is-selected':'')+(isToday?' is-today':''));
        button.type='button';
        button.textContent=String(day);
        button.setAttribute('aria-label',day+' '+MONTHS[state.month-1]+' '+state.year);
        button.setAttribute('aria-pressed',String(selected===value));
        button.onclick=()=>pick(value);
        grid.append(button);
      }
      body.append(weekdays,grid);
    }
    back.onclick=()=>{
      if(state.level==='months')state.year--;
      else state.month=state.month===1?(state.year--,12):state.month-1;
      paint();
    };
    forward.onclick=()=>{
      if(state.level==='months')state.year++;
      else state.month=state.month===12?(state.year++,1):state.month+1;
      paint();
    };
    title.onclick=()=>{
      if(mode!=='date')return;
      state.level=state.level==='months'?'days':'months';
      paint();
    };
    clear.onclick=()=>pick('');
    now.onclick=()=>{
      const today=new Date();
      pick(mode==='month'?iso(today.getFullYear(),today.getMonth()+1):iso(today.getFullYear(),today.getMonth()+1,today.getDate()));
    };
    paint();
    document.body.append(surface);
    // Sit under the field, and flip above it when the window is too short.
    const bounds=anchor.getBoundingClientRect();
    const left=Math.max(12,Math.min(bounds.left,innerWidth-surface.offsetWidth-12));
    const below=bounds.bottom+6;
    const top=below+surface.offsetHeight>innerHeight-12?Math.max(12,bounds.top-surface.offsetHeight-6):below;
    surface.style.left=left+'px';
    surface.style.top=top+'px';
    const onPointerDown=event=>{if(!surface.contains(event.target))close();};
    const onKey=event=>{if(event.key==='Escape'){event.preventDefault();close();anchor.focus();}};
    document.addEventListener('pointerdown',onPointerDown,true);
    document.addEventListener('keydown',onKey,true);
    dismiss=()=>{
      document.removeEventListener('pointerdown',onPointerDown,true);
      document.removeEventListener('keydown',onKey,true);
    };
    return surface;
  }
  function open(anchor,mode,value,onPick){
    close();
    popover=build(anchor,mode,value,onPick);
  }
  // A field that behaves like a text input for everything that reads it: the
  // value stays in the stored format, the label shows the readable one.
  function field(label,mode,value=''){
    const input=el('input');
    input.type='text';
    input.readOnly=true;
    input.className='calendar-field';
    input.setAttribute('aria-label',label);
    input.placeholder=label;
    let raw=String(value||'');
    const paint=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    const show=()=>paint.call(input,format(raw,mode));
    Object.defineProperty(input,'value',{
      get(){return raw;},
      set(next){raw=String(next??'');show();}
    });
    show();
    input.addEventListener('click',()=>open(input,mode,raw,next=>{
      raw=next;
      show();
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }));
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();open(input,mode,raw,next=>{
        raw=next;
        show();
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
      });}
    });
    return input;
  }
  return {field,open,close,format};
})();
