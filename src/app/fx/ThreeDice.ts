// 真实 3D 物理骰子(three.js + cannon-es):6 面汉字签面立方体在骰盘里真实乱滚。
// 迁移自 src/render/dice3d.ts(无 @render 内部依赖,类体原样搬运),差异仅:
//   roll(die?) 结果值可选——不传时由注入的 rng 本地随机;
//   为将来「服务器权威骰子」留缝:联机端拿到服务器下发 die 后直接传入,
//   物理翻滚只负责表现,点数来自参数而非本地物理结算(物理从来不决定点数,
//   snap 阶段强行吸附到目标面,见 TODO.md「结尾 snap 到结果面」既有课题)。
// WebGL 不可用时降级为 no-op(available=false),上层走文字切换 fallback。
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { SIGN_FACES } from "@core/constants";

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

/**
 * 真实 3D 物理骰子。
 * - 构造时探测 WebGL,失败 → available=false,roll/showFace 静默 no-op。
 * - roll(die?):随机初速度+角速度掷出 → world.step 步进 → 几次弹跳衰减 → 吸附旋转让 die 面朝上。
 *   die 省略时用注入的 rng 随机取 1-6(单机本地骰);联机将来传服务器权威点数。
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
    } else {
      this.overlay.remove();
      this.overlay = null;
    }
  }

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
    const viewSize = 7; // 视野更大,覆盖全屏
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

  /** 掷骰:物理乱滚 → 吸附到 die 面朝上,resolve。WebGL 不可用时立即 resolve。
   *  全屏模式:掷骰前显示 overlay,完成后延迟 600ms 隐藏。
   *  die 省略 → 用注入 rng 本地随机(单机);传值 = 权威点数(将来联机服务器下发)。 */
  roll(die?: number): Promise<void> {
    const face = die ?? (Math.floor(this.rng() * 6) + 1);
    if (!this.available) return Promise.resolve();
    this.showOverlay();
    return new Promise<void>((resolve) => {
      void this.rollAsync(face, () => {
        // 显示结果 600ms 后隐藏
        setTimeout(() => this.hideOverlay(), 600);
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

  private rollAsync(die: number, done: () => void): void {
    if (!this.diceBody || !this.diceMesh || !this.world || !this.renderer || !this.scene || !this.camera) {
      done();
      return;
    }
    cancelAnimationFrame(this.rafId);
    this.rolling = true;
    this.lastHitMs = 0; // 重置节流:新一次掷骰的首次碰撞不被上一次掷骰压制

    const body = this.diceBody;
    const world = this.world;
    const rng = this.rng;

    // 随机起手:位置(偏左上方,模拟从手中扔出)+ 强速度(向右下大幅抛掷新
    // 角速度更高(三轴快翻滚)。全屏模式参数——骰子要大范围翻滚、多次弹跳。
    body.wakeUp();
    body.position.set(
      -4 + (rng() - 0.5) * 1.5,
      4 + rng() * 2,
      -2 + (rng() - 0.5) * 1.5,
    );
    body.velocity.set(
      8 + rng() * 4,         // 主要向右抛掷
      1 + rng() * 2,         // 向上腾起
      (rng() - 0.5) * 3,
    );
    body.angularVelocity.set(
      18 + rng() * 14,
      18 + rng() * 14,
      18 + rng() * 14,
    );
    body.quaternion.setFromEuler(
      rng() * Math.PI * 2,
      rng() * Math.PI * 2,
      rng() * Math.PI * 2,
    );

    const targetQ = quatForDie(die);
    const t0 = performance.now();
    // 墙钟判据:swiftshader 软渲每帧可能 50-150ms,按帧数判会拖到数秒(e2e 等待窗口爆掉)。
    // 改用真实经过时间,确保硬件 ~0.5-0.7s、swiftshader 也 ≤0.7s 收尾(+0.2s snap ≤0.9s)。
    const MIN_ROLL_MS = 500;   // 至少滚 0.5s,全屏大幅翻滚要有足够的翻滚感
    const HARD_CAP_MS = 1500;  // 1.5s 硬上限(全屏模式允许更长翻滚)
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

      // 滚够 MIN_ROLL_MS 后静止持续 3 帧 → 吸附;或墙钟硬上限 → 吸附(与 GPU 帧率无关)
      if ((elapsed > MIN_ROLL_MS && stillFrames > 3) || elapsed > HARD_CAP_MS) {
        this.rolling = false;
        this.snapTo(targetQ, 200, done);
        return;
      }
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
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
