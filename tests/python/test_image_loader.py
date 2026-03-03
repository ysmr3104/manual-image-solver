"""画像読み込みのテスト"""

import numpy as np
import pytest
import tempfile
import os
from astropy.io import fits
from core.image_loader import load_image


class TestLoadImage:
    def test_load_fits_mono(self):
        """モノクロFITS読み込み"""
        with tempfile.NamedTemporaryFile(suffix=".fits", delete=False) as f:
            data = np.random.uniform(0, 1, (100, 200)).astype(np.float32)
            hdu = fits.PrimaryHDU(data)
            hdu.writeto(f.name, overwrite=True)

            result_data, metadata = load_image(f.name)
            assert result_data.shape == (100, 200)
            assert metadata["width"] == 200
            assert metadata["height"] == 100
            os.unlink(f.name)

    def test_load_fits_rgb(self):
        """RGB FITS読み込み（ルミナンス変換）"""
        with tempfile.NamedTemporaryFile(suffix=".fits", delete=False) as f:
            data = np.random.uniform(0, 1, (3, 100, 200)).astype(np.float32)
            hdu = fits.PrimaryHDU(data)
            hdu.writeto(f.name, overwrite=True)

            result_data, metadata = load_image(f.name)
            assert result_data.shape == (100, 200)
            assert result_data.ndim == 2
            os.unlink(f.name)

    def test_unsupported_format(self):
        """未対応フォーマットでエラー"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(b"dummy")
            with pytest.raises(ValueError):
                load_image(f.name)
            os.unlink(f.name)

    def test_file_not_found(self):
        """存在しないファイルでエラー"""
        with pytest.raises(FileNotFoundError):
            load_image("/nonexistent/file.fits")
