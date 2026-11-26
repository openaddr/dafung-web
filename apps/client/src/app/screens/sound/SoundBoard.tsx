// 组件收口:使用已有水墨 Dialog、ScrollArea 与 Base UI Button。
import { Button } from "@base-ui/react/button";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { ScrollArea } from "@app/components/ui/scroll-area";
import { MediaAudioPlayer, type SoundEvent } from "@app/fx/audio";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { RoundClose } from "@app/screens/shared/RoundClose";
import { Sym } from "@app/screens/shared/Sym";
import { soundGroups } from "./sound-catalog";
import { SOUND_TID } from "./testids";
import "./sound-board.css";

function SoundBoard() {
  const id = useId();
  const player = useRef<MediaAudioPlayer | null>(null);
  const [playing, setPlaying] = useState<SoundEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const stopOnHide = () => {
      if (document.visibilityState !== "hidden") return;
      player.current?.stop("all");
      setPlaying(null);
    };
    document.addEventListener("visibilitychange", stopOnHide);
    return () => {
      document.removeEventListener("visibilitychange", stopOnHide);
      player.current?.dispose();
      player.current = null;
    };
  }, []);

  const audition = (event: SoundEvent, label: string) => {
    setError(null);
    if (playing === event) {
      player.current?.stop("all");
      setPlaying(null);
      return;
    }
    if (document.visibilityState === "hidden") return;
    // 试听按需取用同一批素材，有自己的播放器和关闭时机。
    const audio = (player.current ??= new MediaAudioPlayer({ preload: false }));
    setPlaying(event);
    audio.audition(event, (played) => {
      setPlaying(null);
      if (!played) setError(`「${label}」播放失败，请重试。`);
    });
  };

  return (
    <>
      {error !== null && (
        <p role="alert" data-testid={SOUND_TID.error} className="sound-audition-error">
          {error}
        </p>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="sound-audition-groups">
          {soundGroups.map(({ key, label, rows }) => (
            <section key={key} aria-labelledby={`${id}-${key}`}>
              <h2 className="sound-audition-group-title" id={`${id}-${key}`}>
                {label}
              </h2>
              <ul className="sound-audition-rows">
                {rows.map(([event, row]) => {
                  const active = playing === event;
                  const description = `${id}-${event}`;
                  return (
                    <li key={event}>
                      <Button
                        data-testid={SOUND_TID.play(event)}
                        aria-label={`试听 ${row.label}`}
                        aria-pressed={active}
                        aria-describedby={description}
                        onClick={() => audition(event, row.label)}
                        className="sound-audition-row note-btn"
                      >
                        <span className="sound-audition-icon">
                          <Sym name={active ? "stop" : "play"} size={13} />
                        </span>
                        <span className="sound-audition-copy">
                          <span className="sound-audition-label">{row.label}</span>
                          <span id={description} className="sound-audition-when">
                            {row.when}
                          </span>
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}

export function SoundMenu({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid={SOUND_TID.dialog} initialFocus={false} className="sound-menu">
        <DialogDragHandle className="sound-audition-header">
          <DialogTitle>音效试听</DialogTitle>
          <RoundClose testid={SOUND_TID.close} />
        </DialogDragHandle>
        <SoundBoard />
      </DialogContent>
    </Dialog>
  );
}

export function SoundBoardPage() {
  return (
    <main className="sound-audition-page">
      <h1 className="sound-audition-header font-title text-[22px]">音效试听</h1>
      <SoundBoard />
    </main>
  );
}
