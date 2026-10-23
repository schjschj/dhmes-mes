# -*- coding: utf-8 -*-
"""[개선제안] 이미지 글자 읽기 (OCR) — Windows 10/11 에 들어 있는 OCR 엔진(Windows.Media.Ocr, 한국어)을 쓴다.

AI · 인터넷 · 추가 설치 없음. PowerShell 이 그림을 읽어 줄 · 낱말 · 위치(x, y, w, h)를 JSON 으로 돌려준다.
손글씨는 잘 못 읽으므로, 읽은 결과는 항상 화면에서 사람이 확인 · 고친 뒤 저장한다.
"""
import base64
import json
import os
import re
import subprocess
import tempfile

PS = r"""
$ErrorActionPreference = 'Stop'
$path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%PATH%'))
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$scale = [double]'%SCALE%'
$max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
$scale = [Math]::Min($scale, [Math]::Min($max / $dec.PixelWidth, $max / $dec.PixelHeight))
$tf = New-Object Windows.Graphics.Imaging.BitmapTransform
$tf.ScaledWidth = [uint32]($dec.PixelWidth * $scale); $tf.ScaledHeight = [uint32]($dec.PixelHeight * $scale)
$tf.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Fant
$bmp = Await ($dec.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
  $tf, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
$eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('ko'))
if (-not $eng) { $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $eng) { throw 'NOENGINE' }
$res = Await ($eng.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
$lines = @()
foreach ($l in $res.Lines) {
  $ws = @(); foreach ($w in $l.Words) { $r = $w.BoundingRect; $ws += ,@($w.Text, [int]($r.X / $scale), [int]($r.Y / $scale), [int]($r.Width / $scale), [int]($r.Height / $scale)) }
  $lines += ,@{ t = $l.Text; w = $ws }
}
$stream.Dispose()
$out = @{ w = $dec.PixelWidth; h = $dec.PixelHeight; lines = $lines }
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::Out.Write(($out | ConvertTo-Json -Depth 6 -Compress))
"""

EXT = {b"\x89PNG": ".png", b"\xff\xd8\xff": ".jpg", b"BM": ".bmp", b"II*\x00": ".tif", b"MM\x00*": ".tif", b"GIF8": ".gif"}


def image_ext(buf):
    for sig, ext in EXT.items():
        if buf.startswith(sig):
            return ext
    return None


def read(buf, scale=2.0):
    """그림 bytes → {w, h, lines:[{t, words:[{t,x,y,w,h}]}], text}
    scale: 확대 배율 (작은 숫자를 덜 놓침, 엔진 최대 크기를 넘지 않게 자동으로 줄임)."""
    ext = image_ext(buf)
    if not ext:
        raise ValueError("그림 파일(JPG · PNG · BMP · TIF)만 읽을 수 있습니다. PDF 는 스캔할 때 그림으로 저장하세요.")
    fd, path = tempfile.mkstemp(suffix=ext, prefix="mes_ocr_")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(buf)
        script = PS.replace("%PATH%", base64.b64encode(path.encode("utf-8")).decode()).replace("%SCALE%", "%.2f" % scale)
        p = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, timeout=120)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    if p.returncode != 0:
        msg = p.stderr.decode("utf-8", "replace")
        if "NOENGINE" in msg:
            raise ValueError("이 PC 에 한국어 OCR 이 없습니다 (Windows 설정 > 언어 > 한국어 > 언어 팩 · 광학 문자 인식 설치).")
        raise ValueError("글자를 읽지 못했습니다: " + (msg.strip().splitlines() or ["알 수 없는 오류"])[0][:200])
    d = json.loads(p.stdout.decode("utf-8", "replace") or "{}")
    lines = []
    for l in d.get("lines") or []:
        ws = l.get("w") or []
        if ws and not isinstance(ws[0], list):       # 낱말 하나뿐이면 ConvertTo-Json 이 펼쳐 버림
            ws = [ws]
        words = [{"t": w[0], "x": w[1], "y": w[2], "w": w[3], "h": w[4]} for w in ws if len(w) >= 5]
        if words:
            lines.append({"t": l.get("t") or " ".join(w["t"] for w in words), "words": words})
    return {"w": d.get("w"), "h": d.get("h"), "lines": lines, "text": "\n".join(l["t"] for l in lines)}


def rows(res, gap=0.6):
    """줄을 표의 행으로 묶기: 세로 위치가 겹치는 낱말을 한 행으로, 왼쪽부터.
    (OCR 은 표의 칸 사이가 넓으면 같은 행을 여러 줄로 나눠 주기 때문)"""
    words = [w for l in res.get("lines") or [] for w in l["words"]]
    if not words:
        return []
    hs = sorted(w["h"] for w in words)
    mh = hs[len(hs) // 2] or 10
    words.sort(key=lambda w: w["y"] + w["h"] / 2)
    out, cur, cy = [], [], None
    for w in words:
        c = w["y"] + w["h"] / 2
        if cy is not None and abs(c - cy) > mh * gap:
            out.append(cur)
            cur = []
        cur.append(w)
        cy = c if cy is None or len(cur) == 1 else (cy * (len(cur) - 1) + c) / len(cur)
    if cur:
        out.append(cur)
    res_rows = []
    for r in out:
        r.sort(key=lambda w: w["x"])
        # 가까운 낱말은 한 칸으로 (글자 높이의 1.2배 이내)
        cells, last = [], None
        for w in r:
            if last and w["x"] - (last["x"] + last["w"]) < mh * 1.2:
                last["t"] += " " + w["t"]
                last["w"] = w["x"] + w["w"] - last["x"]
            else:
                last = dict(w)
                cells.append(last)
        res_rows.append({"y": cells[0]["y"], "h": mh, "cells": [c["t"] for c in cells],
                         "xs": [c["x"] for c in cells], "ws": [c["w"] for c in cells]})
    return res_rows


# OCR 이 자주 헷갈리는 글자 (제번 · 숫자 비교용)
_FIX = str.maketrans({"O": "0", "o": "0", "D": "0", "Q": "0", "I": "1", "l": "1", "|": "1", "i": "1", "!": "1",
                      "Z": "2", "S": "5", "s": "5", "B": "8", "G": "6", "g": "9", "q": "9", "—": "-", "–": "-", "_": "-", "~": "-"})


def norm_code(s):
    return re.sub(r"[^0-9A-Z\-]", "", (s or "").upper().replace(" ", ""))


def loose(s):
    """글자 · 숫자 헷갈림을 없앤 비교용 문자열."""
    return re.sub(r"[^0-9A-Z]", "", (s or "").translate(_FIX).upper().translate(_FIX))


def num(s):
    """'1,234' '12.5' 'l2' → 숫자 (아니면 None)."""
    t = (s or "").strip().translate(_FIX).replace(",", "").replace(" ", "")
    t = t.rstrip(".")
    if re.fullmatch(r"-?\d+(\.\d+)?", t):
        return float(t)
    return None


def time_of(s):
    """'08:30' '0830' '8.30' '8시30분' → 'HH:MM' (아니면 None)."""
    t = (s or "").strip().translate(_FIX).replace(" ", "")
    m = re.fullmatch(r"(\d{1,2})[:.;시]?(\d{2})분?", t)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 24 or mi > 59:
        return None
    return "%02d:%02d" % (h, mi)
