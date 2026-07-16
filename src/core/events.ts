// 锦囊(Chance)/ 天命(Fate)随机事件库——三国典故化重写。
// 纯随机抽取(每次落格独立),效果温和(±100~250)。
// Chance = 锦囊妙计(得计,偏正面);Fate = 天命难违(偏负面)。
export interface RandomEvent {
  id: string;
  text: string; // 战报简报
  cashDelta: number; // +收入 / -支出
}

export const CHANCE_EVENTS: RandomEvent[] = [
  { id: "empty-fort", text: "空城退敌", cashDelta: 250 },
  { id: "arrows", text: "草船借箭", cashDelta: 200 },
  { id: "ally", text: "义士来投", cashDelta: 150 },
  { id: "harvest", text: "风调雨顺", cashDelta: 100 },
];

export const FATE_EVENTS: RandomEvent[] = [
  { id: "maicheng", text: "败走麦城", cashDelta: -250 },
  { id: "fire-camp", text: "火烧连营", cashDelta: -200 },
  { id: "jieting", text: "痛失街亭", cashDelta: -150 },
  { id: "ambush", text: "中伏溃散", cashDelta: -100 },
];
