#!/usr/bin/env python3
"""把 styles/mobile.css 的内容同步到 styles/app.css 末尾的手机端区块。

为什么要这一步（2026-11-06）：
  GitHub Pages 的 CDN 对**新增文件**收录很慢（实测 mobile.css 上线 >7 分钟仍返回 404），
  新文件 404 会让整次上线看起来"没生效"。而 app.css 是存量文件，CDN 1-3 分钟即刷新。
  所以策略是：mobile.css 作为独立可维护源文件，实际生效的副本内联在 app.css 末尾。

实现要点：
  用一对**唯一标记注释**定位区块（SYNC_START / SYNC_END），而不是靠正则猜分隔线 ——
  早期版本用 `/* ==== */` 定位，结果把 mobile.css 自身的头部注释也当成 banner 删掉，
  导致重复执行会追加两份（不幂等）。唯一标记不会误伤。

用法：改完 styles/mobile.css 后运行本脚本（build-dist.py 会自动先跑它）。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / 'styles' / 'mobile.css'
APP = ROOT / 'styles' / 'app.css'

SYNC_START = '/* <<< sync:mobile-css:start >>>'
SYNC_END = '/* <<< sync:mobile-css:end >>> */'

BANNER = """/* <<< sync:mobile-css:start >>>
   手机端版式适配（2026-11-06）—— 本区块由 styles/mobile.css 自动同步而来，请勿手改。
   内容一字不改，只调版式：安全区避让 / 顶栏瘦身 / 按钮独占一行 /
   单元卡单列 / 长文本防横向溢出。
   为什么内联进 app.css：GitHub Pages 的 CDN 对**新增文件**收录很慢
   （实测 >7 分钟仍 404），会拖垮整次上线；改存量文件 1-3 分钟即生效。
   源文件：styles/mobile.css（改那里，再跑 scripts/sync-mobile-css.py 同步）
"""


def main() -> int:
    mob = MOBILE.read_text(encoding='utf-8').strip()
    app = APP.read_text(encoding='utf-8')

    start = app.find(SYNC_START)
    end = app.find(SYNC_END)
    if start != -1 and end != -1 and end > start:
        # 已有区块 → 整体替换（保留区块之后的原始内容）
        head = app[:start].rstrip('\n')
        tail = app[end + len(SYNC_END):].lstrip('\n')
    elif start != -1 or end != -1:
        print('❌ app.css 里的同步标记不完整，请检查后手动清理', file=sys.stderr)
        return 1
    else:
        # 首次同步 → 追加到末尾
        head = app.rstrip('\n')
        tail = ''

    block = f'{BANNER}{mob}\n{SYNC_END}'
    APP.write_text(f'{head}\n\n{block}\n{tail}', encoding='utf-8')
    print(f'✅ 已同步 mobile.css → app.css（{len(mob)} 字节）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
