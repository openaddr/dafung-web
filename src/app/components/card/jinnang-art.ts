interface JinnangStoryArt {
  src: string;
  alt: string;
}

/** #1410 确认的 A 案，为六张锦囊各配一幅完整小场景。 */
export const JINNANG_STORY_ART: ReadonlyMap<string, JinnangStoryArt> = new Map([
  ["连环计", { src: "/assets/jinnang/duel.webp", alt: "两名将领隔着军案掷骰" }],
  ["缓兵之计", { src: "/assets/jinnang/delay.webp", alt: "车轮陷在泥中，骑手勒马等待" }],
  ["窃玉偷香", { src: "/assets/jinnang/jade.webp", alt: "蒙面人从漆匣中取出一枚玉璧" }],
  ["火烧连营", { src: "/assets/jinnang/fire.webp", alt: "火沿山坡上的成排营帐蔓延" }],
  ["识破诡计", { src: "/assets/jinnang/counter.webp", alt: "谋士在烛光下展开一封竹简密札" }],
  ["半路杀出", { src: "/assets/jinnang/ambush.webp", alt: "城外关卡的守军用拒马拦下一名骑手" }],
]);

export const JINNANG_ART_URLS = Array.from(JINNANG_STORY_ART.values(), ({ src }) => src);
