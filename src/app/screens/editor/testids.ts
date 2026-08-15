// 编辑器屏 data-testid 常量:测试选择器唯一来源(命名约定同 setup/game 的 testids.ts)。
export const TID = {
  screen: "editor-screen",
  /** 侧栏属性表单容器(当前选中城池的编辑区)。 */
  tileForm: "editor-tile-form",
  save: "editor-save",
  /** 另存新图(写入 localStorage 自建图库)。 */
  saveAs: "editor-save-as",
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
  /** 租金表第 lvl 级(Lv0..Lv maxLevel)。 */
  rentLevel: (lvl: number) => `editor-rent-${lvl}` as const,
} as const;
