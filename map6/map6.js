/* OlympicMap: Leaflet 1.9.4, WGS84 lat/lon data, no location request until a button click.
 * await OlympicMap.mount(containerId, dataUrl) returns an instance.
 * Optional data.fallbackGeoJSON or data.fallbackUrl provides local OSM geometry.
 * Tiles load only through Leaflet for the visible viewport. No tile cache/prefetch job.
 */
(function(global){
  'use strict';
  let active=null;
  let serial=0;
  const PARK=[40.019,116.389];
  const DEFAULT_TILES='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const OSM_CREDIT='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  const valid=(x)=>Array.isArray(x)&&x.length>=2&&Number.isFinite(+x[0])&&Number.isFinite(+x[1])&&Math.abs(+x[0])<=90&&Math.abs(+x[1])<=180;
  const coords=(arr)=>(Array.isArray(arr)?arr:[]).filter(valid).map(p=>[+p[0],+p[1]]);
  const node=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;};
  const safeUrl=(s)=>{if(typeof s!=='string'||!s.trim())return null;try{const u=new URL(s,location.href);return u.protocol==='https:'||u.protocol==='http:'?u.href:null;}catch{return null;}};
  const localSourceUrl=(s,base)=>new URL(s,base).href;
  function fallbackStyle(feature){
    const raw=feature.properties||{},p=raw.tags||raw,kind=String(p.kind||p.landuse||p.natural||p.waterway||p.highway||p.class||p.type||'');
    const geom=feature.geometry?.type||'';
    if(/water|lake|reservoir|river|stream|basin/i.test(kind)||p.water){return{color:'#8db8ca',weight:1,fillColor:'#b6dce9',fillOpacity:.95,interactive:false};}
    if(/Polygon/.test(geom)){return{color:'#b6c6a9',weight:.7,fillColor:/building/.test(kind)||p.building?'#ddd9ca':'#dce9cd',fillOpacity:.8,interactive:false};}
    const major=/primary|secondary|tertiary|residential|service/.test(kind);
    return{color:major?'#c3bba6':'#b4b1a2',weight:major?3:1.3,opacity:.85,fill:false,dashArray:major?null:'3 3',interactive:false};
  }
  async function mount(containerId,dataUrl){
    if(!global.L?.map)throw new Error('Leaflet 1.9.4 must be loaded before map6.js.');
    const host=typeof containerId==='string'?document.getElementById(containerId):containerId;
    if(!host)throw new Error('Map container not found: '+containerId);
    if(host.__olympicMap)host.__olympicMap.destroy();
    const baseUrl=typeof dataUrl==='string'?new URL(dataUrl,location.href).href:location.href;
    let data;
    if(typeof dataUrl==='object'&&dataUrl!==null)data=dataUrl;
    else{const response=await fetch(baseUrl,{credentials:'same-origin'});if(!response.ok)throw new Error('Map data could not load ('+response.status+').');data=await response.json();}
    host.classList.add('olm6');host.replaceChildren();
    const toolbar=node('div','olm6-toolbar');toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','地图操作');
    const view=node('div','olm6-view');view.id='olm6-view-'+(++serial);view.setAttribute('aria-label','可拖动和双指缩放的真实地图');
    const status=node('div','olm6-status','地图加载中…');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const legend=node('div','olm6-legend');
    [['','游览路线'],['olm6-approach','停车接入'],['olm6-position','我的位置']].forEach(([cls,label])=>{const span=node('span');span.append(node('i',cls),document.createTextNode(label));legend.append(span);});
    host.append(toolbar,view,status,legend);
    const announce=(text,level='info')=>{status.textContent=text;status.dataset.level=level;};
    function button(text,label,handler,cls=''){const b=node('button','olm6-button '+cls,text);b.type='button';b.setAttribute('aria-label',label);b.title=label;b.addEventListener('click',handler);toolbar.append(b);return b;}
    let current='forest',destroyed=false,expanded=false,restoreOverflow='',restoreScroll=0,placeholder=null,locationPending=false;
    let tileSuccess=0,tileErrors=0,fallbackLoaded=false,locationLayer=null,fallbackLayer=null,loadTimer=null;
    const layers=L.featureGroup();const markers=new Map();let currentBounds=null;
    const map=L.map(view,{crs:L.CRS.EPSG3857,zoomControl:false,fadeAnimation:false,attributionControl:true,dragging:true,touchZoom:true,doubleClickZoom:true,scrollWheelZoom:true,boxZoom:false,zoomSnap:.25,zoomDelta:1,minZoom:12,maxZoom:L.Browser.retina?18:19,preferCanvas:true});
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.createPane('olm6-local-base');map.getPane('olm6-local-base').style.zIndex='190';
    map.getPane('olm6-local-base').style.pointerEvents='none';
    map.setView(PARK,15);layers.addTo(map);L.control.scale({position:'bottomleft',imperial:false,maxWidth:100}).addTo(map);
    const tile=L.tileLayer(data.tileUrl||DEFAULT_TILES,{maxZoom:19,detectRetina:true,attribution:data.tileAttribution||OSM_CREDIT,keepBuffer:1,updateWhenIdle:true,updateWhenZooming:false});
    const mapInfo=()=>current==='forest'?'双指缩放、拖动看路；点停车口或编号可直接打开高德导航。':'两馆只看外观。点建筑或停车点查看导航；实际开放通道以现场为准。';
    tile.on('tileload',()=>{tileSuccess++;if(tileSuccess===1&&!locationPending)announce(mapInfo());});
    tile.on('tileerror',()=>{tileErrors++;if(tileErrors>=2&&tileSuccess===0&&!locationPending)announce(fallbackLoaded?'在线底图暂不可用，已显示本地真实路网与路线；仍可点目的地导航。':'在线底图暂不可用；路线与目的地点仍可用，也可直接打开高德导航。','error');});
    // Image requests preserve browser Referer and normal HTTP caching. No preload loops.
    tile.addTo(map);
    button('−','缩小地图',()=>zoom(-1));button('＋','放大地图',()=>zoom(1));button('全路线','查看完整路线与停车点',()=>fit());
    const full=button('全屏','全屏查看地图',()=>toggleFullscreen());
    const locate=button('我的位置','定位我的当前位置',()=>locateOnce(),'olm6-button-location');

    async function addFallback(){
      try{
        let geo=data.fallbackGeoJSON;
        if(!geo&&data.fallbackUrl){const r=await fetch(localSourceUrl(data.fallbackUrl,baseUrl),{credentials:'same-origin'});if(!r.ok)throw new Error('fallback '+r.status);geo=await r.json();}
        if(destroyed||!geo)return;
        fallbackLayer=L.geoJSON(geo,{pane:'olm6-local-base',interactive:false,style:fallbackStyle,pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:2,color:'#728478',fillOpacity:.6,interactive:false,pane:'olm6-local-base'})}).addTo(map);
        (data.baseLabels||[]).forEach(p=>{const span=node('span','',p.label);L.marker([p.lat,p.lon],{pane:'olm6-local-base',interactive:false,keyboard:false,icon:L.divIcon({className:'olm6-base-label',html:span.outerHTML,iconSize:[90,24],iconAnchor:[45,12]})}).addTo(fallbackLayer);});
        fallbackLoaded=true;
        if(data.fallbackAttribution)map.attributionControl.addAttribution(data.fallbackAttribution);
        if(tileErrors&&!tileSuccess&&!locationPending)announce('在线底图暂不可用，已显示本地真实路网与路线；仍可点目的地导航。','error');
      }catch(error){if(!destroyed&&tileErrors&&!tileSuccess)announce('底图加载受限；路线点仍可点开高德导航。','error');}
    }
    function popup(p){
      const box=node('div');box.append(node('strong','',p.label||p.id));if(p.note)box.append(node('p','',p.note));
      const url=safeUrl(p.url);if(url){const a=node('a','olm6-go',p.navLabel||((String(p.id).toUpperCase()==='P'||p.kind==='parking')?'高德驾车到这里 ↗':'高德步行到这里 ↗'));a.href=url;a.target='_blank';a.rel='noopener';box.append(a);}
      return box;
    }
    function showMode(next){
      if(destroyed)return api;if(!data[next]){announce('这个区域的路线尚未加载。','error');return api;}
      current=next;legend.hidden=next==='central';layers.clearLayers();markers.clear();const section=data[next];const bounds=L.latLngBounds([]);
      const route=coords(section.route),approach=coords(section.approach);
      if(route.length>1){L.polyline(route,{color:'white',weight:8,opacity:.95,interactive:false}).addTo(layers);L.polyline(route,{color:'#d25b37',weight:4.5,opacity:.98,lineCap:'round',lineJoin:'round'}).addTo(layers);route.forEach(p=>bounds.extend(p));}
      if(approach.length>1){L.polyline(approach,{color:'white',weight:6,opacity:.9,interactive:false}).addTo(layers);L.polyline(approach,{color:'#476b91',weight:3.5,dashArray:'7 6',opacity:1}).addTo(layers);approach.forEach(p=>bounds.extend(p));}
      (section.points||[]).forEach(p=>{
        const ll=[+p.lat,+p.lon];if(!valid(ll))return;const id=String(p.id),parking=id.toUpperCase()==='P'||p.kind==='parking';const gate=p.kind==='gate'||id.toUpperCase()==='G';
        const label=node('span','',id);const icon=L.divIcon({className:'olm6-pin'+(parking?' olm6-parking':'')+(gate?' olm6-gate':''),html:label.outerHTML,iconSize:[44,44],iconAnchor:[22,22],popupAnchor:[0,-20]});
        const marker=L.marker(ll,{icon,title:p.label||id,keyboard:true,alt:p.label||id,riseOnHover:true}).bindPopup(popup(p),{maxWidth:285,autoPanPadding:[20,22],closeButton:true});
        marker.bindTooltip(p.label||id,{direction:gate?'bottom':'top',offset:gate?[0,18]:[0,-18],className:'olm6-point-label',permanent:gate,opacity:1});
        marker.addTo(layers);markers.set(id,marker);bounds.extend(ll);
      });
      currentBounds=bounds.isValid()?bounds:null;fit();refreshStartMarker();if(!locationPending)announce(mapInfo());return api;
    }
    function fit(){if(destroyed)return api;map.stop();map.closePopup();map.invalidateSize({pan:false});if(currentBounds)map.fitBounds(currentBounds,{padding:[32,40],maxZoom:16,animate:false});return api;}
    function refreshStartMarker(){const s=markers.get('S');if(!s||current!=='forest')return;const on=map.getZoom()>=16;if(on&&!layers.hasLayer(s))layers.addLayer(s);if(!on&&layers.hasLayer(s))layers.removeLayer(s);}
    map.on('zoomend',refreshStartMarker);
    function focus(id){if(destroyed)return api;if(current==='central'&&id==='R')id='M';let marker=markers.get(String(id));if(!marker){const next=['forest','central'].find(k=>(data[k]?.points||[]).some(p=>String(p.id)===String(id)));if(next){showMode(next);marker=markers.get(String(id));}}if(marker){if(!layers.hasLayer(marker))layers.addLayer(marker);map.setView(marker.getLatLng(),Math.max(map.getZoom(),17),{animate:!matchMedia('(prefers-reduced-motion: reduce)').matches});marker.openPopup();}else announce('地图暂未找到这个点，可使用停车或场馆导航链接。','error');return api;}
    function zoom(delta){if(!destroyed){map.stop();map.setZoom(Math.min(map.getMaxZoom(),Math.max(map.getMinZoom(),map.getZoom()+Number(delta))),{animate:false});}return api;}
    function resize(){if(!destroyed){map.invalidateSize({pan:false});requestAnimationFrame(()=>{if(!destroyed)map.invalidateSize({pan:false});});}}
    function fullscreenState(){const on=document.fullscreenElement===host||expanded;full.textContent=on?'退出全屏':'全屏';full.setAttribute('aria-label',on?'退出全屏地图':'全屏查看地图');full.setAttribute('aria-pressed',String(on));resize();}
    function enterFallback(){
      if(expanded)return;expanded=true;restoreOverflow=document.body.style.overflow;restoreScroll=scrollY;
      placeholder=document.createComment('OlympicMap fullscreen placeholder');host.parentNode.insertBefore(placeholder,host);document.body.append(host);host.classList.add('olm6-expanded');document.body.style.overflow='hidden';fullscreenState();full.focus();
    }
    function exitFallback(){
      if(!expanded)return;expanded=false;host.classList.remove('olm6-expanded');if(placeholder?.parentNode){placeholder.parentNode.replaceChild(host,placeholder);}placeholder=null;document.body.style.overflow=restoreOverflow;global.scrollTo({top:restoreScroll,behavior:'auto'});fullscreenState();full.focus({preventScroll:true});
    }
    async function toggleFullscreen(){
      if(document.fullscreenElement===host){await document.exitFullscreen();return;}
      if(expanded){exitFallback();return;}
      if(host.requestFullscreen){try{await host.requestFullscreen();return;}catch{}}
      enterFallback();
    }
    function onEscape(e){if(e.key==='Escape'&&expanded){e.preventDefault();exitFallback();}}
    function locateOnce(){
      if(locationPending||destroyed)return;
      if(!navigator.geolocation){announce('此浏览器不支持定位，请点停车点或场馆点打开高德。','error');return;}
      if(!global.isSecureContext){announce('定位需要HTTPS页面；仍可使用地图上的导航按钮。','error');return;}
      locationPending=true;locate.disabled=true;announce('正在请求当前位置…只用于当前页面显示。');
      navigator.geolocation.getCurrentPosition(position=>{
        if(destroyed)return;locationPending=false;locate.disabled=false;
        const ll=L.latLng(position.coords.latitude,position.coords.longitude),accuracy=Math.max(1,+position.coords.accuracy||1),distance=map.distance(ll,L.latLng(PARK));
        if(locationLayer)map.removeLayer(locationLayer);locationLayer=L.featureGroup();
        L.circle(ll,{radius:accuracy,color:'#248bd1',weight:1,fillColor:'#248bd1',fillOpacity:.1,interactive:false}).addTo(locationLayer);
        L.circleMarker(ll,{radius:7,color:'white',weight:3,fillColor:'#248bd1',fillOpacity:1}).bindPopup('我的当前位置，精度约'+Math.round(accuracy)+'米。').addTo(locationLayer);locationLayer.addTo(map);
        if(distance>8000){announce('定位成功，但你距园区约'+(distance/1000).toFixed(1)+'公里。地图保留游览路线；到园后可再点定位。');return;}
        map.setView(ll,Math.min(17,map.getZoom()+1),{animate:true});announce('已显示当前位置，定位精度约'+Math.round(accuracy)+'米。请结合精度圈和现场路牌确认位置。');
      },error=>{
        if(destroyed)return;locationPending=false;locate.disabled=false;
        const reason=error.code===1?'未获得定位权限':error.code===3?'定位等待超时':'暂时无法取得位置';announce(reason+'。路线仍可使用，也可点目的地打开高德导航。','error');
      },{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
    }
    document.addEventListener('fullscreenchange',fullscreenState);document.addEventListener('keydown',onEscape);
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;observer?.observe(host);global.addEventListener('resize',resize);
    const api={map,container:host,showMode,focus,fit,zoom,getMode:()=>current,destroy(){if(destroyed)return;if(expanded)exitFallback();if(document.fullscreenElement===host)document.exitFullscreen().catch(()=>{});destroyed=true;clearTimeout(loadTimer);observer?.disconnect();document.removeEventListener('fullscreenchange',fullscreenState);document.removeEventListener('keydown',onEscape);global.removeEventListener('resize',resize);map.remove();host.replaceChildren();delete host.__olympicMap;if(active===api)active=null;}};
    host.__olympicMap=api;active=api;showMode(data.forest?'forest':'central');addFallback();
    loadTimer=setTimeout(()=>{if(!destroyed&&!tileSuccess&&!locationPending)announce(fallbackLoaded?'已显示本地真实路网与路线；在线底图暂不可用，可继续点目的地导航。':'在线底图仍在加载；可先点停车或场馆编号打开高德导航。','error');},10000);
    return api;
  }
  global.OlympicMap={mount,showMode(mode){return active?.showMode(mode);},focus(id){return active?.focus(id);},fit(){return active?.fit();},zoom(delta){return active?.zoom(delta);},getInstance(){return active;}};
})(window);
