// 几何/距离小工具:加载器校验与编辑器重叠高亮共用,避免两处各写一套 O(n²) 循环。
export interface Pt {
  x: number;
  y: number;
}

/** 返回所有"欧氏距离 < min"的索引对(i < j)。 */
export function findTooClosePairs(positions: Pt[], min: number): Array<[number, number]> {
  const min2 = min * min;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      if (dx * dx + dy * dy < min2) pairs.push([i, j]);
    }
  }
  return pairs;
}
