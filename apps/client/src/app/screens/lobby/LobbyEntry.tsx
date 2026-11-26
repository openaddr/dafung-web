// 组件收口:Base UI 的按钮、输入、单选和折叠原语，沿用水墨皮与公共步进器。
import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import { Input } from "@base-ui/react/input";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { MAX_SEAT_COUNT, MIN_SEAT_COUNT, STANDARD_SEAT_COUNT } from "@dafung/core/engine/constants";
import { useEffect, useId, useState, type ReactNode } from "react";
import { getAudio } from "@app/fx/audio";
import { getServerBase, setServerBase } from "@app/net/server-base";
import { Stepper } from "@app/screens/shared/Stepper";
import { Sym } from "@app/screens/shared/Sym";
import { LID } from "./testids";

interface LobbyEntryProps {
  busy: boolean;
  shortLandscape: boolean;
  lastRoom: string | null;
  onCreate: (seats: number, target: number | undefined) => void;
  onJoin: (roomCode: string) => void;
  onExit: () => void;
  hint: ReactNode;
}

const buttonSkin = "rounded-[5px] px-4 font-brush transition-colors disabled:opacity-40";
const primaryButton = `${buttonSkin} ink-btn min-h-(--touch-primary) w-full text-lg`;
const secondaryButton = `${buttonSkin} note-btn min-h-(--touch-target) min-w-(--touch-target) text-sm`;
const inputSkin =
  "min-h-(--touch-target) w-full min-w-0 rounded-[3px] border border-paper/30 bg-bg px-2.5 font-wenkai text-base tabular-nums text-paper aria-invalid:border-danger";
const targetOptionSkin =
  "inline-flex min-h-(--touch-target) items-center rounded-[5px] border border-paper/25 bg-bg/60 px-3 font-brush text-sm text-paper-dim data-checked:border-gold data-checked:bg-gold/25 data-checked:text-paper data-disabled:opacity-40";
const TARGET_MAX = 99_999_999;

function validateTarget(value: string): string | null {
  const trimmed = value.trim();
  const amount = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || amount < 1 || amount > TARGET_MAX) {
    return `目标身价须为 1 至 ${TARGET_MAX.toLocaleString("en-US")} 的整数。`;
  }
  return null;
}

function CreateRoomForm({ busy, onCreate }: Pick<LobbyEntryProps, "busy" | "onCreate">) {
  const targetLabelId = useId();
  const targetHelpId = useId();
  const [seats, setSeats] = useState(STANDARD_SEAT_COUNT);
  const [mode, setMode] = useState<"map" | "custom">("map");
  const [target, setTarget] = useState("");
  const [targetError, setTargetError] = useState<string | null>(null);
  const custom = mode === "custom";

  return (
    <section className="min-w-0">
      <h2 className="note-head mb-2 text-lg text-paper">
        <i aria-hidden="true">建</i>
        创建房间
      </h2>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (custom) {
            const error = validateTarget(target);
            setTargetError(error);
            if (error !== null) return;
          }
          onCreate(seats, custom ? Number(target.trim()) : undefined);
        }}
      >
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-paper">
            <span>诸侯数</span>
            <Stepper
              testid={LID.seatCount}
              ariaLabel="诸侯数"
              value={seats}
              min={MIN_SEAT_COUNT}
              max={MAX_SEAT_COUNT}
              onChange={setSeats}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-paper">
            <span id={targetLabelId}>目标身价</span>
            <RadioGroup
              aria-labelledby={targetLabelId}
              value={mode}
              onValueChange={(value) => {
                if (value === mode) return;
                setMode(value);
                getAudio().play("jinnangSelect");
              }}
              disabled={busy}
              className="flex flex-wrap gap-1.5"
            >
              <Radio.Root
                value="map"
                data-testid={LID.targetMapDefault}
                className={targetOptionSkin}
              >
                按地图默认
              </Radio.Root>
              <Radio.Root
                value="custom"
                data-testid={LID.targetCustom}
                className={targetOptionSkin}
              >
                自定义
              </Radio.Root>
            </RadioGroup>
          </div>
          {custom && (
            <label className="flex items-center gap-2 text-sm text-paper">
              <span className="sr-only">自定义目标身价（两）</span>
              <Input
                data-testid={LID.target}
                value={target}
                onInput={(event) => {
                  setTarget(event.currentTarget.value);
                  setTargetError(null);
                }}
                onBlur={() => setTargetError(validateTarget(target))}
                required
                inputMode="numeric"
                enterKeyHint="go"
                aria-invalid={targetError !== null}
                aria-describedby={targetHelpId}
                placeholder="输入目标身价"
                className={inputSkin}
              />
              <span aria-hidden="true">两</span>
            </label>
          )}
          <div id={targetHelpId} className="min-h-[18px] text-xs text-paper-dim">
            {custom && targetError !== null ? (
              <p role="alert" className="text-danger">
                {targetError}
              </p>
            ) : custom ? (
              "填写正整数。"
            ) : (
              "进房后选图，目标取所选地图的默认值。"
            )}
          </div>
          <Button type="submit" data-testid={LID.create} disabled={busy} className={primaryButton}>
            创建房间
          </Button>
        </fieldset>
      </form>
    </section>
  );
}

