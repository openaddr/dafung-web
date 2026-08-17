// 真实 3D 物理骰子(three.js + cannon-es):6 面汉字签面立方体在骰盘里真实乱滚。
// 迁移自 src/render/dice3d.ts(无 @render 内部依赖,类体原样搬运),差异:
//   roll(die?) 结果值可选——不传时由注入的 rng 本地随机;传值 = 权威点数(联机服务器下发)。
//   落面由「反向求解」保证:先在同一物理世界离线试掷,找到能自然停在目标面的初始
//   条件再实播(物理确定性 → 实播落面与试掷一致),全程无结尾 snap 翻面;静止后仅
//   允许 <5° 的极小归正(吸收物理噪声),详见 rollAsync/solveLaunch 注释。
// WebGL 不可用时降级为 no-op(available=false),上层走文字切换 fallback。
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { SIGN_FACES } from "@core/constants";
import { DICE } from "./timings";

// BoxGeometry 材质位顺序:[+X, -X, +Y, -Y, +Z, -Z] = [right,left,top,bottom,front,back]。
// 我们把 die 值贴到固定面,保证「die 面朝上时显示正确签面」。
// 这里定义每个材质位对应哪个 die 值(贴对应签面纹理):
const MAT_TO_DIE = [3, 4, 1, 2, 5, 6] as const;

/** die 值 → 让该面法线指向 +Y(朝上)的目标四元数。 */
function quatForDie(die: number): THREE.Quaternion {
  const X = new THREE.Vector3(1, 0, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  switch (die) {
    case 1: return new THREE.Quaternion();                                   // +Y 已朝上
    case 2: return new THREE.Quaternion().setFromAxisAngle(X, Math.PI);       // -Y → +Y
    case 3: return new THREE.Quaternion().setFromAxisAngle(Z, Math.PI / 2);  // +X → +Y
    case 4: return new THREE.Quaternion().setFromAxisAngle(Z, -Math.PI / 2); // -X → +Y
    case 5: return new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2); // +Z → +Y
    case 6: return new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2);  // -Z → +Y
    default: return new THREE.Quaternion();
  }
}

/** 用 canvas 生成 6 张汉字签面纹理(骨色底 + 双线边框 + 水墨字)。 */
function createFaceTextures(): THREE.CanvasTexture[] {
  const SIZE = 128;
  return SIGN_FACES.map((face) => {
    const cvs = document.createElement("canvas");
    cvs.width = SIZE;
    cvs.height = SIZE;
    const ctx = cvs.getContext("2d")!;

    // 骨色渐变底
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, "#ecdcb0");
    g.addColorStop(1, "#c9b27a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // 双线边框(古风)
    ctx.strokeStyle = "#6e5a2c";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, SIZE - 8, SIZE - 8);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(11, 11, SIZE - 22, SIZE - 22);

    // 签面汉字(水墨体)
    ctx.fillStyle = "#2b2317";
    ctx.font = "bold 92px 'Ma Shan Zheng','ZCOOL XiaoWei','KaiTi','STKaiti',serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(face, SIZE / 2, SIZE / 2 + 6);

    const tex = new THREE.CanvasTexture(cvs);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  });
}

const DIE_SIZE = 1.6;          // 立方体边长(物理单位)——更大,全屏视觉
const FIELD_W = 14;           // 骰盘物理宽(全屏大幅翻滚)
const FIELD_D = 10;           // 骰盘物理深
const SNAP_Y = DIE_SIZE / 2;  // 静息/吸附时骰中心 y(贴地)

/** die → 该面在骰子局部坐标下的单位法线(六面体常量)。 */
const FACE_NORMALS: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0),
  2: new THREE.Vector3(0, -1, 0),
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
  5: new THREE.Vector3(0, 0, 1),
  6: new THREE.Vector3(0, 0, -1),
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// ── C1 bot 半速掷骰(模块级速度开关)──
// diceApi.roll 桥(DiceOverlay 挂载时绑定 dice.roll(face))只透传点数一个参数,
// 速度标志由编排层 present() 在掷前调 setDiceFast 设置;roll() 读取后即复位,
// 不残留到下一次掷骰。默认 false(人类全速)。
let diceFast = false;

