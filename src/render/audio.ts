// 可拔插音效系统:AudioPlayer 接口 + Web Audio 合成实现。
// 替换音效 = 换实现(FileAudioPlayer 加载 public/sounds/*)或单音换文件;
// 调用处(this.audio.play(event))永远不改。

/** 音效事件(游戏语义,与具体实现解耦)。 */
export type SoundEvent =
  | "diceRoll" // 掷骰开始(翻滚启动)
  | "diceHit" // 骰子碰撞(物理事件,带 intensity 0~1)
  | "diceLand" // 骰子停下
  | "coin" // 铜钱(收入)
  | "stamp" // 印章(购地/据城)
  | "banner" // 横幅(回合/事件)
  | "buy" // 购买成功
  | "upgrade" // 扩军
  | "treasure" // 得珍宝
  | "bankrupt" // 破产
  | "victory"; // 胜利

/** 可拔插音效播放器接口。合成 / 文件 / 静音 各自实现。 */
export interface AudioPlayer {
  play(event: SoundEvent, opts?: { intensity?: number }): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

/**
 * Web Audio API 合成播放器(默认实现)。程序生成各音效,零文件零依赖零体积。
 * 古风质感:骰子=木质碰撞噪声、铜钱=金属叮、印章=木石 thump、横幅=whoosh。
 */
export class SynthAudioPlayer implements AudioPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private readonly volume = 0.5;

  /** AudioContext 延迟创建(浏览器 autoplay policy:首次 play / 用户交互后 resume)。 */
  private ensureCtx(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  play(event: SoundEvent, opts?: { intensity?: number }): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    const intensity = opts?.intensity ?? 1;
    switch (event) {
      case "diceRoll": this.diceRoll(ctx, intensity); break;
      case "diceHit": this.diceHit(ctx, intensity); break;
      case "diceLand": this.diceLand(ctx); break;
      case "coin": this.coin(ctx); break;
      case "stamp": this.stamp(ctx); break;
      case "banner": this.banner(ctx); break;
      case "buy": this.buy(ctx); break;
      case "upgrade": this.upgrade(ctx); break;
      case "treasure": this.treasure(ctx); break;
      case "bankrupt": this.bankrupt(ctx); break;
      case "victory": this.victory(ctx); break;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  // ── 合成单元(每个都自检 this.master,防 dispose 后 setTimeout 触发崩溃)──

  private noiseBuffer(ctx: AudioContext, dur: number): AudioBuffer {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private tone(ctx: AudioContext, freq: number, dur: number, type: OscillatorType, vol: number): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  private thump(ctx: AudioContext, freq: number, dur: number, vol = 0.4): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 1.6, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  private noiseBurst(ctx: AudioContext, dur: number, filtType: BiquadFilterType, freq: number, q: number, vol: number, sweepTo?: number): void {
    if (!this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, dur);
    const filt = ctx.createBiquadFilter();
    filt.type = filtType;
    filt.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  // 骰子掷出(启动翻滚,~0.4s 衰减噪声)
  private diceRoll(ctx: AudioContext, intensity: number): void {
    if (!this.master) return;
    const dur = 0.4;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, dur);
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 1800 + intensity * 400;
    filt.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.32 * intensity, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  // 骰子碰撞(短促噪声 burst,物理事件,随强度)
  private diceHit(ctx: AudioContext, intensity: number): void {
    const vol = Math.min(0.5, 0.12 + intensity * 0.28);
    this.noiseBurst(ctx, 0.09, "bandpass", 2200, 1.2, vol);
  }

  // 骰子停下(thump)
  private diceLand(ctx: AudioContext): void {
    this.thump(ctx, 320, 0.12);
  }

  // 印章(thump + 噪声木石撞击)
  private stamp(ctx: AudioContext): void {
    this.thump(ctx, 180, 0.16);
    this.noiseBurst(ctx, 0.08, "lowpass", 1200, 1, 0.25);
  }

  // 铜钱叮(金属高频)
  private coin(ctx: AudioContext): void {
    this.tone(ctx, 1320, 0.12, "sine", 0.3);
    this.tone(ctx, 1760, 0.18, "sine", 0.18);
  }

  // 得珍宝(升调叮咚)
  private treasure(ctx: AudioContext): void {
    this.tone(ctx, 880, 0.1, "triangle", 0.3);
    setTimeout(() => this.tone(ctx, 1320, 0.16, "triangle", 0.25), 90);
    setTimeout(() => this.tone(ctx, 1760, 0.22, "triangle", 0.2), 180);
  }

  // 购买成功(铜钱 + 印章)
  private buy(ctx: AudioContext): void {
    this.coin(ctx);
    setTimeout(() => this.stamp(ctx), 60);
  }

  // 扩军(金属响)
  private upgrade(ctx: AudioContext): void {
    this.tone(ctx, 660, 0.15, "square", 0.13);
    setTimeout(() => this.tone(ctx, 990, 0.2, "square", 0.1), 80);
  }

  // 横幅 whoosh(噪声扫频)
  private banner(ctx: AudioContext): void {
    if (!this.master) return;
    const dur = 0.35;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, dur);
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.setValueAtTime(400, ctx.currentTime);
    filt.frequency.exponentialRampToValueAtTime(1600, ctx.currentTime + dur);
    filt.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  // 破产(低沉降调 + thump)
  private bankrupt(ctx: AudioContext): void {
    this.tone(ctx, 220, 0.5, "sawtooth", 0.22);
    setTimeout(() => this.tone(ctx, 180, 0.6, "sawtooth", 0.18), 120);
    this.thump(ctx, 120, 0.4, 0.3);
  }

  // 胜利(升调琶音)
  private victory(ctx: AudioContext): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => this.tone(ctx, f, 0.3, "triangle", 0.25), i * 130));
  }
}
