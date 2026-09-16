const DB_NAME='kashima-event-pos'; const DB_VERSION=1;
let db; let products=[]; let cart=new Map(); let selectedPayment='cash'; let fulfillmentPendingOnly=true; let tenderedAmount=0; let checkoutBusy=false; let lastCheckoutActivation=0; let editingSaleId=null;
let customerChannel=null; let customerWindow=null;
const fmt=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(n||0));
const el=id=>document.getElementById(id);
function makeId(){
  try{if(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')return globalThis.crypto.randomUUID()}catch(e){}
  try{
    if(globalThis.crypto&&typeof globalThis.crypto.getRandomValues==='function'){
      const a=new Uint32Array(4);globalThis.crypto.getRandomValues(a);
      return `id-${Date.now().toString(36)}-${Array.from(a,x=>x.toString(36)).join('-')}`;
    }
  }catch(e){}
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
const PAYMENT_METHODS={
  cash:{label:'現金',group:'現金'},
  paypay:{label:'PayPay',group:'QR決済'},
  rakutenpay:{label:'楽天ペイ',group:'QR決済'},
  dbarai:{label:'d払い',group:'QR決済'},
  aupay:{label:'au PAY',group:'QR決済'},
  credit:{label:'クレジットカード',group:'クレジットカード'}
};
const initialProducts=[
  {id:'baguette',name:'バゲットサンド',price:400,category:'フード',active:true,order:10},
  {id:'kinako',name:'きなこまみれ',price:400,category:'フード',active:true,order:20},
  {id:'curry',name:'牛すじカレー',price:800,category:'フード',active:true,order:30},
  {id:'monja',name:'もんじゃまん',price:350,category:'フード',active:true,order:40},
  {id:'cheese-monja',name:'チーズもんじゃまん',price:400,category:'フード',active:true,order:50},
  {id:'tofu-pork',name:'とうふ豚まん',price:400,category:'フード',active:true,order:60},
  {id:'coffee',name:'コーヒー（HOT）',price:300,category:'ドリンク',active:true,order:70},
  {id:'iced-coffee',name:'コーヒー（ICE）',price:300,category:'ドリンク',active:true,order:80},
  {id:'cafe-latte-hot',name:'カフェラテ（HOT）',price:400,category:'ドリンク',active:true,order:90},
  {id:'cafe-latte-ice',name:'カフェラテ（ICE）',price:400,category:'ドリンク',active:true,order:100},
  {id:'gelato-1',name:'ジェラート 1',price:400,category:'ジェラート',active:true,order:110},
  {id:'gelato-2',name:'ジェラート 2',price:400,category:'ジェラート',active:true,order:120},
  {id:'gelato-3',name:'ジェラート 3',price:400,category:'ジェラート',active:true,order:130},
];
const defaultSpacers=[
  {id:'spacer-drink-1',name:'空白',price:0,category:'ドリンク',active:true,order:85,isSpacer:true},
  {id:'spacer-drink-2',name:'空白',price:0,category:'ドリンク',active:true,order:105,isSpacer:true},
];
const CATEGORY_ORDER=['フード','ドリンク','ジェラート','その他'];
function categoryRank(cat){const i=CATEGORY_ORDER.indexOf(cat);return i>=0?i:CATEGORY_ORDER.length}

function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains('products'))d.createObjectStore('products',{keyPath:'id'});if(!d.objectStoreNames.contains('sales')){const s=d.createObjectStore('sales',{keyPath:'id'});s.createIndex('day','day',{unique:false});s.createIndex('ts','ts',{unique:false});}if(!d.objectStoreNames.contains('settings'))d.createObjectStore('settings',{keyPath:'key'});};req.onsuccess=()=>{db=req.result;resolve(db)};req.onerror=()=>reject(req.error);});}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function getAll(store){return new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(store,obj){return new Promise((res,rej)=>{const r=tx(store,'readwrite').put(obj);r.onsuccess=()=>res(obj);r.onerror=()=>rej(r.error)})}
function del(store,key){return new Promise((res,rej)=>{const r=tx(store,'readwrite').delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function getOne(store,key){return new Promise((res,rej)=>{const r=tx(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function seed(){
  const existing=await getAll('products');
  if(existing.length===0){for(const p of initialProducts)await put('products',p);return}
  const byId=new Map(existing.map(p=>[p.id,p]));
  for(const sp of defaultSpacers){if(!byId.has(sp.id))await put('products',sp)}
  for(const p of initialProducts){
    const cur=byId.get(p.id);
    if(!cur){await put('products',p);continue}
    if(cur.id==='coffee' && cur.price===0){cur.name='コーヒー（HOT）';cur.price=300;cur.category='ドリンク';cur.order=70;await put('products',cur)}
    if(cur.id==='iced-coffee' && cur.price===0){cur.name='コーヒー（ICE）';cur.price=300;cur.category='ドリンク';cur.order=80;await put('products',cur)}
    if(/^gelato-[123]$/.test(cur.id) && cur.price===0){cur.price=400;cur.category='ジェラート';await put('products',cur)}
  }
}
async function loadProducts(){products=(await getAll('products')).sort((a,b)=>(a.order||0)-(b.order||0));renderProducts();renderAdmin()}
function buildCustomerOrderState(){
  const items=[];let total=0;
  for(const [id,q] of cart){const p=products.find(x=>x.id===id);if(!p)continue;const subtotal=Number(p.price||0)*Number(q||0);items.push({name:p.name,qty:q,price:p.price,subtotal});total+=subtotal}
  if(!items.length)return {type:'idle'};
  return {type:'order',items,total,paymentMethod:selectedPayment,paymentLabel:(PAYMENT_METHODS[selectedPayment]||PAYMENT_METHODS.cash).label,tendered:selectedPayment==='cash'?tenderedAmount:total,change:selectedPayment==='cash'?Math.max(0,(tenderedAmount||0)-total):0};
}
function publishCustomerState(state){
  const payload={...state,_ts:Date.now()};
  try{if(customerChannel)customerChannel.postMessage(payload)}catch(_){ }
  try{localStorage.setItem('kashimaCustomerState',JSON.stringify(payload))}catch(_){ }
}
function publishCurrentOrder(){publishCustomerState(buildCustomerOrderState())}
function openCustomerDisplay(){
  try{customerWindow=window.open('./customer.html','kashimaCustomerDisplay');if(!customerWindow)toast('顧客表示を開けませんでした。ポップアップを許可してください');else{toast('顧客表示を開きました');setTimeout(publishCurrentOrder,300)}}catch(e){console.error(e);toast('顧客表示を開けませんでした')}
}
async function loadAdVideoMeta(){
  const nameEl=el('adVideoName');if(!nameEl)return;
  try{const rec=await getOne('settings','adVideo');nameEl.textContent=rec&&rec.name?`広告動画：${rec.name}`:'広告動画：未設定'}catch(_){nameEl.textContent='広告動画：未設定'}
}
async function saveAdVideoFile(file){
  if(!file)return;
  if(file.size>150*1024*1024){toast('動画は150MB以下を推奨します');return}
  try{await put('settings',{key:'adVideo',name:file.name,type:file.type||'video/mp4',size:file.size,updatedAt:new Date().toISOString(),blob:file});await loadAdVideoMeta();publishCustomerState({type:'ad-updated'});toast('広告動画を保存しました')}catch(e){console.error(e);alert('広告動画を保存できませんでした。\n'+(e&&e.message?e.message:String(e)))}
}
async function removeAdVideo(){
  if(!confirm('広告動画を削除しますか？'))return;
  await del('settings','adVideo');await loadAdVideoMeta();publishCustomerState({type:'ad-updated'});toast('広告動画を削除しました')
}

function renderProducts(){
  const g=el('productGrid');g.innerHTML='';
  const activeProducts=products.filter(p=>p.active && !p.isSpacer);
  el('activeProductCount').textContent=`販売中 ${activeProducts.length}品`;
  const makeSpacer=()=>{const s=document.createElement('div');s.className='product-spacer';s.setAttribute('aria-hidden','true');g.appendChild(s)};
  const appendProduct=p=>{const b=document.createElement('button');b.className='product-btn';b.disabled=p.price<=0;b.innerHTML=`<div class="name">${escapeHtml(p.name)}</div><div class="meta"><span class="cat">${escapeHtml(p.category||'')}</span><span class="price">${p.price>0?fmt(p.price):'価格未設定'}</span></div>`;b.onclick=()=>addToCart(p.id);g.appendChild(b)};
  // 各カテゴリー内の順番どおりに表示。isSpacer=true は任意の空白マスとして1セル消費する。
  const visible=products.filter(p=>p.isSpacer || p.active);
  const cats=CATEGORY_ORDER.map(cat=>({cat,items:visible.filter(p=>(p.category||'その他')===cat).sort((a,b)=>(a.order||0)-(b.order||0))})).filter(group=>group.items.length);
  const known=new Set(CATEGORY_ORDER);
  const extraCats=[...new Set(visible.map(p=>p.category||'その他').filter(cat=>!known.has(cat)))];
  extraCats.forEach(cat=>cats.push({cat,items:visible.filter(p=>(p.category||'その他')===cat).sort((a,b)=>(a.order||0)-(b.order||0))}));
  let cell=0;
  cats.forEach(group=>{
    while(cell%3!==0){makeSpacer();cell++}
    group.items.forEach(p=>{if(p.isSpacer)makeSpacer();else appendProduct(p);cell++});
    while(cell%3!==0){makeSpacer();cell++}
  });
}
function addToCart(id){const p=products.find(x=>x.id===id);if(!p||p.price<=0)return;cart.set(id,(cart.get(id)||0)+1);renderCart()}
function renderCart(){const list=el('cartList');list.innerHTML='';let total=0,count=0;for(const [id,q] of cart){const p=products.find(x=>x.id===id);if(!p)continue;total+=p.price*q;count+=q;const row=document.createElement('div');row.className='cart-row';row.innerHTML=`<div><div class="cart-name">${escapeHtml(p.name)}</div><div class="cart-sub">${fmt(p.price)} × ${q} = ${fmt(p.price*q)}</div></div><div class="qty-controls"><button data-act="minus">−</button><strong>${q}</strong><button data-act="plus">＋</button></div>`;row.querySelector('[data-act=minus]').onclick=()=>{q<=1?cart.delete(id):cart.set(id,q-1);renderCart()};row.querySelector('[data-act=plus]').onclick=()=>{cart.set(id,q+1);renderCart()};list.appendChild(row)}el('cartEmpty').style.display=cart.size?'none':'block';el('itemCount').textContent=`${count}点`;el('grandTotal').textContent=fmt(total);renderQuickCash(total);calcChange();updateCheckoutState();publishCurrentOrder()}
function cartTotal(){let t=0;for(const [id,q] of cart){const p=products.find(x=>x.id===id);if(p)t+=p.price*q}return t}
function setTenderedAmount(value){
  tenderedAmount=Math.max(0,Math.floor(Number(value)||0));
  el('tendered').value=tenderedAmount?fmt(tenderedAmount):'';
  el('tendered').dataset.value=String(tenderedAmount);
  calcChange();
}
function renderQuickCash(total){
  const q=el('quickCash');q.innerHTML='';
  const values=[500,1000,2000,5000,10000].filter(v=>v>=total).slice(0,4);
  values.forEach(v=>{const b=document.createElement('button');b.type='button';b.textContent=fmt(v);b.onclick=()=>setTenderedAmount(v);q.appendChild(b)});
  if(total>0){const exact=document.createElement('button');exact.type='button';exact.textContent='ちょうど';exact.className='exact-cash';exact.onclick=()=>setTenderedAmount(total);q.appendChild(exact)}
}
function calcChange(){const total=cartTotal();const tender=tenderedAmount;el('change').textContent=fmt(Math.max(0,tender-total));el('change').style.color=tender>=total&&total>0?'#065f46':'#b91c1c';updateCheckoutState()}
function openTenderDialog(){
  if(selectedPayment!=='cash')return;
  el('tenderPreview').textContent=fmt(tenderedAmount);
  el('tenderTotalPreview').textContent=fmt(cartTotal());
  el('tenderDialog').showModal();
}
function updateTenderPreview(){el('tenderPreview').textContent=fmt(tenderedAmount)}
function handleTenderKey(key){
  if(key==='clear'){tenderedAmount=0}
  else if(key==='back'){tenderedAmount=Math.floor(tenderedAmount/10)}
  else if(key==='exact'){tenderedAmount=cartTotal()}
  else if(/^\d$/.test(key)){if(tenderedAmount<1000000)tenderedAmount=tenderedAmount*10+Number(key)}
  updateTenderPreview();
}
function confirmTender(){setTenderedAmount(tenderedAmount);el('tenderDialog').close()}
function setPayment(method){if(!PAYMENT_METHODS[method])return;selectedPayment=method;document.querySelectorAll('.payment-method').forEach(b=>{const on=b.dataset.payment===method;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false')});const cash=method==='cash';el('cashPaymentArea').hidden=!cash;el('cashlessPaymentArea').hidden=cash;el('selectedPaymentLabel').textContent=PAYMENT_METHODS[method].label;el('currentPaymentDisplay').textContent=PAYMENT_METHODS[method].label;updateCheckoutState();publishCurrentOrder()}
function updateCheckoutState(){
  const total=cartTotal();
  const ready=total>0 && (selectedPayment!=='cash' || tenderedAmount>=total);
  const btn=el('checkout');
  // iPad/Safariでdisabled状態が残るケースを避けるため、ネイティブdisabledは使わない。
  btn.disabled=false;
  btn.classList.toggle('not-ready',!ready);
  btn.setAttribute('aria-disabled',ready?'false':'true');
  btn.dataset.ready=ready?'1':'0';
  btn.textContent=total>0?`会計完了（${PAYMENT_METHODS[selectedPayment].label}）`:'会計完了';
  const status=el('checkoutStatus');
  if(status){
    if(total<=0){status.textContent='商品を選択してください';status.className='checkout-status muted-state'}
    else if(selectedPayment==='cash' && tenderedAmount<total){status.textContent=`お預かり金があと ${fmt(total-tenderedAmount)} 必要です`;status.className='checkout-status warn-state'}
    else{status.textContent='会計できます';status.className='checkout-status ready-state'}
  }
}
function salePayment(s){const method=s.paymentMethod||'cash';return PAYMENT_METHODS[method]||PAYMENT_METHODS.cash}
function handleCheckoutActivation(e){
  if(e){try{e.preventDefault()}catch(_){} try{e.stopPropagation()}catch(_){}}
  const now=Date.now();
  if(checkoutBusy || now-lastCheckoutActivation<700)return;
  lastCheckoutActivation=now;
  const total=cartTotal();
  if(total<=0){toast('商品を選択してください');return}
  if(selectedPayment==='cash' && tenderedAmount<total){toast('お預かり金が不足しています');return}
  checkoutBusy=true;
  const btn=el('checkout');
  if(btn){btn.classList.add('processing');btn.textContent='会計処理中…'}
  toast('会計処理を開始しました');
  Promise.resolve().then(checkout).catch(err=>{
    console.error('checkout failed',err);
    alert('会計保存でエラーが発生しました。\n'+(err&&err.message?err.message:String(err)));
  }).finally(()=>{
    checkoutBusy=false;
    updateCheckoutState();
    if(btn)btn.classList.remove('processing');
  });
}
window.__kashimaCheckout=handleCheckoutActivation;
async function nextOrderNo(day){const sales=(await getAll('sales')).filter(s=>s.day===day);return sales.reduce((m,s)=>Math.max(m,Number(s.orderNo||0)),0)+1}
async function checkout(){
  const total=cartTotal();
  if(total<=0){toast('商品を選択してください');return;}
  let tender=0,change=0;
  if(selectedPayment==='cash'){
    tender=tenderedAmount;
    if(tender<total){toast('お預かり金が不足しています');return}
    change=tender-total;
  }else{tender=total;change=0}
  const items=[];
  for(const [id,q] of cart){const p=products.find(x=>x.id===id);items.push({productId:id,name:p.name,price:p.price,qty:q,subtotal:p.price*q,delivered:false})}
  const pm=PAYMENT_METHODS[selectedPayment];
  const day=Number(el('eventDay').value);const orderNo=await nextOrderNo(day);
  const sale={id:makeId(),ts:new Date().toISOString(),day,orderNo,items,total,paymentMethod:selectedPayment,paymentGroup:pm.group,paymentLabel:pm.label,tendered:tender,change,fulfilled:false,fulfilledAt:null};
  await put('sales',sale);
  const summary=`${fmt(total)} / ${pm.label}<br>${items.map(i=>`${escapeHtml(i.name)} × ${i.qty}`).join('<br>')}`;
  cart.clear();tenderedAmount=0;el('tendered').value='';setPayment('cash');renderCart();await refreshStats();await refreshFulfillment();
  el('checkoutOrderNo').textContent=String(orderNo).padStart(3,'0');el('checkoutSummary').innerHTML=summary;el('checkoutDialog').showModal();
  publishCustomerState({type:'complete',orderNo,total,paymentMethod:sale.paymentMethod,paymentLabel:sale.paymentLabel,tendered:sale.tendered,change:sale.change,items:sale.items.map(i=>({name:i.name,qty:i.qty,subtotal:i.subtotal}))});
}
async function refreshStats(){
  const day=Number(el('eventDay').value);
  const sales=(await getAll('sales')).filter(s=>s.day===day).sort((a,b)=>b.ts.localeCompare(a.ts));
  const sum=sales.reduce((a,s)=>a+s.total,0);const units=sales.reduce((a,s)=>a+s.items.reduce((x,i)=>x+i.qty,0),0);
  el('todaySales').textContent=fmt(sum);el('todayUnits').textContent=`${units}個`;el('todayTx').textContent=`${sales.length}件`;
  el('salesProgress').textContent=`目標 ¥142,000 / 達成率 ${Math.round(sum/142000*1000)/10}%`;el('unitsProgress').textContent=`目標 310個 / 達成率 ${Math.round(units/310*1000)/10}%`;el('salesBar').style.width=`${Math.min(100,sum/142000*100)}%`;
  renderPaymentSummary(sales);
  const log=el('salesLog');log.innerHTML='';
  if(!sales.length){log.innerHTML='<div class="empty small-empty">会計履歴はありません</div>';return}
  sales.forEach(s=>{
    const d=new Date(s.ts);const pm=salePayment(s);const div=document.createElement('div');div.className='log-item sale-manage-row';
    const order=String(s.orderNo||'?').padStart(3,'0');
    div.innerHTML=`<div class="sale-log-main"><strong>受付 ${order}　${d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}　${fmt(s.total)}</strong> <span class="payment-chip">${escapeHtml(pm.label)}</span><div class="sale-log-items">${s.items.map(i=>`${escapeHtml(i.name)}×${i.qty}`).join(' / ')}</div></div><div class="sale-log-actions"><button type="button" class="secondary edit-sale">修正</button><button type="button" class="danger-btn delete-sale">削除</button></div>`;
    bindTap(div.querySelector('.edit-sale'),()=>openSaleEdit(s.id));
    bindTap(div.querySelector('.delete-sale'),()=>deleteSale(s.id));
    log.appendChild(div)
  })
}
function renderPaymentSummary(sales){
  const totals={cash:0,paypay:0,rakutenpay:0,dbarai:0,aupay:0,credit:0};
  const counts={cash:0,paypay:0,rakutenpay:0,dbarai:0,aupay:0,credit:0};
  for(const s of sales){const m=PAYMENT_METHODS[s.paymentMethod]?s.paymentMethod:'cash';totals[m]+=Number(s.total||0);counts[m]++}
  const qrTotal=totals.paypay+totals.rakutenpay+totals.dbarai+totals.aupay;
  const qrCount=counts.paypay+counts.rakutenpay+counts.dbarai+counts.aupay;
  const wrap=el('paymentSummary');wrap.innerHTML='';
  const rows=[
    ['現金',totals.cash,counts.cash,'main'],
    ['QR決済 合計',qrTotal,qrCount,'main'],
    ['PayPay',totals.paypay,counts.paypay,'sub'],['楽天ペイ',totals.rakutenpay,counts.rakutenpay,'sub'],['d払い',totals.dbarai,counts.dbarai,'sub'],['au PAY',totals.aupay,counts.aupay,'sub'],
    ['クレジットカード',totals.credit,counts.credit,'main']
  ];
  for(const [label,amount,count,kind] of rows){const r=document.createElement('div');r.className=`payment-summary-row ${kind}`;r.innerHTML=`<span>${escapeHtml(label)}</span><strong>${fmt(amount)}</strong><small>${count}件</small>`;wrap.appendChild(r)}
}
function saleIsFulfilled(s){return Boolean(s.fulfilled) || (Array.isArray(s.items)&&s.items.length>0&&s.items.every(i=>Boolean(i.delivered)))}
async function refreshFulfillment(){
  const day=Number(el('eventDay').value);const all=(await getAll('sales')).filter(s=>s.day===day).sort((a,b)=>a.ts.localeCompare(b.ts));
  const pending=all.filter(s=>!saleIsFulfilled(s));el('pendingBadge').textContent=pending.length;
  const sales=fulfillmentPendingOnly?pending:all.slice().reverse();const list=el('fulfillmentList');list.innerHTML='';
  el('fulfillmentEmpty').style.display=sales.length?'none':'block';
  for(const s of sales){
    const d=new Date(s.ts);const pm=salePayment(s);const fulfilled=saleIsFulfilled(s);const card=document.createElement('article');card.className='fulfillment-card'+(fulfilled?' done':'');
    const order=String(s.orderNo||'?').padStart(3,'0');
    card.innerHTML=`<div class="fulfillment-card-head"><div><div class="order-no">受付番号 <strong>${order}</strong></div><div class="order-meta">${d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})} ・ ${escapeHtml(pm.label)} ・ ${fmt(s.total)}</div></div><span class="status-pill ${fulfilled?'done':'pending'}">${fulfilled?'受け渡し完了':'受け渡し待ち'}</span></div><div class="fulfillment-items"></div><div class="fulfillment-card-actions"><button type="button" class="secondary mark-all">${fulfilled?'すべて未渡しに戻す':'すべて渡した'}</button></div>`;
    const itemsWrap=card.querySelector('.fulfillment-items');
    s.items.forEach((i,index)=>{const row=document.createElement('label');row.className='fulfillment-item'+(i.delivered?' delivered':'');row.innerHTML=`<input type="checkbox" ${i.delivered?'checked':''} data-index="${index}"><span class="checkmark"></span><span class="fulfillment-name">${escapeHtml(i.name)}</span><strong>× ${i.qty}</strong>`;const cb=row.querySelector('input');cb.onchange=()=>setDelivered(s.id,index,cb.checked);itemsWrap.appendChild(row)});
    card.querySelector('.mark-all').onclick=()=>setAllDelivered(s.id,!fulfilled);list.appendChild(card)
  }
}
async function setDelivered(saleId,index,checked){const sales=await getAll('sales');const s=sales.find(x=>x.id===saleId);if(!s||!s.items[index])return;s.items[index].delivered=checked;s.fulfilled=s.items.every(i=>Boolean(i.delivered));s.fulfilledAt=s.fulfilled?new Date().toISOString():null;await put('sales',s);await refreshFulfillment();await refreshStats()}
async function setAllDelivered(saleId,checked){const sales=await getAll('sales');const s=sales.find(x=>x.id===saleId);if(!s)return;s.items=s.items.map(i=>({...i,delivered:checked}));s.fulfilled=checked;s.fulfilledAt=checked?new Date().toISOString():null;await put('sales',s);await refreshFulfillment();await refreshStats()}
function scrollToSection(id){
  const target=el(id);if(!target)return;
  try{target.scrollIntoView({behavior:'smooth',block:'start'})}catch(e){window.scrollTo(0,target.offsetTop||0)}
}
async function showView(name){
  const register=name==='register';
  el('showRegister').classList.toggle('active',register);
  el('showFulfillment').classList.toggle('active',!register);
  if(!register){await refreshFulfillment();requestAnimationFrame(()=>scrollToSection('fulfillmentView'))}
  else{requestAnimationFrame(()=>scrollToSection('registerView'))}
}
function bindTap(target,handler){
  if(!target)return;let last=0;
  const fire=e=>{const now=Date.now();if(now-last<450)return;last=now;try{e&&e.preventDefault&&e.preventDefault()}catch(_){};handler(e)};
  target.addEventListener('click',fire,{passive:false});
  target.addEventListener('pointerup',fire,{passive:false});
  target.addEventListener('touchend',fire,{passive:false});
}

function makeSaleEditRow(item){
  const row=document.createElement('div');
  row.className='sale-edit-item';
  row.dataset.productId=String(item.productId||'');
  row.dataset.name=String(item.name||'');
  row.dataset.price=String(Number(item.price||0));
  row.dataset.delivered=item.delivered?'1':'0';
  row.innerHTML=`<div><strong>${escapeHtml(item.name)}</strong><small>${fmt(item.price)} / 個</small></div><div class="sale-edit-qty"><button type="button" data-dir="-1">−</button><strong class="sale-edit-qty-value">${Number(item.qty||0)}</strong><button type="button" data-dir="1">＋</button></div>`;
  row.querySelectorAll('button').forEach(b=>bindTap(b,()=>{
    const q=Number(row.querySelector('.sale-edit-qty-value').textContent)||0;
    const next=Math.max(0,q+Number(b.dataset.dir));
    row.querySelector('.sale-edit-qty-value').textContent=String(next);
    updateSaleEditTotal();
  }));
  return row;
}
function saleEditAllowedPrices(){
  const set=new Set();
  el('saleEditItems').querySelectorAll('.sale-edit-item').forEach(row=>{
    const q=Number(row.querySelector('.sale-edit-qty-value').textContent||0);
    const price=Number(row.dataset.price||0);
    if(q>0&&price>0)set.add(price);
  });
  return set;
}
function renderSaleEditAddProducts(){
  const wrap=el('saleEditAddProducts');if(!wrap)return;
  wrap.innerHTML='';
  const prices=saleEditAllowedPrices();
  const candidates=products.filter(p=>Number(p.price)>0&&prices.has(Number(p.price)));
  if(!candidates.length){wrap.innerHTML='<div class="sale-edit-add-empty">同額で追加できる商品はありません</div>';return}
  candidates.forEach(p=>{
    const b=document.createElement('button');b.type='button';b.className='sale-edit-add-btn';
    b.innerHTML=`${escapeHtml(p.name)}<small>${fmt(p.price)}</small>`;
    bindTap(b,()=>addProductToSaleEdit(p));wrap.appendChild(b);
  });
}
function addProductToSaleEdit(p){
  const wrap=el('saleEditItems');
  const existing=[...wrap.querySelectorAll('.sale-edit-item')].find(row=>row.dataset.productId===String(p.id)&&Number(row.dataset.price)===Number(p.price));
  if(existing){
    const qEl=existing.querySelector('.sale-edit-qty-value');qEl.textContent=String((Number(qEl.textContent)||0)+1);
  }else{
    wrap.appendChild(makeSaleEditRow({productId:p.id,name:p.name,price:p.price,qty:1,subtotal:p.price,delivered:false}));
  }
  updateSaleEditTotal();
  toast(`${p.name}を追加しました`);
}
async function openSaleEdit(saleId){
  const sales=await getAll('sales');const s=sales.find(x=>x.id===saleId);if(!s)return;
  editingSaleId=saleId;
  const d=new Date(s.ts);el('saleEditMeta').textContent=`受付 ${String(s.orderNo||'?').padStart(3,'0')} / ${d.toLocaleString('ja-JP')}`;
  el('saleEditPayment').value=PAYMENT_METHODS[s.paymentMethod]?s.paymentMethod:'cash';
  const wrap=el('saleEditItems');wrap.innerHTML='';
  s.items.forEach(i=>wrap.appendChild(makeSaleEditRow(i)));
  updateSaleEditTotal();renderSaleEditAddProducts();el('saleEditDialog').showModal();
}
function updateSaleEditTotal(){
  let total=0;el('saleEditItems').querySelectorAll('.sale-edit-item').forEach(row=>{total+=Number(row.dataset.price||0)*Number(row.querySelector('.sale-edit-qty-value').textContent||0)});el('saleEditTotal').textContent=fmt(total);
  renderSaleEditAddProducts();
}
async function saveSaleEdit(){
  if(!editingSaleId)return;const sales=await getAll('sales');const s=sales.find(x=>x.id===editingSaleId);if(!s)return;
  const rows=[...el('saleEditItems').querySelectorAll('.sale-edit-item')];
  const newItems=[];
  rows.forEach(row=>{
    const qty=Number(row.querySelector('.sale-edit-qty-value').textContent||0);if(qty<=0)return;
    const price=Number(row.dataset.price||0);const productId=row.dataset.productId||'';const name=row.dataset.name||'';
    newItems.push({productId,name,price,qty,subtotal:price*qty,delivered:row.dataset.delivered==='1'});
  });
  if(!newItems.length){toast('商品を1点以上残してください');return}
  s.items=newItems;s.total=newItems.reduce((a,i)=>a+Number(i.subtotal||0),0);
  s.paymentMethod=el('saleEditPayment').value;const pm=PAYMENT_METHODS[s.paymentMethod]||PAYMENT_METHODS.cash;s.paymentGroup=pm.group;s.paymentLabel=pm.label;
  if(s.paymentMethod==='cash'){s.tendered=Math.max(Number(s.tendered||0),s.total);s.change=Math.max(0,s.tendered-s.total)}else{s.tendered=s.total;s.change=0}
  s.fulfilled=s.items.length>0&&s.items.every(i=>Boolean(i.delivered));s.fulfilledAt=s.fulfilled?(s.fulfilledAt||new Date().toISOString()):null;
  s.editedAt=new Date().toISOString();await put('sales',s);el('saleEditDialog').close();editingSaleId=null;await refreshStats();await refreshFulfillment();toast('売上を修正しました')
}
async function deleteSale(saleId){
  const sales=await getAll('sales');const s=sales.find(x=>x.id===saleId);if(!s)return;const order=String(s.orderNo||'?').padStart(3,'0');
  if(!confirm(`受付 ${order}（${fmt(s.total)}）を削除しますか？\nこの操作は元に戻せません。`))return;
  await del('sales',saleId);await refreshStats();await refreshFulfillment();toast('売上を削除しました')
}
async function clearCurrentDaySales(){
  const day=Number(el('eventDay').value);const sales=(await getAll('sales')).filter(s=>s.day===day);
  if(!sales.length){toast('削除する売上がありません');return}
  const sum=sales.reduce((a,s)=>a+Number(s.total||0),0);
  if(!confirm(`${day}日目の売上 ${sales.length}件（${fmt(sum)}）をすべて削除しますか？\n受け渡しデータも削除されます。`))return;
  if(!confirm('本当にすべて削除しますか？\n本番データの場合は元に戻せません。'))return;
  for(const s of sales)await del('sales',s.id);
  await refreshStats();await refreshFulfillment();toast(`${day}日目の売上を全消去しました`)
}

function renderAdmin(){
  const list=el('adminList');if(!list)return;list.innerHTML='';let lastCat=null;
  products.forEach((p,idx)=>{
    const cat=p.category||'その他';
    if(cat!==lastCat){
      const h=document.createElement('div');h.className='admin-category-heading';
      h.innerHTML=`<span>${escapeHtml(cat)}</span><div class="admin-category-actions"><small>このカテゴリーの商品</small><button type="button" class="mini add-spacer">＋ 空白</button></div>`;
      h.querySelector('.add-spacer').onclick=()=>addSpacer(cat);
      list.appendChild(h);lastCat=cat;
    }
    const row=document.createElement('div');
    if(p.isSpacer){
      row.className='admin-row spacer-row';
      row.innerHTML=`<div class="admin-main"><strong><span class="admin-order-no">${idx+1}</span>［空白マス］</strong><small><span class="category-chip">${escapeHtml(cat)}</span> レジ画面で1マス空けます</small></div><button type="button" class="mini move-up" title="1つ上へ">↑</button><button type="button" class="mini move-down" title="1つ下へ">↓</button><button type="button" class="mini delete-spacer">削除</button>`;
      row.querySelector('.move-up').onclick=()=>moveProduct(p.id,-1);row.querySelector('.move-down').onclick=()=>moveProduct(p.id,1);row.querySelector('.delete-spacer').onclick=()=>deleteSpacer(p.id);list.appendChild(row);return;
    }
    row.className='admin-row'+(p.active?'':' off');
    row.innerHTML=`<div class="admin-main"><strong><span class="admin-order-no">${idx+1}</span>${escapeHtml(p.name)}</strong><small><span class="category-chip">${escapeHtml(cat)}</span> ${fmt(p.price)}</small></div><button type="button" class="mini move-up" title="1つ上へ" aria-label="${escapeHtml(p.name)}を1つ上へ">↑</button><button type="button" class="mini move-down" title="1つ下へ" aria-label="${escapeHtml(p.name)}を1つ下へ">↓</button><button type="button" class="mini edit">編集</button><button type="button" class="mini toggle">${p.active?'停止':'再開'}</button>`;
    row.querySelector('.move-up').onclick=()=>moveProduct(p.id,-1);row.querySelector('.move-down').onclick=()=>moveProduct(p.id,1);row.querySelector('.edit').onclick=()=>openEdit(p.id);row.querySelector('.toggle').onclick=()=>toggleProduct(p.id);list.appendChild(row)
  })
}
async function addSpacer(category){
  const catItems=products.filter(p=>(p.category||'その他')===category).sort((a,b)=>(a.order||0)-(b.order||0));
  const last=catItems.at(-1);let order=last?Number(last.order||0)+1:Math.max(0,...products.map(p=>Number(p.order||0)))+10;
  await put('products',{id:`spacer-${makeId()}`,name:'空白',price:0,category,active:true,order,isSpacer:true});
  await sortProductsByCategory(false);await ensureAdminOpen();toast(`${category}に空白マスを追加しました`)
}
async function ensureAdminOpen(){const d=el('adminDialog');if(d&&!d.open){try{d.showModal()}catch(_){}}}
async function deleteSpacer(id){await del('products',id);await loadProducts();await ensureAdminOpen();toast('空白マスを削除しました')}
async function moveProduct(id,dir){const idx=products.findIndex(p=>p.id===id);const target=idx+dir;if(target<0||target>=products.length)return;const a=products[idx],b=products[target];const ao=Number(a.order||((idx+1)*10)),bo=Number(b.order||((target+1)*10));a.order=bo;b.order=ao;await put('products',a);await put('products',b);await loadProducts();await ensureAdminOpen();toast('商品の並び順を変更しました')}
async function sortProductsByCategory(showToast=true){const sorted=[...products].sort((a,b)=>{const ca=categoryRank(a.category||'その他'),cb=categoryRank(b.category||'その他');if(ca!==cb)return ca-cb;return Number(a.order||0)-Number(b.order||0)});for(let i=0;i<sorted.length;i++){sorted[i].order=(i+1)*10;await put('products',sorted[i])}await loadProducts();await ensureAdminOpen();if(showToast)toast('カテゴリー順に並べ替えました')}
function openEdit(id){const p=products.find(x=>x.id===id);el('editId').value=p.id;el('editName').value=p.name;el('editPrice').value=p.price;el('editCategory').value=p.category||'その他';el('editDialog').showModal()}
async function saveEdit(){const id=el('editId').value;const p=products.find(x=>x.id===id);p.name=el('editName').value.trim();p.price=Number(el('editPrice').value||0);p.category=el('editCategory').value;if(!p.name){toast('商品名を入力してください');return}await put('products',p);el('editDialog').close();await loadProducts();await ensureAdminOpen();renderCart();toast('商品を更新しました')}
async function toggleProduct(id){const p=products.find(x=>x.id===id);p.active=!p.active;await put('products',p);await loadProducts();await ensureAdminOpen();toast(p.active?'販売を再開しました':'販売停止にしました')}
async function addProduct(){const name=el('newName').value.trim();const price=Number(el('newPrice').value||0);const category=el('newCategory').value;if(!name){toast('商品名を入力してください');return}const max=Math.max(0,...products.map(p=>p.order||0));await put('products',{id:makeId(),name,price,category,active:true,order:max+10});el('newName').value='';el('newPrice').value='';await loadProducts();await ensureAdminOpen();toast('商品を追加しました')}
function publicAccountingId(s){
  // IndexedDB内部の一意IDはそのまま維持し、CSVには人が読みやすい会計IDを出力する。
  // 鹿嶋まつり2026は1日目=10/3、2日目=10/4として、受付番号を末尾につけて一意にする。
  const datePart=Number(s.day)===2?'20261004':'20261003';
  const order=String(Number(s.orderNo||0)).padStart(3,'0');
  return `kashima-m${datePart}-${order}`;
}

async function exportCSV(){
  const sales=(await getAll('sales')).sort((a,b)=>a.ts.localeCompare(b.ts));
  const rows=[['日時','日','受付番号','会計ID','決済区分','決済方法','商品名','単価','数量','小計','商品受渡済','注文受渡完了','会計合計','預かり','お釣り']];
  for(const s of sales){const pm=salePayment(s);for(const i of s.items)rows.push([new Date(s.ts).toLocaleString('ja-JP'),s.day,s.orderNo??'',publicAccountingId(s),pm.group,pm.label,i.name,i.price,i.qty,i.subtotal,i.delivered?'済':'未',saleIsFulfilled(s)?'済':'未',s.total,s.tendered??'',s.change??''])}
  download('kashima_pos_sales.csv','\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8')
}
async function exportBackup(){const data={exportedAt:new Date().toISOString(),products:await getAll('products'),sales:await getAll('sales')};download('kashima_pos_backup.json',JSON.stringify(data,null,2),'application/json')}
function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}
function download(name,content,type){const blob=new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(msg){const t=el('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),1800)}
function updateOnline(){el('offlineBadge').textContent=navigator.onLine?'オンライン':'オフライン';el('offlineBadge').classList.toggle('online',navigator.onLine)}
async function init(){
  await openDB();try{customerChannel=new BroadcastChannel('kashima-pos-customer')}catch(_){customerChannel=null}await seed();await loadProducts();renderCart();await refreshStats();await refreshFulfillment();await loadAdVideoMeta();
  el('openAdmin').onclick=()=>el('adminDialog').showModal();bindTap(el('openCustomerDisplay'),openCustomerDisplay);bindTap(el('previewCustomerDisplay'),openCustomerDisplay);el('adVideoFile').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)saveAdVideoFile(f);e.target.value=''});bindTap(el('removeAdVideo'),removeAdVideo);el('addProduct').onclick=addProduct;bindTap(el('sortByCategory'),sortProductsByCategory);el('saveEdit').onclick=saveEdit;const checkoutBtn=el('checkout');checkoutBtn.onclick=handleCheckoutActivation;checkoutBtn.addEventListener('pointerup',handleCheckoutActivation,{passive:false});checkoutBtn.addEventListener('touchend',handleCheckoutActivation,{passive:false});document.addEventListener('pointerup',e=>{const b=e.target&&e.target.closest?e.target.closest('#checkout'):null;if(b)handleCheckoutActivation(e)},{capture:true,passive:false});el('clearCart').onclick=()=>{cart.clear();renderCart()};el('tendered').onclick=openTenderDialog;el('tendered').onfocus=e=>e.target.blur();
  el('eventDay').onchange=async()=>{await refreshStats();await refreshFulfillment()};bindTap(el('refreshStats'),async()=>{await refreshStats();toast('本日の状況を更新しました')});bindTap(el('clearDaySales'),clearCurrentDaySales);el('exportCsv').onclick=exportCSV;el('exportBackup').onclick=exportBackup;bindTap(el('saveSaleEdit'),saveSaleEdit);
  el('paymentMethods').addEventListener('click',e=>{const b=e.target.closest('.payment-method');if(b)setPayment(b.dataset.payment)});setPayment('cash');
  el('tenderPad').addEventListener('click',e=>{const b=e.target.closest('[data-key]');if(b)handleTenderKey(b.dataset.key)});el('confirmTender').onclick=confirmTender;el('cancelTender').onclick=()=>el('tenderDialog').close();el('tenderExact').onclick=()=>{handleTenderKey('exact')};
  bindTap(el('showRegister'),()=>showView('register'));bindTap(el('showFulfillment'),()=>showView('fulfillment'));bindTap(el('refreshFulfillment'),async()=>{await refreshFulfillment();toast('受け渡し一覧を更新しました')});
  el('filterPending').onclick=()=>{fulfillmentPendingOnly=true;el('filterPending').classList.add('active');el('filterAll').classList.remove('active');refreshFulfillment()};
  el('filterAll').onclick=()=>{fulfillmentPendingOnly=false;el('filterAll').classList.add('active');el('filterPending').classList.remove('active');refreshFulfillment()};
  el('closeCheckoutDialog').onclick=()=>el('checkoutDialog').close();bindTap(el('goFulfillment'),()=>{try{el('checkoutDialog').close()}catch(_){};setTimeout(()=>showView('fulfillment'),80)});
  setInterval(()=>el('clock').textContent=new Date().toLocaleString('ja-JP'),1000);updateOnline();window.addEventListener('online',updateOnline);window.addEventListener('offline',updateOnline);
  if('serviceWorker'in navigator){try{const reg=await navigator.serviceWorker.register('./sw.js?v=18');if(navigator.onLine){try{await reg.update()}catch(_){}}}catch(e){console.warn('SW register failed',e)}}
}

init();
