import { afterAll, beforeAll, expect, it } from "bun:test";
import { setAudio } from "@app/fx/audio";
import { FxLayer } from "@app/fx/FxLayer";
import { resetFxOrchestration } from "@app/fx/orchestrator";
import { nextFrame } from "@app/fx/timings";
import { stashEventBatch } from "@app/net/event-feed";
import { SCROLL_TESTIDS } from "@app/screens/game/scroll/testids";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameEngine, type GameCommand } from "@dafung/core/engine/authority";
import { loadMap, type MapData } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { armPhase, pinDice, placePlayer } from "@dafung/core/engine/planter";
import { act } from "react";
import { createRoot } from "react-dom/client";
import mapData from "../../packages/core/maps/guanzhong.json";
import pkg from "../../package.json";
import { installControlledClock } from "./controlled-clock";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
import { recordAudio } from "./record-audio";

(globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
beforeAll(ensureHappyDom);
afterAll(releaseHappyDom);

it.each(["继续招贤", "归账后断线", "归账后跳过"])(
  "正落己都城时招贤照常显示，展纸等实际归账声收尾：%s",
  async (action) => {
    const { GameController } = await import("@app/controllers/controller");
    const { setController } = await import("@app/controllers/registry");
    const { DecisionScrollLayer, decisionScrollIdentity } =
      await import("@app/screens/game/scroll/DecisionScrollLayer");
    const { board, catalog } = loadMap(mapData);
    const engine = new GameEngine(board, catalog, createDice(7), {
      seats: ["魏", "蜀"].map((guohao) => ({ name: guohao, guohao, isBot: false })),
      targetNetWorth: 30_000,
      startingCash: 10_000,
      startingTreasures: 0,
    });
    engine.beginCapitalSelection();
    while (engine.phase === "Setup") {
      const result = engine.pickCapital(engine.currentSetupPlayerIndex, engine.offeredCapitals[0]);
      if (!result.ok) throw new Error(`选都失败 ${result.reason}`);
    }
    const seat = engine.activeIndex;
    placePlayer(engine, seat, (engine.activePlayer.capitalIndex + board.count - 1) % board.count);
    armPhase(engine, { turnPhase: "Roll" });
    pinDice(engine, "march", [1]);

    class CapitalController extends GameController {
      protected readonly mySeat = seat;
      get engine() {
        return engine;
      }
      dispatchCommand(command: GameCommand): void {
        const pre = engine.players.map((player) => player.position);
        engine.submitCommand(command);
        stashEventBatch(engine.gameEvents);
        this.fx.play(pre);
        this.sync();
      }
    }

    function BoardWithDecision() {
      const snapshot = useGameStore((s) => s.snapshot);
      const interactive = useGameStore((s) => s.interactive);
      if (!snapshot) throw new Error("接线缺快照");
      return (
        <>
          <svg id="board" />
          {snapshot.players.map(({ id }, index) => (
            <span key={id} data-testid={TESTIDS.seatCash(index)} />
          ))}
          <FxLayer />
          <DecisionScrollLayer
            snapshot={snapshot}
            viewSeat={seat}
            interactive={interactive}
            decisionKey={decisionScrollIdentity(snapshot, seat)}
            parked={false}
            tileDetail={null}
          />
        </>
      );
    }

    const clock = installControlledClock();
    const controller = new CapitalController();
    setController(controller, mapData as MapData);
    controller.sync();
    const sounds = recordAudio();
    const cues = () => sounds.filter((sound) => sound === "coin" || sound === "scrollOpen");
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      act(() => root.render(<BoardWithDecision />));
      Object.defineProperty(document.getElementById("board"), "getScreenCTM", {
        value: () => new DOMMatrix(),
      });
      await act(async () => controller.dispatchCommand({ type: "rollAndMove" }));
      await act(nextFrame);
      const find = (testId: string) => document.querySelector(`[data-testid="${testId}"]`);
      const skip = find(SCROLL_TESTIDS.heroPickDecline);
      const coin = find(TESTIDS.cashFly(seat));
      if (!skip || !coin) throw new Error("都城归账或招贤卷轴未出现");
      expect(useGameStore.getState().interactive).toBe(true);
      expect(cues()).toEqual([]);

      act(() => coin.dispatchEvent(new Event("animationend", { bubbles: true })));
      expect(cues()).toEqual(["coin"]);
      if (action === "归账后断线") {
        act(() => controller.discardPresentation());
      } else if (action === "归账后跳过") {
        await act(async () => skip.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      }
      await clock.advance(250);
      expect(cues()).toEqual(action === "继续招贤" ? ["coin", "scrollOpen"] : ["coin"]);
    } finally {
      act(() => root.unmount());
      setController(null);
      resetFxOrchestration();
      useGameStore.getState().reset();
      useNetStore.getState().reset();
      setAudio(null);
      host.remove();
      clock.restore();
    }
  },
);
