// 每个子进程只装配一个完整生产客户端;模块缓存、store、控制器、WS 与父端/另一端隔离。
import { loadMap } from "@core/board-loader";
import { OnlineController, type RoomJoinReply } from "@app/controllers/online";
import { setController } from "@app/controllers/registry";
import { setEngine, useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import guanzhongData from "../../public/maps/guanzhong.json" with { type: "json" };
import type {
  DualClientObservation,
  DualClientOperation,
  DualClientRequest,
  DualClientResponse,
} from "./dual-client-observation";

const serverBase = process.argv[2];
if (serverBase === undefined || process.send === undefined)
  throw new Error("dual-client-runtime 必须由双端装配传入服务器地址并开启 IPC");

// Bun 1.3.14 无 localStorage;只补地址覆写既有通路需要的三个方法,零 DOM。
const storage = new Map<string, string>([["dafung.server-base", serverBase]]);
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => void storage.set(key, value),
    removeItem: (key: string): void => void storage.delete(key),
  },
  configurable: true,
});

let controller: OnlineController | null = new OnlineController(loadMap(guanzhongData), "guanzhong");
let credentials: DualClientObservation["credentials"] = null;

function observe(): DualClientObservation {
  const game = useGameStore.getState();
  const net = useNetStore.getState();
  // 同一 JS 拍读取本端引擎与真实 store,不拿 controller.seat 冒充 net.mySeat。
  return {
    seat: controller === null ? -1 : controller.seat,
    hydrated:
      controller !== null && (controller as unknown as { enteredGame: boolean }).enteredGame,
    engine: controller === null ? null : controller.engine.snapshot(),
    game: { snapshot: game.snapshot, viewSeat: game.viewSeat, screen: game.screen },
    net: {
      roomId: net.roomId,
      host: net.host,
      started: net.started,
      mapId: net.mapId,
      seats: net.seats,
      mySeat: net.mySeat,
      connection: net.connection,
      connected: net.connected,
      connectionFailure: net.connectionFailure,
    },
    credentials,
  };
}

function reset(): void {
  controller?.destroy();
  controller = null;
  setController(null);
  setEngine(null);
  useNetStore.getState().reset();
  useGameStore.getState().reset();
  credentials = null;
}

async function execute(operation: DualClientOperation): Promise<void> {
  if (operation.kind === "observe") return;
  if (operation.kind === "reset") {
    reset();
    return;
  }
  if (controller === null) throw new Error(`已重置的客户端不能执行 ${operation.kind}`);
  switch (operation.kind) {
    case "createRoom": {
      // LobbyApi 无 seed 形参,沿用本族既有最小测试缝:同一 REST 请求补 seed,
      // 回包仍经生产 adoptRoom 灌凭证/双 store/真 WS,不扩张产品接口。
      const seeded = controller as unknown as {
        api: { createRoom(opts: { seats: number; seed: number }): Promise<RoomJoinReply> };
        adoptRoom(reply: RoomJoinReply): void;
      };
      const reply = await seeded.api.createRoom({ seats: operation.seats, seed: operation.seed });
      seeded.adoptRoom(reply);
      credentials = { roomId: reply.roomId, seatToken: reply.seatToken };
      return;
    }
    case "joinRoom": {
      const reply = await controller.joinRoom(operation.roomId);
      credentials = { roomId: reply.roomId, seatToken: reply.seatToken };
      return;
    }
    case "pickMap":
      await controller.pickMap(operation.mapId);
      return;
    case "startGame":
      await controller.startGame();
      return;
    case "pickCapital":
      controller.setupPickCapital(operation.tileIndex);
      return;
    case "declineJinnang": {
      const engine = controller.engine;
      if (
        engine.phase === "Playing" &&
        engine.turnPhase === "AwaitingJinnang" &&
        engine.decisionOwner === controller.seat &&
        controller.interactive
      ) {
        controller.dispatchCommand({ type: "useJinnang", cardId: null });
      }
      return;
    }
  }
}

process.on("message", async (request: DualClientRequest) => {
  let response: DualClientResponse;
  try {
    await execute(request.operation);
    response = { id: request.id, ok: true, observation: observe() };
  } catch (error) {
    response = { id: request.id, ok: false, error: String(error) };
  }
  process.send!(response);
});

// 父端正常关闭/异常退出都会断 IPC;关闭生产 WS 和重连计时器后结束本端运行环境。
process.on("disconnect", () => {
  reset();
  Reflect.deleteProperty(globalThis, "localStorage");
  process.exit(0);
});
