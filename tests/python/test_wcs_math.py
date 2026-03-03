"""wcs_math モジュールのテスト — javascript/wcs_math.js テストの完全移植。"""

import math

import pytest

from core.wcs_math import (
    WCSFitter,
    angular_separation,
    tan_deproject,
    tan_project,
)

# ============================================================
# ヘルパー: 既知 WCS からピクセル→天球座標の星ペアを合成
# ============================================================


def _make_star_pairs(known_crval, known_cd, img_w, img_h, test_pixels):
    """既知 WCS パラメータからテスト用星ペアを合成する。"""
    crpix1 = img_w / 2.0 + 0.5
    crpix2 = img_h / 2.0 + 0.5

    star_pairs = []
    for i, tp in enumerate(test_pixels):
        u = (tp["px"] + 1.0) - crpix1
        v = (tp["py"] + 1.0) - crpix2  # PixInsight FITS: フリップなし
        xi = known_cd[0][0] * u + known_cd[0][1] * v
        eta = known_cd[1][0] * u + known_cd[1][1] * v
        coord = tan_deproject(known_crval, (xi, eta))
        star_pairs.append(
            {
                "px": tp["px"],
                "py": tp["py"],
                "ra": coord[0],
                "dec": coord[1],
                "name": f"TestStar{i + 1}",
            }
        )
    return star_pairs


# ============================================================
# TAN 投影テスト
# ============================================================


class TestTanProject:
    """TAN 投影の正投影・逆投影テスト。"""

    def test_roundtrip_at_center(self):
        """投影中心での往復。"""
        crval = (180.0, 45.0)
        proj = tan_project(crval, (180.0, 45.0))
        assert proj is not None
        assert proj[0] == pytest.approx(0.0, abs=1e-12)
        assert proj[1] == pytest.approx(0.0, abs=1e-12)

        deproj = tan_deproject(crval, (0.0, 0.0))
        assert deproj[0] == pytest.approx(180.0, abs=1e-10)
        assert deproj[1] == pytest.approx(45.0, abs=1e-10)

    def test_roundtrip_nearby(self):
        """近傍点の往復精度 (< 1e-10 度)。"""
        crval = (83.633, 22.014)
        test_coords = [
            (83.822, -5.391),
            (84.053, 21.142),
            (82.500, 23.000),
            (85.000, 20.500),
        ]

        for coord in test_coords:
            proj = tan_project(crval, coord)
            assert proj is not None, f"投影成功: {coord}"
            deproj = tan_deproject(crval, proj)
            assert deproj[0] == pytest.approx(coord[0], abs=1e-10), f"RA 往復 {coord}"
            assert deproj[1] == pytest.approx(coord[1], abs=1e-10), f"DEC 往復 {coord}"

    def test_ra_wraparound(self):
        """RA=0 付近のラップアラウンド。"""
        crval = (1.0, 30.0)
        coord = (359.0, 30.0)
        proj = tan_project(crval, coord)
        assert proj is not None, "投影成功"
        deproj = tan_deproject(crval, proj)
        assert deproj[0] == pytest.approx(coord[0], abs=1e-10), "RA 往復"
        assert deproj[1] == pytest.approx(coord[1], abs=1e-10), "DEC 往復"

    def test_south_pole(self):
        """天の南極付近。"""
        crval = (0.0, -89.0)
        coord = (45.0, -88.5)
        proj = tan_project(crval, coord)
        assert proj is not None, "投影成功"
        deproj = tan_deproject(crval, proj)
        assert deproj[0] == pytest.approx(coord[0], abs=1e-8), "RA 往復"
        assert deproj[1] == pytest.approx(coord[1], abs=1e-8), "DEC 往復"

    def test_opposite_hemisphere_returns_none(self):
        """反対半球で None を返す。"""
        crval = (0.0, 90.0)
        coord = (0.0, -10.0)
        proj = tan_project(crval, coord)
        assert proj is None, "反対半球で None"


# ============================================================
# 角距離テスト
# ============================================================


class TestAngularSeparation:
    """角距離計算のテスト。"""

    def test_same_point(self):
        """同一点で 0。"""
        sep = angular_separation((83.822, -5.391), (83.822, -5.391))
        assert sep == pytest.approx(0.0, abs=1e-12)

    def test_betelgeuse_rigel(self):
        """ベテルギウス ↔ リゲル ≈ 18.5°。"""
        betelgeuse = (88.793, 7.407)
        rigel = (78.634, -8.202)
        sep = angular_separation(betelgeuse, rigel)
        assert sep == pytest.approx(18.5, abs=0.5)

    def test_poles(self):
        """天の極間 = 180°。"""
        sep = angular_separation((0.0, 90.0), (0.0, -90.0))
        assert sep == pytest.approx(180.0, abs=1e-10)

    def test_equator_90deg(self):
        """赤道上90°離れた点。"""
        sep = angular_separation((0.0, 0.0), (90.0, 0.0))
        assert sep == pytest.approx(90.0, abs=1e-10)


