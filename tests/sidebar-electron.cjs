// Exercise the real sidebar without touching a user's library or window settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app,nativeTheme} = require('electron');
const profile = fs.mkdtempSync('/private/tmp/canvas-sidebar-');
process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = profile;
require('../electron/main.cjs');
let win;
const run = code => win.webContents.executeJavaScript(code);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  // A busy machine needs longer than three seconds to settle the sidebar and let
  // its toolbar settle.
  for (let i=0; i<400; i++) { if (await check()) return; await pause(20); }
  console.error(await run("JSON.stringify({mode:document.body.className,hover:$('.sidebar-hover-pill').outerHTML,focus:document.activeElement.id})"));
  throw Error('Sidebar check timed out');
}
function key(keyCode,modifiers=[]) {
  win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
  win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
}
(async()=>{
  await app.whenReady();
  win = global.assetTestWindow;
  win.webContents.setBackgroundThrottling(false);
  if(win.webContents.isLoading()) await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  await until(()=>run("!!$('#navigation button') && !$('.sidebar-active-pill').hidden"));
  // The sections follow one another with an even gap, and Collections sits
  // right after the Library.
  const sectionSpacing = await run("(()=>{const library=$('#navigation').getBoundingClientRect(),collections=$('[data-section=collections] > summary').getBoundingClientRect(),media=$('[data-section=media] > summary').getBoundingClientRect();return {libraryGap:collections.top-library.bottom,sectionGap:media.top-collections.bottom};})()");
  assert.ok(sectionSpacing.libraryGap < 36, `Collections is too far from the Library: ${sectionSpacing.libraryGap}px`);
  assert.ok(sectionSpacing.sectionGap < 36, `The section after Collections is too far: ${sectionSpacing.sectionGap}px`);
  const initial = await run("$('.sidebar-active-pill').style.transform");
  await run("$('#navigation button:nth-child(2)').click()");
  await until(()=>run("view==='favorites' && $('.sidebar-active-pill').style.transform!=="+JSON.stringify(initial)));
  await run("$('#media-navigation button').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}))");
  await until(()=>run("!$('.sidebar-hover-pill').hidden"));
  await run("$('.sidebar').dispatchEvent(new PointerEvent('pointerleave'))");
  await until(()=>run("$('.sidebar-hover-pill').hidden"));
  await run("$('#gallery').focus()");
  key('B',['meta']);
  await until(()=>run("document.body.classList.contains('hide-sidebar')"));
  await pause(240);
  // The gallery takes back the space the hidden sidebar was using and runs to
  // the edge of the window.
  assert.equal(await run("$('main').getBoundingClientRect().left"),0);
  assert.equal(await run("$('.sidebar').inert"),true);
  assert.equal(await run("getComputedStyle($('.sidebar')).visibility"),'hidden');
  assert.equal(await run("document.activeElement.id"),'show-sidebar');
  await run("$('#show-sidebar').click()");
  await until(()=>run("!document.body.classList.contains('hide-sidebar')"));
  await pause(240);
  key('S',['meta']);
  await until(()=>run("document.body.classList.contains('hide-sidebar') && $('.sidebar').inert"));
  key('S',['meta']);
  await until(()=>run("!document.body.classList.contains('hide-sidebar') && !$('.sidebar').inert"));
  await pause(240);
  await run("$('[data-section=media] > summary').click()");
  await pause(150);
  assert.equal(await run("$('[data-section=media]').open"),true,'Media section must stay open');
  assert.equal(await run("localStorage.getItem('sidebar-section-media')"),null,'Section state is no longer stored');
  await run("$('#gallery').focus()");
  key('B',['meta']);
  await until(()=>run("document.body.classList.contains('hide-sidebar') && $('[data-section=media]').open"));
  key('B',['meta']);
  await until(()=>run("!document.body.classList.contains('hide-sidebar') && $('[data-section=media]').open"));
  await run("$('[data-section=media] > summary').click()");
  await run("$('#add-folder').click()");
  assert.ok(await run("!!document.querySelector('#folders .inline-create input')"),'Inline collection field must open');
  await run("document.querySelector('#folders .inline-create input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  console.log('SIDEBAR_PILLS_FULL_HIDE_CMDS_SECTIONS_OK');

  await run("$('#gallery').focus()");
  key('B',['meta']);
  await until(()=>run("document.body.classList.contains('hide-sidebar') && $('.sidebar').inert"));
  await pause(240);
  assert.equal(await run("$('.sidebar-active-pill').hidden"),true);
  key('B',['meta']);
  await until(()=>run("!document.body.classList.contains('hide-sidebar')"));
  win.setSize(1000,800);
  await until(()=>run("matchMedia('(max-width:1040px)').matches && $('.sidebar').inert"));
  await run("$('#show-sidebar').click()");
  await until(()=>run("document.body.classList.contains('sidebar-drawer-open') && $('main').inert"));
  assert.equal(await run("$('.sidebar').getAttribute('aria-modal')"),'true');
  assert.ok(await run("$('main').getBoundingClientRect().width > 350"));
  await pause(240);
  fs.writeFileSync('/private/tmp/canvas-sidebar-drawer.png',(await win.webContents.capturePage()).toPNG());
  await run("$('#show-settings').focus()");
  key('Tab');
  await until(()=>run("document.activeElement.id==='toggle-sidebar'"));
  key('Escape');
  await until(()=>run("$('.sidebar').inert && !$('main').inert"));
  await pause(120);
  assert.equal(await run("document.activeElement.id"),'show-sidebar');
  await run("$('#show-sidebar').click()");
  await pause(240);
  const point = await run("(()=>{const r=$('.sidebar-drawer-handle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
  win.webContents.sendInputEvent({type:'mouseMove',x:point.x-115,y:point.y,button:'left'});
  win.webContents.sendInputEvent({type:'mouseUp',x:point.x-115,y:point.y,button:'left',clickCount:1});
  await until(()=>run("!document.body.classList.contains('sidebar-drawer-open')"));
  await run("$('#show-sidebar').click();$('#navigation button').click()");
  await until(()=>run("view==='all' && !document.body.classList.contains('sidebar-drawer-open')"));
  console.log('SIDEBAR_DRAWER_FOCUS_DRAG_NAVIGATION_OK');

  win.setSize(1400,900);
  win.webContents.debugger.attach();
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  nativeTheme.themeSource='light';
  await until(()=>run("document.body.classList.contains('light-mode')"));
  await run("$('#navigation button:nth-child(2)').click()");
  await until(()=>run("view==='favorites'"));
  const duration=await run("getComputedStyle($('.sidebar-active-pill')).transitionDuration");
  assert.ok(duration.split(',').every(value=>parseFloat(value)<.002));
  assert.notEqual(await run("getComputedStyle($('.sidebar-active-pill')).backgroundColor"),'rgba(0, 0, 0, 0)');
  console.log('SIDEBAR_LIGHT_MODE_REDUCED_MOTION_OK');
  app.quit();
})().catch(error=>{console.error(error);app.exit(1)});
app.on('will-quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
