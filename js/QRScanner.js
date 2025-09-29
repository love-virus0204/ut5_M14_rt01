// /js/QRScanner.js  — ES Module 最小可用版（只掃 QR）
export const QRScanner = (() => {
  let video, stream = null, rafId = 0, onOkCb = null, onErrCb = null;
  let canvas, ctx, mounted = false;

  // 依序嘗試載入 jsQR：CDN → 本地
  async function ensureJsQR(){
    if (window.jsQR) return true;
    const load = (src) => new Promise((res, rej)=>{
      const s=document.createElement('script');
      s.src=src; s.async=true; s.onload=()=>res(true); s.onerror=()=>rej(src);
      document.head.appendChild(s);
    });
    const cdn = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
    try { await load(cdn); return true; }
    catch{
      try { await load("./jsQR.min.js"); return true; } // 放在 /js/jsQR.min.js 同層也可寫成 "./js/jsQR.min.js"
      catch{ return false; }
    }
  }

  function decodeFrame(){
    if (!video || video.readyState < 2) { rafId = requestAnimationFrame(decodeFrame); return; }
    const w = video.videoWidth|0, h = video.videoHeight|0;
    if (w===0 || h===0){ rafId = requestAnimationFrame(decodeFrame); return; }

    if (!canvas){ canvas = document.createElement('canvas'); ctx = canvas.getContext('2d'); }
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    try{
      const res = window.jsQR && window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
      if (res && res.data){
        const txt = String(res.data);
        stop();
        onOkCb && onOkCb(txt);
        return;
      }
    }catch(e){
      onErrCb && onErrCb(e.message || String(e));
    }
    rafId = requestAnimationFrame(decodeFrame);
  }

  async function start(){
    try{
      if (!mounted) throw new Error("call mount() first");
      if (stream) return; // already running
      const ok = await ensureJsQR();
      if (!ok) throw new Error("jsQR 載入失敗（CDN 與本地皆不可用）");

      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      video.srcObject = stream;
      await video.play();
      rafId = requestAnimationFrame(decodeFrame);
    }catch(e){
      onErrCb && onErrCb(e.message || String(e));
    }
  }

  function stop(){
    if (rafId){ cancelAnimationFrame(rafId); rafId = 0; }
    if (video){ try{ video.pause(); }catch{} }
    if (stream){ try{ stream.getTracks().forEach(t=>t.stop()); }catch{} stream=null; }
  }

  function mount(opts){
    // 只需 videoEl 與回呼；其他忽略
    const vSel = opts.videoEl || "#cam";
    video = (typeof vSel==="string") ? document.querySelector(vSel) : vSel;
    if (!video) throw new Error("videoEl 不存在");
    video.setAttribute("playsinline",""); video.muted = true; video.autoplay = true;

    onOkCb = opts.onOk || null;
    onErrCb = opts.onError || null;

    // 若有開始/停止按鈕就綁定
    if (opts.startBtn){
      const sb = document.querySelector(opts.startBtn);
      sb && sb.addEventListener("click", ()=>start());
    }
    if (opts.stopBtn){
      const tb = document.querySelector(opts.stopBtn);
      tb && tb.addEventListener("click", ()=>stop());
    }

    mounted = true;
    return true;
  }

  return { mount, start, stop };
})();