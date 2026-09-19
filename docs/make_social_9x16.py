"""
Skill 出厂台 · 9:16 竖版一图流（1080 x 1920）
=============================================
用途：发社群 / 手机竖屏阅读。

内容主张（三段式）：混乱输入 → 方法处理器 → 结构化输出
  左栏「现状 · 痛点」  装了不知道会不会被叫到
  中栏「方法 · 出厂台」  五个能力，一条线
  右栏「结果 · 拿到什么」 改哪里、怎么改

布局教训（沿用上一版）：
· **自顶向下反推**，不要"先定死画布高度再分配预算"，那样必算漏间距、中段留大片空白。
  顺序：页脚贴底 → 编目区占定高 → 面板吃掉剩余。
· 署名与网址必须**真正分两行**：网址太长，同行必与署名相撞。

用法: python make_social_9x16.py
"""
import io
import os
import sys
import subprocess

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_SVG = os.path.join(HERE, "_social.src.svg")
OUT_PNG = os.path.join(HERE, "skill-foundry-9x16.png")

W, H = 1080, 1920
M = 72
CW = W - M * 2

# ── 配色（与界面同源：深空底 + 青碧主色）──
INK = "#0B1220"
MUTED = "#5A6478"
BG = "#F7F8FA"
PANEL = "#FFFFFF"
BLUE = "#1769D2"      # 主色：路由 / 命中
PURPLE = "#5B48D6"    # 方法
GREEN = "#12A06A"     # 结果 / 就绪
ORANGE = "#E8891A"    # 摇摆
RED = "#D64545"       # 阻塞 / 漏触
CYAN = "#0E9AA7"      # 观察
GREY_BG = "#F1F2F5"
SOFT_BLUE = "#EDF3FD"
SOFT_GREEN = "#EAF7F1"
SOFT_PURPLE = "#F2F0FE"

FONT = '"Microsoft YaHei","Noto Sans SC","PingFang SC",sans-serif'
MONO = '"Consolas","Courier New",monospace'

p = []
a = p.append


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def arrow(x, yc, h=20, col=BLUE):
    a(f'<path d="M{x} {yc-h} L{x+h*0.9} {yc} L{x} {yc+h} Z" fill="{col}"/>')
    a(f'<rect x="{x-h*0.82}" y="{yc-6}" width="{h*0.85}" height="12" fill="{col}"/>')


# ============================================================ 纵向预算（自顶向下）
HEAD_TOP = M + 2
BADGE_H = 42
TITLE_Y = HEAD_TOP + BADGE_H + 92
SUB1_Y = TITLE_Y + 58
SUB2_Y = SUB1_Y + 38
PANEL_TOP = SUB2_Y + 38

FOOT_H = 196
FOOT_TOP = H - M - FOOT_H

CAT_COLS, CAT_ROWS = 2, 3
CAT_H, CAT_GAP = 112, 16
CAT_BLOCK = CAT_ROWS * CAT_H + (CAT_ROWS - 1) * CAT_GAP
CAT_TITLE_H = 108  # 「五个页签」标题带（含上方呼吸空间）
CAT_W = (CW - (CAT_COLS - 1) * CAT_GAP) // CAT_COLS

GRID_TOP = FOOT_TOP - 32 - CAT_BLOCK
# 面板底到「五个页签」标题之间要留出呼吸空间。
# CAT_TITLE_H 是标题占高（含上方间距），不能压到 0，否则标题会贴住面板底边。
PANEL_H = GRID_TOP - CAT_TITLE_H - PANEL_TOP

# ============================================================ 输出
a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
a(f'<rect width="{W}" height="{H}" fill="{BG}"/>')
a('<defs>')
a('<filter id="sh" x="-10%" y="-10%" width="120%" height="130%">'
  '<feDropShadow dx="0" dy="4" stdDeviation="9" flood-color="#0B1020" flood-opacity="0.07"/></filter>')
a('<filter id="sh2" x="-10%" y="-10%" width="120%" height="130%">'
  '<feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#0B1020" flood-opacity="0.06"/></filter>')
a('</defs>')
a(f'<style>text{{font-family:{FONT};}} .m{{font-family:{MONO};}}</style>')

# ---- 顶部
BW = 336
a(f'<rect x="{M}" y="{HEAD_TOP}" width="{BW}" height="{BADGE_H}" rx="{BADGE_H/2}" fill="{BLUE}"/>')
a(f'<text x="{M+BW/2}" y="{HEAD_TOP+BADGE_H-14}" font-size="17" font-weight="700" fill="#FFFFFF" '
  f'letter-spacing="2.2" text-anchor="middle">OPEN SOURCE · MCP APP</text>')

