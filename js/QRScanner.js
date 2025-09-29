// /js/QRScanner.js  — ES Module，可掃 QR（jsQR）與 Code39（Quagga2）
// 使用方式（範例）：
// import { QRScanner } from './js/QRScanner.js';
// QRScanner.mount({ videoEl:'#cam', formats:['qr','code39'], onOk:txt=>{...} });
// document.getElementById('start').onclick = ()=>QRScanner.start();

export const QRScanner = (() => {
  // ---- 狀態 ----
  let video = null;
  let stream = null;
  let canvas = null, ctx = null;
  let raf = 0;
  let mounted = false;
  let running = false;

  // 回呼
  let onOk = null;
  let onErr = null;
  let onFrame = null;

  // 設定
  let formats = ['qr'];          // 支援: 'qr', 'code39'
  let tryCode39Every = 6;        // 每 N 幀嘗試一次 Code39
  let frameCnt = 0;

  // ---- 工具：載入外部 script（CDN → local 備援）----
  function loadScript(src){
    return new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => reject(src);
      document.head.appendChild(s);
    });
  }

  async function ensureJsQR(){
    if (window.jsQR) return true;
    try { await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'); return true; }
    catch(_) {}
    try { await loadScript('./jsQR.min.js'); return true; }               // 與本檔同目錄放一份備援
    catch(_) {}
    return false;
  }

  async function ensureQuagga(){
    if (window.Quagga) return true;
    try { await loadScript('https://cdn.jsdelivr.net/npm/@ericblade/quagga2@2.0.0-beta.3/dist/quagga.min.js'); return true; }
    catch(_) {}
    try { await loadScript('./quagga.min.js'); return true; }             // 與本檔同目錄放一份備援
    catch(_) {}
    return false;
  }

  // ---- 影格處理 ----
  async function decodeCode39ViaQuagga() {
    // 以 dataURL 給 quagga 單張解碼（避免長時間占用）
    return new Promise(async (resolve) => {
      try{
        const ok = await ensureQuagga();
        if (!ok || !window.Quagga) return resolve(null);

        const dataURL = canvas.toDataURL('image/png');
        window.Quagga.decodeSingle({
          inputStream: { size: `${canvas.width}x${canvas.height}` },
          locator: { patchSize: 'medium', halfSample: true },
          numOfWorkers: 0,
          decoder: { readers: ['code_39_reader'] },
          src: dataURL
        }, (res) => {
          if (res && res.codeResult && res.codeResult.code) {
            resolve(String(res.codeResult.code));
          } else {
            resolve(null);
          }
        });
      }catch(_){
        resolve(null);
      }
    });
  }

  function readFrameToCanvas() {
    if (!video || video.readyState < 2) return false;
    const w = video.videoWidth | 0;
    const h = video.videoHeight | 0;
    if (!w || !h) return false;
    if (!canvas) { canvas = document.createElement('canvas'); ctx = canvas.getContext('2d', { willReadFrequently: true }); }
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    return true;
  }

  async function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);

    // 回報影格（可用來顯示解析度與心跳）
    if (video && onFrame && video.videoWidth && video.videoHeight) {
      onFrame({ w: video.videoWidth, h: video.videoHeight, ts: performance.now() });
    }

    if (!readFrameToCanvas()) return;

    // 先試 QR（若啟用）
    if (formats.includes('qr')) {
      try{
        if (window.jsQR) {
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const r = window.jsQR(img.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
          if (r && r.data) {
            const txt = String(r.data);
            stop();
            onOk && onOk(txt);
            return;
          }
        }
      }catch(e){
        onErr && onErr(e.message || String(e));
      }
    }

    // 週期性嘗試 Code39（若啟用）
    if (formats.includes('code39')) {
      frameCnt = (frameCnt + 1) % tryCode39Every;
      if (frameCnt === 0) {
        const code = await decodeCode39ViaQuagga();
        if (code) {
          stop();
          onOk && onOk(code);
          return;
        }
      }
    }
  }

  // ---- 公開 API ----
  function setFormats(arr){
    if (Array.isArray(arr) && arr.length) {
      formats = arr.map(s => String(s).toLowerCase());
    }
  }

  function mount(opts = {}) {
    const sel = opts.videoEl || '#cam';
    video = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!video) throw new Error('videoEl 不存在');

    // 基本屬性
    video.setAttribute('playsinline', '');
    video.autoplay = true;
    video.muted = true;

    // 回呼
    onOk    = opts.onOk    || null;
    onErr   = opts.onError || null;
    onFrame = opts.onFrame || null;

    // 格式
    if (Array.isArray(opts.formats)) setFormats(opts.formats);

    // 綁定按鈕（若有）
    if (opts.startBtn) {
      const b = document.querySelector(opts.startBtn);
      b && b.addEventListener('click', () => start());
    }
    if (opts.stopBtn) {
      const b = document.querySelector(opts.stopBtn);
      b && b.addEventListener('click', () => stop());
    }

    mounted = true;
    return true;
  }

  async function start() {
    try{
      if (!mounted) throw new Error('請先呼叫 mount()');
      if (running) return;

      // 依需求載入必要解碼器
      if (formats.includes('qr')) {
        const ok = await ensureJsQR();
        if (!ok) throw new Error('jsQR 載入失敗');
      }
      // Code39 由 loop 內按需 lazy 載入，避免啟動等待

      // 取得鏡頭
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false
      });
      video.srcObject = stream;
      await video.play();

      running = true;
      frameCnt = 0;
      raf = requestAnimationFrame(loop);
    }catch(e){
      onErr && onErr(e.message || String(e));
    }
  }

  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    try { video && video.pause(); } catch(_){}
    try { stream && stream.getTracks().forEach(t=>t.stop()); } catch(_){}
    stream = null;
  }

  return { mount, start, stop, setFormats };
})();