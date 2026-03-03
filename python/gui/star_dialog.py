"""星座標入力ダイアログ（QDialog）"""

import re
from PyQt6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QGroupBox,
    QLabel,
    QLineEdit,
    QPushButton,
    QDialogButtonBox,
    QMessageBox,
)
from PyQt6.QtCore import Qt


def ra_to_hms(ra_deg):
    """RA (度) → "HH MM SS.ss" 形式に変換"""
    ra = ra_deg % 360.0
    total_sec = ra / 15.0 * 3600.0
    h = int(total_sec / 3600.0)
    total_sec -= h * 3600.0
    m = int(total_sec / 60.0)
    s = total_sec - m * 60.0
    return f"{h:02d} {m:02d} {s:05.2f}"


def dec_to_dms(dec_deg):
    """DEC (度) → "+DD MM SS.s" 形式に変換"""
    sign = "+" if dec_deg >= 0 else "-"
    dec = abs(dec_deg)
    total_sec = dec * 3600.0
    d = int(total_sec / 3600.0)
    total_sec -= d * 3600.0
    m = int(total_sec / 60.0)
    s = total_sec - m * 60.0
    return f"{sign}{d:02d} {m:02d} {s:04.1f}"


def parse_ra_input(text):
    """RA入力をパース（HMS "HH MM SS.ss" / "HH:MM:SS.ss" または度数）"""
    text = text.strip()
    if not text:
        return None
    parts = re.split(r"[\s:]+", text)
    if len(parts) >= 3:
        try:
            h, m, s = float(parts[0]), float(parts[1]), float(parts[2])
            return (h + m / 60.0 + s / 3600.0) * 15.0
        except ValueError:
            pass
    try:
        return float(text)
    except ValueError:
        return None


def parse_dec_input(text):
    """DEC入力をパース（DMS "±DD MM SS.ss" / "±DD:MM:SS.ss" または度数）"""
    text = text.strip()
    if not text:
        return None
    sign = 1
    if text[0] == "-":
        sign = -1
        text = text[1:]
    elif text[0] == "+":
        text = text[1:]
    parts = re.split(r"[\s:]+", text)
    if len(parts) >= 3:
        try:
            d, m, s = float(parts[0]), float(parts[1]), float(parts[2])
            return sign * (d + m / 60.0 + s / 3600.0)
        except ValueError:
            pass
    try:
        return sign * float(text)
    except ValueError:
        return None


