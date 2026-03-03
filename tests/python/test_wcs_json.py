"""WCS JSON 入出力のテスト"""

import json
import os
import tempfile

import pytest

from wcs_io.wcs_json import save_wcs_json, load_wcs_json, _sanitize_floats_for_pjsr


class TestSanitizeFloats:
    def test_zero(self):
        assert _sanitize_floats_for_pjsr(0.0) == 0.0

    def test_normal_float(self):
        result = _sanitize_floats_for_pjsr(83.633212)
        assert isinstance(result, float)
        assert abs(result - 83.633212) < 1e-6

    def test_small_float(self):
        """科学表記になりそうな小数"""
        result = _sanitize_floats_for_pjsr(1.23e-6)
        assert isinstance(result, float)

    def test_dict(self):
        result = _sanitize_floats_for_pjsr({"a": 1.23456789012345, "b": "text"})
        assert isinstance(result["a"], float)
        assert result["b"] == "text"

    def test_list(self):
        result = _sanitize_floats_for_pjsr([1.0, 2.0, 3.0])
        assert len(result) == 3

    def test_non_float(self):
        assert _sanitize_floats_for_pjsr(42) == 42
        assert _sanitize_floats_for_pjsr("hello") == "hello"
        assert _sanitize_floats_for_pjsr(None) is None


class TestSaveLoadWcsJson:
    def _make_wcs_result(self):
        return {
            "success": True,
            "crval1": 83.633212,
            "crval2": 22.014501,
            "crpix1": 3012.5,
            "crpix2": 2012.5,
            "cd": [[-0.00035, 0.00001], [0.00001, 0.00035]],
            "pixel_scale_arcsec": 1.26,
            "rms_arcsec": 0.19,
            "residuals": [
                {"name": "Betelgeuse", "residual_arcsec": 0.23},
                {"name": "Rigel", "residual_arcsec": 0.15},
                {"name": "Sirius", "residual_arcsec": 0.18},
                {"name": "Vega", "residual_arcsec": 0.20},
            ],
            "message": "WCS フィット成功",
        }

    def _make_star_pairs(self):
        return [
            {
                "name": "Betelgeuse",
                "px": 1234.56,
                "py": 2345.67,
                "ra": 88.793,
                "dec": 7.407,
            },
            {
                "name": "Rigel",
                "px": 3456.78,
                "py": 1234.56,
                "ra": 78.634,
                "dec": -8.202,
            },
            {
                "name": "Sirius",
                "px": 2345.67,
                "py": 3456.78,
                "ra": 101.287,
                "dec": -16.716,
            },
            {
                "name": "Vega",
                "px": 4567.89,
                "py": 2345.67,
                "ra": 279.235,
                "dec": 38.784,
            },
        ]

    def test_roundtrip(self):
        """保存→読み込みの往復テスト"""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w") as f:
            filepath = f.name

        try:
            wcs_result = self._make_wcs_result()
            image_info = {"filename": "test.fits", "width": 6024, "height": 4024}
            star_pairs = self._make_star_pairs()

            save_wcs_json(filepath, wcs_result, image_info, star_pairs)
            loaded = load_wcs_json(filepath)

            assert loaded["version"] == "1.0.0"
            assert loaded["image"]["width"] == 6024
            assert loaded["wcs"]["ctype1"] == "RA---TAN"
            assert abs(loaded["wcs"]["crval1"] - 83.633212) < 1e-6
            assert len(loaded["star_pairs"]) == 4
            assert loaded["star_pairs"][0]["name"] == "Betelgeuse"
            assert loaded["fit_quality"]["num_stars"] == 4
        finally:
            os.unlink(filepath)

    def test_no_scientific_notation(self):
        """JSONに科学表記が含まれないことを確認"""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w") as f:
            filepath = f.name

        try:
            wcs_result = self._make_wcs_result()
            wcs_result["cd"] = [[-3.5e-4, 1.0e-5], [1.0e-5, 3.5e-4]]
            image_info = {"filename": "test.fits", "width": 6024, "height": 4024}
            star_pairs = self._make_star_pairs()

            save_wcs_json(filepath, wcs_result, image_info, star_pairs)

            with open(filepath) as f:
                content = f.read()

            import re

            sci_matches = re.findall(r"-?\d+\.?\d*[eE][+-]?\d+", content)
            assert len(sci_matches) == 0, f"科学表記が残っています: {sci_matches}"
        finally:
            os.unlink(filepath)

    def test_load_invalid_version(self):
        """不正バージョンでエラー"""
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w") as f:
            json.dump({"version": "2.0.0"}, f)
            filepath = f.name

        try:
            with pytest.raises(ValueError):
                load_wcs_json(filepath)
        finally:
            os.unlink(filepath)

    def test_load_nonexistent(self):
        """存在しないファイルでエラー"""
        with pytest.raises(FileNotFoundError):
            load_wcs_json("/nonexistent/file.json")
