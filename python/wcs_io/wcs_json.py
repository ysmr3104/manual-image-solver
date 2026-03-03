"""WCS JSON 入出力（PJSR互換フォーマット）"""

import json
import math
import re


def _sanitize_floats_for_pjsr(obj):
    """PJSR の JSON.parse 互換のために浮動小数点精度を制限する

    全浮動小数点数を12有効桁・最大15桁小数に丸める。
    科学表記(1.23e-06等)を固定小数点に変換。
    """
    if isinstance(obj, dict):
        return {k: _sanitize_floats_for_pjsr(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_sanitize_floats_for_pjsr(v) for v in obj]
    elif isinstance(obj, float):
        if obj == 0.0:
            return 0.0
        try:
            magnitude = math.floor(math.log10(abs(obj)))
        except ValueError:
            return 0.0
        decimal_places = max(0, min(15, 12 - int(magnitude) - 1))
        return round(obj, decimal_places)
    return obj


def _json_dumps_pjsr_safe(obj):
    """PJSR 互換の JSON 文字列を生成する"""
    safe_obj = _sanitize_floats_for_pjsr(obj)
    json_str = json.dumps(safe_obj, indent=2, ensure_ascii=False)

    def _sci_to_fixed(match):
        val = float(match.group(0))
        if val == 0:
            return "0.0"
        s = f"{val:.15f}".rstrip("0")
        if s.endswith("."):
            s += "0"
        return s

    return re.sub(r"-?\d+\.?\d*[eE][+-]?\d+", _sci_to_fixed, json_str)


def save_wcs_json(filepath, wcs_result, image_info, star_pairs):
    """WCS結果をPJSR互換JSONで保存

    Args:
        filepath: 出力JSONファイルパス
        wcs_result: WCSFitter.solve() の結果dict
        image_info: {"filename": str, "width": int, "height": int}
        star_pairs: [{"name": str, "px": float, "py": float, "ra": float, "dec": float}]
    """
    data = {
        "version": "1.0.0",
        "image": {
            "filename": image_info["filename"],
            "width": image_info["width"],
            "height": image_info["height"],
        },
        "wcs": {
            "ctype1": "RA---TAN",
            "ctype2": "DEC--TAN",
            "crval1": wcs_result["crval1"],
            "crval2": wcs_result["crval2"],
            "crpix1": wcs_result["crpix1"],
            "crpix2": wcs_result["crpix2"],
            "cd1_1": wcs_result["cd"][0][0],
            "cd1_2": wcs_result["cd"][0][1],
            "cd2_1": wcs_result["cd"][1][0],
            "cd2_2": wcs_result["cd"][1][1],
        },
        "fit_quality": {
            "rms_arcsec": wcs_result["rms_arcsec"],
            "pixel_scale_arcsec": wcs_result["pixel_scale_arcsec"],
            "num_stars": len(star_pairs),
        },
        "star_pairs": [],
    }

    for i, star in enumerate(star_pairs):
        entry = {
            "name": star.get("name", f"Star {i+1}"),
            "px": star["px"],
            "py": star["py"],
            "ra": star["ra"],
            "dec": star["dec"],
        }
        if "residuals" in wcs_result and i < len(wcs_result["residuals"]):
            entry["residual_arcsec"] = wcs_result["residuals"][i]["residual_arcsec"]
        data["star_pairs"].append(entry)

    json_str = _json_dumps_pjsr_safe(data)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(json_str)


def load_wcs_json(filepath):
    """PJSR互換JSONからWCSデータを読み込む

    Args:
        filepath: JSONファイルパス

    Returns:
        dict: JSONデータ全体

    Raises:
        FileNotFoundError: ファイルが存在しない
        json.JSONDecodeError: JSON解析エラー
        ValueError: バージョン不整合
    """
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    # バージョンチェック
    version = data.get("version", "")
    if not version.startswith("1."):
        raise ValueError(f"未対応の WCS JSON バージョン: {version}")

    return data
