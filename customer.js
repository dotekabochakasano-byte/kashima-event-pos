const DB_NAME='kashima-event-pos'; const DB_VERSION=1;
let db=null; let currentVideoUrl=null; let completeTimer=null;
const fmt=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(n||0));
const el=id=>document.getElementById(id);
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains('settings'))d.createObjectStore('settings',{keyPath:'key'});};req.onsuccess=()=>{db=req.result;resolve(db)};req.onerror=()=>reject(req.error);});}
function getSetting(key){return new Promise((res,rej)=>{const r=db.transaction('settings').objectStore('settings').get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function show(name){['standbyView','orderView','completeView'].forEach(id=>el(id).classList.remove('active'));el(name).classList.add('active');}
async function loadAdVideo(){
  try{
    const rec=await getSetting('adVideo'); const video=el('adVideo'); const fallback=el('standbyFallback');
    if(currentVideoUrl){URL.revokeObjectURL(currentVideoUrl);currentVideoUrl=null}
    if(rec&&rec.blob){currentVideoUrl=URL.createObjectURL(rec.blob);video.src=currentVideoUrl;video.hidden=false;fallback.style.display='none';try{await video.play()}catch(_){} }
    else{video.pause();video.removeAttribute('src');video.load();video.hidden=true;fallback.style.display='flex'}
  }catch(e){console.warn(e)}
}
function renderOrder(state){
  if(!state||!state.items||!state.items.length){show('standbyView');return}
  clearTimeout(completeTimer);
  el('customerItems').innerHTML=state.items.map(i=>`<div class="customer-item"><div class="customer-item-name">${escapeHtml(i.name)}</div><div class="customer-item-qty">× ${i.qty}</div><div class="customer-item-sub">${fmt(i.subtotal)}</div></div>`).join('');
  el('customerTotal').textContent=fmt(state.total);el('customerPayment').textContent=state.paymentLabel||'現金';show('orderView');
}
function renderComplete(state){
  clearTimeout(completeTimer);el('completeOrderNo').textContent=String(state.orderNo||'---').padStart(3,'0');el('completePayment').textContent=`お支払い：${state.paymentLabel||''}　${fmt(state.total)}`;
  el('completeChange').textContent=state.change>0?`お釣り：${fmt(state.change)}`:'';show('completeView');
  completeTimer=setTimeout(()=>show('standbyView'),6500);
}
function handleState(state){if(!state)return;if(state.type==='complete')renderComplete(state);else if(state.type==='order')renderOrder(state);else if(state.type==='ad-updated')loadAdVideo();else show('standbyView');}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
let bc=null;try{bc=new BroadcastChannel('kashima-pos-customer');bc.onmessage=e=>handleState(e.data)}catch(_){ }
window.addEventListener('storage',e=>{if(e.key==='kashimaCustomerState'&&e.newValue){try{handleState(JSON.parse(e.newValue))}catch(_){}}});
setInterval(()=>{try{const s=localStorage.getItem('kashimaCustomerState');if(s){const o=JSON.parse(s);if(o._ts&&(!window._lastStateTs||o._ts>window._lastStateTs)){window._lastStateTs=o._ts;handleState(o)}}}catch(_){}},500);
(async()=>{await openDB();await loadAdVideo();try{const s=localStorage.getItem('kashimaCustomerState');if(s)handleState(JSON.parse(s))}catch(_){}})();
