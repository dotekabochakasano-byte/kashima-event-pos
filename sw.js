const CACHE='kashima-event-pos-v16';
const ASSETS=['./','./index.html','./styles.css?v=16','./app.js?v=16','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(event.request.mode==='navigate'){
      return (await cache.match('./index.html')) || (await cache.match('./')) || new Response('オフライン用画面を読み込めません',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
    }
    const hit=await cache.match(event.request,{ignoreSearch:true});
    if(hit) return hit;
    // 完全オフライン運用時に不要なネットワーク要求を発生させない。
    return new Response('',{status:204});
  })());
});