class StarEditDialog(QDialog):
    """星座標入力ダイアログ"""

    def __init__(self, parent=None, star_index=1, star_data=None, sesame_resolver=None):
        super().__init__(parent)
        self.star_data = star_data or {
            "px": None,
            "py": None,
            "ra": None,
            "dec": None,
            "name": "",
        }
        self.sesame_resolver = sesame_resolver
        self.setWindowTitle(f"Reference Star #{star_index}")
        self.setMinimumWidth(420)
        self.setWindowModality(Qt.WindowModality.ApplicationModal)
        self._setup_ui()
        self._populate_fields()
        self.name_edit.setFocus(Qt.FocusReason.TabFocusReason)

    def _setup_ui(self):
        layout = QVBoxLayout(self)

        # --- ピクセル座標 ---
        pixel_group = QGroupBox("ピクセル座標")
        pixel_layout = QHBoxLayout()

        pixel_layout.addWidget(QLabel("X:"))
        self.px_edit = QLineEdit()
        self.px_edit.setFixedWidth(100)
        self.px_edit.setToolTip("画像上の X 座標（0-based）")
        pixel_layout.addWidget(self.px_edit)

        pixel_layout.addSpacing(8)
        pixel_layout.addWidget(QLabel("Y:"))
        self.py_edit = QLineEdit()
        self.py_edit.setFixedWidth(100)
        self.py_edit.setToolTip("画像上の Y 座標（0-based）")
        pixel_layout.addWidget(self.py_edit)
        pixel_layout.addStretch()

        pixel_group.setLayout(pixel_layout)
        layout.addWidget(pixel_group)

        # --- 天体座標 ---
        coord_group = QGroupBox("天体座標")
        coord_layout = QVBoxLayout()

        # 天体名 + 検索
        name_layout = QHBoxLayout()
        name_layout.addWidget(QLabel("天体名:"))
        self.name_edit = QLineEdit()
        self.name_edit.setToolTip("天体名を入力して Search（例: Sirius, Vega, M42）")
        name_layout.addWidget(self.name_edit)
        self.search_button = QPushButton("Search")
        self.search_button.setToolTip("CDS Sesame で天体名から座標を検索")
        self.search_button.clicked.connect(self._on_search)
        name_layout.addWidget(self.search_button)
        coord_layout.addLayout(name_layout)

        # RA
        ra_layout = QHBoxLayout()
        ra_label = QLabel("RA:")
        ra_label.setFixedWidth(60)
        ra_label.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )
        ra_layout.addWidget(ra_label)
        self.ra_edit = QLineEdit()
        self.ra_edit.setToolTip("HH MM SS.ss / HH:MM:SS.ss / 度数")
        ra_layout.addWidget(self.ra_edit)
        ra_layout.addWidget(QLabel("(HH MM SS / degrees)"))
        coord_layout.addLayout(ra_layout)

        # DEC
        dec_layout = QHBoxLayout()
        dec_label = QLabel("DEC:")
        dec_label.setFixedWidth(60)
        dec_label.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )
        dec_layout.addWidget(dec_label)
        self.dec_edit = QLineEdit()
        self.dec_edit.setToolTip("+DD MM SS.s / +DD:MM:SS.s / 度数")
        dec_layout.addWidget(self.dec_edit)
        dec_layout.addWidget(QLabel("(+DD MM SS / degrees)"))
        coord_layout.addLayout(dec_layout)

        coord_group.setLayout(coord_layout)
        layout.addWidget(coord_group)

        # --- ボタン ---
        button_box = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        button_box.accepted.connect(self._on_accept)
        button_box.rejected.connect(self.reject)
        layout.addWidget(button_box)

    def _populate_fields(self):
        """既存データをフィールドにセット"""
        if self.star_data["px"] is not None:
            self.px_edit.setText(f"{self.star_data['px']:.2f}")
        if self.star_data["py"] is not None:
            self.py_edit.setText(f"{self.star_data['py']:.2f}")
        if self.star_data.get("name"):
            self.name_edit.setText(self.star_data["name"])
        if self.star_data["ra"] is not None:
            self.ra_edit.setText(ra_to_hms(self.star_data["ra"]))
        if self.star_data["dec"] is not None:
            self.dec_edit.setText(dec_to_dms(self.star_data["dec"]))

    def _on_search(self):
        """Sesame 天体名検索"""
        name = self.name_edit.text().strip()
        if not name:
            QMessageBox.warning(self, "検索エラー", "天体名を入力してください。")
            return

        if self.sesame_resolver is None:
            try:
                from core.sesame_resolver import resolve

                self.sesame_resolver = resolve
            except ImportError:
                QMessageBox.warning(
                    self, "検索エラー", "Sesame resolver が利用できません。"
                )
                return

        result = self.sesame_resolver(name)
        if result is not None:
            self.ra_edit.setText(ra_to_hms(result["ra"]))
            self.dec_edit.setText(dec_to_dms(result["dec"]))
            self.star_data["ra"] = result["ra"]
            self.star_data["dec"] = result["dec"]
            self.star_data["name"] = name
        else:
            QMessageBox.warning(
                self,
                "検索エラー",
                f"'{name}' が見つかりませんでした。\nRA/DEC を直接入力してください。",
            )

    def _on_accept(self):
        """OKボタン: バリデーション + データ更新"""
        # ピクセル座標
        try:
            px = float(self.px_edit.text())
            py = float(self.py_edit.text())
        except ValueError:
            QMessageBox.warning(
                self, "入力エラー", "ピクセル座標 X, Y を正しく入力してください。"
            )
            return

        # RA/DEC
        ra = parse_ra_input(self.ra_edit.text())
        dec = parse_dec_input(self.dec_edit.text())
        if ra is None or dec is None:
            QMessageBox.warning(
                self, "入力エラー", "RA と DEC を正しく入力してください。"
            )
            return
        if ra < 0 or ra >= 360:
            QMessageBox.warning(
                self, "入力エラー", "RA は 0〜360 度の範囲で入力してください。"
            )
            return
        if dec < -90 or dec > 90:
            QMessageBox.warning(
                self, "入力エラー", "DEC は -90〜+90 度の範囲で入力してください。"
            )
            return

        self.star_data["px"] = px
        self.star_data["py"] = py
        self.star_data["ra"] = ra
        self.star_data["dec"] = dec
        self.star_data["name"] = self.name_edit.text().strip()
        self.accept()

    def get_star_data(self):
        """入力された星データを取得"""
        return self.star_data
