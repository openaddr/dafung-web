import type { SoundEvent } from "@app/fx/sound-clips";

const groups = [
  ["opening", "界面与开局"],
  ["movement", "行军与拼点"],
  ["cities", "城池攻防"],
  ["cash", "银两与交割"],
  ["cards", "锦囊与反应"],
  ["retainers", "名将与珍宝"],
  ["stamina", "体力与休整"],
  ["finale", "破产与终局"],
] as const;

type Group = (typeof groups)[number][0];

interface SoundRow {
  group: Group;
  label: string;
  when: string;
}

// 试听与对局共用 SoundEvent，新增声音时编译检查是否补齐了游戏触发说明。
const rows: Record<SoundEvent, SoundRow> = {
  jinnangSelect: {
    group: "opening",
    label: "选择纸扣",
    when: "选中地图、国号、锦囊或其他有效选项",
  },
  scrollOpen: {
    group: "opening",
    label: "卷轴展开",
    when: "首次打开新抉择。正落都城时，等补给声收尾",
  },
  lobbyJoined: { group: "opening", label: "入房软木扣", when: "建房或入房后，首次房间校准完成" },
  reconnectFailure: { group: "opening", label: "重连提示", when: "连接恢复失败，出现恢复操作" },
  stamp: { group: "opening", label: "石印", when: "定都「筑」章落定，以及对局的通用印章" },
  gameStart: { group: "opening", label: "起兵主题", when: "全员定都，正式起兵" },
  diceLand: { group: "movement", label: "骰签落定", when: "骰签定面，或拼点签面依次落定" },
  marchStart: { group: "movement", label: "行军起步", when: "棋子实际开始一段行军" },
  haltLatch: { group: "movement", label: "驻跸门闩", when: "路过己方都城必停，驻跸条带首次出现" },
  duelClash: { group: "movement", label: "拼点合击", when: "拼点的签面开始起摇" },
  verdictChime: {
    group: "movement",
    label: "判词磬·中性",
    when: "中缝印落下时，旁观或打平的玩家听见单音",
  },
  verdictChimeWin: {
    group: "movement",
    label: "判词磬·己胜",
    when: "中缝印落下时，拼点获胜的本座听见上行双音",
  },
  verdictChimeLose: {
    group: "movement",
    label: "判词磬·己败",
    when: "中缝印落下时，拼点失利的本座听见下行双音",
  },
  buy: { group: "cities", label: "购地成交", when: "购地成功，「据」章钤定" },
  upgrade: { group: "cities", label: "扩军", when: "扩军或公道买卖实际提升城池等级" },
  cityHit: { group: "cities", label: "城池受击", when: "火攻扣防。同次火烧连营只响最重城损" },
  cityBreach: { group: "cities", label: "破防", when: "城池被打至降级，或都城防御打空" },
  cityConquest: { group: "cities", label: "攻陷", when: "非都城被攻陷，随易主或归无主落定" },
  coin: {
    group: "cash",
    label: "银两归账",
    when: "一笔收入的首枚铜钱抵达席位，轮末持城收益合响一次",
  },
  pay: { group: "cash", label: "独立失银", when: "独立扣掉银两，负向金额出现" },
  cashTransfer: {
    group: "cash",
    label: "铜钱交接",
    when: "玩家转账或珍宝交割，收款方的铜钱抵达席位",
  },
  ledgerClose: {
    group: "cash",
    label: "账册合拢",
    when: "出售资产后清偿债务。同次珍宝交割由交接声承接",
  },
  jinnangDraw: { group: "cards", label: "锦囊入手", when: "本座实际摸牌，同一段行军只响一次" },
  jinnangAnnounce: {
    group: "cards",
    label: "出牌拂纸",
    when: "公开出牌指示线或施展浮字出现，直接有结算音时由结算承接",
  },
  jinnangCountered: { group: "cards", label: "识破铜扣", when: "识破的结果确定生效" },
  jinnangRestored: { group: "cards", label: "反识破回音", when: "反识破最终恢复原锦囊的效果" },
  jinnangPeek: { group: "cards", label: "窥探翻页", when: "窥方实际打开军情密探弹层" },
  reactionOpen: { group: "cards", label: "开窗轻叩", when: "本座首次出现可应答的反应窗" },
  reactionTick: { group: "cards", label: "末段提醒", when: "反应窗剩 3 秒，本座仍可应答" },
  treasure: { group: "retainers", label: "探得珍宝", when: "探宝成功，「得」印落定" },
  treasureStolen: { group: "retainers", label: "窃得珍宝", when: "窃宝成功，「得」印落定" },
  bookSetDown: { group: "retainers", label: "书册入案", when: "求书、印书或遣散折书实际结算" },
  heroRecruited: { group: "retainers", label: "招将成功", when: "名将来投的浮字出现" },
  skillLearned: { group: "retainers", label: "习得技能", when: "习得技能的浮字出现" },
  staminaHit: {
    group: "stamina",
    label: "体力损耗",
    when: "实际扣体的浮字出现，耗竭随城损另行收口",
  },
  staminaRecover: {
    group: "stamina",
    label: "恢复体力",
    when: "实际恢复体力。都城同时补银时随归账合响",
  },
  exhaustionDrum: { group: "stamina", label: "体力耗竭", when: "外敌乘虚及城损结清，休整宣告出现" },
  bankrupt: { group: "finale", label: "倒旗起锣", when: "确认破产出局，倒旗起拍" },
  rain: { group: "finale", label: "雨声铺底", when: "倒旗起拍铺雨，仪式交棒前收声" },
  coinsBox: { group: "finale", label: "撒币短响", when: "破产出局仪式中的撒币拍" },
  victoryDrum: { group: "finale", label: "终局单鼓", when: "正常终局的胜利卷轴登场" },
  victory: {
    group: "finale",
    label: "称帝落印与角句",
    when: "胜利卷轴朱印落定，接起兵主题的短角句",
  },
};

const entries = Object.entries(rows) as [SoundEvent, SoundRow][];
export const soundGroups = groups.map(([key, label]) => ({
  key,
  label,
  rows: entries.filter(([, row]) => row.group === key),
}));
