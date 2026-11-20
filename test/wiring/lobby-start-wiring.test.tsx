import { afterAll, afterEach, beforeAll, beforeEach, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { LID } from "@app/screens/lobby/testids";
import { HintBar } from "@app/screens/shared/HintBar";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

let LobbyStartActions: typeof import("@app/screens/lobby/LobbyStartActions").LobbyStartActions;
let useLobbyStart: typeof import("@app/screens/lobby/use-lobby-start").useLobbyStart;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeAll(async () => {
  ensureHappyDom();
  ({ LobbyStartActions } = await import("@app/screens/lobby/LobbyStartActions"));
  ({ useLobbyStart } = await import("@app/screens/lobby/use-lobby-start"));
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

afterAll(async () => {
  await releaseHappyDom();
});

function HostActions({
  startGame,
  hint = null,
  mapSelected = true,
}: {
  startGame: () => Promise<void>;
  hint?: string | null;
  mapSelected?: boolean;
}) {
  const { state, submit } = useLobbyStart("ROOMA");
  return (
    <LobbyStartActions
      state={state}
      mapSelected={mapSelected}
      disabled={false}
      connectionDown={false}
      onSelectMap={() => {}}
      onStart={() => submit(startGame)}
      hint={hint === null ? null : <HintBar hint={hint} variant="inline" />}
    />
  );
}

function button(testId: string): HTMLButtonElement {
  const target = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (target === null) throw new Error(`缺少大厅按钮 ${testId}`);
  return target;
}

it("房主连续点击只发一次开局，服务器接受后仍锁住操作等待首份棋局", async () => {
  const reply = Promise.withResolvers<void>();
  const startGame = mock(() => reply.promise);
  act(() => root.render(<HostActions startGame={startGame} />));
  expect(startGame).not.toHaveBeenCalled();

  const start = button(LID.start);
  act(() => {
    start.click();
    start.click();
  });
  expect(startGame).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("正在开局…");

  await act(async () => reply.resolve());
  expect(container.querySelector('[role="status"]')?.textContent).toBe("正在同步棋局…");
  expect(start.disabled).toBe(true);
  expect(button(LID.selectMap).disabled).toBe(true);
  act(() => start.click());
  expect(startGame).toHaveBeenCalledTimes(1);
});

it("开局请求与同步棋局期间，通用提示让位给开局状态", async () => {
  const reply = Promise.withResolvers<void>();
  const hint = "复制失败，请手动抄录";
  act(() => root.render(<HostActions startGame={() => reply.promise} hint={hint} />));
  expect(container.textContent).toContain(hint);

  act(() => button(LID.start).click());
  expect(container.querySelector('[role="status"]')?.textContent).toBe("正在开局…");
  expect(container.textContent).not.toContain(hint);

  await act(async () => reply.resolve());
  expect(container.querySelector('[role="status"]')?.textContent).toBe("正在同步棋局…");
  expect(container.textContent).not.toContain(hint);
});

it("房主还未选定地图时，选图失败优先于选图引导", () => {
  const startGame = async () => {};
  const hint = "地图清单加载失败:请求超时";
  act(() => root.render(<HostActions startGame={startGame} mapSelected={false} />));
  expect(container.textContent).toContain("需先选择地图");

  act(() => root.render(<HostActions startGame={startGame} mapSelected={false} hint={hint} />));
  expect(container.textContent).toContain(hint);
  expect(container.textContent).not.toContain("需先选择地图");
});

it("开局失败显示实际原因，房主可以重试", async () => {
  const failed = Promise.withResolvers<void>();
  const retried = Promise.withResolvers<void>();
  const startGame = mock(() => retried.promise).mockReturnValueOnce(failed.promise);
  act(() => root.render(<HostActions startGame={startGame} />));

  const start = button(LID.start);
  act(() => start.click());
  await act(async () => failed.reject(new Error("当前地图无法开局")));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("当前地图无法开局");
  expect(start.disabled).toBe(false);

  act(() => start.click());
  expect(startGame).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await act(async () => retried.resolve());
  expect(container.querySelector('[role="status"]')?.textContent).toBe("正在同步棋局…");
});
