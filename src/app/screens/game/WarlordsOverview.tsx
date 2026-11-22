// 组件收口:已收口——诸侯详情与分项共用 ui/dialog，子层覆盖名录，表体使用 ScrollArea。
import { memo, useCallback, useContext, useState } from "react";
import { DialogPeekInspection } from "@app/hooks/dialog-stack";
import { Button } from "@base-ui/react/button";
import { STAMINA_MAX } from "@core/constants";
import { heroById } from "@core/heroes";
import { tileIndexOfProperty } from "@core/board";
import { playerColor, playerSealText, rgba } from "@core/theme";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { getControllerContext } from "@app/controllers/registry";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { ScrollArea } from "@app/components/ui/scroll-area";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { RoundClose } from "@app/screens/shared/RoundClose";
import { STAMINA_LOW } from "./SeatRail";
import { CityLedgerModal } from "./CityLedgerModal";
import { SeatDetailModal, type SeatDetailKind } from "./SeatAttrModals";
import { TESTIDS } from "./testids";
import "./warlords-overview.css";

type WarlordDetail = { seat: number; kind: "city" | SeatDetailKind };

const OVERVIEW_COLUMNS = [
  { label: "诸侯", width: "12%" },
  { label: "体力", width: "16%" },
  { label: "城池", width: "22%" },
  { label: "银两", width: "13%" },
  { label: "锦囊", width: "9%" },
  { label: "名将", width: "19%" },
  { label: "珍宝", width: "9%" },
];

function OverviewRow({
  player,
  seat,
  self,
  active,
  onInspect,
}: {
  player: SnapshotPlayer;
  seat: number;
  self: boolean;
  active: boolean;
  onInspect: (target: WarlordDetail) => void;
}) {
  const { board } = getControllerContext()!;
  const cityNames = player.properties
    .map(({ propertyId }) => tileIndexOfProperty(board, propertyId))
    .sort((a, b) => a - b)
    .slice(0, 3)
    .map((tileIndex) => board.at(tileIndex).name);
  const heroNames = player.heroes.map(({ heroId }) => heroById(heroId).name);
  return (
    <tr
      data-testid={TESTIDS.warlordsRow(seat)}
      className={
        "zl-row" +
        (self ? " self" : "") +
        (active ? " is-active" : "") +
        (player.isBankrupt ? " dead" : "")
      }
      style={{
        ["--pc" as string]: rgba(playerColor(player.colorIndex)),
        ["--pc-seal" as string]: rgba(playerSealText(player.colorIndex)),
      }}
    >
      <th scope="row" aria-current={active || undefined}>
        <span className="zl-seal">{player.guohao}</span>
      </th>
      <td>
        <span className="zl-stamina">
          <span
            className={"zl-track" + (player.stamina < STAMINA_LOW ? " low" : "")}
            aria-hidden="true"
          >
            <i style={{ width: `${(player.stamina / STAMINA_MAX) * 100}%` }} />
          </span>
          <span data-testid={TESTIDS.warlordsStamina(seat)}>{player.stamina}</span>
        </span>
      </td>
      <td className="zl-city">
        <Button
          className="zl-drill"
          data-testid={TESTIDS.warlordsCities(seat)}
          aria-label={`${player.guohao}名下城池 ${player.properties.length} 座`}
          aria-haspopup="dialog"
          onClick={() => onInspect({ seat, kind: "city" })}
        >
          <span>{player.properties.length}</span>
          <span className="zl-preview">{cityNames.join("、")}</span>
        </Button>
      </td>
      <td className="zl-cash" data-testid={TESTIDS.warlordsCash(seat)}>
        {player.cash}
      </td>
      <td data-testid={TESTIDS.warlordsHand(seat)}>{player.jinnangHandCount}</td>
      <td className="zl-hero">
        <Button
          className="zl-drill"
          data-testid={TESTIDS.warlordsHeroes(seat)}
          aria-label={`${player.guohao}麾下名将 ${heroNames.length} 位${heroNames.length > 0 ? `，${heroNames.join("、")}` : ""}`}
          aria-haspopup="dialog"
          onClick={() => onInspect({ seat, kind: "hero" })}
        >
          <span>{heroNames.length}</span>
          <span className="zl-preview">{heroNames.join("、")}</span>
        </Button>
      </td>
      <td className="zl-gem">
        <Button
          className="zl-drill"
          data-testid={TESTIDS.warlordsGems(seat)}
          aria-label={`${player.guohao}珍宝 ${player.treasures.length} 件`}
          aria-haspopup="dialog"
          onClick={() => onInspect({ seat, kind: "gem" })}
        >
          {player.treasures.length}
        </Button>
      </td>
    </tr>
  );
}

export const WarlordsOverview = memo(function WarlordsOverview({
  players,
  selfSeat,
  activeSeat,
  round,
  onClose,
}: {
  players: SnapshotPlayer[];
  selfSeat: number;
  activeSeat: number | null;
  round: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<WarlordDetail | null>(null);
  const inspectingBoard = useContext(DialogPeekInspection) !== null;
  const seatGroups = players.length > 6 ? [players.slice(0, 4), players.slice(4)] : [players];
  const closeDetail = useCallback(() => setDetail(null), []);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid={TESTIDS.warlordsOverview} initialFocus={false} className="zl">
        <DialogDragHandle className="zl-head" testid={TESTIDS.modalDragHandle}>
          <DialogTitle className="zl-title">诸侯详情</DialogTitle>
          <span className="zl-round">第 {round} 轮</span>
        </DialogDragHandle>
        <RoundClose testid={TESTIDS.modalClose} />
        <ScrollArea className="zl-scroll">
          <div className={seatGroups.length > 1 ? "zl-columns is-split" : "zl-columns"}>
            {seatGroups.map((seats, group) => (
              <table
                className="zl-table"
                key={group}
                aria-label={
                  seatGroups.length === 1
                    ? "诸侯名录"
                    : group === 0
                      ? "诸侯一至四席"
                      : "诸侯五至八席"
                }
              >
                <colgroup>
                  {OVERVIEW_COLUMNS.map(({ label, width }) => (
                    <col key={label} style={seatGroups.length === 1 ? { width } : undefined} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {OVERVIEW_COLUMNS.map(({ label }) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seats.map((player, row) => {
                    const seat = group * 4 + row;
                    return (
                      <OverviewRow
                        key={player.id}
                        player={player}
                        seat={seat}
                        self={seat === selfSeat}
                        active={seat === activeSeat}
                        onInspect={setDetail}
                      />
                    );
                  })}
                </tbody>
              </table>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
      {detail !== null && (
        <DialogPeekInspection.Provider value={inspectingBoard ? closeDetail : null}>
          {detail.kind === "city" ? (
            <CityLedgerModal
              players={players}
              seat={detail.seat}
              self={detail.seat === selfSeat}
              onClose={closeDetail}
            />
          ) : (
            <SeatDetailModal kind={detail.kind} p={players[detail.seat]} onClose={closeDetail} />
          )}
        </DialogPeekInspection.Provider>
      )}
    </Dialog>
  );
});
