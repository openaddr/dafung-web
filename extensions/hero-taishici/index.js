const contribution = {
  heroes: [
    {
      id: "taishici",
      name: "太史慈",
      title: "信义笃行",
      desc: "被招揽时义从归心:立即 +100 两(来投之礼)",
      image: "",
      // 立绘未落地:卡面走「像」占位(华佗先例);专属将旗由客户端渲染 hook 提供
      skills: [
        {
          id: "taishici-yicong",
          name: "义从",
          when: "HeroRecruited",
          // 招贤得将时机(subject=招揽者;scope self=属主即招揽者本人招到)
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
        kind: "warDrum",
        // 复用既有结算案(jinnang-execution warDrum 路径),扩展零新增 kind
        params: { bonus: 1 },
      },
    },
  ],
  effects: {
    /** 来投之礼:属主立即得 params.amount 两。走引擎 grantSkillCash(浮字+cashChanged
     *  事件流;不派发 CashGained 的防连锁口径与内置 gainCash 一致)。 */
    joinGift: (engine, ctx, params) => {
      const amount = params["amount"];
      if (amount === void 0)
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
var index_default = contribution;
export { index_default as default };
