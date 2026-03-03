"""セントロイド計算（輝度重心法）"""

import numpy as np


def compute_centroid(image_data, cx, cy, radius=10):
    """クリック位置周辺のセントロイド（輝度重心）を計算

    Args:
        image_data: 2D numpy array
        cx, cy: クリック位置（0-based ピクセル座標）
        radius: 検索半径（ピクセル、デフォルト 10）

    Returns:
        tuple: (x, y) サブピクセル精度の星中心、失敗時 None
    """
    height, width = image_data.shape

    # 窓範囲を計算（画像端でクリップ）
    x0 = max(0, round(cx) - radius)
    x1 = min(width - 1, round(cx) + radius)
    y0 = max(0, round(cy) - radius)
    y1 = min(height - 1, round(cy) + radius)

    # 窓内のピクセルを取得
    window = image_data[y0 : y1 + 1, x0 : x1 + 1]

    # バックグラウンド: 窓内ピクセルの中央値
    median = np.median(window)

    # 輝度重心を計算
    sum_wx = 0.0
    sum_wy = 0.0
    sum_w = 0.0

    for iy in range(y0, y1 + 1):
        for ix in range(x0, x1 + 1):
            val = image_data[iy, ix] - median
            if val > 0:
                sum_wx += val * ix
                sum_wy += val * iy
                sum_w += val

    if sum_w <= 0:
        return None

    return (sum_wx / sum_w, sum_wy / sum_w)
