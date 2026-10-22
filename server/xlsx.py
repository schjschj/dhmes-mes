# -*- coding: utf-8 -*-
"""엑셀 내보내기. 프론트: POST /api/xlsx {filename, sheets:[{name, head[], rows[[]]}]}"""
import io
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

_HEAD_FILL = PatternFill("solid", fgColor="1D2733")
_HEAD_FONT = Font(color="FFFFFF", bold=True)
_THIN = Side(style="thin", color="D5DCE4")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)


def build(payload):
    wb = Workbook()
    wb.remove(wb.active)
    for sheet in payload.get("sheets", []):
        ws = wb.create_sheet((sheet.get("name") or "Sheet")[:31])
        head = sheet.get("head", [])
        if head:
            ws.append(head)
            for ci, _ in enumerate(head, 1):
                cell = ws.cell(row=1, column=ci)
                cell.fill = _HEAD_FILL
                cell.font = _HEAD_FONT
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.border = _BORDER
        for r in sheet.get("rows", []):
            ws.append(["" if v is None else v for v in r])
        # 열 너비 자동
        for ci, _ in enumerate(head, 1):
            width = len(str(head[ci - 1])) + 2
            for r in sheet.get("rows", []):
                if ci - 1 < len(r) and r[ci - 1] is not None:
                    width = max(width, min(40, len(str(r[ci - 1])) + 2))
            ws.column_dimensions[ws.cell(row=1, column=ci).column_letter].width = width
        ws.freeze_panes = "A2"
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()
