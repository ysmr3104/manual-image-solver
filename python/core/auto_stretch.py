"""天文画像用オートストレッチ"""

import numpy as np
from astropy.visualization import ZScaleInterval, AsinhStretch


def auto_stretch(data, rgb_data=None):
    """ZScale + AsinhStretch でオートストレッチ

    Args:
        data: 2D numpy array (float, ルミナンス)
        rgb_data: 3D numpy array (H, W, 3) or None

    Returns:
        rgb_data が None なら 2D (float, 0-1)
        rgb_data があれば 3D (H, W, 3, float, 0-1)
    """
    # ルミナンスから vmin, vmax を決定
    zscale = ZScaleInterval()
    vmin, vmax = zscale.get_limits(data)

    if rgb_data is not None:
        # RGB の各チャンネルに同じ vmin/vmax を適用（リンクドストレッチ）
        if vmax > vmin:
            scaled = (rgb_data - vmin) / (vmax - vmin)
        else:
            scaled = np.zeros_like(rgb_data)
        scaled = np.clip(scaled, 0.0, 1.0)
        stretch = AsinhStretch(a=0.1)
        result = stretch(scaled)
        return np.clip(result, 0.0, 1.0)

    # 既存の 2D 処理
    if vmax > vmin:
        scaled = (data - vmin) / (vmax - vmin)
    else:
        scaled = np.zeros_like(data)
    scaled = np.clip(scaled, 0.0, 1.0)
    stretch = AsinhStretch(a=0.1)
    result = stretch(scaled)
    return np.clip(result, 0.0, 1.0)
