"""FITS/XISF 画像読み込みモジュール"""

import os
import numpy as np
from astropy.io import fits


def load_image(filepath):
    """FITS または XISF 画像を読み込む

    Args:
        filepath: 画像ファイルパス（.fits, .fit, .xisf）

    Returns:
        tuple: (data_2d, metadata)
            data_2d: 2D numpy array (float64, ルミナンス)
            metadata: dict {"width": int, "height": int, "filename": str, "format": str}

    Raises:
        ValueError: 未対応フォーマット
        FileNotFoundError: ファイルが存在しない
    """
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"ファイルが見つかりません: {filepath}")

    ext = os.path.splitext(filepath)[1].lower()

    if ext in (".fits", ".fit"):
        data = _load_fits(filepath)
        fmt = "FITS"
    elif ext == ".xisf":
        data = _load_xisf(filepath)
        fmt = "XISF"
    else:
        raise ValueError(f"未対応フォーマット: {ext}")

    data_2d = _to_luminance_2d(data)
    data_2d = _normalize_float64(data_2d)

    # RGB データも返す（カラー表示用）
    rgb_data = _to_rgb_hwc(data)

    metadata = {
        "width": data_2d.shape[1],
        "height": data_2d.shape[0],
        "filename": os.path.basename(filepath),
        "format": fmt,
        "rgb_data": rgb_data,
    }

    return data_2d, metadata


def _load_fits(filepath):
    """FITS ファイルからデータを読み込む"""
    with fits.open(filepath) as hdul:
        data = hdul[0].data
    if data is None:
        raise ValueError("FITS ファイルにデータが含まれていません")
    return data.astype(np.float64)


def _load_xisf(filepath):
    """XISF ファイルからデータを読み込む"""
    from xisf import XISF

    xisf_obj = XISF(filepath)
    data = xisf_obj.read_image(0)
    return data.astype(np.float64)


def _to_rgb_hwc(data):
    """RGB データを (H, W, 3) 形式で返す。モノクロなら None"""
    if data.ndim == 2:
        return None
    if data.ndim == 3:
        # (channels, H, W) 形式
        if data.shape[0] in (3, 4):
            rgb = np.stack([data[0], data[1], data[2]], axis=-1)
            return _normalize_float64(rgb)
        # (H, W, channels) 形式
        if data.shape[2] in (3, 4):
            rgb = data[:, :, :3].copy()
            return _normalize_float64(rgb)
    return None


def _to_luminance_2d(data):
    """3D RGB データを 2D ルミナンスに変換（必要に応じて）"""
    if data.ndim == 2:
        return data

    if data.ndim == 3:
        # (channels, height, width) 形式
        if data.shape[0] in (3, 4):
            r, g, b = data[0], data[1], data[2]
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
        # (height, width, channels) 形式
        if data.shape[2] in (3, 4):
            r, g, b = data[:, :, 0], data[:, :, 1], data[:, :, 2]
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
        # 1チャンネル
        if data.shape[0] == 1:
            return data[0]
        if data.shape[2] == 1:
            return data[:, :, 0]

    raise ValueError(f"未対応のデータ形状: {data.shape}")


def _normalize_float64(data):
    """データを float64 に変換し 0-1 範囲に正規化"""
    data = data.astype(np.float64)

    # 既に 0-1 範囲ならそのまま返す
    if data.max() <= 1.0 and data.min() >= 0.0:
        return data

    # 整数型のデータを正規化
    dmax = data.max()
    if dmax > 0:
        return data / dmax

    return data
