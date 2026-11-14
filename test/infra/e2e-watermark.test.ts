// #1438:OS 探针的进程计数/硬闸接缝。固定进程清单守工具代理单列与真实负载拒绝,
// 不启动负载进程、不做 CPU/调度竞速,单例毫秒级。
import { expect, test } from "bun:test";
import { classifyWatermark, assertWatermark } from "../../scripts/e2e-watermark";

test("工具代理单列而不稀释真实 node 水位,其余 node 一律保守计入", () => {
  const broker = {
    Name: "node.exe",
    CommandLine: "node C:/codex/require-browser-access.mjs C:/codex/cua-repl.mjs",
  };
  const processes = [
    ...Array.from({ length: 27 }, () => broker),
    { Name: "bun.exe", CommandLine: "bun scripts/e2e-one.ts" },
    { Name: "node.exe", CommandLine: "node server.mjs" },
    { Name: "node.exe", CommandLine: "node require-browser-access.mjs" },
    { Name: "node.exe", CommandLine: null },
  ];
  const quiet = classifyWatermark(15, processes);
  expect(quiet.text).toContain("node=30 broker=27 nodeLoad=3");
  expect(() => assertWatermark(quiet)).not.toThrow();
  const loaded = classifyWatermark(15, [
    ...processes,
    ...Array.from({ length: 24 }, () => ({
      Name: "node.exe",
      CommandLine: "node playwright/cli.js test",
    })),
  ]);
  expect(() => assertWatermark(loaded)).toThrow("bun=1+nodeLoad=27≥28");
});

test("探针结构异常响亮失败,不会按零进程放行", () => {
  expect(() => classifyWatermark(15, [{ Name: "node.exe" }])).toThrow();
  expect(() => classifyWatermark(null, [])).toThrow();
});
