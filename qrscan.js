// qrscan.js - 獨立模組
export class QRScanner {
  constructor(videoEl, opts = {}) {
    this.video = videoEl;
    this.stream = null;
    this.running = false;
    this.mode = opts.mode || "once";       // once / valid / continuous
    this.flash = opts.flash || false;      // 閃框效果
    this.key = opts.key || "";             // 驗證用 key (valid 模式才會用)
    this.onResult = opts.onResult || (()=>{});

    if (this.flash) this.injectCSS();
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.running = true;
      if (this.flash) document.body.classList.add("cam-on");
      this.loop();
    } catch (e) {
      console.error("無法開啟相機:", e);
      this.onResult({ ok:false, msg:"camera_error" });
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.running = false;
    if (this.flash) document.body.classList.remove("cam-on");
  }

  async loop() {
    if (!this.running) return;

    // 使用 BarcodeDetector（含 code_39）
    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['code_39', 'qr_code'] });
      try {
        const codes = await detector.detect(this.video);
        if (codes.length > 0) {
          const raw = codes[0].rawValue.trim();
          this.handleResult(raw);
        }
      } catch(e){
        console.error("偵測失敗", e);
      }
    } else {
      this.onResult({ ok:false, msg:"not_supported" });
      this.stop();
      return;
    }

    requestAnimationFrame(()=>this.loop());
  }

  handleResult(value){
    if (this.mode === "once") {
      this.onResult({ ok:true, value });
      this.stop();
    }
    else if (this.mode === "valid") {
      if (value === this.key) {
        this.onResult({ ok:true, value });
        this.stop();
      } else {
        this.onResult({ ok:false, msg:"invalid", value });
        // 繼續掃描直到正確
      }
    }
    else if (this.mode === "continuous") {
      this.onResult({ ok:true, value });
      // 不停，繼續掃描
    }
  }

  injectCSS(){
    if(document.getElementById("qrscan-style")) return;
    const css = `
      body.cam-on{
        outline:3px solid #ef4444;
        outline-offset:-3px;
        animation:camFlash 1s infinite;
      }
      @keyframes camFlash{
        0%,100%{ outline-color:#ef4444; }
        50%{ outline-color:transparent; }
      }
    `;
    const s = document.createElement("style");
    s.id = "qrscan-style";
    s.textContent = css;
    document.head.appendChild(s);
  }
}