"""セントロイド計算のテスト"""

import numpy as np
import pytest
from core.centroid import compute_centroid


class TestComputeCentroid:
    def test_gaussian_star(self):
        """ガウシアン星のセントロイド"""
        # 50x50 の画像にガウシアン星を配置
        img = np.zeros((50, 50))
        # 中心 (25.3, 24.7) にガウシアン
        for y in range(50):
            for x in range(50):
                r2 = (x - 25.3) ** 2 + (y - 24.7) ** 2
                img[y, x] = np.exp(-r2 / (2 * 3.0**2))

        result = compute_centroid(img, 25, 25, radius=10)
        assert result is not None
        assert abs(result[0] - 25.3) < 0.5
        assert abs(result[1] - 24.7) < 0.5

    def test_no_signal(self):
        """信号なしでNone"""
        img = np.ones((50, 50)) * 0.5  # 均一画像
        result = compute_centroid(img, 25, 25, radius=10)
        assert result is None

    def test_edge(self):
        """画像端で範囲クリップ"""
        img = np.zeros((50, 50))
        # 端にガウシアン星を配置（ピークが必要）
        for y in range(10):
            for x in range(10):
                r2 = (x - 2.0) ** 2 + (y - 2.0) ** 2
                img[y, x] = np.exp(-r2 / (2 * 1.5**2))
        result = compute_centroid(img, 0, 0, radius=5)
        assert result is not None

    def test_bright_star(self):
        """明るい星のセントロイドがクリック位置近傍"""
        img = np.random.uniform(0.0, 0.01, (100, 100))
        # 中心 (60, 40) に明るい星
        for y in range(100):
            for x in range(100):
                r2 = (x - 60) ** 2 + (y - 40) ** 2
                img[y, x] += 0.8 * np.exp(-r2 / (2 * 2.0**2))

        result = compute_centroid(img, 62, 42, radius=10)
        assert result is not None
        assert abs(result[0] - 60) < 1.0
        assert abs(result[1] - 40) < 1.0
