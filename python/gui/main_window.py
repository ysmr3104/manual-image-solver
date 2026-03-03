"""ManualImageSolver メインウィンドウ"""

import os
from pathlib import Path

from PyQt6.QtWidgets import (
    QMainWindow,
    QWidget,
    QHBoxLayout,
    QVBoxLayout,
    QPushButton,
    QLabel,
    QLineEdit,
    QFileDialog,
    QMessageBox,
    QStatusBar,
    QSplitter,
)
from PyQt6.QtCore import Qt

from gui.image_viewer import ImageViewer
from gui.star_table import StarTable
from gui.star_dialog import StarEditDialog

VERSION = "1.0.0"


class MainWindow(QMainWindow):
    """ManualImageSolver メインウィンドウ"""

    def __init__(self, output_path=None):
        super().__init__()

        # PJSR連携モード（--output 指定時）
        self._output_path = output_path
        self._pjsr_mode = output_path is not None

        title = f"ManualImageSolver v{VERSION}"
        if self._pjsr_mode:
            title += " (PixInsight連携)"
        self.setWindowTitle(title)
        self.setMinimumSize(1200, 800)

        # 状態
        self._image_data = None  # 2D numpy array (生データ)
        self._display_data = None  # ストレッチ済み
        self._image_path = None
        self._image_width = 0
        self._image_height = 0
        self._star_pairs = []  # [{"px", "py", "ra", "dec", "name"}]
        self._wcs_result = None

        self._setup_ui()
        self._connect_signals()
        self._update_buttons()

    def _setup_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)

        # --- ファイル選択バー ---
        file_layout = QHBoxLayout()
        file_layout.addWidget(QLabel("File:"))
        self.file_edit = QLineEdit()
        self.file_edit.setReadOnly(True)
        file_layout.addWidget(self.file_edit)
        self.open_button = QPushButton("Open...")
        if self._pjsr_mode:
            self.open_button.setVisible(False)
        file_layout.addWidget(self.open_button)
        self.image_info_label = QLabel()
        file_layout.addWidget(self.image_info_label)
        main_layout.addLayout(file_layout)

        # --- メインエリア: ImageViewer + StarTable ---
        splitter = QSplitter(Qt.Orientation.Horizontal)

        self.image_viewer = ImageViewer()
        splitter.addWidget(self.image_viewer)

        self.star_table = StarTable()
        splitter.addWidget(self.star_table)

        splitter.setStretchFactor(0, 3)  # ImageViewer: 3
        splitter.setStretchFactor(1, 1)  # StarTable: 1

        main_layout.addWidget(splitter)

        # --- ボタンバー ---
        button_layout = QHBoxLayout()
        button_layout.addStretch()

        self.solve_button = QPushButton("Solve")
        self.solve_button.setToolTip("WCS をフィッティング（4星以上必要）")
        button_layout.addWidget(self.solve_button)

        if self._pjsr_mode:
            # PJSR連携モード: Apply & Close / Cancel
            self.apply_close_button = QPushButton("Apply && Close")
            self.apply_close_button.setToolTip(
                "WCS結果をJSONに保存してウィンドウを閉じる"
            )
            button_layout.addWidget(self.apply_close_button)

            self.cancel_button = QPushButton("Cancel")
            self.cancel_button.setToolTip("WCS を適用せずに終了")
            button_layout.addWidget(self.cancel_button)

            # 通常モード用ボタンは非表示で作成（_update_buttons で参照されるため）
            self.export_json_button = QPushButton("Export JSON")
            self.export_json_button.setVisible(False)
            self.write_fits_button = QPushButton("Write FITS")
            self.write_fits_button.setVisible(False)
            self.close_button = QPushButton("Close")
            self.close_button.setVisible(False)
        else:
            # 通常モード: Export JSON / Write FITS / Close
            self.export_json_button = QPushButton("Export JSON")
            self.export_json_button.setToolTip("WCS結果をJSONで保存")
            button_layout.addWidget(self.export_json_button)

            self.write_fits_button = QPushButton("Write FITS")
            self.write_fits_button.setToolTip("WCS付きFITSを出力")
            button_layout.addWidget(self.write_fits_button)

            self.close_button = QPushButton("Close")
            button_layout.addWidget(self.close_button)

        main_layout.addLayout(button_layout)

        # --- ステータスバー ---
        self.status_bar = QStatusBar()
        self.setStatusBar(self.status_bar)
        if self._pjsr_mode:
            self.status_bar.showMessage(
                "星をクリックして座標を入力 → Solve → Apply & Close"
            )
        else:
            self.status_bar.showMessage("画像を開いてください")

    def _connect_signals(self):
        self.open_button.clicked.connect(self._on_open)
        self.solve_button.clicked.connect(self._on_solve)

        if self._pjsr_mode:
            self.apply_close_button.clicked.connect(self._on_apply_close)
            self.cancel_button.clicked.connect(self._on_cancel)
        else:
            self.close_button.clicked.connect(self.close)
            self.export_json_button.clicked.connect(self._on_export_json)
            self.write_fits_button.clicked.connect(self._on_write_fits)

        # ImageViewer クリック → 星追加
        self.image_viewer.image_clicked.connect(self._on_image_click)

        # StarTable シグナル
        self.star_table.star_edit_requested.connect(self._on_edit_star)
        self.star_table.star_remove_requested.connect(self._on_remove_star)
        self.star_table.clear_requested.connect(self._on_clear_stars)

    def _update_buttons(self):
        has_image = self._image_data is not None
        has_enough_stars = len(self._star_pairs) >= 4
        has_wcs = self._wcs_result is not None and self._wcs_result.get("success")

        self.solve_button.setEnabled(has_image and has_enough_stars)

        if self._pjsr_mode:
            self.apply_close_button.setEnabled(has_wcs)
        else:
            self.export_json_button.setEnabled(has_wcs)
            self.write_fits_button.setEnabled(has_wcs and has_image)

    def _update_status(self):
        parts = []
        if self._wcs_result and self._wcs_result.get("success"):
            parts.append(f"RMS={self._wcs_result['rms_arcsec']:.2f}\"")
            parts.append(f"Scale={self._wcs_result['pixel_scale_arcsec']:.3f}\"/px")
        parts.append(f"{len(self._star_pairs)} stars")
        self.status_bar.showMessage(" / ".join(parts))

    # --- ファイル操作 ---

    def _on_open(self):
        filepath, _ = QFileDialog.getOpenFileName(
            self,
            "画像ファイルを開く",
            "",
            "画像ファイル (*.fits *.fit *.xisf);;All Files (*)",
        )
        if not filepath:
            return

        try:
            from core.image_loader import load_image
            from core.auto_stretch import auto_stretch

            data, metadata = load_image(filepath)
            rgb_data = metadata.get("rgb_data")
            if rgb_data is not None:
                display = auto_stretch(data, rgb_data=rgb_data)
            else:
                display = auto_stretch(data)

            self._image_data = data
            self._display_data = display
            self._image_path = filepath
            self._image_width = metadata["width"]
            self._image_height = metadata["height"]

            self.file_edit.setText(filepath)
            self.image_info_label.setText(
                f"({self._image_width} x {self._image_height} px)"
            )

            self.image_viewer.set_image(data, display)

            # 星リストをクリア
            self._star_pairs.clear()
            self._wcs_result = None
            self.star_table.refresh(self._star_pairs)
            self._update_buttons()
            self._update_status()

        except Exception as e:
            QMessageBox.critical(self, "読み込みエラー", str(e))

    # --- 星操作 ---

    def _on_image_click(self, x, y):
        """画像クリック → セントロイド → ダイアログ"""
        if self._image_data is None:
            return

        # セントロイド計算
        try:
            from core.centroid import compute_centroid

            centroid = compute_centroid(self._image_data, x, y, radius=10)
            if centroid is not None:
                cx, cy = centroid
            else:
                cx, cy = x, y
        except ImportError:
            cx, cy = x, y

        # canvas からフォーカスを解放してダイアログに移す
        self.image_viewer.canvas.clearFocus()

        # StarEditDialog
        star_data = {"px": cx, "py": cy, "ra": None, "dec": None, "name": ""}
        dialog = StarEditDialog(
            self, star_index=len(self._star_pairs) + 1, star_data=star_data
        )
        if dialog.exec() == StarEditDialog.DialogCode.Accepted:
            self._star_pairs.append(dialog.get_star_data())
            self._wcs_result = None
            self._refresh_all()

    def _on_edit_star(self, index):
        if index < 0 or index >= len(self._star_pairs):
            return
        star = self._star_pairs[index]
        star_copy = dict(star)
        dialog = StarEditDialog(self, star_index=index + 1, star_data=star_copy)
        if dialog.exec() == StarEditDialog.DialogCode.Accepted:
            self._star_pairs[index] = dialog.get_star_data()
            self._wcs_result = None
            self._refresh_all()

    def _on_remove_star(self, index):
        if index < 0 or index >= len(self._star_pairs):
            return
        self._star_pairs.pop(index)
        self._wcs_result = None
        self._refresh_all()

    def _on_clear_stars(self):
        self._star_pairs.clear()
        self._wcs_result = None
        self._refresh_all()

    def _refresh_all(self):
        """テーブル、マーカー、ボタン、ステータスを一括更新"""
        self.star_table.refresh(self._star_pairs, self._wcs_result)
        self.image_viewer.set_star_markers(self._star_pairs, self._wcs_result)
        self._update_buttons()
        self._update_status()

    # --- Solve ---

    def _on_solve(self):
        if len(self._star_pairs) < 4:
            QMessageBox.warning(self, "不足", "最低4つの星ペアが必要です。")
            return

        try:
            from core.wcs_math import WCSFitter

            fitter = WCSFitter(self._star_pairs, self._image_width, self._image_height)
            self._wcs_result = fitter.solve()

            if self._wcs_result["success"]:
                self._refresh_all()
                QMessageBox.information(
                    self,
                    "Solve 成功",
                    self._wcs_result["message"],
                )
            else:
                QMessageBox.warning(
                    self,
                    "Solve 失敗",
                    self._wcs_result["message"],
                )
        except Exception as e:
            QMessageBox.critical(self, "エラー", str(e))

    # --- Export JSON ---

    def _on_export_json(self):
        if not self._wcs_result or not self._wcs_result.get("success"):
            return

        # デフォルトファイル名
        default_name = ""
        if self._image_path:
            stem = Path(self._image_path).stem
            default_name = f"{stem}.wcs.json"

        filepath, _ = QFileDialog.getSaveFileName(
            self,
            "WCS JSON を保存",
            default_name,
            "JSON Files (*.json);;All Files (*)",
        )
        if not filepath:
            return

        try:
            from wcs_io.wcs_json import save_wcs_json

            image_info = {
                "filename": os.path.basename(self._image_path or ""),
                "width": self._image_width,
                "height": self._image_height,
            }
            save_wcs_json(filepath, self._wcs_result, image_info, self._star_pairs)
            self.status_bar.showMessage(f"JSON を保存しました: {filepath}")
        except Exception as e:
            QMessageBox.critical(self, "保存エラー", str(e))

    # --- Write FITS ---

    def _on_write_fits(self):
        if not self._wcs_result or not self._wcs_result.get("success"):
            return
        if self._image_data is None:
            return

        default_name = ""
        if self._image_path:
            stem = Path(self._image_path).stem
            default_name = f"{stem}_wcs.fits"

        filepath, _ = QFileDialog.getSaveFileName(
            self,
            "WCS付きFITSを保存",
            default_name,
            "FITS Files (*.fits);;All Files (*)",
        )
        if not filepath:
            return

        try:
            from astropy.io import fits
            from astropy.wcs import WCS

            wcs = WCS(naxis=2)
            wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
            wcs.wcs.crval = [
                self._wcs_result["crval1"],
                self._wcs_result["crval2"],
            ]
            wcs.wcs.crpix = [
                self._wcs_result["crpix1"],
                self._wcs_result["crpix2"],
            ]
            wcs.wcs.cd = [
                self._wcs_result["cd"][0],
                self._wcs_result["cd"][1],
            ]
            wcs.wcs.cunit = ["deg", "deg"]

            header = wcs.to_header()
            header["RADESYS"] = "ICRS"
            header["EQUINOX"] = 2000.0
            header["PLTSOLVD"] = True

            hdu = fits.PrimaryHDU(data=self._image_data, header=header)
            hdu.writeto(filepath, overwrite=True)

            self.status_bar.showMessage(f"FITS を保存しました: {filepath}")
        except Exception as e:
            QMessageBox.critical(self, "保存エラー", str(e))

    # --- PJSR連携モード ---

    def _on_apply_close(self):
        """Solve 済みの WCS を JSON に保存して終了（PJSR連携モード）"""
        if not self._wcs_result or not self._wcs_result.get("success"):
            return

        try:
            from wcs_io.wcs_json import save_wcs_json

            image_info = {
                "filename": os.path.basename(self._image_path or ""),
                "width": self._image_width,
                "height": self._image_height,
            }
            save_wcs_json(
                self._output_path, self._wcs_result, image_info, self._star_pairs
            )
            print(f"WCS JSON を保存しました: {self._output_path}")
            import sys

            sys.exit(0)
        except Exception as e:
            QMessageBox.critical(self, "保存エラー", str(e))

    def _on_cancel(self):
        """WCS を適用せずに終了（PJSR連携モード）"""
        import sys

        sys.exit(1)
