const contribution = {
  // 技能注册(ADR-0036:技能升一等公民):两条技先入技能表,名将池按 id 引用。
  skills: [
    {
      id: "taishici-yicong",
      name: "义从",
      // desc 必填(#604 每技自带,typecheck 纳入 extensions 面后暴露的包漂移,随修)
      desc: "被招揽时义从归心:立得 +100 两来投之礼",
      when: "HeroRecruited",
      // 招贤得将时机(subject=招揽者;scope self=属主即招揽者本人招到)
      effect: "joinGift",
      params: { amount: 100 },
      scope: "self",
    },
    {
      id: "taishici-pozhen",
      name: "破阵",
      cooldown: 3,
      desc: "擂鼓突阵:本回合你的下一次掷骰步数 +1(签面不变)。",
      target: "none",
      kind: "warDrum",
      // 复用既有结算案(jinnang-execution warDrum 路径),扩展零新增 kind
      params: { bonus: 1 },
    },
  ],
  heroes: [
    {
      id: "taishici",
      name: "太史慈",
      title: "信义笃行",
      // 技能池(ADR-0036):按池声明序引用上方注册的技(核心技亦可入池,如 "jixing")。
      // 立绘(#751 画像统一收官):sgs 经典形象直取(curid=8974,登记单源 public/assets/manifest.json)
      image: "/assets/heroes/hero-taishici-sgs.png",
      skillPool: ["taishici-yicong", "taishici-pozhen"],
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
};
var index_default = contribution;
export { index_default as default };
