// /js/QRScanner.js  — ES Module
// 支援：QR（jsQR / 原生 BarcodeDetector）、Code39（Quagga2）
// 參數：
// QRScanner.mount({
//   videoEl:'#cam',                // 必填：<video>
//   formats:['auto'],              // ['auto'] | ['qr'] | ['code39'] | ['qr','code39']
//   mode:'stop-once',              // 'stop-once' | 'continuous' | 'stop-on-valid'
//   isValid:(txt)=>true,           // mode==='stop-on-valid' 時使用
//   blink:true,                    // 相機期間紅框閃爍
//   autoStopOnLeave:true,          // 離頁/背景即停止
//   onOk:(txt)=>{},                // 掃到內容
//   onError:(err)=>{},             // 錯誤回報
//   onFrame:(info)=>{}             // 心跳 {w,h,ts}
// });

export const QRScanner = (() => {
  // ---- state ----
  let video=null, stream=null, canvas=null, ctx=null, raf=0;
  let mounted=false, running=false, frameCnt=0;
  let onOk=null, onErr=null, onFrame=null, isValid=(t)=>true;
  let mode='stop-once', blink=false, autoStopOnLeave=true;
  let wantQR=true, want39=false, useAuto=true;
  let overlay=null, overlayCSSInjected=false;

  // ---- util ----
  const loadScript = (src)=>new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.async=true; s.onload=()=>res(true); s.onerror=()=>rej(src); document.head.appendChild(s); });
  async function ensureJsQR(){
    if (window.jsQR) return true;
    try { await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'); return true; }
    catch(_){}
    try { await loadScript('./jsQR.min.js'); return true; }
    catch(_){ return false; }
  }
  async function ensureQuagga(){
    if (window.Quagga) return true;
    try { await loadScript('https://cdn.jsdelivr.net/npm/@ericblade/quagga2@2.0.0-beta.3/dist/quagga.min.js'); return true; }
    catch(_){}
    try { await loadScript('./quagga.min.js'); return true; }
    catch(_){ return false; }
  }

  // ---- native BarcodeDetector (auto) ----
  let BD=null, bdFormats=[];
  async function ensureBarcodeDetector(){
    if (!('BarcodeDetector' in window)) return false;
    if (!bdFormats.length){
      try { bdFormats = await window.BarcodeDetector.getSupportedFormats(); } catch { bdFormats=[]; }
    }
    const needs = [];
    if (wantQR && bdFormats.includes('qr_code')) needs.push('qr_code');
    if (want39 && bdFormats.includes('code_39')) needs.push('code_39');
    if (!needs.length) return false;
    try { BD = new window.BarcodeDetector({ formats: needs }); return true; } catch { return false; }
  }

  // ---- visuals ----
  function injectOverlayCSS(){
    if (overlayCSSInjected) return;
    const css = `
    .qrscn-blink{position:absolute;inset:0;pointer-events:none;border:3px solid #ef4444;border-radius:12px;animation:qrscnPulse 1.1s ease-in-out infinite}
    @keyframes qrscnPulse{0%,100%{opacity:1}50%{opacity:0}}
    .qrscn-wrap{position:relative}
    `;
    const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s);
    overlayCSSInjected=true;
  }
  function mountOverlay(){
    if (!blink) return;
    injectOverlayCSS();
    const wrap = video.parentElement;
    if (wrap && !wrap.classList.contains('qrscn-wrap')) wrap.classList.add('qrscn-wrap');
    overlay = document.createElement('div'); overlay.className='qrscn-blink';
    (wrap||document.body).appendChild(overlay);
  }
  function unmountOverlay(){
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay=null;
  }

  // ---- frame IO ----
  function readFrame(){
    if (!video || video.readyState<2) return null;
    const w=video.videoWidth|0, h=video.videoHeight|0;
    if (!w||!h) return null;
    if (!canvas){ canvas=document.createElement('canvas'); ctx=canvas.getContext('2d',{willReadFrequently:true}); }
    canvas.width=w; canvas.height=h;
    ctx.drawImage(video,0,0,w,h);
    return {w,h, data:ctx.getImageData(0,0,w,h).data};
  }

  // ---- decoders ----
  async function tryNativeBD(){
    if (!BD) return null;
    try {
      const bb = await BD.detect(video);
      if (bb && bb.length && bb[0].rawValue) return String(bb[0].rawValue);
    } catch {}
    return null;
  }
  function tryJsQR(img){
    try{
      if (!window.jsQR) return null;
      const r = window.jsQR(img.data, img.w, img.h, { inversionAttempts:'dontInvert' });
      return r && r.data ? String(r.data) : null;
    }catch{ return null; }
  }
  async function tryCode39(){
    try{
      const ok = await ensureQuagga(); if (!ok || !window.Quagga) return null;
      const src = canvas.toDataURL('image/png');
      return await new Promise((resolve)=>{
        window.Quagga.decodeSingle({
          inputStream:{ size:`${canvas.width}x${canvas.height}` },
          locator:{ patchSize:'medium', halfSample:true },
          numOfWorkers:0,
          decoder:{ readers:['code_39_reader'] },
          src
        }, (res)=>{
          if (res && res.codeResult && res.codeResult.code) resolve(String(res.codeResult.code));
          else resolve(null);
        });
      });
    }catch{ return null; }
  }

  // ---- loop ----
  async function loop(){
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (video && onFrame && video.videoWidth && video.videoHeight){
      onFrame({w:video.videoWidth, h:video.videoHeight, ts:performance.now()});
    }
    const img = readFrame(); if (!img) return;

    // auto: 原生優先
    if (useAuto){
      const nat = await tryNativeBD();
      if (nat){ return handleHit(nat); }
    }

    // jsQR
    if (wantQR){
      const q = tryJsQR(img);
      if (q){ return handleHit(q); }
    }

    // Code39（降頻）
    if (want39){
      frameCnt=(frameCnt+1)%6;
      if (frameCnt===0){
        const c39 = await tryCode39();
        if (c39){ return handleHit(c39); }
      }
    }
  }

  function handleHit(txt){
    if (mode==='stop-once'){
      stop();
      onOk && onOk(txt);
    }else if (mode==='stop-on-valid'){
      if (isValid && isValid(txt)){ stop(); onOk && onOk(txt); }
      // 否則繼續跑
    }else{ // 'continuous'
      onOk && onOk(txt);
    }
  }

  // ---- public ----
  function setFormats(arr){
    useAuto=false; wantQR=false; want39=false;
    const list = (Array.isArray(arr)?arr:[arr]).map(s=>String(s).toLowerCase());
    if (list.includes('auto')) useAuto=true;
    if (list.includes('qr')) wantQR=true;
    if (list.includes('code39') || list.includes('39')) want39=true;
    // 預設：若都沒勾，視為 auto
    if (!useAuto && !wantQR && !want39){ useAuto=true; }
  }

  function mount(opts={}){
    const sel = opts.videoEl || '#cam';
    video = typeof sel==='string' ? document.querySelector(sel) : sel;
    if (!video) throw new Error('videoEl 不存在');
    video.setAttribute('playsinline',''); video.autoplay=true; video.muted=true;

    // 行為
    setFormats(opts.formats ?? ['auto']);
    mode = String(opts.mode||'stop-once');
    isValid = typeof opts.isValid==='function' ? opts.isValid : (t)=>true;
    blink = !!opts.blink;
    autoStopOnLeave = (opts.autoStopOnLeave!==false);

    // 回呼
    onOk    = opts.onOk    || null;
    onErr   = opts.onError || null;
    onFrame = opts.onFrame || null;

    // 控制鍵（若提供）
    if (opts.startBtn){ const b=document.querySelector(opts.startBtn); b && b.addEventListener('click', ()=>start()); }
    if (opts.stopBtn){  const b=document.querySelector(opts.stopBtn);  b && b.addEventListener('click', ()=>stop());  }

    // 離頁自動停
    if (autoStopOnLeave){
      const stopIfHidden = ()=>{ if (document.hidden) stop(); };
      document.addEventListener('visibilitychange', stopIfHidden);
      window.addEventListener('pagehide', ()=>stop());
      window.addEventListener('beforeunload', ()=>stop());
    }

    mounted=true;
    return true;
  }

  async function start(){
    try{
      if (!mounted) throw new Error('請先呼叫 mount()');
      if (running) return;

      // 解碼器載入（原生在 loop 內用 ensureBarcodeDetector 決定）
      if (useAuto){
        await ensureBarcodeDetector(); // 不擋啟動，fallback 由 js 解碼器承接
      }
      if (wantQR){ const ok = await ensureJsQR(); if (!ok) throw new Error('jsQR 載入失敗'); }
      // Code39 在 loop 時 lazy 載入

      stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ideal:'environment'} }, audio:false });
      video.srcObject = stream;
      await video.play();

      if (blink) mountOverlay();
      running=true; frameCnt=0;
      raf = requestAnimationFrame(loop);
    }catch(e){
      onErr && onErr(e.message||String(e));
    }
  }

  function stop(){
    running=false;
    if (raf){ cancelAnimationFrame(raf); raf=0; }
    try{ video && video.pause(); }catch{}
    try{ stream && stream.getTracks().forEach(t=>t.stop()); }catch{}
    stream=null;
    unmountOverlay();
  }

  return { mount, start, stop, setFormats };
})();