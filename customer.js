const DB_NAME='kashima-event-pos'; const DB_VERSION=1;
let db=null; let currentVideoUrl=null; let completeTimer=null; let videoRetryTimer=null;
const fmt=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(n||0));
const el=id=>document.getElementById(id);
const QR_METHODS=new Set(['paypay','rakutenpay','dbarai','aupay']);
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains('settings'))d.createObjectStore('settings',{keyPath:'key'});};req.onsuccess=()=>{db=req.result;resolve(db)};req.onerror=()=>reject(req.error);});}
function getSetting(key){return new Promise((res,rej)=>{const r=db.transaction('settings').objectStore('settings').get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function show(name){['standbyView','orderView','completeView'].forEach(id=>el(id).classList.remove('active'));el(name).classList.add('active');}
function isQrPaymentMethod(method){return QR_METHODS.has(String(method||''));}
function resetVideoState(showFallback=true){
  const video=el('adVideo'); const fallback=el('standbyFallback');
  clearTimeout(videoRetryTimer);
  if(video){
    try{video.pause();}catch(_){ }
    video.hidden=showFallback;
  }
  if(fallback)fallback.style.display=showFallback?'flex':'none';
}
async function tryPlayVideo(video){
  try{
    const p=video.play();
    if(p&&typeof p.then==='function')await p;
    return true;
  }catch(_){
    return false;
  }
}
async function loadAdVideo(){
  const video=el('adVideo'); const fallback=el('standbyFallback');
  if(!video||!fallback)return;
  try{
    const rec=await getSetting('adVideo');
    if(currentVideoUrl){URL.revokeObjectURL(currentVideoUrl);currentVideoUrl=null}
    clearTimeout(videoRetryTimer);
    video.onloadeddata=null; video.oncanplay=null; video.onerror=null; video.onstalled=null; video.onabort=null;
    if(rec&&rec.blob){
      currentVideoUrl=URL.createObjectURL(rec.blob);
      video.muted=true; video.defaultMuted=true; video.autoplay=true; video.loop=true; video.playsInline=true;
      video.setAttribute('muted',''); video.setAttribute('autoplay',''); video.setAttribute('loop',''); video.setAttribute('playsinline',''); video.setAttribute('webkit-playsinline','');
      video.preload='auto';
      video.src=currentVideoUrl;
      video.hidden=false;
      fallback.style.display='none';
      video.onerror=()=>resetVideoState(true);
      video.onstalled=()=>{videoRetryTimer=setTimeout(()=>tryPlayVideo(video),400)};
      video.onabort=()=>resetVideoState(true);
      video.oncanplay=()=>{tryPlayVideo(video);};
      video.onloadeddata=async()=>{
        const ok=await tryPlayVideo(video);
        if(!ok){videoRetryTimer=setTimeout(async()=>{const retryOk=await tryPlayVideo(video); if(!retryOk)resetVideoState(true);},500);}
      };
      video.load();
      const started=await tryPlayVideo(video);
      if(!started){videoRetryTimer=setTimeout(async()=>{const retryOk=await tryPlayVideo(video); if(!retryOk)resetVideoState(true);},500);}
    }else{
      if(video){try{video.pause();}catch(_){ } video.removeAttribute('src'); video.load();}
      resetVideoState(true);
    }
  }catch(e){console.warn(e);resetVideoState(true)}
}
function renderOrder(state){
  if(!state||!state.items||!state.items.length){show('standbyView');return}
  clearTimeout(completeTimer);
  el('customerItems').innerHTML=state.items.map(i=>`<div class="customer-item"><div class="customer-item-name">${escapeHtml(i.name)}</div><div class="customer-item-qty">× ${i.qty}</div><div class="customer-item-sub">${fmt(i.subtotal)}</div></div>`).join('');
  el('customerTotal').textContent=fmt(state.total);
  el('customerPayment').textContent=state.paymentLabel||'現金';
  const cashInfo=el('customerCashInfo');
  const qrInfo=el('customerQrInfo');
  const isCash=state.paymentMethod==='cash';
  const isQr=isQrPaymentMethod(state.paymentMethod);
  if(cashInfo){
    if(isCash){
      el('customerTendered').textContent=fmt(state.tendered||0);
      el('customerChange').textContent=fmt(state.change||0);
      cashInfo.hidden=false;
    }else{
      cashInfo.hidden=true;
    }
  }
  if(qrInfo){
    qrInfo.hidden=!isQr;
    if(isQr){
      el('customerQrMethod').textContent=`${state.paymentLabel||'QRコード決済'} に対応しています`;
    }
  }
  show('orderView');
}
function renderComplete(state){
  clearTimeout(completeTimer);el('completeOrderNo').textContent=String(state.orderNo||'---').padStart(3,'0');
  const cashDetail=state.paymentMethod==='cash' ? `　お預かり：${fmt(state.tendered||0)}` : '';
  el('completePayment').textContent=`お支払い：${state.paymentLabel||''}　${fmt(state.total)}${cashDetail}`;
  el('completeChange').textContent=state.paymentMethod==='cash' ? `お釣り：${fmt(state.change||0)}` : '';
  show('completeView');
  completeTimer=setTimeout(()=>show('standbyView'),6500);
}
function handleState(state){if(!state)return;if(state.type==='complete')renderComplete(state);else if(state.type==='order')renderOrder(state);else if(state.type==='ad-updated')loadAdVideo();else show('standbyView');}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
let bc=null;try{bc=new BroadcastChannel('kashima-pos-customer');bc.onmessage=e=>handleState(e.data)}catch(_){ }
window.addEventListener('storage',e=>{if(e.key==='kashimaCustomerState'&&e.newValue){try{handleState(JSON.parse(e.newValue))}catch(_){}}});
setInterval(()=>{try{const s=localStorage.getItem('kashimaCustomerState');if(s){const o=JSON.parse(s);if(o._ts&&(!window._lastStateTs||o._ts>window._lastStateTs)){window._lastStateTs=o._ts;handleState(o)}}}catch(_){}},500);
(async()=>{await openDB();await loadAdVideo();try{const s=localStorage.getItem('kashimaCustomerState');if(s)handleState(JSON.parse(s))}catch(_){}})();
