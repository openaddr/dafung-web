import { afterAll, afterEach, beforeAll, beforeEach, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { LID } from "@app/screens/lobby/testids";
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

function HostActions({ startGame }: { startGame: () => Promise<void> }) {
  const { state, submit } = useLobbyStart("ROOMA");
  return (
    <LobbyStartActions
      state={state}
      shortLandscape={true}
      mapSelected={true}
      disabled={false}
      connectionDown={false}
      onSelectMap={() => {}}
      onStart={() => submit(startGame)}
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
