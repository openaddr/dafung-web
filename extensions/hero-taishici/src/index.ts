// 太史慈 · 扩展名将包(权威侧贡献 TS 源)。分发 = 编译后 JS(包根 index.js):
//   bunx esbuild src/index.ts --format=esm --target=es2022 --outfile=../index.js
// 结构契约见 src/core/extension-contract.ts(ExtensionAuthorityContribution);
// 本包演示三能力之一「技能/效果注册」:一个自定义效果(joinGift)+ 挂时机框架的
// 触发技 + 复用既有结算案的主动技(warDrum);并演示「交互 handler」权威半边(#410):
// 一个 choices 通路无法自然表达的定制问询(blindPick,从暗牌中盲选)。效果与内置
// 效果同纪律:纯逻辑、只经引擎公共方法改状态、无随机数/时钟(ADR-0021/0022)。
import type { ExtensionAuthorityContribution } from "../../../src/core/extension-contract";

const contribution: ExtensionAuthorityContribution = {
  heroes: [
    {
      id: "taishici",
      name: "太史慈",
      title: "信义笃行",
      desc: "被招揽时义从归心:立即 +100 两(来投之礼)",
      image: "", // 立绘未落地:卡面走「像」占位(华佗先例);专属将旗由客户端渲染 hook 提供
      skills: [
        {
          id: "taishici-yicong",
          name: "义从",
          when: "HeroRecruited", // 招贤得将时机(subject=招揽者;scope self=属主即招揽者本人招到)
          effect: "joinGift",
          params: { amount: 100 },
          scope: "self",
        },
      ],
      active: {
        id: "taishici-pozhen",
        name: "破阵",
        cooldown: 3,
        desc: "擂鼓突阵:本回合你的下一次掷骰步数 +1(签面不变)。",
        target: "none",
        kind: "warDrum", // 复用既有结算案(jinnang-execution warDrum 路径),扩展零新增 kind
        params: { bonus: 1 },
      },
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
  },
  inquiries: [
    {
      /** 「信义盲选」演示(#410,choices 无法自然表达的定制问询):从被询问者手牌
       *  暗牌中盲选一张。选项集只表达「有几张可选」,label 用序号**不泄露牌面**——
       *  通用卷轴按 label 渲染会在 UI 上亮出暗牌,盲选必须换呈现(牌背),呈现意图
       *  由客户端交互 hook 声明(client.ts interactions,blindCards)。选项集本身
       *  仍走 ChoiceOption 词汇:引擎消费挂点(无匹配 choices 时回调)归后续票,
       *  届时经 snapshot.choices 单通道透出(ADR-0013 不旁路)。 */
      id: "taishici-blind-pick",
      askPlayer: ({ engine, seat }) =>
        Array.from({ length: engine.players[seat].jinnangHandCount }, (_, i) => ({
          id: `blind:${i}`,
          label: `暗牌·第${i + 1}张`,
          available: true,
        })),
    },
  ],
};

export default contribution;
