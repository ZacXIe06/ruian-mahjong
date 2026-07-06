# -*- coding: utf-8 -*-
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "平阳台炮当前实现规则确认稿-新版.pdf"


def find_font():
    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simsun.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return path
    raise FileNotFoundError("未找到可用中文字体")


FONT_NAME = "CNFont"
pdfmetrics.registerFont(TTFont(FONT_NAME, str(find_font())))


def p(text, style):
    return Paragraph(text, style)


styles = getSampleStyleSheet()
title = ParagraphStyle(
    "TitleCN",
    parent=styles["Title"],
    fontName=FONT_NAME,
    fontSize=22,
    leading=30,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#1f5138"),
    spaceAfter=8,
)
subtitle = ParagraphStyle(
    "SubtitleCN",
    parent=styles["Normal"],
    fontName=FONT_NAME,
    fontSize=10,
    leading=16,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#666666"),
    spaceAfter=12,
)
h1 = ParagraphStyle(
    "H1CN",
    parent=styles["Heading1"],
    fontName=FONT_NAME,
    fontSize=15,
    leading=22,
    textColor=colors.HexColor("#1f5138"),
    spaceBefore=8,
    spaceAfter=6,
)
h2 = ParagraphStyle(
    "H2CN",
    parent=styles["Heading2"],
    fontName=FONT_NAME,
    fontSize=12,
    leading=18,
    textColor=colors.HexColor("#2f6b4c"),
    spaceBefore=6,
    spaceAfter=4,
)
body = ParagraphStyle(
    "BodyCN",
    parent=styles["BodyText"],
    fontName=FONT_NAME,
    fontSize=9.3,
    leading=15,
    wordWrap="CJK",
    alignment=TA_LEFT,
)
small = ParagraphStyle(
    "SmallCN",
    parent=body,
    fontSize=8.2,
    leading=12.5,
    textColor=colors.HexColor("#555555"),
)
cell = ParagraphStyle(
    "CellCN",
    parent=body,
    fontSize=8.4,
    leading=12,
    wordWrap="CJK",
)
cell_head = ParagraphStyle(
    "CellHeadCN",
    parent=cell,
    fontSize=8.8,
    leading=12.5,
    textColor=colors.white,
)


def bullets(items):
    story = []
    for item in items:
        story.append(p("• " + item, body))
    return story


def table(rows, widths, header=True):
    data = [[p(str(c), cell_head if header and i == 0 else cell) for c in row] for i, row in enumerate(rows)]
    t = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#bfd2c5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2f6b4c")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ]
    for r in range(1 if header else 0, len(rows)):
        if r % 2 == 0:
            style.append(("BACKGROUND", (0, r), (-1, r), colors.HexColor("#f4f8f5")))
    t.setStyle(TableStyle(style))
    return t


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT_NAME, 8)
    canvas.setFillColor(colors.HexColor("#6b6b6b"))
    canvas.drawString(18 * mm, 10 * mm, "平阳台炮当前实现规则确认稿")
    canvas.drawRightString(192 * mm, 10 * mm, f"第 {doc.page} 页")
    canvas.restoreState()


