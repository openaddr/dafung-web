// 设置弹层(#700 全浮层骨架,原型 tmp/席位侧列原型.html ⑥设置弹层 判决移植):
// 顶左齿轮点开的降级入口收口件——音效 / 演出加速 / 战报› / 版本 / 回到主页。
// 壳走 ui/dialog 底件(Base UI:焦点陷阱/Esc/点外关闭白拿,不自写交互语义)+
// ADR-0031 题名拖动(DialogDragHandle 把手);挂载不夺焦(ScrollShell 先例)。
// 入口降级对账(旧顶栏/仪表条退役 → 本弹层承接):
//   - 静音钮 → 音效开关(Base UI Switch 原语,接 AudioProvider 单通道静音账本;
//     现役音频系统只有音效一个通道、无配乐,原型「音乐」行无真实承载,不落假开关);
//   - 战报把手 → 战报› 行(抽屉本体保留,数据照记,入口降级);
//   - 版本角标 → 版本行(构建戳直读 VERSION);
//   - 回到主页行:弃局离屏(销毁控制器释放 WS/时钟,回 setup)——本行是新增出口;
//     #745 高1 起接现成 ConfirmDialog 二次确认(文案写明弃局/退房后果;#836 起
//     确认框走 danger 变体,不可逆侧不再吃墨钮主行动)。
//   - 演出加速行:信息展示「标准」(原型原样;演出提速目前只有追帧自动档,无用户
//     档位基建,不落假切换钮)。
import { useState } from "react";
import { Dialog, DialogContent, DialogClose, DialogTitle } from "@app/components/ui/dialog";
import { Switch } from "@app/components/ui/switch";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { useAudio } from "@app/fx/AudioProvider";
import { useNetStore } from "@app/store/netStore";
import { Sym } from "@app/screens/shared/Sym";
import { ConfirmDialog } from "./scroll/ConfirmDialog";
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
  // 回到主页弃局确认(#745 高1):弹层内唯一不可逆动作,裸奔退役——点行先落确认框,
  // 确认文案写明后果(单机=对局进度丢弃;联机=并退出房间);取消则设置弹层原样保留。
  const roomId = useNetStore((s) => s.roomId);
  const [confirmHome, setConfirmHome] = useState(false);
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
        {/* 题名行(#836 制式归家,与 BannerShell 家族同语):漆金小章(题印漆金化
            #492 决议①同材质——漆底金字渐变,这里按 270px 紧凑壳缩到 20px 档)+
            题名升 font-title 18px(家族 26/27px 的紧凑方言,退役 15px 素面板档);
            章影 rgba(43,35,23,·) 为墨影族阴影豁免,同 BannerShell 题印登记。 */}
        {/* 刻意不定位(不挂 relative):题名行保持 static,压在上方透明把手条
            (absolute z-0)之下,题行一带的拖拽命中归把手(ADR-0031)。 */}
        <div className="mb-1 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-[20px] w-[20px] flex-none rotate-[-4deg] items-center justify-center rounded-[3px] bg-gradient-to-b from-gold-bright to-gold-deep font-title text-[13px] leading-none text-lacquer shadow-[0_1px_3px_rgba(43,35,23,0.5)]"
          >
            设
          </span>
          <DialogTitle className="font-title text-[18px] tracking-[2px]">设置</DialogTitle>
        </div>
        {/* 音效开关:开=有声(接 AudioProvider 单通道静音账本,原静音钮的接替者)。
            开关皮单源回 ui/switch 底件桥接(#745 高4:.setsw 手写皮退役,on 态吃
            --primary=漆金,success 语义错位收口)。 */}
        {audio && (
          <div className="setrow">
            音效
            <Switch
              data-testid={TESTIDS.settingsSfx}
              aria-label={audio.muted ? "开音效" : "静音音效"}
              checked={!audio.muted}
              onCheckedChange={() => audio.toggleMuted()}
            />
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
        {/* 回到主页:弃局离屏(控制器销毁;联机即退出房间)——行先落确认框(#745 高1),
            行文字/chevron 转 danger 朱砂,与「战报」普通行一眼区分(danger 语义已
            有承担,不新造色)。 */}
        <button
          type="button"
          data-testid={TESTIDS.settingsHome}
          className="setrow setrow-btn setrow-danger"
          onClick={() => setConfirmHome(true)}
        >
          回到主页
          <Sym name="expand" size={11} className="rotate-[-90deg] text-danger" />
        </button>
        {/* 弃局确认(#745 高1,#836 danger 归位):现成 ConfirmDialog 接力(禁新造
            组件),按钮全称,文案写明后果——单机=进度丢弃,联机=并退出房间。
            #836:danger 变体——「弃局回主页」(不可逆)转朱砂警示钮,不再吃墨钮
            主行动;「继续对局」升墨钮主行动(DESIGN §4.2 朱=权险)。 */}
        {confirmHome && (
          <ConfirmDialog
            title="弃局回到主页?"
            confirmLabel="弃局回主页"
            cancelLabel="继续对局"
            danger
            onConfirm={() => {
              setConfirmHome(false);
              onClose();
              onGoHome();
            }}
            onCancel={() => setConfirmHome(false)}
          >
            对局进度将丢弃,不可找回
            {roomId !== "" ? ",并退出房间" : ""}。
          </ConfirmDialog>
        )}
        {/* 可达名兜底出口:× 关闭钮(原型无,模态弹层出口口径同城池详情/锦囊详情)。
            DialogClose 承载交互语义,制式 44px 热区漆金圆钮(HandRack JinnangDetailSheet
            同族)。 */}
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
      </DialogContent>
    </Dialog>
  );
}
