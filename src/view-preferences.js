function revealFromTrigger(surface, trigger) {
 if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
 for (const animation of surface.getAnimations()) animation.cancel();
 const bounds = surface.getBoundingClientRect(), source = trigger.getBoundingClientRect();
 if (!bounds.width || !source.width) return;
 const x = Math.max(0, Math.min(bounds.width, source.left + source.width / 2 - bounds.left));
 const y = Math.max(0, Math.min(bounds.height, source.top + source.height / 2 - bounds.top));
 const transformOrigin = `${x}px ${y}px`;
 surface.animate([
  { transformOrigin, transform: 'scale(.97)', opacity: .82 },
  { transformOrigin, transform: 'none', opacity: 1 }
 ], { duration: 125, easing: 'cubic-bezier(.23,1,.32,1)' });
}

function setGalleryLayout(mode){
 if(!['masonry','waterfall','justified'].includes(mode))return;
 const gallery=$('#gallery'),anchor=layout?AssetLayout.anchorAt(layout,gallery.scrollTop,gallery.clientHeight):null;
 stopHover();galleryLayout=mode;localStorage.setItem('gallery-layout',mode);document.body.dataset.layout=mode;
 for(const option of document.querySelectorAll('#layout-menu [data-layout]'))option.setAttribute('aria-checked',String(option.dataset.layout===mode));
 $('#layout-button').title='Gallery layout · '+mode[0].toUpperCase()+mode.slice(1);
 layoutDirty=true;renderWindow(anchor);
}
function applyAppearance(state){
 document.body.classList.toggle('light-mode',state.dark===false);document.documentElement.style.colorScheme=state.dark===false?'light':'dark';
 document.body.classList.toggle('native-glass',state.dark!==false&&!!state.nativeGlass);
 document.body.classList.toggle('reduced-transparency',state.reducedTransparency);
}
function initViewPreferences(){
 const saved=localStorage.getItem('gallery-layout');galleryLayout=['masonry','waterfall','justified'].includes(saved)?saved:'masonry';document.body.dataset.layout=galleryLayout;
 const savedSort=localStorage.getItem('sort-order');if(['new','old','name','size'].includes(savedSort))$('#sort').value=savedSort;
 const menu=$('#layout-menu'),button=$('#layout-button'),options=[...menu.querySelectorAll('[data-layout]')];
 for(const option of options){option.setAttribute('aria-checked',String(option.dataset.layout===galleryLayout));option.onclick=()=>{setGalleryLayout(option.dataset.layout);menu.hidePopover();button.focus({preventScroll:true});};}
 function positionMenu(){if(!menu.matches(':popover-open'))return;const rect=button.getBoundingClientRect();menu.style.top=(rect.bottom+8)+'px';menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,rect.right-menu.offsetWidth))+'px';}
 let pointerOpening = false;
 button.addEventListener('click', event => { pointerOpening = event.detail > 0; });
 menu.addEventListener('beforetoggle', event => {
  if (event.newState === 'closed') for (const animation of menu.getAnimations()) animation.cancel();
 });
 menu.addEventListener('toggle', event => {
  const open = event.newState === 'open';
  button.setAttribute('aria-expanded', String(open));
  if (open) {
   stopHover();
   positionMenu();
   if (pointerOpening) revealFromTrigger(menu, button);
   menu.querySelector('[aria-checked="true"]').focus({preventScroll:true});
  }
  pointerOpening = false;
 });
 menu.addEventListener('keydown',event=>{event.stopPropagation();const index=options.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next].focus();}else if(event.key==='Escape'){event.preventDefault();menu.hidePopover();button.focus();}else if(event.key==='Enter'||event.code==='Space'){event.preventDefault();document.activeElement.click();}});
 menu.addEventListener('focusout',()=>requestAnimationFrame(()=>{if(menu.matches(':popover-open')&&!menu.contains(document.activeElement)&&document.activeElement!==button)menu.hidePopover();}));
 addEventListener('resize',positionMenu);
 applyAppearance({dark:matchMedia('(prefers-color-scheme: dark)').matches});
 api.onAppearance(applyAppearance);safe(async()=>applyAppearance(await api.appearanceState()));
}
