// 锦囊(Chance)随机事件库——三国典故化重写。
// 纯随机抽取(每次落格独立),偏正面(0~+250)。Chance = 锦囊妙计(得计)。
// 天命(Fate)格不在此表:#121 起落格固定 +20 声望(movement-flow 直写),原天命坏事表已删。
export interface RandomEvent {
  id: string;
  text: string; // 战报简报
  cashDelta: number; // +收入 / -支出
  jinnangDraw?: true; // #147:该事件额外抽一张锦囊(军师来投)
}

export const CHANCE_EVENTS: RandomEvent[] = [
  { id: "empty-fort", text: "空城退敌", cashDelta: 250 },
  { id: "arrows", text: "草船借箭", cashDelta: 200 },
  { id: "ally", text: "义士来投", cashDelta: 150 },
  { id: "harvest", text: "风调雨顺", cashDelta: 100 },
  { id: "strategist", text: "军师来投,献计一封", cashDelta: 0, jinnangDraw: true }, // #147:辅路→锦囊佐料渠道
];
