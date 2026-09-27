// 锦囊牌面纯数据单测(#236 一期 T1):别称切分(8 张真实牌逐张)/ 四族映射 /
// 目标域中文 / 尺寸表。牌面数据单源 core/jinnang.ts,本文件只验证「牌面怎么画」
// 的映射(src/app/components/card/jinnang-face-data.ts)与单源对齐。
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { JINNANG_CARDS } from "@core/jinnang";
import { TREASURES } from "@core/treasures";
import {
  jinnangAliasSplit,
  JINNANG_FAMILY,
  JINNANG_TARGET_LABEL,
  treasureFrameTone,
  treasureLevelCn,
  rackTilt,
} from "@app/components/card/jinnang-face-data";

describe("jinnangAliasSplit(笺脚别称剥离)", () => {
  it("9 张真实牌逐张:常规牌都有四字计名别称,切分无损还原原文", () => {
    expect(JINNANG_CARDS.length).toBe(9);
    for (const def of JINNANG_CARDS) {
      const { alias, body } = jinnangAliasSplit(def.text);
      if (def.targetDomain === "reaction") continue; // 反应牌照票面无别称前缀(#281)
      expect(alias).not.toBeNull();
      expect(alias!.length).toBe(4); // 冒号前是四字计名别称(牌面用语规范)
      expect(body.length).toBeGreaterThan(0);
      expect(`${alias}:${body}`).toBe(def.text); // 无损:alias + 冒号 + body = 原文
      expect(body.includes(":")).toBe(false); // 按第一个冒号切,正文不再含冒号
    }
  });

  it("已知牌抽检:连环计=「二虎竞食」、求贤令=「张榜求贤」,正文自冒号后起", () => {
    const lianhuan = JINNANG_CARDS.find((c) => c.id === "连环计")!;
    expect(jinnangAliasSplit(lianhuan.text)).toEqual({
      alias: "二虎竞食",
      body: "指定两名其他诸侯拼点,胜者得 300 两,败者向你赔 400 两;平局则此计作废。",
    });
    const qiuxian = JINNANG_CARDS.find((c) => c.id === "求贤令")!;
    expect(jinnangAliasSplit(qiuxian.text).alias).toBe("张榜求贤");
  });

  it("无冒号:alias=null,body=全文", () => {
    expect(jinnangAliasSplit("至你的下回合开始")).toEqual({
      alias: null,
      body: "至你的下回合开始",
    });
  });
});

describe("JINNANG_FAMILY(五标签映射:一标签一族)", () => {
  it("谋/攻/守/援/即时 五标签齐全,pattern 与 token 一一对应", () => {
    expect(new Set(Object.keys(JINNANG_FAMILY))).toEqual(new Set(["谋", "攻", "守", "援", "即时"]));
    expect(JINNANG_FAMILY["谋"]).toEqual({
      token: "--color-seal-qing",
      pattern: "cloud",
      label: "谋",
      faceClass: "f-mou",
    });
    expect(JINNANG_FAMILY["攻"]).toEqual({
      token: "--color-danger",
      pattern: "fire",
      label: "攻",
      faceClass: "f-gong",
    });
    expect(JINNANG_FAMILY["守"]).toEqual({
      token: "--color-road-side",
      pattern: "shield",
      label: "守",
      faceClass: "f-shou",
    });
    expect(JINNANG_FAMILY["援"]).toEqual({
      token: "--color-money",
      pattern: "branch",
      label: "援",
      faceClass: "f-yuan",
    });
    // 即时族(#281 正式):电纹·靛青(--color-jishi),章字=即时
    expect(JINNANG_FAMILY["即时"]).toEqual({
      token: "--color-jishi",
      pattern: "bolt",
      label: "即时",
      faceClass: "f-shi",
    });
  });

  it("族 token 全部存在于 tokens.css(与配色单源核对,防漂移)", () => {
    const tokens = readFileSync(new URL("../src/app/styles/tokens.css", import.meta.url), "utf8");
    for (const fam of Object.values(JINNANG_FAMILY)) {
      expect(tokens.includes(`\n  ${fam.token}: `)).toBe(true);
    }
  });

  it("每张真实牌的每个标签都有族映射(牌面族色=tags[0] 也不会落空)", () => {
    for (const def of JINNANG_CARDS) {
      for (const t of def.tags) expect(JINNANG_FAMILY[t]).toBeDefined();
    }
  });
});

describe("JINNANG_TARGET_LABEL(目标域中文)", () => {
  it("五域齐全,文案与牌面用语规范一致", () => {
    expect(JINNANG_TARGET_LABEL).toEqual({
      self: "自身",
      one: "指定一名其他诸侯",
      "two-others": "指定两名其他诸侯",
      "all-others": "其余所有诸侯",
      reaction: "反应窗打出",
    });
  });

  it("每张真实牌的 targetDomain 都有中文", () => {
    for (const def of JINNANG_CARDS) {
      expect(JINNANG_TARGET_LABEL[def.targetDomain].length).toBeGreaterThan(0);
    }
  });
});

