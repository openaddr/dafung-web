// 可拔插音效系统:AudioPlayer 接口 + Web Audio 合成实现。
// 迁移自 src/render/audio.ts(无 @render 内部依赖,原样搬运),仅新增:
//   ① unlock() 公开方法——供 React AudioProvider 在用户手势里解锁 AudioContext;
//   ③ getAudio() 模块单例——控制器(非 React 世界)与组件共用同一播放器实例。
// 替换音效 = 换实现(FileAudioPlayer 加载 public/sounds/*)或单音换文件;
// 调用处(audio.play(event))永远不改。

/** 音效事件(游戏语义,与具体实现解耦)。 */
export type SoundEvent =
  | "diceRoll" // 掷骰开始(翻滚启动)
  | "diceHit" // 骰子碰撞(物理事件,带 intensity 0~1)
  | "diceLand" // 骰子停下
  | "marchStart" // 行军启动(高频触发:轻嗒瞬态,50ms 去重 + 连发音量衰减)
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
  /** 用户手势内解锁 AudioContext(可选实现;no-op 播放器无此能力)。 */
  unlock?(): void;
}

/**
 * Web Audio API 合成播放器(默认实现)。程序生成各音效,零文件零依赖零体积。
 * 古风质感:骰子=木质碰撞噪声、铜钱=金属叮、印章=木石 thump、横幅=whoosh。
 */
export class SynthAudioPlayer implements AudioPlayer {
  protected ctx: AudioContext | null = null;
  protected master: GainNode | null = null;
  protected muted = false;
  protected readonly volume = 0.5;
  /** 噪声缓存(2 秒):diceRoll/banner/diceHit/stamp 共用同一份白噪声,
   *  各合成单元用随机 offset 取不同片段,免去每次 play 重新生成随机样本(消除 GC 抖动)。 */
  private noiseCache: AudioBuffer | null = null;
  private static readonly NOISE_CACHE_DUR = 2; // 秒(覆盖最长 diceRoll 0.4s × 余量)
  /** marchStart 限流游标:上次触发时间 / 600ms 窗口内连发计数(见 play() 防吵注释)。 */
  private lastMarchStart: number | null = null;
  private marchRapidCount = 0;

