// 降噪口静默状态机(#284,ADR-0017 §4):「本回合不再询问」的客户端本地静默。
// 纯函数单源(零 React/零 DOM, #1181 自 GameScreen 内联态抽出,行为逐条等价):
//   按「本回合不再询问」= engage(记当前行动者)——当窗立即代发「不用」由调用方同拍
//   执行(与手点同一条 respondReaction 命令,通路留 UI 层);
//   同回合静默 = muted(对该行动者的后续询问不弹横幅、自动代发不用);
//   换回合解除 = onActor(行动者变更边沿,任何变更即清)——静默不复燃:甲回合按的
//   静默,乙回合后轮回到甲也不复燃(A→B→A),与原 useEffect([activeIndex]) 清空
//   语义逐拍一致。
// 判词:静默记的是「按下时的行动者」,仅对该行动者的当前在位期生效;seenActor 是
// 「任何变更即解除」的边沿检测锚——只比 mutedSeat===activeIndex 多钉住「回来的
// 不是原来的在位期」这一条(原实现由 effect 依赖数组隐式承载)。
export interface ReactionMuteState {
  /** 静默生效中的行动者座位;null=未静默。 */
  readonly mutedSeat: number | null;
  /** 上一次见过的行动者座位(换人即解除的边沿锚)。 */
  readonly seenActor: number | null;
}

/** 初始态:未静默。 */
export const reactionMuteInitial: ReactionMuteState = { mutedSeat: null, seenActor: null };

/** 静默判定:横幅显隐与静默自动代发共用的单源判词(仅对被记行动者的当前在位期为真)。 */
export function reactionMuted(s: ReactionMuteState, activeIndex: number): boolean {
  return s.mutedSeat != null && s.mutedSeat === activeIndex;
}

/** 按下降噪口:静默记当前行动者(当窗的「不用」应答由调用方同拍发出,不在此处)。 */
export function reactionMuteEngage(activeIndex: number): ReactionMuteState {
  return { mutedSeat: activeIndex, seenActor: activeIndex };
}

/** 行动者变更边沿:activeIndex 任何变更即解除静默(同值重渲保持原状)。 */
export function reactionMuteOnActor(s: ReactionMuteState, activeIndex: number): ReactionMuteState {
  if (s.seenActor === activeIndex) return s;
  return { mutedSeat: null, seenActor: activeIndex };
}
