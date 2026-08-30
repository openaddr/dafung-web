// 国号重名前缀(autos 28 / #19 E7):联机重名国号的开局分配算法。
// 纯函数、零依赖——服务端(startGame 定稿)与客户端(大厅重名预告)共用同一份,
// 保证「预告」与「开局后实际国号」永远同源,不存在两套口径漂移。

/** 联机重名国号的方位前缀(定案 8 个:东西南北前后大小;座位 ≤8,一名+七前缀恰好够用)。 */
export const GUOHAO_PREFIXES = ["东", "西", "南", "北", "前", "后", "大", "小"] as const;

/** 重名国号分配:先到先得保留原名,后到者依次取未被占用的前缀国号(宁→东宁/西宁/…)。
 *  null(未预设)与不重复的国号原样返回;顺序即座位顺序。 */
export function resolveGuohaoClash(desired: ReadonlyArray<string | null>): Array<string | null> {
  const used = new Set<string>();
  return desired.map((g) => {
    if (g == null) return null;
    if (!used.has(g)) {
      used.add(g);
      return g;
    }
    const prefix = GUOHAO_PREFIXES.find((px) => !used.has(px + g));
    if (prefix == null) throw new Error("国号前缀耗尽(座位数超出 8)");
    const final = prefix + g;
    used.add(final);
    return final;
  });
}