  /** AudioContext 延迟创建(浏览器 autoplay policy:首次 play / 用户交互后 resume)。 */
  protected ensureCtx(): AudioContext | null {
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
        // 受限 iframe / AudioContext 数耗尽 / 隐私模式:new Ctor() 抛 NotSupportedError → 静默降级
        // (各合成单元已守 this.master,play 自动 no-op,绝不破坏回合状态机)
        this.ctx = null;
        this.master = null;
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** 用户手势内调用一次:提前创建并 resume AudioContext(autoplay policy 解锁)。
   *  幂等且静音态 no-op——供 AudioProvider 挂 pointerdown 监听。 */
  unlock(): void {
    this.ensureCtx();
  }

  play(event: SoundEvent, opts?: { intensity?: number }): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    const intensity = opts?.intensity ?? 1;
    // marchStart 防吵:高频触发的行军启动音做两层限流——
    //   ① 50ms 内同音去重(连点/多棋子同帧启动只响一次);
    //   ② 600ms 窗口内连发时音量逐次衰减(最低到 40%),连续行军不叠加成噪声。
    if (event === "marchStart") {
      const now = performance.now();
      const last = this.lastMarchStart;
      if (last != null && now - last < 50) return;
      const rapid = last != null && now - last < 600 ? this.marchRapidCount + 1 : 0;
      this.lastMarchStart = now;
      this.marchRapidCount = rapid;
      const volScale = Math.max(0.4, 1 - rapid * 0.2);
      this.marchStart(ctx, volScale);
      return;
    }
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

  /** 噪声 burst 管线:noiseBuffer → biquad(可选扫频)→ gain(可选 attack ramp)→ master。 */
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

  // 骰子掷出(#26 改浅:行军点击即掷骰,是全游戏最高频的触发。旧 0.4s 衰减噪声太重,
  // 现改为 ~120ms 轻快沙锤瞬态:高频带通 + 快速下滑扫频,低音量,衰减快)
  private diceRoll(ctx: AudioContext, intensity: number): void {
    this.noiseBurst(ctx, 0.12, "bandpass", 2600 + intensity * 300, 1.5, 0.14 * intensity, 1400, 6);
    this.tone(ctx, 1800, 0.05, "sine", 0.05 * intensity); // 极轻的起振点,给瞬态一个"头"
  }

  // 行军启动(#26:轻嗒瞬态,~70ms 高通噪声 + 微量高频正弦,衰减极快;
  // volScale 由 play() 的连发衰减传入)
  private marchStart(ctx: AudioContext, volScale: number): void {
    this.noiseBurst(ctx, 0.07, "highpass", 3200, 0.7, 0.09 * volScale);
    this.tone(ctx, 2400, 0.04, "sine", 0.03 * volScale);
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

// ─────────────────────── 混合播放器:真实音效文件优先,回退合成 ───────────────────────
/** SoundEvent → 音频文件 URL 映射。缺失的 event 走合成回退。 */
const AUDIO_FILES: Partial<Record<SoundEvent, string>> = {
  // diceRoll 不再映射文件:旧 drum-roll.ogg 是 4s 完整鼓滚奏,行军点击(=掷骰)是
  // 全游戏最高频触发,太吵(#26)——改走上方合成轻快瞬态。banner 低频保留鼓滚奏。
  diceLand: "/assets/audio/woodblock-hit.ogg",
  coin: "/assets/audio/coin-drop.ogg",
  stamp: "/assets/audio/gong-hit.ogg",
  banner: "/assets/audio/drum-roll.ogg",
  buy: "/assets/audio/coins-shake.ogg",
  treasure: "/assets/audio/guqin-note.ogg",
  bankrupt: "/assets/audio/gong-long.ogg",
  victory: "/assets/audio/victory-fanfare.ogg",
  upgrade: "/assets/audio/woodblock-hit.ogg",
};

/**
 * 混合音效播放器:优先播放 public/assets/audio/ 下的真实音效文件;
 * 文件未加载 / 加载失败 / 无映射 → 回退到合成音(SynthAudioPlayer)。
 * 调用方完全透明:构造、play(event)、setMuted、dispose 接口不变。
 */
export class HybridAudioPlayer extends SynthAudioPlayer {
  private buffers = new Map<SoundEvent, AudioBuffer | null>(); // null = 加载失败,走合成

  constructor() {
    super();
    void this.preload();
  }

  /** 后台预加载所有映射的音频文件;不阻塞构造。 */
  private async preload(): Promise<void> {
    const ctx = this.ensureCtx();
    if (!ctx) return; // AudioContext 不可用 → 全部走合成
    const entries = Object.entries(AUDIO_FILES) as [SoundEvent, string][];
    await Promise.all(
      entries.map(async ([event, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const arr = await res.arrayBuffer();
          const buf = await ctx.decodeAudioData(arr);
          this.buffers.set(event, buf);
        } catch {
          this.buffers.set(event, null); // 标记失败,后续直接走合成
        }
      }),
    );
  }

  play(event: SoundEvent, opts?: { intensity?: number }): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    const buf = this.buffers.get(event);
    // 有真实音效 buffer → 播放文件
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.92 + Math.random() * 0.16; // 轻微随机变调避免单调
      const g = ctx.createGain();
      g.gain.value = this.muted ? 0 : 0.6;
      src.connect(g).connect(this.master);
      src.start();
      return;
    }
    // 无 buffer 或加载失败(null/未就绪)→ 合成回退(文件还在加载中也临时合成)
    super.play(event, opts);
  }
}

// ─────────────────────── 模块单例(控制器 / 组件共用) ───────────────────────
// 播放器带 AudioContext 与解码缓存,全局一份最干净;由 AudioProvider 创建,
// 控制器(非 React 世界)经 getAudio() 取同一实例——若 AudioProvider 尚未挂载
// (理论不会:Game 屏必挂),返回 no-op 播放器兜底而非 null,调用处免判空。
const NOOP: AudioPlayer = { play: () => {}, setMuted: () => {}, dispose: () => {}, unlock: () => {} };

let instance: AudioPlayer | null = null;

/** 绑定全局播放器(AudioProvider mount 时调用)。 */
export function setAudio(player: AudioPlayer | null): void {
  instance?.dispose();
  instance = player;
}

/** 全局播放器(未挂载时 no-op)。unlock 缺省为空实现。 */
export function getAudio(): AudioPlayer {
  return instance ?? NOOP;
}
