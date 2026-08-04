# 客户端控制器抽基类:ClientController + 状态源接缝

热座(HotseatController,原 `state.ts` App)与联机(`NetworkClient`)两个客户端控制器在 ~1260 行里重复了大部分逻辑——scaffold + `fullRender` + `bindEvents` + 4 个 `show*Scroll`(招贤/赠宝/破产)+ `openScroll/hideOverlay/showHandDetail/showVictory/onTileClick/flashHint`。每次交互改动(P2/P3)都得改两遍。

抽出 `ClientController` 基类持有这些共享成员,并向子类要四个抽象成员:`engine`(渲染源)、`viewSeat`(视角座位)、`interactive`(此刻能否操作)、`dispatchAction`(动作执行)。热座提供活跃引擎 + 动画编排 + 选都;联机提供快照引擎 + WS + 大厅。

`dispatchAction` 各模式自己实现,不强行统一进基类:热座要逐动作动画(购地→印章、赠宝→珍宝音)+ 推进回合,联机只发命令等快照——动作执行是真正的差异点,动画味道属热座,塞进基类会污染接缝。共用的 action-string 解析(`halt`/`buy`/`heropick-N`…)抽一个 helper 两边复用。

选**继承而非组合**:动画编排(doRoll/afterLand)和大厅/WS 是控制器级、模式特有的流程,不适合塞进一个 StateSource 适配器接口;继承让基类持有共享交互、子类各自留模式特有流程。动画暂时只热座有(联机仍跳帧渲染);将来若抽共享动画编排器,可作为候选 3 再做。
