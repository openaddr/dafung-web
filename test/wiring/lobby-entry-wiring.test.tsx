import { afterAll, afterEach, beforeAll, beforeEach, expect, it, spyOn } from "bun:test";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { LID } from "@app/screens/lobby/testids";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

let LobbyEntry: typeof import("@app/screens/lobby/LobbyEntry").LobbyEntry;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let fetchHealth: { mockRestore(): void };

beforeAll(async () => {
  ensureHappyDom();
  ({ LobbyEntry } = await import("@app/screens/lobby/LobbyEntry"));
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const fetchHost: Pick<Window, "fetch"> = globalThis;
  fetchHealth = spyOn(fetchHost, "fetch").mockImplementation(async () =>
    Response.json({ ok: true }),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  fetchHealth.mockRestore();
});

afterAll(async () => {
  await releaseHappyDom();
});

async function renderEntry(props: Partial<ComponentProps<typeof LobbyEntry>>): Promise<void> {
  await act(async () =>
    root.render(
      <LobbyEntry
        busy={false}
        shortLandscape
        lastRoom={null}
        onCreate={() => {}}
        onJoin={() => {}}
        onExit={() => {}}
        hint={null}
        {...props}
      />,
    ),
  );
}

function findByTestId(id: string): HTMLElement {
  const element = container.querySelector(`[data-testid="${id}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`缺少大厅入口 ${id}`);
  return element;
}

function input(id: string): HTMLInputElement {
  const element = findByTestId(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${id} 应是输入框`);
  return element;
}

async function enterText(id: string, value: string): Promise<void> {
  await act(async () => {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(id: string): Promise<void> {
  await act(async () => findByTestId(id).click());
}

it("加入框留给新房间，重进始终提交上次入座的房间码", async () => {
  const joined: string[] = [];
  await renderEntry({ lastRoom: "QRMX", onJoin: (code) => joined.push(code) });
  expect(input(LID.joinInput).value).toBe("");

  await enterText(LID.joinInput, " xyz ");
  await click(LID.rejoin);
  await click(LID.join);

  expect(joined).toEqual(["QRMX", "XYZ"]);
});

it("默认以六席建房，按地图默认时省略目标，自定义仅提交有效的正整数", async () => {
  const created: Array<[number, number | undefined]> = [];
  await renderEntry({ onCreate: (seats, target) => created.push([seats, target]) });
  const create = () => click(LID.create);

  await create();
  await click(`${LID.seatCount}-plus`);
  await click(LID.targetCustom);
  await create();
  expect(input(LID.target).getAttribute("aria-invalid")).toBe("true");
  await enterText(LID.target, "1.5");
  await create();
  expect(input(LID.target).getAttribute("aria-invalid")).toBe("true");
  await enterText(LID.target, "25000");
  await create();
  await click(LID.targetMapDefault);
  await create();

  expect(created).toEqual([
    [6, undefined],
    [7, 25000],
    [7, undefined],
  ]);
});
