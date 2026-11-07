// dev/test 端口族按 workspace 名派生的单源(#658 e2e 三件套,#1181 真 server 测试口):
// 多 workspace 并行(多 agent 会话常态)各自解析出互不相同的端口,同名恒同值(确定性
// 哈希,无随机)——单 workspace/CI 同样解析出确定值。显式 env 仍最高优先可覆盖,派生
// 只是缺省(隔离协议本意,消费口各自的头注写明覆盖旋钮名)。
//
// FNV-1a 32 位:确定性哈希选型只求稳定性(同名恒同输出),无新依赖;不追求均匀性,
// 异名撞同 offset 概率 1/60,撞了走显式 env 覆盖(隔离协议本意)。
export function hashWs(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** workspace 名 → 端口偏移(0-59):各族端口 = 各自基址 + 本偏移。 */
export function wsPortOffset(ws: string): number {
  return hashWs(ws) % 60;
}

// 基址:各族端口段互不重叠,族内两端口(4280/4281)保持历史 1 间隔——同 workspace
// 的 cmd-error 与 protocol-online 两测试同跑时各占一口,不互撞。
const STATIC_PREVIEW_BASE = 4100; // e2e 静态 preview(#658)
const GAME_SERVER_BASE = 3510; // e2e 引擎服务器(#658)
const CMD_ERROR_TEST_BASE = 4280; // test/server-cmd-error 真 server(#1181)
const PROTOCOL_TEST_BASE = 4281; // test/protocol-online 真 server(#1181)

export function staticPreviewPort(ws: string): number {
  return STATIC_PREVIEW_BASE + wsPortOffset(ws);
}
export function gameServerPort(ws: string): number {
  return GAME_SERVER_BASE + wsPortOffset(ws);
}
export function cmdErrorTestPort(ws: string): number {
  return CMD_ERROR_TEST_BASE + wsPortOffset(ws);
}
export function protocolTestPort(ws: string): number {
  return PROTOCOL_TEST_BASE + wsPortOffset(ws);
}
