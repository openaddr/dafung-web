import { setController } from "@app/controllers/registry";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";

/** 离开当前会话回首页;关闭本机资源与房间投影,不解散服务器房间。 */
export function returnHome(): void {
  setController(null);
  useNetStore.getState().reset();
  useGameStore.getState().setScreen("setup");
}