# ============================================================
# WCSFitter テスト — エラーケース
# ============================================================


class TestWCSFitterErrors:
    """WCSFitter のバリデーションテスト。"""

    def test_less_than_4_stars(self):
        """3星未満でエラー。"""
        fitter = WCSFitter(
            [
                {"px": 100, "py": 100, "ra": 10.0, "dec": 20.0},
                {"px": 200, "py": 200, "ra": 10.1, "dec": 20.1},
                {"px": 300, "py": 300, "ra": 10.2, "dec": 20.2},
            ],
            1000,
            1000,
        )
        result = fitter.solve()
        assert result["success"] is False
        assert "4" in result["message"]

    def test_invalid_ra(self):
        """不正な RA でエラー。"""
        fitter = WCSFitter(
            [
                {"px": 100, "py": 100, "ra": 400.0, "dec": 20.0},
                {"px": 200, "py": 200, "ra": 10.0, "dec": 20.0},
                {"px": 300, "py": 300, "ra": 10.0, "dec": 20.0},
                {"px": 400, "py": 400, "ra": 10.0, "dec": 20.0},
            ],
            1000,
            1000,
        )
        result = fitter.solve()
        assert result["success"] is False

    def test_invalid_dec(self):
        """不正な DEC でエラー。"""
        fitter = WCSFitter(
            [
                {"px": 100, "py": 100, "ra": 10.0, "dec": 95.0},
                {"px": 200, "py": 200, "ra": 10.0, "dec": 20.0},
                {"px": 300, "py": 300, "ra": 10.0, "dec": 20.0},
                {"px": 400, "py": 400, "ra": 10.0, "dec": 20.0},
            ],
            1000,
            1000,
        )
        result = fitter.solve()
        assert result["success"] is False


# ============================================================
# WCSFitter テスト — 合成星ペアでのフィッティング
# ============================================================


