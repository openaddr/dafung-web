// 普通对局路径的临时样张布景。选中、拍板和消耗仍通过对局命令。
import { LocalController } from "@app/controllers/local";
import { applyPlant } from "@core/planter";
import type { RoomRegistry } from "../../../../scripts/room";

const scenes = {
  duel: { card: "连环计", reacting: false },
  fire: { card: "火烧连营", reacting: false },
  counter: { card: "火烧连营", reacting: true },
  levy: { card: "横征暴敛", reacting: false },
  "levy-counter": { card: "横征暴敛", reacting: true },
} as const;

export async function startTargetSelectionDemo(scene: string) {
  if (!Object.hasOwn(scenes, scene)) throw new Error(`未知的样张场景 ${scene}`);
  const { card, reacting } = scenes[scene as keyof typeof scenes];
  const debug = window.__dafung;
  if (!debug) throw new Error("样张的调试桥未接入");
  await debug.seedSolo({ seed: 49, seats: 8, mapId: "guanzhong" });
  const deadline = performance.now() + 6000;
  while (debug.snapshot()?.phase !== "Playing") {
    if (performance.now() > deadline) throw new Error("样张未能完成选都");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  debug.clockPause();

  const controller = debug.controller();
  if (!(controller instanceof LocalController)) throw new Error("样张未进入单机对局");
  const { registry, roomId } = controller as unknown as { registry: RoomRegistry; roomId: string };
  const engine = registry.get(roomId)?.engine;
  if (!engine) throw new Error("样张缺少权威引擎");

  for (let seat = 0; seat < engine.players.length; seat++) {
    const cards =
      seat === 0 ? [reacting ? "识破诡计" : card] : seat === 1 && reacting ? [card] : [];
    applyPlant(engine, { kind: "giveJinnang", seat, cards });
  }
  applyPlant(engine, { kind: "setJinnangUsedTags", tags: [] });
  applyPlant(engine, {
    kind: "armPhase",
    activeIndex: reacting ? 1 : 0,
    turnPhase: "AwaitingJinnang",
  });
  if (card === "火烧连营") {
    const vacant = engine.board.tiles.filter(
      (tile) => tile.propertyId != null && engine.findOwner(tile.propertyId) == null,
    );
    const run = vacant
      .map((center) =>
        vacant.filter((tile) => engine.board.forwardDistance(center.index, tile.index) <= 2),
      )
      .find((candidate) => candidate.length === 3 && candidate[0].name === "子午谷");
    if (!run) throw new Error("样张缺少从子午谷开始的三座连续无主城");

    run.forEach((tile, index) => {
      applyPlant(engine, {
        kind: "grantProperty",
        seat: index === 0 ? 0 : index + 1,
        propertyId: tile.propertyId!,
        level: 3,
      });
    });
    if (reacting) {
      engine.submitCommand({ type: "useJinnang", cardId: card });
      engine.submitCommand({ type: "useJinnang", cardId: card, targets: [run[0].index] });
    }
  }
  if (reacting && card === "横征暴敛") {
    // 结算后停在出牌者的待掷点，能直接核对这一次的缴付。
    applyPlant(engine, { kind: "setBot", seat: 1, bot: false });
    engine.submitCommand({ type: "useJinnang", cardId: card });
  }
  registry.flushTransportNow(roomId);
}