// ── M-4 reduced-motion:系统「减弱动态效果」时跳过物理翻滚演出 ──
// matchMedia 结果在运行期监听变化(用户中途改系统设置时立即生效)。
// bun 测试环境无 window:该处只判环境,浏览器/WebView 内恒有 window。
const motionQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
export let reducedMotion = motionQuery?.matches ?? false;
motionQuery?.addEventListener("change", () => {
  reducedMotion = motionQuery.matches;
});

/** 设置下一次掷骰的速度档(true = bot 半速)。 */
export function setDiceFast(fast: boolean): void {
  diceFast = fast;
}
/** 读取并复位速度标志(每次 roll 恰好消费一次)。 */
function consumeDiceFast(): boolean {
  const fast = diceFast;
  diceFast = false;
  return fast;
}

/** D2:模块级强制隐藏骰子 overlay。roll() 完成本会自己 hideOverlay,
 *  但胜利屏挂载可能赶在 holdMs 定时器之前(终局瞬间切屏),残留的 z-45 骰子层
 *  会压住胜利屏——胜利屏 mount 时调一次本函数兜住这个时序窗口。
 *  直接按类名清(overlay 由本模块创建且类名唯一),不触碰实例内部状态。 */
export function hideDiceOverlay(): void {
  document.querySelectorAll<HTMLElement>(".dice-overlay").forEach((el) => {
    el.style.display = "none";
  });
}

/** 从任意姿态四元数(x/y/z/w 分量)求当前朝上的 die(1-6)。物理求解与诊断共用。 */
function upFaceOf(q: { x: number; y: number; z: number; w: number }): number {
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  let best = -1;
  let bestDot = -2;
  for (const die of [1, 2, 3, 4, 5, 6]) {
    const dot = FACE_NORMALS[die].clone().applyQuaternion(quat).y;
    if (dot > bestDot) { bestDot = dot; best = die; }
  }
  return best;
}

/** 反向求解的落定目标姿态:在 current 的基础上,用「最小旋转」把 die 面法线掰到世界 +Y。
 *  只绕 n×up 轴转,不锁 yaw——落定微调观感是「归正」而非「旋转」,且天然保持落点朝向。 */
function alignFaceUp(current: THREE.Quaternion, die: number): THREE.Quaternion {
  const n = FACE_NORMALS[die].clone().applyQuaternion(current);
  const cosA = THREE.MathUtils.clamp(n.dot(WORLD_UP), -1, 1);
  const angle = Math.acos(cosA);
  if (angle < 1e-4) return current.clone();
  const axis = n.clone().cross(WORLD_UP);
  if (axis.lengthSq() < 1e-8) {
    // n 与 up 共线但反向(理论上是 180° 翻面——求解 bug 兜底,任选水平轴)
    axis.set(1, 0, 0);
  }
  axis.normalize();
  return new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(current);
}

/** 一次掷出的初始条件(反向求解的解:保存后可原样重放,物理确定性保证轨迹一致)。 */
interface LaunchState {
  position: CANNON.Vec3;
  quaternion: CANNON.Quaternion;
  velocity: CANNON.Vec3;
  angularVelocity: CANNON.Vec3;
}

/**
 * 真实 3D 物理骰子。
 * - 构造时探测 WebGL,失败 → available=false,roll/showFace 静默 no-op。
 * - roll(die?):反向求解初始条件后物理掷出,自然停在 die 面(静止后仅 <5° 微归正),
 *   resolve。die 省略时用注入的 rng 随机取 1-6(单机本地骰);联机传服务器权威点数。
 * - showFace(die):静息姿态(die 面朝上)。
 * - cleanup():dispose 全部 GL 资源。
 * - onHit(intensity):物理碰撞 callback,供上层接 diceHit 音效(0~1 强度)。
 */
export class ThreeDice {
  readonly available: boolean;

  private overlay: HTMLElement | null = null; // 全屏覆盖层
  private rng: () => number;
  private readonly onHit?: (intensity: number) => void;
  private collideListener: ((e: { contact: { getImpactVelocityAlongNormal(): number } }) => void) | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;
  private diceMesh: THREE.Mesh | null = null;
  private diceBody: CANNON.Body | null = null;
  private world: CANNON.World | null = null;
  private textures: THREE.CanvasTexture[] = [];