a(f'<text x="{M}" y="{TITLE_Y}" font-size="88" font-weight="800" fill="{INK}">Skill 出厂台</text>')
a(f'<rect x="{M}" y="{TITLE_Y+16}" width="470" height="11" rx="5.5" fill="{PURPLE}" opacity="0.85"/>')
a(f'<text x="{M}" y="{SUB1_Y}" font-size="30" fill="#1F3A6E">你的技能，装了会不会被叫到？</text>')
a(f'<text x="{M}" y="{SUB2_Y}" font-size="26" fill="{MUTED}">验触发 · 看结构 · 打包发布</text>')

# ---- 三栏
GAP = 18
LW, MW2, RW = 268, 334, 300
LX = M
MX = LX + LW + GAP
RX = MX + MW2 + GAP

for x, w, fill in ((LX, LW, GREY_BG), (MX, MW2, PANEL), (RX, RW, SOFT_GREEN)):
    a(f'<rect x="{x}" y="{PANEL_TOP}" width="{w}" height="{PANEL_H}" rx="22" fill="{fill}" filter="url(#sh)"/>')

BTN_TOP = PANEL_TOP + PANEL_H - 58

# ============================================================ 左栏：痛点
pl = PANEL_TOP + 32
a(f'<rect x="{LX+16}" y="{pl}" width="128" height="34" rx="17" fill="#8A8F9C"/>')
a(f'<text x="{LX+80}" y="{pl+23}" font-size="17" font-weight="700" fill="#FFFFFF" '
  f'text-anchor="middle">现状 · 痛点</text>')

notes = [
    ("该用的没说", RED, -5, -3),
    ("不该用的乱套", "#C0392B", 6, 3),
    ("两个抢触发", ORANGE, -4, -1),
    ("装了从没生效", CYAN, 3, -3),
    ("谁和谁重复", PURPLE, -5, 2),
]
nw = 216
ny0 = pl + 52
nh = int((PANEL_TOP + PANEL_H - 68 - ny0) / 5) - 10
for i, (txt, col, rot, dx) in enumerate(notes):
    nx = LX + 20 + dx
    ny = ny0 + i * (nh + 10)
    a(f'<g transform="rotate({rot} {nx+nw/2} {ny+nh/2})">')
    a(f'<rect x="{nx}" y="{ny}" width="{nw}" height="{nh}" rx="13" fill="#FFFFFF" filter="url(#sh2)"/>')
    a(f'<circle cx="{nx+24}" cy="{ny+nh/2}" r="9.5" fill="{col}" opacity="0.9"/>')
    a(f'<text x="{nx+45}" y="{ny+nh/2+7}" font-size="20" font-weight="700" fill="{INK}">{esc(txt)}</text>')
    a('</g>')

a(f'<line x1="{LX+20}" y1="{PANEL_TOP+PANEL_H-68}" x2="{LX+LW-20}" y2="{PANEL_TOP+PANEL_H-68}" '
  f'stroke="#D8D5CC" stroke-width="1.6" stroke-dasharray="5 5"/>')
a(f'<text x="{LX+LW/2}" y="{PANEL_TOP+PANEL_H-32}" font-size="19" font-weight="700" fill="{MUTED}" '
  f'text-anchor="middle">根因：没人测过触发接口</text>')

# ============================================================ 中栏：方法（五个能力）
pm = PANEL_TOP + 32
a(f'<rect x="{MX+MW2/2-104}" y="{pm}" width="208" height="34" rx="17" fill="{PURPLE}"/>')
a(f'<text x="{MX+MW2/2}" y="{pm+23}" font-size="17" font-weight="700" fill="#FFFFFF" '
  f'text-anchor="middle">方法 · 五个能力</text>')
pm += 48

caps = [
    ("试一条", "看会被谁接住", BLUE),
    ("路由体检", "六类结论 + 归因", CYAN),
    ("关系图谱", "域间 / 重复 / 孤岛", PURPLE),
    ("打包发布", "13 项检查 + 物料", ORANGE),
    ("静态体检", "零模型成本", GREEN),
]
rh = int((BTN_TOP - 20 - pm) / 5) - 10
rw2 = MW2 - 56
for i, (t1, t2, col) in enumerate(caps):
    ry = pm + i * (rh + 10)
    a(f'<rect x="{MX+28}" y="{ry}" width="{rw2}" height="{rh}" rx="13" fill="#F4F2FE"/>')
    a(f'<circle cx="{MX+50}" cy="{ry+rh/2}" r="9.5" fill="{col}"/>')
    a(f'<text x="{MX+69}" y="{ry+rh/2+7}" font-size="20" font-weight="700" fill="{INK}">{esc(t1)}</text>')
    a(f'<text x="{MX+MW2-40}" y="{ry+rh/2+6}" font-size="15" fill="{MUTED}" '
      f'text-anchor="end">{esc(t2)}</text>')