def build_story():
    story = [
        p("平阳台炮当前实现规则确认稿", title),
        p("根据当前网站代码整理，用于请熟悉规则的人核对。本文描述的是“当前已实现逻辑”，不是最终不可修改规则。", subtitle),
        p("1. 适用范围与隔离", h1),
        *bullets([
            "开房间时可选择“瑞安麻将”或“平阳台炮”。平阳台炮走独立 ruleset=pingyang_taipao。",
            "平阳台炮的财神、白板、花牌、补牌、台数、起翻、海底流程与瑞安麻将分开处理。",
            "瑞安麻将中白板按财神面额参与吃碰杠；平阳台炮中白板是普通牌/补牌牌面，不作为瑞安式财神面额。",
        ]),
        p("2. 牌数、发牌与财神", h1),
        table([
            ["项目", "当前实现"],
            ["使用牌数", "144 张：原 136 张麻将牌 + 8 张花牌（春夏秋冬、梅兰竹菊）。"],
            ["起手牌数", "庄家起手直接 17 张，其他玩家 16 张；不是补花结束后再给庄家一张。"],
            ["初始分数", "平阳台炮每位玩家初始 200 分。"],
            ["财神", "每局翻 2 张牌做财神；如果两张相同，去重后只有 1 种财神。翻财神不跳过花牌和白板。"],
            ["财神作用", "财神可作为百搭参与胡牌结构；台数按财神数量和财神类别计算。"],
            ["起手重洗", "若某玩家起手同时有东、南、西、北、中、发、白，则整副 144 张重新洗牌发牌；庄家不变，财神重新翻。"],
        ], [34 * mm, 132 * mm]),
        p("3. 花牌、白板与补牌", h1),
        *bullets([
            "平阳台炮中，花牌和白板进入补牌流程。玩家手中有花牌或白板时，会被要求先补牌。",
            "补牌顺序：开局按庄家开始，逆时针一轮一轮处理；手上没有可补牌的人在补牌环节跳过。",
            "补牌来源：从牌尾摸补牌。补到的新牌如果仍是花牌或白板，等这一圈补完后再回到该玩家继续补。",
            "补牌期间不能出牌、不能吃碰杠、不能暗杠或补杠。",
            "胡牌判断时，已补出的花牌/白板不放在普通手牌区参与 3+3+3+3+3+2 结构，只参与台数计算。",
        ]),
        p("4. 行牌与吃碰杠", h1),
        *bullets([
            "正常出牌后，系统开放胡、杠、碰、吃反应窗口。",
            "优先级：胡 > 杠 > 碰 > 吃。若高优先级玩家未回应，低优先级不会提前结算。",
            "吃只允许下家；碰、杠、胡按规则可由其他玩家响应。",
            "明杠/暗杠后从牌尾补一张牌。",
            "补杠会开启抢杠胡窗口；有人胡则按抢杠胡处理，否则完成补杠并从牌尾补牌。",
        ]),
        p("5. 胡牌资格", h1),
        *bullets([
            "基础胡牌结构使用 17 张胡牌手牌：5 组面子 + 1 对将；也支持八对检测。",
            "平阳台炮不继承瑞安麻将的清一色/四风齐等快捷胡牌入口；必须满足平阳结构或特殊胡。",
            "8 花补齐视为杀猪，可直接胡。",
            "杀猪：财神数量达到条件时可直接作为特殊胡；同财神翻出时，2 张同财神也可触发。",
            "台数不是胡牌按钮出现条件；13 台/30 台用于大炮结算倍率。",
        ]),
        p("6. 牌面台数（所有玩家通用）", h1),
        table([
            ["类别", "当前实现"],
            ["杠牌", "小牌明杠 2 台；小牌暗杠 3 台；大牌（中/发/白/自家风）明杠 3 台；大牌暗杠 4 台。"],
            ["刻/碰", "中、发、白、自家风的碰或暗刻计 1 台；两张对应牌 + 财神搭成暗刻也计 1 台。"],
            ["小牌财神", "1 张 1 台；2 张相同 3 台；3 张相同 5 台。"],
            ["大牌财神", "字牌、风牌、花牌、白板类财神：1 张 2 台；2 张相同 5 台；3 张相同 8 台。"],
            ["同财神特殊", "翻出的两张财神相同后：手里 1 张该财神 5 台；2 张该财神 10 台；不自动视为起翻。"],
            ["花牌/白板", "每组按数量计：1 张 1 台，2 张同组 3 台，3 张同组 5 台，4 张同组 10 台。白板也按同样分档计台。"],
        ], [34 * mm, 132 * mm]),
        p("7. 胡牌台数（只有胡家加）", h1),
        table([
            ["胡牌项", "当前实现"],
            ["自摸", "+1 台。"],
            ["杠上开花", "+2 台。"],
            ["抢杠胡", "+2 台。"],
            ["海底捞月", "+1 台。"],
            ["财神汇", "3 个财神不作替代并可成胡，+7 台。"],
            ["单钓将", "财神单钓 +7 台；非财神单钓按 13 台起翻项处理。"],
            ["混一色", "+7 台。"],
            ["对对胡/碰碰胡", "+5 台。"],
            ["硬牌", "无财神胡牌，+3 台。"],
            ["清一色、四风齐、门清、天胡、地胡、硬八对", "均按 13 台起翻项处理。"],
            ["杀猪", "4 财神（3+1）10 台；5 财神（3+2）12 台；6 财神（3+3）15 台；翻出同财神时，手里 2 张同财神也可触发。"],
            ["8 花补齐", "视为杀猪，15 台。"],
        ], [46 * mm, 120 * mm]),
        p("8. 起翻、双翻与结算", h1),
        *bullets([
            "大炮玩法：胡家总台数达到 13 台即翻一倍；达到 30 台为双翻。",
            "台数不是胡牌资格限制；未到 13 台仍可胡，只是不翻倍。",
            "当前网站采用人工结算：系统展示胡家完整台数、每位玩家牌面台数，玩家自行填写给每个人多少钱。",
            "所有玩家都点“下一局”后才进入下一局；分数按玩家填写金额变化。",
            "未胡三家之间的台数差、庄家翻倍等，当前主要交给人工结算面板处理，系统不自动套公式。",
        ]),
        p("9. 流局/海底流程", h1),
        *bullets([
            "当平阳台炮牌墙剩余 20 张时，停止正常摸打，进入海底/臭庄处理。",
            "从当前出牌后的下一家开始，按逆时针顺序给四家各摸一张海底牌。",
            "海底牌只能用于判断能否胡；不能打出、不能补花、不能暗杠、不能补杠。",
            "若有人胡，按海底捞月加台；若无人胡，进入流局，所有人本局不自动计分，进入人工确认下一局。",
        ]),
        p("10. 当前建议重点核对", h1),
        *bullets([
            "白板：当前既走补牌流程，又按“花牌/白板”计台；请确认平阳当地是否确实如此。",
            "起手东南西北中发白重洗：当前规则为整副 144 张重洗，庄家不变，财神重新翻。",
            "海底顺序：当前从原本下一位摸牌者开始依次四家各摸一张；请确认是否符合当地玩法。",
            "杀猪台数：当前按 4 财神 10 台、5 财神 12 台、6 财神 15 台、8 花 15 台；请确认是否还要叠加哪些胡牌台数。",
            "结算：当前不自动计算庄家翻倍/边家台差，只展示台数并人工填账；请确认是否希望后续改为自动结算。",
        ]),
    ]
    return story


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="平阳台炮当前实现规则确认稿",
        author="Codex",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin + 8 * mm, doc.width, doc.height - 8 * mm, id="normal")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=on_page)])
    story = []
    for item in build_story():
        story.append(item)
        if isinstance(item, Paragraph):
            story.append(Spacer(1, 1.5 * mm))
        elif isinstance(item, Table):
            story.append(Spacer(1, 4 * mm))
    doc.build(story)
    print(OUT)


if __name__ == "__main__":
    main()
