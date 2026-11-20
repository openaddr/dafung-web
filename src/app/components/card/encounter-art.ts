import { ENCOUNTERS } from "@core/encounters";

const ART: Readonly<Record<string, readonly [file: string, alt: string]>> = {
  屯粮居奇: ["grain", "粮商在谷袋垛间掬起稻谷"],
  草船借箭: ["arrows", "江上草舟的草束插满箭矢"],
  风调雨顺: ["harvest", "雨后稻田里农人抱起一大束稻穗"],
  神医行诊: ["doctor", "郎中在屋内把脉，身侧药篮开盖"],
  义士来投: ["recruit", "石门前的义士捧剑投效"],
  圯上授书: ["bridge-scroll", "石桥上的老人向年轻行人递出一卷书"],
  窖藏现世: ["buried-hoard", "挖开的土沟里露出古铜器、玉件和铜钱"],
  传檄而定: ["surrender-edict", "使者在敞开的城门前宣示檄文，守军垂下兵器"],
  敌营哗变: ["camp-defectors", "离开军营的士卒挑粮投奔对营"],
  纳款输诚: ["tribute-silver", "邻镇使节在厅堂跪献一箱银锭"],
  奉迎天子: ["chariot", "金顶车驾在仪仗护送下过关"],
  木牛流马: ["wooden-ox", "匠人在山道上展示牛首木制粮车"],
  刮骨: ["arm-treatment", "将军沉着对弈，医者在一旁治臂"],
  直百五铢: ["coin-mint", "铸钱匠将铜液注入钱模，案前堆着方孔钱"],
  乌巢焚粮: ["wuchao-grain-fire", "夜袭将士举火点燃敌营的粮袋堆"],
  孙刘联姻: ["marriage-gifts", "两家使节在红绸婚仪上交接聘礼"],
  水淹七军: ["flooded-camp", "开堤放下的洪水漫过军帐"],
  七步诗: ["seven-steps", "青年文士在殿上缓步吟诗，满座注目"],
  空城计: ["empty-fort", "城门大开，城楼上的文士在两童相伴下抚琴"],
  三顾茅庐: ["thatched-cottage", "三位访客持书候在竹林茅舍前"],
  挟玺号令: ["imperial-seal-command", "玉玺陈于座前，来使跪献盟书"],
  携民渡江: ["refugees", "有棚渡船载着流民和家当过江"],
  散财消灾: ["grain-relief", "官吏开仓赈粮，给携孩子的妇人盛粮"],
  以宝换贤: ["treasures-for-service", "武将使者在烛下呈上佩剑与铜镜"],
  结盟互市: ["market-alliance", "两镇使节在集市的案上钤印盟书"],
  温泉疗养: ["hot-spring", "卸下盔甲的士卒泡在冒着热气的山间温泉里"],
  夜行军: ["night-march", "火把照着夜色中的运粮队伍，马车沿山路前行"],
  单刀赴会: ["lone-banquet", "绿袍武将独自携刀走进对席只有两只酒盏的宴会"],
  义释俘虏: ["prisoners-released", "辕门前军吏割断捆住俘虏手腕的绳索"],
  走马荐诸葛: ["horseback-recommendation", "谋士回马向等候的主公递荐书"],
  匿玺: ["well-seal", "汲井的士卒在石井旁举起滴水的金角玉玺"],
  连环计: ["linked-stratagem", "灯下谋士指着地图上对峙的两组木筹献策"],
  摸金: ["tomb-raiders", "军士提灯撬开古墓棺椁，露出殉葬金器"],
  太平要术: ["daoist-arts", "夜访营门的游方道人递上缚绳的书册"],
  山越羁縻: ["mountain-envoys", "使者牵牛携酒，在山口与山越首领会面"],
  千里走单骑: ["solitary-rider", "一位披绿氅的骑士孤身越过风雪山路"],
  辕门射戟: ["halberd-target", "弓手在使节注视下拉弓瞄准辕门长戟"],
  粮道被劫: ["grain-ambush", "山贼在窄道上夺取翻倒牛车上的粮筐"],
  漕船倾覆: ["capsized-barge", "漕船倾覆，敞开的银箱和银锭跌进波涛"],
  假道征粮: ["false-passage", "对军拦住商旅，军官伸手勒取银袋"],
  疫病入营: ["outbreak", "雨中军帐躺着病卒，药罐架在火上"],
  强征军粮: ["requisition", "士兵在乡里强征粮袋，老农护住粮筐"],
  祸水东引: ["border-bandits", "边骑与马贼在岔路口对峙，暗处斥候指向另一条路"],
  坚壁清野: ["scorched-fields", "守军在村外点燃仍在田间的庄稼，敌军逼近"],
  河堤告急: ["failing-levee", "民夫在秋雨中搬运沙袋堵住河堤漏口"],
  盟镇勒币: ["ally-extortion", "来使把盟书拍在空贡盘边，向对坐的主公索币"],
  驿马倒毙: ["relay-horse-collapse", "驿马倒在路边，后方士卒拖着辎重徒步赶路"],
  火烛惊营: ["tent-fire", "油灯翻倒，士卒提水抢救着火的军帐"],
  的卢妨主: ["dilu-horse", "使者牵来白马，谋士在一旁指向马匹劝阻"],
  建安大疫: ["jianan-epidemic", "大疫中的数户人家照看病患，医者提着药箱穿过街巷"],
  华容道: ["huarong", "窄谷泥淖中，士卒合力推陷住的巨轮"],
  山洪冲道: ["flash-flood", "山洪冲断沿崖的木栈道，谷筐随水漂走"],
  溃卒为盗: ["deserter-raiders", "溃卒披着残甲闯进乡宅，抢走鸡和粮食"],
  辎重陷淖: ["bogged-wagon", "粮车陷在泥路上，士卒卸下粮袋步行"],
  武库渗朽: ["rusted-armory", "雨水从武库屋顶滴入，库吏拿起受潮的弩"],
  流言中伤: ["rumor-whisper", "集市上有人贴近商贩耳边散播流言"],
  津口勒索: ["checkpoint-bribe", "渡口守将挡住登船的旅人，伸手索取银袋"],
  粮仓霉变: ["molded-grain", "漏雨的粮仓里倒出发霉的粮食，商人掩鼻"],
  功高震主: ["victory-suspicion", "使者向胜归的将军献礼，同时窥看缴获的军旗"],
  敌垒相逼: ["frontier-rampart", "敌军在边河对岸用木桩和泥土筑垒"],
};

/** 手册目录、详情与局内卷轴按同一机遇 ID 读取画心。 */
export function encounterArt(id: string): { src: string; alt: string } {
  if (!Object.hasOwn(ART, id)) throw new Error(`机遇「${id}」缺画心`);
  const [file, alt] = ART[id];
  return { src: `/assets/encounters/${file}.webp`, alt };
}

/** 对局预热只取抉择条目，每个文件仅一次。 */
export const ENCOUNTER_CHOICE_ART_URLS = [
  ...new Set(ENCOUNTERS.filter((def) => def.choices != null).map(({ id }) => encounterArt(id).src)),
];