a(f'<rect x="{MX+MW2/2-100}" y="{BTN_TOP}" width="200" height="42" rx="21" fill="{PURPLE}"/>')
a(f'<text x="{MX+MW2/2}" y="{BTN_TOP+28}" font-size="19" font-weight="700" fill="#FFFFFF" '
  f'text-anchor="middle">一条线跑通</text>')

# ============================================================ 右栏：结果
pr = PANEL_TOP + 32
a(f'<rect x="{RX+RW/2-100}" y="{pr}" width="200" height="34" rx="17" fill="{GREEN}"/>')
a(f'<text x="{RX+RW/2}" y="{pr+23}" font-size="17" font-weight="700" fill="#FFFFFF" '
  f'text-anchor="middle">结果 · 拿到什么</text>')
pr += 50

# 六类结论（配稳定/摇摆/漏触/误触/正确/观察）
verdicts = [
    ("稳定命中", "每次都叫到", GREEN),
    ("摇摆触发", "时灵时不灵", ORANGE),
    ("漏触", "该叫没叫到", RED),
    ("误触", "不该叫却叫", "#C0392B"),
    ("正确不触发", "测误触通过", BLUE),
    ("观察", "只记录触发谁", CYAN),
]
gh = int((BTN_TOP - 20 - pr) / 6) - 11
for i, (name, desc, col) in enumerate(verdicts):
    gy = pr + i * (gh + 11)
    a(f'<circle cx="{RX+26}" cy="{gy+13}" r="9" fill="{col}" opacity="0.18"/>')
    a(f'<circle cx="{RX+26}" cy="{gy+13}" r="4.5" fill="{col}"/>')
    a(f'<text x="{RX+46}" y="{gy+20}" font-size="19" font-weight="700" fill="{INK}">{esc(name)}</text>')
    a(f'<text x="{RX+RW-18}" y="{gy+20}" font-size="15" fill="{MUTED}" '
      f'text-anchor="end">{esc(desc)}</text>')
    if i < 5:
        a(f'<line x1="{RX+26}" y1="{gy+24}" x2="{RX+26}" y2="{gy+gh+2}" '
          f'stroke="{GREEN}" stroke-width="2" stroke-dasharray="4 4" opacity="0.4"/>')

a(f'<rect x="{RX+16}" y="{BTN_TOP}" width="{RW-32}" height="42" rx="21" fill="{GREEN}"/>')
a(f'<text x="{RX+RW/2}" y="{BTN_TOP+28}" font-size="19" font-weight="800" fill="#FFFFFF" '
  f'text-anchor="middle">知道该改哪句话</text>')

ayc = PANEL_TOP + PANEL_H / 2
arrow(LX + LW + 2, ayc, col=BLUE)
arrow(MX + MW2 + 2, ayc, col=PURPLE)

# ============================================================ 编目区（2 列 × 3 行）
a(f'<text x="{M}" y="{GRID_TOP-18}" font-size="24" font-weight="800" fill="{INK}">'
  f'五个页签 · 从摸底到出门</text>')

# ⚠️ 必须与实际界面一致：试一条与体检 / 关系图谱 / 打包发布 / 导出清单 / 设置 = 5 个。
# 第 6 格留给「严格只读」这条设计约束，正好填满 2×3，也顺带把最重要的承诺说清楚。
cats = [
    ("01", "试一条与体检", "摸底 + 验触发", BLUE),
    ("02", "关系图谱", "看结构", PURPLE),
    ("03", "打包发布", "出门带物料", ORANGE),
    ("04", "导出清单", "给 AI 改", "#7A5AF8"),
    ("05", "设置", "接模型 / Codex", GREEN),
    ("—", "严格只读", "不动你的文件", MUTED),
]
for i, (num, name, tag, col) in enumerate(cats):
    c_i, r_i = i % CAT_COLS, i // CAT_COLS
    cx = M + c_i * (CAT_W + CAT_GAP)
    cy = GRID_TOP + r_i * (CAT_H + CAT_GAP)
    a(f'<rect x="{cx}" y="{cy}" width="{CAT_W}" height="{CAT_H}" rx="16" fill="{PANEL}" filter="url(#sh2)"/>')
    a(f'<rect x="{cx}" y="{cy}" width="6" height="{CAT_H}" rx="3" fill="{col}"/>')
    a(f'<text x="{cx+26}" y="{cy+42}" font-size="18" font-weight="800" fill="{col}">{num}</text>')
    a(f'<text x="{cx+26}" y="{cy+CAT_H-28}" font-size="24" font-weight="700" fill="{INK}">{esc(name)}</text>')
    a(f'<text x="{cx+CAT_W-24}" y="{cy+CAT_H-28}" font-size="17" font-weight="700" fill="{col}" '
      f'text-anchor="end">{esc(tag)}</text>')

