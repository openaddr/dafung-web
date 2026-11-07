// 弹层漆金圆关闭钮(C8 瘦身收口):44px 热区 + 漆金发丝描边圆钮的弹层内唯一可见
// 出口,HandRack 锦囊详情抽屉与 SettingsDialog 曾逐字双抄(11 行 JSX 含同一长
// className 串),收口单源。交互语义归壳的 DialogClose(点击=关层、Esc/点外由
// ui/dialog 底件接管),本件只承载制式——壳内直接 <RoundClose />。
// 注:与 11-02 搁置的「弹层壳统一」无涉——不动壳 API 与 ConfirmDialog 语义,
// 只是同一颗钮不再抄两份。
import { DialogClose } from "@app/components/ui/dialog";
import { Sym } from "./Sym";

export function RoundClose() {
  return (
    <DialogClose
      aria-label="关闭"
      className="group absolute right-1 top-1 z-10 flex h-11 w-11 cursor-pointer items-center justify-center"
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(217,185,92,0.45)] bg-[color-mix(in_srgb,var(--color-paper-hi)_85%,transparent)] text-paper-dim transition-colors group-hover:bg-[rgba(217,185,92,0.18)] group-hover:text-paper"
      >
        <Sym name="close" size={13} />
      </span>
    </DialogClose>
  );
}
