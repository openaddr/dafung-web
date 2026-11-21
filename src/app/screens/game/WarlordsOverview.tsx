// 组件收口:已收口——诸侯详情与分项共用 ui/dialog，逐层切换，表体使用 ScrollArea。
import { memo, useContext, useState } from "react";
import { DialogPeekInspection } from "@app/hooks/dialog-stack";
import { Button } from "@base-ui/react/button";
import { heroById } from "@core/heroes";
import { tileIndexOfProperty } from "@core/board";
import { playerColor, playerSealText, rgba } from "@core/theme";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { getControllerContext } from "@app/controllers/registry";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { ScrollArea } from "@app/components/ui/scroll-area";
import { DialogDragHandle } from "@app/hooks/use-dialog-drag";
import { useDialogExit } from "@app/hooks/use-dialog-exit";
import { RoundClose } from "@app/screens/shared/RoundClose";
import { STAMINA_LOW } from "./SeatRail";
import { CityLedgerModal } from "./CityLedgerModal";
import { SeatDetailModal, type SeatDetailKind } from "./SeatAttrModals";
import { RepProbBar } from "./RepProbBar";
import { TESTIDS } from "./testids";
import "./warlords-overview.css";

type WarlordDetail = { seat: number; kind: "city" | SeatDetailKind };

const OVERVIEW_COLUMNS = [
  { label: "诸侯", width: "15%" },
  { label: "银两", width: "11%" },
  { label: "体力", width: "10%" },
  { label: "手牌", width: "8%" },
  { label: "城池", width: "15%" },
  { label: "名将", width: "18%" },
  { label: "珍宝", width: "8%" },
  { label: "声望", width: "15%" },
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
        <span className="zl-identity">
          <span className="zl-seal" aria-hidden="true">
            {player.guohao.charAt(0)}
          </span>
          <span className="zl-name">{player.guohao}</span>
        </span>
      </th>
      <td className="zl-cash" data-testid={TESTIDS.warlordsCash(seat)}>
        {player.cash}
      </td>
      <td>
        <span className="zl-stamina">
          <span
            className={"zl-track" + (player.stamina < STAMINA_LOW ? " low" : "")}
            aria-hidden="true"
          >
            <i style={{ width: `${player.stamina}%` }} />
          </span>
          <span data-testid={TESTIDS.warlordsStamina(seat)}>{player.stamina}</span>
        </span>
      </td>
      <td data-testid={TESTIDS.warlordsHand(seat)}>{player.jinnangHandCount}</td>
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
      <td>
        <Button
          className="zl-drill"
          data-testid={TESTIDS.warlordsRepCell(seat)}
          aria-label={`${player.guohao}声望 ${player.reputation}`}
          aria-haspopup="dialog"
          onClick={() => onInspect({ seat, kind: "rep" })}
        >
          <span data-testid={TESTIDS.warlordsRep(seat)}>{player.reputation}</span>
          <span className="zl-preview">
            <RepProbBar reputation={player.reputation} size="row" />
          </span>
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
  const { closing, requestClose } = useDialogExit(onClose);
  const dismissInspection = useContext(DialogPeekInspection);
  const closeDetail = dismissInspection ?? (() => setDetail(null));

  if (detail?.kind === "city") {
    return (
      <CityLedgerModal
        players={players}
        seat={detail.seat}
        self={detail.seat === selfSeat}
        onClose={closeDetail}
      />
    );
  }
  if (detail != null) {
    return <SeatDetailModal kind={detail.kind} p={players[detail.seat]} onClose={closeDetail} />;
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        data-testid={TESTIDS.warlordsOverview}
        animateOnOpen={false}
        initialFocus={false}
        inert={closing}
        overlayProps={closing ? { className: "dialog-overlay-out" } : undefined}
        className={"zl" + (closing ? " zl-out" : "")}
      >
        <DialogDragHandle className="zl-head" testid={TESTIDS.modalDragHandle}>
          <DialogTitle className="zl-title">诸侯详情</DialogTitle>
          <span className="zl-round">第 {round} 轮</span>
        </DialogDragHandle>
        <RoundClose testid={TESTIDS.modalClose} />
        <ScrollArea className="zl-scroll">
          <table className="zl-table">
            <colgroup>
              {OVERVIEW_COLUMNS.map(({ label, width }) => (
                <col key={label} style={{ width }} />
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
              {players.map((player, seat) => (
                <OverviewRow
                  key={player.id}
                  player={player}
                  seat={seat}
                  self={seat === selfSeat}
                  active={seat === activeSeat}
                  onInspect={setDetail}
                />
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
});