function JoinRoomForm({
  busy,
  lastRoom,
  onJoin,
}: Pick<LobbyEntryProps, "busy" | "lastRoom" | "onJoin">) {
  const joinId = useId();
  const [joinCode, setJoinCode] = useState("");
  const normalizedCode = joinCode.trim();

  return (
    <section className="min-w-0 border-t border-paper/20 pt-3 @xl:border-t-0 @xl:border-l @xl:pt-0 @xl:pl-4">
      <h2 className="note-head mb-2 text-lg text-paper">
        <i aria-hidden="true">入</i>
        加入房间
      </h2>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || normalizedCode === "") return;
          onJoin(normalizedCode);
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-paper" htmlFor={joinId}>
          房间码
          <Input
            id={joinId}
            data-testid={LID.joinInput}
            value={joinCode}
            onInput={(event) => setJoinCode(event.currentTarget.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="输入好友发来的房间码"
            maxLength={8}
            disabled={busy}
            className={inputSkin}
          />
        </label>
        <Button
          type="submit"
          data-testid={LID.join}
          disabled={busy || normalizedCode === ""}
          className={primaryButton}
        >
          加入房间
        </Button>
      </form>
      {lastRoom !== null && (
        <Button
          type="button"
          data-testid={LID.rejoin}
          disabled={busy}
          onClick={() => onJoin(lastRoom)}
          className={`${buttonSkin} note-btn mt-3 flex min-h-(--touch-primary) w-full items-center justify-between gap-2 text-sm`}
        >
          <span className="text-left font-wenkai text-paper-dim">
            上次房间 <span className="tabular-nums tracking-widest text-paper">{lastRoom}</span>
          </span>
          <span className="shrink-0">重进</span>
        </Button>
      )}
    </section>
  );
}

function ServerSettings({ busy }: Pick<LobbyEntryProps, "busy">) {
  const addressId = useId();
  const [serverBase, setConfiguredBase] = useState(getServerBase);
  const [address, setAddress] = useState(serverBase);
  const [health, setHealth] = useState<"checking" | "connected" | "unreachable">("checking");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 3000);
    const probe = async () => {
      try {
        const response = await fetch(`${serverBase}/health`, { signal: controller.signal });
        const connected = response.ok && ((await response.json()) as { ok: unknown }).ok === true;
        if (active) setHealth(connected ? "connected" : "unreachable");
      } catch {
        if (active) setHealth("unreachable");
      } finally {
        clearTimeout(timeout);
      }
    };
    void probe();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [serverBase]);

  const saveAddress = () => {
    setServerBase(address);
    const saved = getServerBase();
    setAddress(saved);
    if (saved !== serverBase) {
      setHealth("checking");
      setConfiguredBase(saved);
    }
  };

  return (
    <Collapsible.Root data-testid={LID.serverToggle} className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3">
        <Collapsible.Trigger
          className={`group inline-flex items-center gap-1.5 ${secondaryButton}`}
        >
          <Sym name="expand" size={12} className="group-data-panel-open:rotate-180" />
          高级
        </Collapsible.Trigger>
        {health !== "checking" && (
          <span
            role="status"
            data-testid={LID.serverStatus}
            className={`inline-flex items-center gap-1.5 text-xs ${
              health === "connected" ? "text-success" : "text-danger"
            }`}
          >
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" />
            {health === "connected" ? "已连通" : "未连通"}
          </span>
        )}
      </div>
      <Collapsible.Panel>
        <form
          className="mt-2 flex max-w-[315px] flex-col gap-1 text-sm text-paper-dim"
          onSubmit={(event) => {
            event.preventDefault();
            saveAddress();
          }}
        >
          <label htmlFor={addressId}>服务器地址</label>
          <Input
            id={addressId}
            data-testid={LID.serverBase}
            value={address}
            inputMode="url"
            autoCapitalize="none"
            autoComplete="off"
            enterKeyHint="done"
            spellCheck={false}
            disabled={busy}
            onInput={(event) => setAddress(event.currentTarget.value)}
            onBlur={saveAddress}
            className={inputSkin}
          />
        </form>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

export function LobbyEntry({
  busy,
  shortLandscape,
  lastRoom,
  onCreate,
  onJoin,
  onExit,
  hint,
}: LobbyEntryProps) {
  return (
    <div className="m-auto w-full max-w-[756px] font-wenkai">
      <h1
        className={`mb-3 pl-[0.1em] text-center font-title tracking-widest text-paper ${
          shortLandscape ? "text-3xl leading-none" : "text-4xl"
        }`}
      >
        联机对局
      </h1>
      <div className="scroll-anim-unroll note-card @container flex flex-col gap-2 rounded-[8px] px-4 py-3">
        <div className="grid gap-4 @xl:grid-cols-2">
          <CreateRoomForm busy={busy} onCreate={onCreate} />
          <JoinRoomForm busy={busy} lastRoom={lastRoom} onJoin={onJoin} />
        </div>
        {busy && (
          <p role="status" className="text-sm text-paper-dim">
            处理中…
          </p>
        )}
        {hint}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <ServerSettings busy={busy} />
          <Button type="button" data-testid={LID.back} onClick={onExit} className={secondaryButton}>
            返回首页
          </Button>
        </div>
      </div>
    </div>
  );
}