class TestWCSFitterSynthetic:
    """合成星ペアを使った WCSFitter の精度テスト。"""

    def test_4_stars_residual_lt_1_arcsec(self):
        """既知WCSからの合成4星（最小構成）で残差 < 1 arcsec。"""
        known_crval = (180.0, 45.0)
        known_cd = [[-4.166667e-4, 0.0], [0.0, 4.166667e-4]]
        img_w, img_h = 6000, 4000

        test_pixels = [
            {"px": 500, "py": 500},
            {"px": 5500, "py": 500},
            {"px": 500, "py": 3500},
            {"px": 5500, "py": 3500},
        ]

        star_pairs = _make_star_pairs(known_crval, known_cd, img_w, img_h, test_pixels)
        fitter = WCSFitter(star_pairs, img_w, img_h)
        result = fitter.solve()

        assert result["success"] is True
        assert (
            result["rms_arcsec"] < 1.0
        ), f"RMS < 1 arcsec (実際: {result['rms_arcsec']})"
        assert result["crpix1"] == pytest.approx(img_w / 2.0 + 0.5, abs=0.01)
        assert result["crpix2"] == pytest.approx(img_h / 2.0 + 0.5, abs=0.01)

    def test_6_stars_residual_lt_001_arcsec(self):
        """既知WCSからの合成6星で残差 < 0.01 arcsec。"""
        known_crval = (83.633, 22.014)
        known_cd = [[-3.5e-4, 1.0e-5], [1.0e-5, 3.5e-4]]
        img_w, img_h = 6024, 4024

        test_pixels = [
            {"px": 300, "py": 300},
            {"px": 3000, "py": 300},
            {"px": 5700, "py": 300},
            {"px": 300, "py": 3700},
            {"px": 3000, "py": 3700},
            {"px": 5700, "py": 3700},
        ]

        star_pairs = _make_star_pairs(known_crval, known_cd, img_w, img_h, test_pixels)
        fitter = WCSFitter(star_pairs, img_w, img_h)
        result = fitter.solve()

        assert result["success"] is True
        assert (
            result["rms_arcsec"] < 0.01
        ), f"RMS < 0.01 arcsec (実際: {result['rms_arcsec']})"

    def test_10_stars_high_precision(self):
        """合成10星で高精度フィット。"""
        known_crval = (200.0, -30.0)
        known_cd = [[-2.778e-4, 0.0], [0.0, 2.778e-4]]
        img_w, img_h = 4000, 4000

        test_pixels = [
            {"px": 200, "py": 200},
            {"px": 2000, "py": 200},
            {"px": 3800, "py": 200},
            {"px": 200, "py": 2000},
            {"px": 2000, "py": 2000},
            {"px": 3800, "py": 2000},
            {"px": 200, "py": 3800},
            {"px": 2000, "py": 3800},
            {"px": 3800, "py": 3800},
            {"px": 1000, "py": 1000},
        ]

        star_pairs = _make_star_pairs(known_crval, known_cd, img_w, img_h, test_pixels)
        fitter = WCSFitter(star_pairs, img_w, img_h)
        result = fitter.solve()

        assert result["success"] is True
        assert (
            result["rms_arcsec"] < 0.01
        ), f"RMS < 0.01 arcsec (実際: {result['rms_arcsec']})"
        assert result["cd"][0][0] == pytest.approx(known_cd[0][0], abs=1e-8)
        assert result["cd"][0][1] == pytest.approx(known_cd[0][1], abs=1e-8)
        assert result["cd"][1][0] == pytest.approx(known_cd[1][0], abs=1e-8)
        assert result["cd"][1][1] == pytest.approx(known_cd[1][1], abs=1e-8)

    def test_crval_convergence_with_offset(self):
        """CRVAL 初期値が 5度ずれても収束。"""
        known_crval = (120.0, 10.0)
        known_cd = [[-5.0e-4, 0.0], [0.0, 5.0e-4]]
        img_w, img_h = 4000, 3000

        test_pixels = [
            {"px": 200, "py": 200},
            {"px": 3800, "py": 200},
            {"px": 200, "py": 2800},
            {"px": 3800, "py": 2800},
            {"px": 2000, "py": 1500},
        ]

        star_pairs = _make_star_pairs(known_crval, known_cd, img_w, img_h, test_pixels)
        fitter = WCSFitter(star_pairs, img_w, img_h)
        result = fitter.solve()

        assert result["success"] is True
        assert (
            result["rms_arcsec"] < 0.1
        ), f"RMS < 0.1 arcsec (実際: {result['rms_arcsec']})"
        assert result["crval1"] == pytest.approx(known_crval[0], abs=0.01)
        assert result["crval2"] == pytest.approx(known_crval[1], abs=0.01)

    def test_rotated_cd_matrix(self):
        """回転した CD 行列のフィット。"""
        angle = math.radians(30.0)
        scale = 3.0e-4
        known_crval = (45.0, 60.0)
        known_cd = [
            [-scale * math.cos(angle), scale * math.sin(angle)],
            [-scale * math.sin(angle), -scale * math.cos(angle)],
        ]
        img_w, img_h = 5000, 3000

        test_pixels = [
            {"px": 500, "py": 500},
            {"px": 4500, "py": 500},
            {"px": 500, "py": 2500},
            {"px": 4500, "py": 2500},
            {"px": 2500, "py": 1500},
            {"px": 1500, "py": 1000},
        ]

        star_pairs = _make_star_pairs(known_crval, known_cd, img_w, img_h, test_pixels)
        fitter = WCSFitter(star_pairs, img_w, img_h)
        result = fitter.solve()

        assert result["success"] is True
        assert (
            result["rms_arcsec"] < 0.01
        ), f"RMS < 0.01 arcsec (実際: {result['rms_arcsec']})"
        assert result["cd"][0][0] == pytest.approx(known_cd[0][0], abs=1e-7)
        assert result["cd"][0][1] == pytest.approx(known_cd[0][1], abs=1e-7)
        assert result["cd"][1][0] == pytest.approx(known_cd[1][0], abs=1e-7)
        assert result["cd"][1][1] == pytest.approx(known_cd[1][1], abs=1e-7)

    def test_pixel_scale(self):
        """ピクセルスケールの検証。"""
        scale = 2.0e-4
        known_crval = (0.0, 0.0)
        known_cd = [[-scale, 0.0], [0.0, scale]]
        img_w, img_h = 2000, 2000

        test_pixels = [
            {"px": 200, "py": 200},
            {"px": 1800, "py": 200},
            {"px": 200, "py": 1800},
            {"px": 1800, "py": 1800},
        ]

        star_pairs = _make_star_pairs(known_crval, known_cd, img_w, img_h, test_pixels)
        fitter = WCSFitter(star_pairs, img_w, img_h)
        result = fitter.solve()

        assert result["success"] is True
        assert result["pixel_scale_arcsec"] == pytest.approx(scale * 3600.0, abs=0.01)
