// 太史慈 · 扩展名将包(权威侧贡献 TS 源)。分发 = 编译后 JS(包根 index.js,包根下执行):
//   bunx esbuild src/index.ts --format=esm --target=es2022 --charset=utf8 --outfile=index.js
// 结构契约见 src/core/extension-contract.ts(ExtensionAuthorityContribution);
// 本包演示三能力之一「技能/效果注册」(ADR-0036 技能升一等公民):一个自定义效果
// (joinGift)+ 两条挂时机框架的触发技 + 复用既有结算案的主动技(warDrum),三条技
// 经 skills 注册面入表、名将池按 id 引用;并演示「交互 handler」全链(#410 注册,
// #424 引擎消费挂点+命令路由落地):一个 choices 通路无法自然表达的定制问询
// (taishici-blind-pick,从暗牌中盲选)——招贤得太史慈即触发(HeroRecruited 第二技),
// 应答弃 1 摸 1 真实生效。效果与内置效果同纪律:纯逻辑、只经引擎公共方法改状态、
// 无随机数/时钟(ADR-0021/0022)。
import type { ExtensionAuthorityContribution } from "../../../src/core/extension-contract";

const contribution: ExtensionAuthorityContribution = {
  // 技能注册(ADR-0036:技能升一等公民):三条技先入技能表,名将池按 id 引用。
  skills: [
    {
      id: "taishici-yicong",
      name: "义从",
      // desc 必填(#604 每技自带,typecheck 纳入 extensions 面后暴露的包漂移,随修)
      desc: "被招揽时义从归心:立得 +100 两来投之礼",
      when: "HeroRecruited", // 招贤得将时机(subject=招揽者;scope self=属主即招揽者本人招到)
      effect: "joinGift",
      params: { amount: 100 },
      scope: "self",
    },
    {
      // 「信义盲选」触发技(#424 对局可玩):招贤即问询发起。空手牌无可盲选,
      // 效果条件不满足静默跳过(EffectFn 语义,非兜底);1 张=唯一选项自动执行
      // (ADR-0013,引擎分流);≥2 张=弹问询卷轴(客户端按呈现意图画牌背)。
      id: "taishici-blindpick",
      name: "信义盲选",
      desc: "被招揽时行信义试炼:从手牌中盲选一张,弃旧换新",
      when: "HeroRecruited",
      effect: "blindPickRitual",
      scope: "self",
    },
    {
      id: "taishici-pozhen",
      name: "破阵",
      cooldown: 3,
      desc: "擂鼓突阵:本回合你的下一次掷骰步数 +1(签面不变)。",
      target: "none",
      kind: "warDrum", // 复用既有结算案(jinnang-execution warDrum 路径),扩展零新增 kind
      params: { bonus: 1 },
    },
  ],
  heroes: [
    {
      id: "taishici",
      name: "太史慈",
      title: "信义笃行",
      // 技能池(ADR-0036):按池声明序引用上方注册的技(核心技亦可入池,如 "jixing")。
      // 立绘(#751 画像统一收官):sgs 经典形象直取(curid=8974,素材映射.md);
      // 专属将旗仍由客户端渲染 hook 提供
      image: "/assets/heroes/hero-taishici-sgs.png",
      skillPool: ["taishici-yicong", "taishici-blindpick", "taishici-pozhen"],
    },
  ],
  effects: {
    /** 来投之礼:属主立即得 params.amount 两。走引擎 grantSkillCash(浮字+cashChanged
     *  事件流;不派发 CashGained 的防连锁口径与内置 gainCash 一致)。 */
    joinGift: (engine, ctx, params) => {
      const amount = params["amount"];
      if (amount === undefined)
        throw new Error(`扩展效果 joinGift 缺参数 amount(包 ${ctx.moment} 数据 bug)`);
      engine.grantSkillCash(ctx.owner, amount);
      return true;
    },
    /** 信义盲选发起(#424):经引擎公共方法 askInquiry 挂起问询(选项集分流/相位进出
     *  全在引擎 inquiry-flow 域,扩展只报「要问了」)。 */
    blindPickRitual: (engine, ctx) => {
      if (engine.players[ctx.owner].jinnangHandCount === 0) return false; // 无牌可盲选:不发起
      engine.askInquiry("taishici-blind-pick");
      return true;
    },
  },
  inquiries: [
    {
      /** 「信义盲选」演示(#410 注册/#424 全链,choices 无法自然表达的定制问询):
       *  从被询问者手牌暗牌中盲选一张。选项集只表达「有几张可选」,label 用序号
       *  **不泄露牌面**——通用卷轴按 label 渲染会在 UI 上亮出暗牌,盲选必须换呈现
       *  (牌背),呈现意图由客户端交互 hook 声明(client.ts interactions,blindCards)。
       *  选项集本身仍走 ChoiceOption 词汇:AwaitingInquiry 相位注册条目按 id 回调产出,
       *  经 snapshot.choices 单通道透出(ADR-0013 不旁路)。 */
      id: "taishici-blind-pick",
      name: "信义盲选", // 战报显示名(#424):玩家可读,不亮内部 id
      askPlayer: ({ engine, seat }) =>
        Array.from({ length: engine.players[seat].jinnangHandCount }, (_, i) => ({
          id: `blind:${i}`,
          label: `暗牌·第${i + 1}张`,
          available: true,
        })),
      /** 应答结算(#424):盲中的暗牌弃掉、立即摸一张(信义试炼,舍旧迎新)。
       *  选项 id=手牌下标句柄(问询挂起期间手牌不变——挂起即相位,无 intervening 命令),
       *  越界 = 调用方/状态机 bug,当场炸(零兜底)。 */
      resolve: ({ engine, seat }, optionId) => {
        if (!optionId.startsWith("blind:"))
          throw new Error(`信义盲选:未知选项「${optionId}」(调用方 bug)`);
        const hand = engine.players[seat].jinnangHand;
        const cardId = hand[Number(optionId.slice("blind:".length))];
        if (cardId == null)
          throw new Error(`信义盲选:选项「${optionId}」越界(手牌 ${hand.length} 张,状态机 bug)`);
        engine.discardJinnang(seat, cardId); // 舍旧
        engine.drawJinnang(seat, 1); // 迎新
      },
    },
  ],
};

export default contribution;
