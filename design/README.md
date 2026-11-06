# 设计稿源文件

在线版（可交互、可评论）：https://claude.ai/artifact/9cmeZdAA6UgXHAER5Amwhs

| 文件 | 页面 | 尺寸 |
| --- | --- | --- |
| `Main.dc.html` | 今日机会清单 | 390 × 844 |
| `Stock.dc.html` | 个股页（K 线 + 指标） | 390 × 1010 |
| `Drawer.dc.html` | 指标抽屉 | 390 × 844 |
| `canvas.json` | 画布索引 | — |

这些是 Design canvas 的 `.dc.html` 格式（依赖画布运行时 `support.js`，不能直接在浏览器打开）。实现前端时把它们当作布局、配色和交互的参考：结构在 `<x-dc>` 标记里，示例数据和交互逻辑在底部的 `renderVals()` 里。图表数据是模拟的。