  private rafId = 0;
  private rolling = false;
  private disposed = false;
  /** 正交相机视野半高(init 与 resize 共用,保证重配后构图一致)。 */
  private static readonly VIEW_SIZE = 7;
  /** diceHit 节流:碰撞 callback 上次触发时间(ms),相邻碰撞间隔 < 60ms 时合并,
   *  免一次翻滚几十次碰撞创建大量 AudioBufferSource 拖慢物理步进(e2e 时序敏感)。 */
  private lastHitMs = 0;
  private static readonly HIT_THROTTLE_MS = 60;

  constructor(rng: () => number, onHit?: (intensity: number) => void) {
    this.rng = rng;
    this.onHit = onHit;
    // 创建全屏覆盖层(掷骰时显示,平时隐藏)
    this.overlay = document.createElement("div");
    this.overlay.className = "dice-overlay";
    this.overlay.style.display = "none";
    document.body.appendChild(this.overlay);
    // 探测 WebGL:可用(含 swiftshader 软件渲染)→ 真实 3D 乱滚;不可用 → available=false,
    // 上层自动回退文字切换动画。e2e 经 swiftshader 软件渲染跑真实 3D 路径。
    this.available = this.init();
    if (this.available) {
      this.showFace(1);
      this.hideOverlay();
      // F3:监听窗口尺寸变化(全屏 overlay 的 renderer/相机随之重配)
      window.addEventListener("resize", this.handleResize);
    } else {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  /** F3:窗口尺寸变化 → 重配 renderer 尺寸与正交相机 aspect(视野高度不变,横向裁切)。
   *  arrow 字段绑定 this,cleanup 移除时引用稳定。 */
  private readonly handleResize = (): void => {
    if (this.disposed || !this.renderer || !this.camera) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.renderer.setSize(W, H, false);
    const aspect = W / H;
    this.camera.left = -ThreeDice.VIEW_SIZE * aspect;
    this.camera.right = ThreeDice.VIEW_SIZE * aspect;
    this.camera.updateProjectionMatrix();
    // 立即重绘一帧(非掷骰期间 raf 不在跑,不补帧会留旧尺寸残影)
    if (this.scene && this.diceMesh) this.renderer.render(this.scene, this.camera);
  };

  private init(): boolean {
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return false;
    }
    // 软件 WebGL(swiftshader)/ 真硬件 WebGL 都返回非 null context;无 WebGL 返回 null
    if (!renderer.getContext()) {
      renderer.dispose();
      return false;
    }

    // 全屏渲染到 overlay(而非侧栏小窗 mount)
    const W = window.innerWidth;
    const H = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0); // 透明背景,透出 overlay 底色
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    this.overlay!.appendChild(renderer.domElement);
    this.renderer = renderer;

    // 场景 + 灯光(Ambient 主光 + 两道 Directional 模拟自然光,古风暖调)
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.75);
    dir.position.set(3, 8, 5);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xfff0d0, 0.35);
    dir2.position.set(-4, 5, -3);
    scene.add(dir2);
    this.scene = scene;

    // 正交相机(略微俯视;全屏适配大物理空间)
    const aspect = W / H;
    const viewSize = ThreeDice.VIEW_SIZE;
    const camera = new THREE.OrthographicCamera(
      -viewSize * aspect, viewSize * aspect,
      viewSize, -viewSize,
      0.1, 100,
    );
    camera.position.set(0.8, 7, 1.6);
    camera.lookAt(0, 0, 0);
    this.camera = camera;

    // 骰 mesh(6 面 Lambert 材质 + 汉字纹理,Lambert 受光照影响显立体)
    const textures = createFaceTextures();
    this.textures = textures;
    const mats = MAT_TO_DIE.map(
      (die) => new THREE.MeshLambertMaterial({ map: textures[die - 1] }),
    );
    const geo = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
    const mesh = new THREE.Mesh(geo, mats);
    scene.add(mesh);
    this.diceMesh = mesh;

    // ── cannon-es 物理 ──
    // 重力偏强 + 较高阻尼,让骰子真实乱滚后快速(~0.5-0.9s)静止,避免拖慢回合节奏。
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -32, 0) });
    world.broadphase = new CANNON.NaiveBroadphase();
    world.defaultContactMaterial.restitution = 0.28; // 弹跳适度(过低会粘地,过高滚不停)
    world.defaultContactMaterial.friction = 0.45;
    this.world = world;

    // 地面(y=0 平面,默认法线 +Z,绕 X 轴 -π/2 使法线朝 +Y)
    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    world.addBody(ground);

    // 四面边界墙(防骰滚出骰盘区域;墙高 2、厚 0.5,藏在相机俯视盲区)
    const halfW = FIELD_W / 2;
    const halfD = FIELD_D / 2;
    const wallT = 0.5;
    const wallH = 2;
    const addBox = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(sx, sy, sz)) });
      b.position.set(x, y, z);
      world.addBody(b);
    };
    addBox(0, wallH, -halfD, halfW + wallT, wallH, wallT); // 前 -Z
    addBox(0, wallH, halfD, halfW + wallT, wallH, wallT);  // 后 +Z
    addBox(-halfW, wallH, 0, wallT, wallH, halfD + wallT); // 左 -X
    addBox(halfW, wallH, 0, wallT, wallH, halfD + wallT);  // 右 +X

    // 骰 body(动态)
    const half = DIE_SIZE / 2;
    const diceBody = new CANNON.Body({
      mass: 0.35,
      shape: new CANNON.Box(new CANNON.Vec3(half, half, half)),
      position: new CANNON.Vec3(0, SNAP_Y, 0),
      linearDamping: 0.28,
      angularDamping: 0.28,
    });
    world.addBody(diceBody);
    this.diceBody = diceBody;

    // 物理碰撞 → onHit callback(供上层接 diceHit 音效;按冲击速度归一化为 0~1 强度)。
    if (this.onHit) {
      const listener = (e: { contact: { getImpactVelocityAlongNormal(): number } }) => {
        if (!this.onHit || this.disposed) return;
        const now = performance.now();
        if (now - this.lastHitMs < ThreeDice.HIT_THROTTLE_MS) return;
        const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
        if (impact > 0.5) {
          this.lastHitMs = now;
          this.onHit(Math.min(1, impact / 5));
        }
      };
      diceBody.addEventListener("collide", listener as unknown as (...args: unknown[]) => void);
      this.collideListener = listener;
    }

    return true;
  }

  /** 掷骰:反向求解初始条件 → 物理自然停在 die 面朝上,resolve。WebGL 不可用时立即 resolve。
   *  全屏模式:掷骰前显示 overlay,完成后延迟 holdMs 隐藏。
   *  C1:每次 roll 先消费模块级速度开关(setDiceFast),bot 半速 = 更短翻滚/硬上限/停留。
   *  M-4:系统「减弱动态效果」(reducedMotion)时跳过物理演出——直接摆到结果面,
   *  overlay 只短暂停留 ~500ms 让玩家看清点数。
   *  die 省略 → 用注入 rng 本地随机(单机);传值 = 权威点数(联机服务器下发)。 */
  roll(die?: number): Promise<void> {
    const face = die ?? (Math.floor(this.rng() * 6) + 1);
    if (!this.available) return Promise.resolve();
    const fast = consumeDiceFast(); // 每次掷骰恰好消费一次(reduced 路径直接丢弃)
    if (reducedMotion) {
      this.showOverlay();
      this.showFace(face);
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          this.hideOverlay();
          resolve();
        }, 500);
      });
    }
    const minRollMs = fast ? DICE.botMinRollMs : DICE.minRollMs;
    const hardCapMs = fast ? DICE.botHardCapMs : DICE.hardCapMs;
    const holdMs = fast ? DICE.botHoldMs : DICE.holdMs;
    this.showOverlay();
    return new Promise<void>((resolve) => {
      void this.rollAsync(face, minRollMs, hardCapMs, () => {
        // 显示结果 holdMs 后隐藏(bot 半速 250ms,人类 600ms)
        setTimeout(() => this.hideOverlay(), holdMs);
        resolve();
      });
    });
  }

  /** 显示全屏骰子层。 */
  private showOverlay(): void {
    if (this.overlay) this.overlay.style.display = "block";
  }

  /** 隐藏全屏骰子层。 */
  private hideOverlay(): void {
    if (this.overlay) this.overlay.style.display = "none";
  }

  private rollAsync(die: number, minRollMs: number, hardCapMs: number, done: () => void): void {
    if (!this.diceBody || !this.diceMesh || !this.world || !this.renderer || !this.scene || !this.camera) {
      done();
      return;
    }
    cancelAnimationFrame(this.rafId);
    this.rolling = true;
    this.lastHitMs = 0; // 重置节流:新一次掷骰的首次碰撞不被上一次掷骰压制

    const body = this.diceBody;
    const world = this.world;

    // ── 反向求解(TODO #1 的根治):给定目标面,先在「无渲染」的同一物理世界里
    // 反复试掷,直到某组初始条件(位置/姿态/线速度/角速度)模拟后**自然静止在目标面**,
    // 再用该初始条件实播。cannon-es 定步长积分确定性的:同初始状态 → 同轨迹,因此
    // 实播必然落在试掷验证过的面上,全程无 snap。期望 ~6 次命中(1/6);上限 12 次(C2 预算,耗尽走 snap 兜底)。
    // ── C2 预算:反向求解是同步 CPU 工作(12 次试掷 × ≤1.5s headless 模拟),期间
    //    rAF 不跑——软渲/低端设备上 overlay 会先白屏一拍。先进一次随机起手并渲染
    //    一帧起手姿态,让骰子先出现在盘上,再进 solve。复用现有 syncMesh+render 路径。
    const launch0 = this.randomLaunch();
    this.applyLaunch(body, launch0);
    this.syncMesh();
    this.renderer.render(this.scene, this.camera);

    const solved = this.solveLaunch(die);
    if (solved) {
      this.applyLaunch(body, solved);
    } else {
      // 兜底(理论到不了:概率 (5/6)^40 ≈ 0.07%):退回旧随机起手 + 结尾 snap,并 warn。
      console.warn(`[ThreeDice] reverse-solve exhausted for die=${die}, falling back to snap`);
      this.applyLaunch(body, this.randomLaunch());
    }

    const targetQ = solved ? null : quatForDie(die);
    const t0 = performance.now();
    // 墙钟判据:swiftshader 软渲每帧可能 50-150ms,按帧数判会拖到数秒(e2e 等待窗口爆掉)。
    // 改用真实经过时间,确保硬件 ~0.5-0.7s、swiftshader 也 ≤0.7s 收尾(+0.2s snap ≤0.9s)。
    // 阈值由 roll() 按速度档传入(C1:bot 半速 250/900,人类 500/1500;见 timings.DICE)。
    let stillFrames = 0;

    const step = () => {
      if (this.disposed || !this.rolling) {
        this.rolling = false;
        done();
        return;
      }
      world.step(1 / 60);
      this.syncMesh();
      this.renderer!.render(this.scene!, this.camera!);

      const elapsed = performance.now() - t0;
      const speed = body.velocity.length() + body.angularVelocity.length();
      if (speed < 0.8) stillFrames++; else stillFrames = 0;

      // 滚够 minRollMs 后静止持续 3 帧 → 收尾;或墙钟硬上限(与 GPU 帧率无关)
      if ((elapsed > minRollMs && stillFrames > 3) || elapsed > hardCapMs) {
        this.rolling = false;
        this.finishRoll(die, targetQ, done);
        return;
      }
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  /** 随机起手:位置(偏左上方,模拟从手中扔出)+ 强速度(向右下大幅抛掷新
   *  角速度更高(三轴快翻滚)。全屏模式参数——骰子要大范围翻滚、多次弹跳。 */
  private randomLaunch(): LaunchState {
    const rng = this.rng;
    return {
      position: new CANNON.Vec3(
        -4 + (rng() - 0.5) * 1.5,
        4 + rng() * 2,
        -2 + (rng() - 0.5) * 1.5,
      ),
      quaternion: new CANNON.Quaternion().setFromEuler(
        rng() * Math.PI * 2,
        rng() * Math.PI * 2,
        rng() * Math.PI * 2,
      ),
      velocity: new CANNON.Vec3(
        8 + rng() * 4,         // 主要向右抛掷
        1 + rng() * 2,         // 向上腾起
        (rng() - 0.5) * 3,
      ),
      angularVelocity: new CANNON.Vec3(
        18 + rng() * 14,
        18 + rng() * 14,
        18 + rng() * 14,
      ),
    };
  }

  /** 把初始条件原样写到 body 上(重放)。清力/力矩并唤醒,保证与试掷时完全同状态。 */
  private applyLaunch(body: CANNON.Body, s: LaunchState): void {
    body.position.copy(s.position);
    body.quaternion.copy(s.quaternion);
    body.velocity.copy(s.velocity);
    body.angularVelocity.copy(s.angularVelocity);
    body.force.setZero();
    body.torque.setZero();
    body.previousPosition.copy(s.position);
    body.previousQuaternion.copy(s.quaternion);
    body.interpolatedPosition.copy(s.position);
    body.interpolatedQuaternion.copy(s.quaternion);
    body.wakeUp();
  }

  /** 反向求解主循环:反复随机起手 + 离线(headless,无渲染)步进同一 world,
   *  按 rollAsync 相同的「滚够 500ms 且静止 3 步」判据模拟到静止;若此时朝上的
   *  面恰为目标 die,该初始条件即解。返回前把 body 重置为解,供实播重放。 */
  private solveLaunch(die: number, maxTries = 12): LaunchState | null {
    const body = this.diceBody!;
    const world = this.world!;
    for (let attempt = 0; attempt < maxTries; attempt++) {
      const s = this.randomLaunch();
      this.applyLaunch(body, s);
      const restQ = this.simulateToRest(body, world);
      if (restQ && upFaceOf(restQ) === die) {
        this.applyLaunch(body, s); // 重放前重置到解的初始状态
        return s;
      }
    }
    return null;
  }

  /** headless 模拟到静止:定步长 1/60 连续 step(不渲染,毫秒级完成上百步)。
   *  判据与实播一致:模拟时长 >500ms 且速度连续 3 步 <0.8;1.5s 硬上限仍未静止
   *  (卡在墙边抖动等边缘)→ 返回 null(该初始条件不采纳)。
   *  返回静止时的姿态;步进结果对 world 的副作用只有骰 body(地面/墙是静态体)。 */
  private simulateToRest(body: CANNON.Body, world: CANNON.World): CANNON.Quaternion | null {
    const dtMs = 1000 / 60;
    let simMs = 0;
    let stillSteps = 0;
    while (simMs <= 1500) {
      world.step(1 / 60);
      simMs += dtMs;
      const speed = body.velocity.length() + body.angularVelocity.length();
      if (speed < 0.8) stillSteps++; else stillSteps = 0;
      if (simMs > 500 && stillSteps > 3) return body.quaternion.clone();
    }
    return null;
  }

  /** 物理静止后的收尾:
   *  - 反向求解路径:理论上已停在目标面,只做极小角(<5°,吸收物理噪声/浮点尾差)
   *    的归正——用 alignFaceUp 的最小旋转(不锁 yaw),≤80ms 缓动,观感是「落定微调」。
   *    这是兜底而非主路径:若修正角 >5°(说明求解/重放出了问题,如软渲掉帧撞上
   *    HARD_CAP 提前截断)→ console.warn 便于排查,但仍用 ≤80ms 微调掰回目标面,
   *    绝不做 180° 翻面式长 slerp。
   *  - 求解耗尽兜底路径(targetQ 非 null):退回旧 200ms snap(应几乎不可达)。 */
  private finishRoll(die: number, targetQ: THREE.Quaternion | null, done: () => void): void {
    if (targetQ) {
      this.snapTo(targetQ, 200, done);
      return;
    }
    const mesh = this.diceMesh;
    if (!mesh) { done(); return; }
    const target = alignFaceUp(mesh.quaternion, die);
    const angle = mesh.quaternion.angleTo(target);
    if (angle > THREE.MathUtils.degToRad(5)) {
      console.warn(`[ThreeDice] settle correction ${THREE.MathUtils.radToDeg(angle).toFixed(1)}deg exceeds 5deg for die=${die} — solver replay mismatch?`);
    }
    if (angle < 0.005) { // 已精确归正(<0.3°),不动画
      done();
      return;
    }
    this.snapTo(target, 80, done);
  }

  private syncMesh(): void {
    if (!this.diceMesh || !this.diceBody) return;
    const p = this.diceBody.position;
    const q = this.diceBody.quaternion;
    this.diceMesh.position.set(p.x, p.y, p.z);
    this.diceMesh.quaternion.set(q.x, q.y, q.z, q.w);
  }

  /** 物理滚动停止后,平滑 lerp/slerp 到目标姿态(die 面朝上 + 落地高度)。 */
  private snapTo(target: THREE.Quaternion, durationMs: number, done: () => void): void {
    if (!this.diceMesh || !this.renderer || !this.scene || !this.camera || !this.diceBody) {
      done();
      return;
    }
    const mesh = this.diceMesh;
    const body = this.diceBody;

    // 冻结物理体(吸附期间不再 step,姿态全权由 lerp 控制)
    body.velocity.setZero();
    body.angularVelocity.setZero();

    const startQ = mesh.quaternion.clone();
    const startPos = mesh.position.clone();
    // 保留落点的 x/z(每次随机),仅把 y 拉回贴地高度
    const endPos = new THREE.Vector3(startPos.x, SNAP_Y, startPos.z);
    const t0 = performance.now();

    const tick = () => {
      if (this.disposed) {
        done();
        return;
      }
      const t = Math.min(1, (performance.now() - t0) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      mesh.quaternion.slerpQuaternions(startQ, target, eased);
      mesh.position.lerpVectors(startPos, endPos, eased);
      body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
      body.quaternion.set(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w);
      this.renderer!.render(this.scene!, this.camera!);
      if (t < 1) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        done();
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** 静息姿态:die 面朝上,中心贴地,不动画。用于初始化展示。 */
  showFace(die: number): void {
    if (!this.available || !this.diceMesh || !this.renderer || !this.scene || !this.camera || !this.diceBody) return;
    cancelAnimationFrame(this.rafId);
    this.rolling = false;
    const mesh = this.diceMesh;
    const body = this.diceBody;
    const q = quatForDie(die);
    mesh.quaternion.copy(q);
    mesh.position.set(0, SNAP_Y, 0);
    body.position.set(0, SNAP_Y, 0);
    body.quaternion.set(q.x, q.y, q.z, q.w);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    this.renderer.render(this.scene, this.camera);
  }

  /** 诊断:返回当前 mesh 朝上的面(1-6),基于四元数算各面法线与世界 +Y 的点积。 */
  getUpFace(): number {
    if (!this.diceMesh) return -1;
    const q = this.diceMesh.quaternion;
    // die → 该面在立方体局部坐标系下的法线
    const faces: { die: number; n: THREE.Vector3 }[] = [
      { die: 1, n: new THREE.Vector3(0, 1, 0) },
      { die: 2, n: new THREE.Vector3(0, -1, 0) },
      { die: 3, n: new THREE.Vector3(1, 0, 0) },
      { die: 4, n: new THREE.Vector3(-1, 0, 0) },
      { die: 5, n: new THREE.Vector3(0, 0, 1) },
      { die: 6, n: new THREE.Vector3(0, 0, -1) },
    ];
    let best = -1;
    let bestDot = -2;
    for (const f of faces) {
      const world = f.n.clone().applyQuaternion(q);
      if (world.y > bestDot) { bestDot = world.y; best = f.die; }
    }
    return best;
  }

  /** 释放所有 GL 资源(切换/重开局面时调用)。 */
  cleanup(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.rolling = false;
    // F3:解绑 resize 监听(与构造期的 addEventListener 成对)
    window.removeEventListener("resize", this.handleResize);
    if (this.diceBody && this.collideListener) {
      this.diceBody.removeEventListener("collide", this.collideListener as unknown as (...args: unknown[]) => void);
      this.collideListener = null;
    }
    for (const t of this.textures) t.dispose();
    this.textures = [];
    if (this.diceMesh) {
      this.diceMesh.geometry.dispose();
      const ms = Array.isArray(this.diceMesh.material) ? this.diceMesh.material : [this.diceMesh.material];
      for (const m of ms) (m as THREE.MeshLambertMaterial).dispose();
      this.diceMesh = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.scene = null;
    this.camera = null;
    this.diceBody = null;
    this.world = null;
  }
}