# ============================================================ 页脚
a(f'<rect x="{M}" y="{FOOT_TOP}" width="{CW}" height="{FOOT_H}" rx="22" fill="{PANEL}" filter="url(#sh)"/>')

lx, ly = M + 50, FOOT_TOP + 46
a(f'<circle cx="{lx}" cy="{ly}" r="23" fill="{BLUE}" opacity="0.15"/>')
a(f'<circle cx="{lx}" cy="{ly-4}" r="10.5" fill="{BLUE}"/>')
a(f'<rect x="{lx-5}" y="{ly+6}" width="10" height="9" rx="2" fill="{BLUE}"/>')

a(f'<text x="{M+92}" y="{FOOT_TOP+56}" font-size="30" font-weight="800" fill="{INK}">'
  f'技能写得再好，叫不出来就等于没有。</text>')
a(f'<line x1="{M+50}" y1="{FOOT_TOP+84}" x2="{M+CW-50}" y2="{FOOT_TOP+84}" '
  f'stroke="{BLUE}" stroke-width="1.6" opacity="0.30"/>')

# ⚠ 署名与网址必须分两行：网址过长，同行必撞
a(f'<text x="{M+50}" y="{FOOT_TOP+110}" font-size="20" font-weight="700" fill="{MUTED}">'
  f'严格只读你的技能库 · MIT License</text>')
a(f'<text x="{M+50}" y="{FOOT_TOP+146}" font-size="20" font-weight="700" fill="{BLUE}" '
  f'class="m">github.com/q2522879285-source/skill-foundry</text>')
a('</svg>')

open(OUT_SVG, "w", encoding="utf-8").write("\n".join(p))

# ============================================================ 自检
grid_bot = GRID_TOP + CAT_BLOCK
panel_bot = PANEL_TOP + PANEL_H
print(f"WR_LAYOUT 画布 {W}x{H}")
print(f"WR_LAYOUT 面板 {PANEL_TOP}~{panel_bot} 高 {PANEL_H}")
print(f"WR_LAYOUT 编目 {GRID_TOP}~{grid_bot} ({CAT_COLS}列x{CAT_ROWS}行, 格 {CAT_W}x{CAT_H})")
print(f"WR_LAYOUT 页脚 {FOOT_TOP}~{FOOT_TOP+FOOT_H}")

assert panel_bot < GRID_TOP - CAT_TITLE_H + 1, f"面板与编目重叠: {panel_bot} vs {GRID_TOP-CAT_TITLE_H}"
assert grid_bot <= FOOT_TOP - 24, f"编目与页脚重叠: {grid_bot} vs {FOOT_TOP}"
assert PANEL_H > 620, f"面板过矮 {PANEL_H}"
assert H - (FOOT_TOP + FOOT_H) == M, f"底部余量不对 {H-(FOOT_TOP+FOOT_H)}"
# 面板底与编目标题之间要真有呼吸空间。
# 注意：panel_bot 按构造 = GRID_TOP - CAT_TITLE_H，所以不能拿"面板底 vs 标题带顶"去量
# （那永远是 0）。要量的是「面板底 vs 标题文字基线」——那才是眼睛看到的间距。
TITLE_BASELINE = GRID_TOP - 18
gap_panel_title = TITLE_BASELINE - panel_bot
assert gap_panel_title >= 40, f"面板底到编目标题太挤: {gap_panel_title}px"
print(f"WR_LAYOUT 面板→编目标题 {gap_panel_title} | 编目→页脚 {FOOT_TOP-grid_bot} | 底部余量 {H-(FOOT_TOP+FOOT_H)}")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
url = "file:///" + OUT_SVG.replace("\\", "/")
subprocess.run([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
                f"--screenshot={OUT_PNG}", f"--window-size={W},{H}",
                "--force-device-scale-factor=2", url],
               capture_output=True, text=True, timeout=180)
print(f"WR_SOCIAL png ok={os.path.isfile(OUT_PNG)} size={os.path.getsize(OUT_PNG) if os.path.isfile(OUT_PNG) else 0} B")
