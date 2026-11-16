// 组件收口:快选沿用 shadcn/Base UI Dialog，选字按钮同时关闭弹层。
import { onBackButtonPress } from "@tauri-apps/api/app";
import { isTauri, type PluginListener } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@app/components/ui/dialog";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { RoundClose } from "@app/screens/shared/RoundClose";
import { useGameStore } from "@app/store/gameStore";
import { cn } from "@app/utils/cn";
import { GUOHAO_POOL } from "@core/theme";
import { TID } from "./testids";

const GUOHAO_CHOICES = GUOHAO_POOL.slice(0, 26);

export function GuohaoPicker({
  value,
  onChoose,
  onOpen,
}: {
  value: string;
  onChoose: (ch: string) => void;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pushHint = useGameStore((s) => s.pushHint);

  useEffect(() => {
    if (!open || !isTauri() || !navigator.userAgent.includes("Android")) return;
    // 注册会接管 Android 系统返回，收起字盘时归还。
    let listening = true;
    let listener: PluginListener | undefined;
    const reportError = (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      pushHint(`字盘返回键监听失败:${detail}`);
    };

    void onBackButtonPress(() => {
      if (listening) setOpen(false);
    })
      .then(async (registered) => {
        if (listening) {
          listener = registered;
        } else {
          await registered.unregister();
        }
      })
      .catch(reportError);

    return () => {
      listening = false;
      if (listener) void listener.unregister().catch(reportError);
    };
  }, [open, pushHint]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpen();
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger data-testid={TID.guohaoTrigger} className="su-secondary note-btn font-brush">
        字盘
      </DialogTrigger>
      <DialogContent className="su-picker gap-3 pt-1" initialFocus={false}>
        <DialogDragHandle className="flex min-h-10 shrink-0 items-center pr-10">
          <DialogTitle className="text-lg">字盘快选</DialogTitle>
        </DialogDragHandle>
        <div className="su-picker-scroll">
          <div data-testid={TID.guohaoPool} role="group" aria-label="国号" className="su-pool">
            {GUOHAO_CHOICES.map((ch) => (
              <DialogClose
                key={ch}
                data-testid={TID.guohaoChar(ch)}
                aria-pressed={value === ch}
                onClick={() => onChoose(ch)}
                className={cn("su-pool-key font-brush", value === ch && "seal-gold")}
              >
                {ch}
              </DialogClose>
            ))}
          </div>
        </div>
        <RoundClose testid={TID.guohaoClose} />
      </DialogContent>
    </Dialog>
  );
}
