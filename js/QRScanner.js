// /js/QRScanner.js
export const QRScanner = (() => {
  let video, stream=null, raf=0, onOk=null, onErr=null, canvas, ctx;

  async function ensureJsQR(){
    if (window.jsQR) return true;
    const load = src => new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src=src; s.async=true; s.onload=()=>res(true); s.onerror=()=>rej(src);
      document.head.appendChild(s);
    });
    try { await load("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"); return true; }
    catch {}
    try { await load("./jsQR.min.js"); return true; } // 請把 jsQR.min.js 放在與本檔同層
    catch { return false; }
  }

  function tick(){
    if (!video || video.readyState<2){ raf=requestAnimationFrame(tick); return; }
    const w=video.videoWidth|0, h=video.videoHeight|0;
    if (!w || !h){ raf=requestAnimationFrame(tick); return; }
    if (!canvas){ canvas=document.createElement('canvas'); ctx=canvas.getContext('2d'); }
    canvas.width=w; canvas.height=h;
    ctx.drawImage(video,0,0,w,h);
    const img = ctx.getImageData(0,0,w,h);
    try{
      const r = window.jsQR && window.jsQR(img.data,w,h,{inversionAttempts:"dontInvert"});
      if (r && r.data){
        stop();
        onOk && onOk(String(r.data));
        return;
      }
    }catch(e){ onErr && onErr(e.message||String(e)); }
    raf=requestAnimationFrame(tick);
  }

  async function start(){
    try{
      if (!video) throw new Error("call mount() first");
      if (stream) return;
      const ok = await ensureJsQR();
      if (!ok) throw new Error("jsQR 載入失敗");
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}, audio:false});
      video.srcObject = stream;
      await video.play();
      raf=requestAnimationFrame(tick);
    }catch(e){ onErr && onErr(e.message||String(e)); }
  }

  function stop(){
    if (raf){ cancelAnimationFrame(raf); raf=0; }
    try{ video && video.pause(); }catch{}
    try{ stream && stream.getTracks().forEach(t=>t.stop()); }catch{}
    stream=null;
  }

  function mount(opts){
    const sel = opts.videoEl || "#cam";
    video = typeof sel==="string" ? document.querySelector(sel) : sel;
    if(!video) throw new Error("videoEl 不存在");
    video.setAttribute("playsinline",""); video.muted=true; video.autoplay=true;
    onOk  = opts.onOk   || null;
    onErr = opts.onError|| null;

    if (opts.startBtn){
      const b=document.querySelector(opts.startBtn);
      b && b.addEventListener("click", ()=>start());
    }
    if (opts.stopBtn){
      const b=document.querySelector(opts.stopBtn);
      b && b.addEventListener("click", ()=>stop());
    }
    return true;
  }

  return { mount, start, stop };
})();