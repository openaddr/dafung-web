// 设置弹层(#700 全浮层骨架,原型 tmp/席位侧列原型.html ⑥设置弹层 判决移植):
// 顶左齿轮点开的降级入口收口件——音效 / 演出加速 / 战报› / 版本 / 回到主页。
// 壳走 ui/dialog 底件(Base UI:焦点陷阱/Esc/点外关闭白拿,不自写交互语义)+
// ADR-0031 题名拖动(DialogDragHandle 把手);挂载不夺焦(ScrollShell 先例)。
// 入口降级对账(旧顶栏/仪表条退役 → 本弹层承接):
//   - 静音钮 → 音效开关(Base UI Switch 原语,接 AudioProvider 单通道静音账本;
//     现役音频系统只有音效一个通道、无配乐,原型「音乐」行无真实承载,不落假开关);
//   - 战报把手 → 战报› 行(抽屉本体保留,数据照记,入口降级);
//   - 版本角标 → 版本行(构建戳直读 VERSION);
//   - 回到主页行:弃局离屏(销毁控制器释放 WS/时钟,回 setup)——本行是新增出口。
//   - 演出加速行:信息展示「标准」(原型原样;演出提速目前只有追帧自动档,无用户
//     档位基建,不落假切换钮)。
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { Dialog, DialogContent, DialogClose, DialogTitle } from "@app/components/ui/dialog";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { useAudio } from "@app/fx/AudioProvider";
import { Sym } from "@app/screens/shared/Sym";
import { VERSION } from "../../../version";
import { TESTIDS } from "./testids";
import "./layout.css";

export interface SettingsDialogProps {
  onClose: () => void;
  /** 战报› 行:开战报抽屉(本弹层先收)。 */
  onOpenWarReport: () => void;
  /** 回到主页行:弃局离屏(控制器销毁 + 切 setup),接线归 GameScreen。 */
  onGoHome: () => void;
}

export function SettingsDialog({ onClose, onOpenWarReport, onGoHome }: SettingsDialogProps) {
  const audio = useAudio();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid={TESTIDS.settingsDialog}
        /* 挂载不夺焦(ScrollShell 先例):设置是低频只读弹层,焦点留在触发钮,Esc 直关 */
        initialFocus={false}
        aria-label="设置"
        className="settings-dialog w-[270px] max-w-[92vw] gap-0 rounded-[10px] px-4 pt-3 pb-2"
      >
        {/* 题名行拖动把手(ADR-0031):透明条覆盖题名行一带,hover 显 grab */}
        <DialogDragHandle
          aria-hidden="true"
          className="absolute inset-x-0 top-0 z-0 h-[40px]"
          testid={TESTIDS.modalDragHandle}
        />
        <DialogTitle className="mb-1 font-title text-[15px] tracking-[2px]">设置</DialogTitle>
        {/* 音效开关:开=有声(接 AudioProvider 单通道静音账本,原静音钮的接替者) */}
        {audio && (
          <div className="setrow">
            音效
            <SwitchPrimitive.Root
              data-testid={TESTIDS.settingsSfx}
              aria-label={audio.muted ? "开音效" : "静音音效"}
              checked={!audio.muted}
              onCheckedChange={() => audio.toggleMuted()}
              className="setsw"
            >
              <SwitchPrimitive.Thumb className="setsw-thumb" />
            </SwitchPrimitive.Root>
          </div>
        )}
        {/* 演出加速:信息展示(原型原样「标准」;用户档位切换无基建,不落假钮) */}
        <div className="setrow">
          演出加速
          <i className="setval">标准</i>
        </div>
        {/* 战报›:开战报抽屉(本弹层先收,抽屉本体在 GameScreen 持开合) */}
        <button
          type="button"
          data-testid={TESTIDS.settingsWarReport}
          className="setrow setrow-btn"
          onClick={() => {
            onClose();
            onOpenWarReport();
          }}
        >
          战报
          <Sym name="expand" size={11} className="rotate-[-90deg] text-gold" />
        </button>
        {/* 版本:构建戳(原右下角版本角标的接替位) */}
        <div className="setrow">
          版本
          <i className="setval">{VERSION}</i>
        </div>
        {/* 回到主页:弃局离屏(控制器销毁;联机即退出房间) */}
        <button
          type="button"
          data-testid={TESTIDS.settingsHome}
          className="setrow setrow-btn"
          onClick={() => {
            onClose();
            onGoHome();
          }}
        >
          回到主页
          <Sym name="expand" size={11} className="rotate-[-90deg] text-gold" />
        </button>
        {/* 可达名兜底出口:× 关闭钮(原型无,模态弹层出口口径同城池详情/锦囊详情)。
            DialogClose 承载交互语义,制式 44px 热区漆金圆钮(HandRack JinnangDetailSheet
            同族)。 */}
        <DialogClose
          aria-label="关闭"
          className="group absolute right-1 top-1 z-10 flex h-11 w-11 cursor-pointer items-center justify-center"
        >
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(217,185,92,0.45)] bg-[color-mix(in_srgb,var(--color-paper-hi)_85%,transparent)] text-ink-dim transition-colors group-hover:bg-[rgba(217,185,92,0.18)] group-hover:text-ink"
          >
            <Sym name="close" size={13} />
          </span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
