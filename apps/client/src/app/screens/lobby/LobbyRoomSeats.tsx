import { useMemo } from "react";
import type { NetSeatMeta } from "@app/store/netStore";
import { resolveGuohaoClash } from "@dafung/core/engine/guohao";
import { LID } from "./testids";

interface LobbyRoomSeatsProps {
  seats: readonly NetSeatMeta[];
  mySeat: number;
  host: number;
}

export function LobbyRoomSeats({ seats, mySeat, host }: LobbyRoomSeatsProps) {
  // 开局国号预告与服务端 startGame 共用同一重名分配规则。
  const finalGuohao = useMemo(() => resolveGuohaoClash(seats.map((seat) => seat.guohao)), [seats]);
  const midpoint = Math.ceil(seats.length / 2);
  const halves = [
    { side: "left", label: "左侧座位", seats: seats.slice(0, midpoint) },
    { side: "right", label: "右侧座位", seats: seats.slice(midpoint) },
  ];

  return halves.map((half) => (
    <ol
      key={half.side}
      role="list"
      aria-label={half.label}
      className={`lobby-room-seats lobby-room-seats-${half.side}`}
    >
      {half.seats.map((seat) => {
        const own = seat.seat === mySeat;
        const identity = [own && "你", seat.seat === host && "房主"].filter(Boolean).join(" · ");
        const takenHuman = seat.taken && seat.kind === "human";
        const finalName = finalGuohao[seat.seat];
        const renamed = seat.guohao != null && finalName != null && finalName !== seat.guohao;
        return (
          <li
            key={seat.seat}
            data-testid={LID.seatRow(seat.seat)}
            data-own={own}
            data-taken={seat.taken}
            className={seat.taken ? "lobby-room-seat lobby-seat-in" : "lobby-room-seat"}
          >
            {seat.guohao != null ? (
              <span
                data-testid={LID.seatGuohao(seat.seat)}
                role="img"
                aria-label={`预设国号「${seat.guohao}」`}
                className="lobby-room-seat-seal seal-gold font-brush"
              >
                {seat.guohao}
              </span>
            ) : !seat.taken ? (
              <span
                role="img"
                aria-label="虚位以待"
                className="lobby-room-seat-seal border-paper/25 font-brush text-paper-dim"
              >
                虚
              </span>
            ) : null}
            <div className="lobby-room-seat-name">
              <span>诸侯 {seat.seat + 1}</span>
              {renamed && (
                <span
                  data-testid={LID.guohaoPreview(seat.seat)}
                  className="block text-xs text-paper-dim"
                >
                  开局改称 {finalName}
                </span>
              )}
            </div>
            <div className="lobby-room-seat-meta">
              {identity && <span className="text-gold-bright">{identity}</span>}
              <div data-testid={LID.seatOnline(seat.seat)} className="lobby-room-seat-status">
                {seat.kind === "bot" && seat.taken && <span>电脑</span>}
                {takenHuman &&
                  (seat.online ? (
                    <span className="lobby-room-seat-online">
                      <span className="sr-only">在线</span>
                    </span>
                  ) : (
                    <span>离线</span>
                  ))}
                {seat.autoPilot && <span>托管</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  ));
}
