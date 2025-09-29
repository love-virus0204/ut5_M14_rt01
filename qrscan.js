// qrscan.js — 自動載 jsQR + Quagga2（Quagga 先 CDN → 本地；jsQR 先本地 → CDN）
export class QRScanner{
  constructor(videoEl,canvasEl,opts={}){
    this.video=videoEl; this.canvas=canvasEl;
    this.ctx=this.canvas.getContext("2d",{willReadFrequently:true});
    this.mode=opts.mode??"once";            // once | valid | continuous
    this.key=opts.key??"";                  // mode:"valid" 比對值
    this.flash=opts.flash??true;            // 掃描時紅框
    this.fps=Math.max(4, opts.fps??10);     // 軟解頻率
    this.paths={
      jsqrLocal: opts.paths?.jsqrLocal ?? "./libs/jsQR.js",
      jsqrCDN:   opts.paths?.jsqrCDN   ?? "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
      quaggaCDN: opts.paths?.quaggaCDN ?? "https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.js",
      quaggaLocal:opts.paths?.quaggaLocal?? "./libs/quagga.js",
    };
    this.onResult=typeof opts.onResult==="function"?opts.onResult:()=>{};
    this.stream=null; this.detector=null; this.running=false; this._timer=0; this._raf=0;
    if(this.flash) QRScanner._ensureFlashCSS();
    this._tickNative=this._tickNative.bind(this);
  }

  static _ensureFlashCSS(){
    if(document.getElementById("qrscan-flash-style")) return;
    const s=document.createElement("style"); s.id="qrscan-flash-style";
    s.textContent=`body.cam-on{outline:3px solid #ef4444;outline-offset:-3px;animation:camFlash 1s infinite}
@keyframes camFlash{0%,100%{outline-color:#ef4444}50%{outline-color:transparent}}`;
    document.head.appendChild(s);
  }
  _loadScript(src){return new Promise((res,rej)=>{const s=document.createElement("script");
    s.src=src; s.onload=()=>res(); s.onerror=()=>rej(new Error("load fail:"+src)); document.head.appendChild(s);});}

  async _ensureLibs(){
    // jsQR：本地 → CDN
    if(!window.jsQR){
      try{ await this._loadScript(this.paths.jsqrLocal); }
      catch{ await this._loadScript(this.paths.jsqrCDN); }
    }
    // Quagga2：CDN → 本地（你要求的流量策略）
    if(!window.Quagga){
      try{ await this._loadScript(this.paths.quaggaCDN); }
      catch{ await this._loadScript(this.paths.quaggaLocal); }
    }
  }

  async init(){
    // 有原生就先試原生；若真正用不到軟解則不載庫
    let needSoft = !("BarcodeDetector" in window);
    await this._openCamera();
    if("BarcodeDetector" in window){
      try{ this.detector=new BarcodeDetector({formats:["qr_code","code_39"]}); }
      catch{ this.detector=null; needSoft=true; }
    }
    if(needSoft) await this._ensureLibs();
    this.running=true;
    if(this.detector) this._tickNative(); else this._timer=setInterval(()=>this._tickSoft(), Math.max(60,Math.round(1000/this.fps)));
  }

  async _openCamera(){
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
    this.stream=stream; this.video.srcObject=stream; this.video.setAttribute("playsinline","true");
    await this.video.play(); document.body.classList.add("cam-on");
  }

  stop(){
    this.running=false;
    if(this._raf) cancelAnimationFrame(this._raf), this._raf=0;
    if(this._timer) clearInterval(this._timer), this._timer=0;
    if(this.stream){ this.stream.getTracks().forEach(t=>t.stop()); this.stream=null; }
    document.body.classList.remove("cam-on");
  }

  _drawFlash(){
    if(!this.flash) return;
    const w=this.video.videoWidth,h=this.video.videoHeight;
    this.canvas.width=w; this.canvas.height=h;
    this.ctx.drawImage(this.video,0,0,w,h);
    this.ctx.lineWidth=4; this.ctx.strokeStyle="#ef4444"; this.ctx.strokeRect(0,0,w,h);
  }

  async _tickNative(){
    if(!this.running) return;
    try{
      const codes=await this.detector.detect(this.video);
      if(codes&&codes.length){
        const v=codes[0].rawValue??codes[0].raw??"";
        if(v){ this._handle(v); if(!this.running) return; }
      }
    }catch{}
    this._drawFlash();
    this._raf=requestAnimationFrame(this._tickNative);
  }

  _tickSoft(){
    if(!this.running) return;
    const w=this.video.videoWidth,h=this.video.videoHeight;
    if(!w||!h||this.video.readyState!==this.video.HAVE_ENOUGH_DATA) return;
    this.canvas.width=w; this.canvas.height=h;
    this.ctx.drawImage(this.video,0,0,w,h);

    // 1) jsQR（QR）
    if(window.jsQR){
      try{
        const img=this.ctx.getImageData(0,0,w,h);
        const qr=jsQR(img.data,w,h,{inversionAttempts:"dontInvert"});
        if(qr&&qr.data){ this._handle(qr.data); if(!this.running) return; }
      }catch{}
    }
    // 2) Quagga（Code39）
    if(window.Quagga){
      try{
        const src=this.canvas.toDataURL("image/png");
        Quagga.decodeSingle({
          src, numOfWorkers:0,
          inputStream:{ size: Math.max(640, Math.min(1280, Math.max(w,h))) },
          locator:{ patchSize:"medium", halfSample:true },
          decoder:{ readers:["code_39_reader"] }
        }, r=>{ if(r&&r.codeResult&&r.codeResult.code){ this._handle(r.codeResult.code); } });
      }catch{}
    }
    this._drawFlash();
  }

  _handle(val){
    if(this.mode==="once"){ this.onResult(val); this.stop(); return; }
    if(this.mode==="valid"){ const ok=this.key?val===this.key:true; if(ok){ this.onResult(val); this.stop(); } return; }
    this.onResult(val); // continuous
  }
}