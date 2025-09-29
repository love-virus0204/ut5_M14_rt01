// QRScanner.js — 單檔模組，自動載入 jsQR / Quagga2（CDN↔同層 fallback）
// 支援：formats=["qr","code39"] 可控；模式：once | valid | continuous；掃描時可顯示紅框

export class QRScanner {
  constructor(videoEl, canvasEl, opts = {}) {
    // DOM
    this.video  = videoEl;
    this.canvas = canvasEl || document.createElement("canvas");
    this.ctx    = this.canvas.getContext("2d", { willReadFrequently: true });

    // 參數
    this.mode    = opts.mode    ?? "once";           // once | valid | continuous
    this.key     = opts.key     ?? "";               // mode:"valid" 比對值
    this.flash   = opts.flash   ?? true;             // 掃描時紅框
    this.fps     = Math.max(4, opts.fps ?? 10);      // 軟解頻率
    this.formats = opts.formats ?? ["qr","code39"];  // ← 新增：掃描格式控制

    // 路徑（本機與 QRScanner.js 同層）
    this.paths = {
      quaggaCDN:   "https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.2.6/dist/quagga.min.js",
      quaggaLocal: "./quagga.min.js",
      jsqrLocal:   "./jsQR.js",
      jsqrCDN:     "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
    };

    // 回呼
    this.onResult = typeof opts.onResult === "function" ? opts.onResult : () => {};

    // 狀態
    this.stream   = null;
    this.detector = null;
    this.running  = false;
    this._raf     = 0;
    this._timer   = 0;

    // 綁定
    this._tickNative = this._tickNative.bind(this);

    // 掃描時紅框樣式
    if (this.flash) QRScanner._ensureFlashCSS();
  }

  // 入口
  async init() {
    await this._openCamera();

    // 原生條碼偵測（若可）
    let needSoft = !("BarcodeDetector" in window);
    if ("BarcodeDetector" in window) {
      try {
        const fmts = [];
        if (this.formats.includes("qr")) fmts.push("qr_code");
        if (this.formats.includes("code39")) fmts.push("code_39");
        this.detector = new BarcodeDetector({ formats: fmts.length ? fmts : ["qr_code"] });
      } catch {
        this.detector = null;
        needSoft = true;
      }
    }

    // 軟解需要時才載依賴
    if (needSoft) await this._ensureDeps();

    // 啟動
    this.running = true;
    if (this.detector) this._tickNative();
    else {
      const interval = Math.max(60, Math.round(1000 / this.fps));
      this._timer = window.setInterval(() => this._tickSoft(), interval);
    }
  }

  stop() {
    this.running = false;
    if (this._raf)   cancelAnimationFrame(this._raf), (this._raf = 0);
    if (this._timer) clearInterval(this._timer), (this._timer = 0);
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    document.body.classList.remove("cam-on");
  }

  // ───────────────────────── internal ─────────────────────────

  static _ensureFlashCSS() {
    if (document.getElementById("qrscan-flash-style")) return;
    const s = document.createElement("style");
    s.id = "qrscan-flash-style";
    s.textContent = `
      body.cam-on{ outline:3px solid #ef4444; outline-offset:-3px; animation:camFlash 1s infinite }
      @keyframes camFlash{ 0%,100%{ outline-color:#ef4444 } 50%{ outline-color:transparent } }
    `;
    document.head.appendChild(s);
  }

  _loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = () => res(true);
      s.onerror = () => rej(new Error("load fail: " + src));
      document.head.appendChild(s);
    });
  }

async _ensureDeps() {
  // jsQR：CDN → 本地
  if (this.formats.includes("qr") && !window.jsQR) {
    try { await this._loadScript(this.paths.jsqrCDN); }
    catch { await this._loadScript(this.paths.jsqrLocal); }
  }
  // Quagga2：CDN → 本地
  if (this.formats.includes("code39") && !window.Quagga) {
    try { await this._loadScript(this.paths.quaggaCDN); }
    catch { await this._loadScript(this.paths.quaggaLocal); }
  }
}

  async _openCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }, audio: false
    });
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.setAttribute("playsinline", "true");
    await this.video.play();
    document.body.classList.add("cam-on");
  }

  // 原生：requestAnimationFrame
  async _tickNative() {
    if (!this.running) return;
    try {
      const codes = await this.detector.detect(this.video);
      if (codes && codes.length) {
        const v = codes[0].rawValue ?? codes[0].raw ?? "";
        if (v) { this._handle(v); if (!this.running) return; }
      }
    } catch {}
    this._drawFlash();
    this._raf = requestAnimationFrame(this._tickNative);
  }

  // 軟解：setInterval（jsQR + Quagga）
  _tickSoft() {
    if (!this.running) return;
    const { videoWidth:w, videoHeight:h, readyState } = this.video;
    if (readyState !== this.video.HAVE_ENOUGH_DATA || !w || !h) return;

    this.canvas.width = w; this.canvas.height = h;
    this.ctx.drawImage(this.video, 0, 0, w, h);

    // 1) jsQR（QR）
    if (this.formats.includes("qr") && window.jsQR) {
      try {
        const img = this.ctx.getImageData(0, 0, w, h);
        const qr  = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
        if (qr && qr.data) { this._handle(qr.data); if (!this.running) return; }
      } catch {}
    }

    // 2) Quagga（Code39）
    if (this.formats.includes("code39") && window.Quagga) {
      try {
        const src = this.canvas.toDataURL("image/png");
        Quagga.decodeSingle({
          src,
          numOfWorkers: 0,
          inputStream: { size: Math.max(640, Math.min(1280, Math.max(w, h))) },
          locator: { patchSize: "medium", halfSample: true },
          decoder: { readers: ["code_39_reader"] }
        }, r => {
          if (r && r.codeResult && r.codeResult.code) this._handle(r.codeResult.code);
        });
      } catch {}
    }

    this._drawFlash();
  }

  _drawFlash() {
    if (!this.flash) return;
    const w = this.video.videoWidth, h = this.video.videoHeight;
    this.canvas.width = w; this.canvas.height = h;
    this.ctx.drawImage(this.video, 0, 0, w, h);
    this.ctx.lineWidth = 4;
    this.ctx.strokeStyle = "#ef4444";
    this.ctx.strokeRect(0, 0, w, h);
  }

  _handle(val) {
    if (this.mode === "once") { this.onResult(val); this.stop(); return; }
    if (this.mode === "valid") {
      const ok = this.key ? (val === this.key) : true;
      if (ok) { this.onResult(val); this.stop(); }
      return;
    }
    this.onResult(val); // continuous
  }
}