describe("牌面 ↔ CSS 镜像钉(格式鲁棒:规则体匹配,不看排版)", () => {
  const css = () =>
    readFileSync(new URL("../src/app/components/card/jinnang-card.css", import.meta.url), "utf8");

  it("尺寸档:jinnang-card 基准 8px(→120×160)/ .lg 16px(→240×320)——数值唯一事实源在 CSS", () => {
    // 首个 .jinnang-card 基座规则块内 font-size:8px;.lg 档规则块内 16px(容任意空白)
    const base = css().match(/\.jinnang-card\s*\{[^}]*\}/s);
    expect(base, ".jinnang-card 基座规则块缺失").not.toBeNull();
    expect(base![0]).toMatch(/font-size:\s*8px/);
    const lg = css().match(/\.jinnang-card\.lg\s*\{[^}]*\}/s);
    expect(lg, ".jinnang-card.lg 档规则块缺失").not.toBeNull();
    expect(lg![0]).toMatch(/font-size:\s*16px/);
  });

  it("FAM 族色镜像:JINNANG_FAMILY.faceClass ↔ CSS .f-* 的 --fam token 一一对应", () => {
    // 组件不再自备第二份映射(face-data 单源),这里把「数据类名 → CSS token」钉死
    for (const fam of Object.values(JINNANG_FAMILY)) {
      const rule = css().match(new RegExp(`\\.${fam.faceClass}\\s*\\{[^}]*\\}`, "s"));
      expect(rule, `.${fam.faceClass} 规则块缺失`).not.toBeNull();
      expect(rule![0]).toMatch(new RegExp(`--fam:\\s*var\\(${fam.token}\\)`));
    }
  });
});

describe("treasureFrameTone(珍宝品级 → 框色档,#234/#281)", () => {
  it("档位边界:1–3 铜 / 4–6 银 / 7–10 金", () => {
    expect(treasureFrameTone(1)).toBe("tong");
    expect(treasureFrameTone(3)).toBe("tong");
    expect(treasureFrameTone(4)).toBe("yin");
    expect(treasureFrameTone(6)).toBe("yin");
    expect(treasureFrameTone(7)).toBe("gold");
    expect(treasureFrameTone(10)).toBe("gold");
  });

  it("目录在售珍宝(treasures.ts)逐张有框色档,且等级全部落在 1..10", () => {
    for (const t of TREASURES) {
      expect(t.level).toBeGreaterThanOrEqual(1);
      expect(t.level).toBeLessThanOrEqual(10);
      expect(["tong", "yin", "gold"]).toContain(treasureFrameTone(t.level));
    }
  });

  it("TONE CSS 镜像:.tone-tong/yin/gold 都在 jinnang-card.css,内环框+--tone 双通道", () => {
    const css = () =>
      readFileSync(new URL("../src/app/components/card/jinnang-card.css", import.meta.url), "utf8");
    for (const tone of ["tong", "yin", "gold"]) {
      const rule = css().match(new RegExp(`\\.jinnang-card\\.tone-${tone}\\s*\\{[^}]*\\}`, "s"));
      expect(rule, `.tone-${tone} 规则块缺失`).not.toBeNull();
      expect(rule![0]).toMatch(/inset 0 0 0 0\.3em/); // 同形框异色=品级:内环描述符固定
      expect(rule![0]).toMatch(/--tone:/); // 框色与品级大字共用 --tone
    }
  });
});

describe("treasureLevelCn(珍宝等级汉字,牌面品级大字)", () => {
  it("1..10 逐级映射汉字", () => {
    expect(treasureLevelCn(1)).toBe("一");
    expect(treasureLevelCn(5)).toBe("五");
    expect(treasureLevelCn(9)).toBe("九");
    expect(treasureLevelCn(10)).toBe("十");
  });

  it("越界=数据 bug 显式抛错(零兜底)", () => {
    expect(() => treasureLevelCn(0)).toThrow();
    expect(() => treasureLevelCn(11)).toThrow();
  });
});

describe("rackTilt(军师幕/反应窗牌面微旋,±1.5°)", () => {
  it("输出恒在 ±1.5° 内,同 key 确定性(重渲不翻滚)", () => {
    const keys = ["火烧连营#0", "识破诡计#1", "连环计#2", "求贤令#3", "横征暴敛#4"];
    for (const k of keys) {
      const a = rackTilt(k);
      expect(a).toBe(rackTilt(k)); // 确定性
      expect(Math.abs(a)).toBeLessThanOrEqual(1.5);
    }
  });

  it("样本集上正负角都有分布(不是单侧常数)", () => {
    const tilts = Array.from({ length: 40 }, (_, i) => rackTilt(`牌#${i}`));
    expect(tilts.some((t) => t > 0)).toBe(true);
    expect(tilts.some((t) => t < 0)).toBe(true);
  });
});
