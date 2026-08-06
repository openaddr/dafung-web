// 可拔插音效系统:AudioPlayer 接口 + Web Audio 合成实现。
// 替换音效 = 换实现(FileAudioPlayer 加载 public/sounds/*)或单音换文件;
// 调用处(this.audio.play(event))永远不改。

/** 音效事件(游戏语义,与具体实现解耦)。 */
export type SoundEvent =
  | "diceRoll" // 掷骰开始(翻滚启动)
  | "diceHit" // 骰子碰撞(物理事件,带 intensity 0~1)
  | "diceLand" // 骰子停下
  | "coin" // 铜钱(收入)
  | "stamp" // 印章(建都/据城)
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
  /** 噪声缓存(2 秒):diceRoll/banner/diceHit/stamp 共用同一份白噪声,
   *  各合成单元用随机 offset 取不同片段,免去每次 play 重新生成随机样本(消除 GC 抖动)。 */
  private noiseCache: AudioBuffer | null = null;
  private static readonly NOISE_CACHE_DUR = 2; // 秒(覆盖最长 diceRoll 0.4s × 余量)

  /** AudioContext 延迟创建(浏览器 autoplay policy:首次 play / 用户交互后 resume)。 */
  private ensureCtx(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      } catch {
        // 受限 iframe / AudioContext 数耗尽 / 隐私模式:new Ctor() 抛 NotSupportedError → 静默降级(各合成单元已守 this.master,play 自动 no-op,绝不破坏回合状态机)
        this.ctx = null;
        this.master = null;
        return null;
      }
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
    this.noiseCache = null;
  }

  // ── 合成单元(每个都自检 this.master,防 dispose 后 setTimeout 触发崩溃)──

  /** 白噪声 buffer:缓存一份 2 秒(AudioContext 生命周期内复用),各合成单元按需取片段。
   *  dur 超过缓存长度(当前合成单元最长 0.4s,不会触发)时降级为按需新建。 */
  private noiseBuffer(ctx: AudioContext, dur: number): AudioBuffer {
    if (dur <= SynthAudioPlayer.NOISE_CACHE_DUR) {
      if (!this.noiseCache || this.noiseCache.sampleRate !== ctx.sampleRate) {
        const len = Math.floor(ctx.sampleRate * SynthAudioPlayer.NOISE_CACHE_DUR);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.noiseCache = buf;
      }
      return this.noiseCache;
    }
    // 兜底:超长 dur(当前无此调用)新建独立 buffer
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

  /** 噪声 burst 管线:noiseBuffer → biquad(可选扫频)→ gain(可选 attack ramp)→ master。
   *  attackMs>0 时用 0.0001→vol 的指数 attack ramp(供 diceRoll/banner 复用,消除复制粘贴);
   *  缓存 buffer 比较长,从随机 offset 取 dur 段(免每次同一段噪声听感重复)。 */
  private noiseBurst(
    ctx: AudioContext,
    dur: number,
    filtType: BiquadFilterType,
    freq: number,
    q: number,
    vol: number,
    sweepTo?: number,
    attackMs?: number,
  ): void {
    if (!this.master) return;
    const src = ctx.createBufferSource();
    const buf = this.noiseBuffer(ctx, dur);
    src.buffer = buf;
    const maxOffset = Math.max(0, buf.duration - dur);
    const offset = Math.random() * maxOffset;
    const filt = ctx.createBiquadFilter();
    filt.type = filtType;
    filt.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
    filt.Q.value = q;
    const g = ctx.createGain();
    if (attackMs && attackMs > 0) {
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + attackMs / 1000);
    } else {
      g.gain.setValueAtTime(vol, ctx.currentTime);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(ctx.currentTime, offset);
    src.stop(ctx.currentTime + dur);
  }

  // 骰子掷出(启动翻滚,~0.4s 衰减噪声 + 20ms attack ramp)
  private diceRoll(ctx: AudioContext, intensity: number): void {
    this.noiseBurst(ctx, 0.4, "bandpass", 1800 + intensity * 400, 0.8, 0.32 * intensity, undefined, 20);
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

  // 横幅 whoosh(噪声 400→1600Hz 扫频 + 120ms attack ramp)
  private banner(ctx: AudioContext): void {
    this.noiseBurst(ctx, 0.35, "bandpass", 400, 0.6, 0.22, 1600, 120);
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
