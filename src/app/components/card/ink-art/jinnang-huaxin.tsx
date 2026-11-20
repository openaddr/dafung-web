// #763 自绘专属墨线。viewBox 统一 0 0 100 70，描边由金框画心取族色。
import type { ReactNode } from "react";

interface JinnangInkArt {
  label: string;
  paths: ReactNode;
}

export const JINNANG_INK_ART: ReadonlyMap<string, JinnangInkArt> = new Map([
  [
    "军情密探",
    {
      label: "一只睁开的眼睛",
      paths: (
        <>
          <path d="M10 36 C24 18 76 18 90 36 C76 54 24 54 10 36 Z" strokeWidth={3.2} />
          <circle cx={50} cy={36} r={12} strokeWidth={2.8} />
          <circle cx={50} cy={36} r={4.5} style={{ fill: "var(--fam)" }} stroke="none" />
          <path d="M38 13 L42 19 M62 13 L58 19" strokeWidth={1.9} />
        </>
      ),
    },
  ],
  [
    "横征暴敛",
    {
      label: "一大一小两枚相叠的方孔钱",
      paths: (
        <>
          <circle cx={44} cy={28} r={20} strokeWidth={3.4} />
          <path d="M38 22 H50 V34 H38 Z" strokeWidth={2.1} />
          <circle cx={68} cy={46} r={13} strokeWidth={2.8} />
          <path d="M63 41 H73 V51 H63 Z" strokeWidth={1.8} />
        </>
      ),
    },
  ],
  [
    "求贤令",
    {
      label: "一幅盖着方印的求贤榜文",
      paths: (
        <>
          <path d="M22 12 H78" strokeWidth={3.4} />
          <circle cx={22} cy={12} r={3} strokeWidth={2} />
          <circle cx={78} cy={12} r={3} strokeWidth={2} />
          <path d="M30 17 V53 M70 17 V53" strokeWidth={2.2} />
          <path d="M30 53 Q50 59 70 53" strokeWidth={2.2} />
          <path d="M38 26 H62 M38 34 H62" strokeWidth={1.9} />
          <rect x={46} y={41} width={9} height={9} rx={1} strokeWidth={1.9} />
        </>
      ),
    },
  ],
]);
