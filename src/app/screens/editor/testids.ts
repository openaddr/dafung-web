// 编辑器屏 data-testid 常量:测试选择器唯一来源(命名约定同 setup/game 的 testids.ts)。
export const TID = {
  screen: "editor-screen",
  /** 侧栏属性表单容器(当前选中城池的编辑区)。 */
  tileForm: "editor-tile-form",
  save: "editor-save",
  /** 另存新图(写入 localStorage 自建图库)。 */
  saveAs: "editor-save-as",
  /** 重置回内置图(undo 栈清空)。 */
  reset: "editor-reset",
  /** 导出当前地图为 JSON 文件下载。 */
  export: "editor-export",
  /** 从 JSON 文件导入地图(校验后替换编辑态,推入 undo)。 */
  import: "editor-import",
  undo: "editor-undo",
  redo: "editor-redo",
  exit: "editor-exit",
  tryPlay: "editor-try-play",
  /** 校验错误提示区(严格 loadMap 失败时显示)。 */
  validationError: "editor-validation-error",
  /** 重叠城警示行(距离 < MIN_TILE_DIST)。 */
  overlapWarning: "editor-overlap-warning",
  /** 拖拽中跟随指针的幽灵标记。 */
  dragGhost: "editor-drag-ghost",
  // 表单字段工厂:testid = editor-field-<key>
  field: (key: string) => `editor-field-${key}` as const,
  /** 城池价值表第 lvl 级(Lv0..Lv maxLevel)。 */
  rentLevel: (lvl: number) => `editor-rent-${lvl}` as const,
} as const;
