"""星テーブル（QTableWidget）"""

from PyQt6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QTableWidget,
    QTableWidgetItem,
    QPushButton,
    QHeaderView,
    QMessageBox,
    QAbstractItemView,
)
from PyQt6.QtCore import pyqtSignal, Qt

from gui.star_dialog import ra_to_hms, dec_to_dms


class StarTable(QWidget):
    """星テーブルウィジェット"""

    # シグナル
    star_edit_requested = pyqtSignal(int)  # インデックス
    star_remove_requested = pyqtSignal(int)  # インデックス
    clear_requested = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        # テーブル
        self.table = QTableWidget()
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels(
            ["#", "X", "Y", "Name", "RA / DEC", "Residual"]
        )
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.verticalHeader().setVisible(False)

        # カラム幅
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Fixed)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Fixed)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.Fixed)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.Fixed)
        self.table.setColumnWidth(0, 30)
        self.table.setColumnWidth(1, 75)
        self.table.setColumnWidth(2, 75)
        self.table.setColumnWidth(5, 80)

        layout.addWidget(self.table)

        # ボタン
        button_layout = QHBoxLayout()
        self.edit_button = QPushButton("Edit...")
        self.edit_button.setToolTip("選択した星の座標を編集")
        self.edit_button.clicked.connect(self._on_edit)
        button_layout.addWidget(self.edit_button)

        self.remove_button = QPushButton("Remove")
        self.remove_button.setToolTip("選択した星を削除")
        self.remove_button.clicked.connect(self._on_remove)
        button_layout.addWidget(self.remove_button)

        self.clear_button = QPushButton("Clear All")
        self.clear_button.setToolTip("全ての星を削除")
        self.clear_button.clicked.connect(self._on_clear)
        button_layout.addWidget(self.clear_button)

        button_layout.addStretch()
        layout.addLayout(button_layout)

    def refresh(self, star_pairs, wcs_result=None):
        """テーブルを更新"""
        self.table.setRowCount(len(star_pairs))
        for i, star in enumerate(star_pairs):
            # #
            item = QTableWidgetItem(str(i + 1))
            item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            self.table.setItem(i, 0, item)

            # X
            item = QTableWidgetItem(f"{star['px']:.2f}")
            item.setTextAlignment(
                Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
            )
            self.table.setItem(i, 1, item)

            # Y
            item = QTableWidgetItem(f"{star['py']:.2f}")
            item.setTextAlignment(
                Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
            )
            self.table.setItem(i, 2, item)

            # Name
            self.table.setItem(i, 3, QTableWidgetItem(star.get("name", "--") or "--"))

            # RA / DEC
            if star.get("ra") is not None and star.get("dec") is not None:
                coord_text = f"{ra_to_hms(star['ra'])} / {dec_to_dms(star['dec'])}"
            else:
                coord_text = "--"
            self.table.setItem(i, 4, QTableWidgetItem(coord_text))

            # Residual
            if (
                wcs_result
                and wcs_result.get("success")
                and wcs_result.get("residuals")
                and i < len(wcs_result["residuals"])
            ):
                resid = wcs_result["residuals"][i]["residual_arcsec"]
                item = QTableWidgetItem(f'{resid:.2f}"')
                item.setTextAlignment(
                    Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
                )
            else:
                item = QTableWidgetItem("--")
                item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            self.table.setItem(i, 5, item)

    def get_selected_index(self):
        """選択中の行インデックスを返す（未選択時 -1）"""
        rows = self.table.selectionModel().selectedRows()
        if rows:
            return rows[0].row()
        return -1

    def _on_edit(self):
        idx = self.get_selected_index()
        if idx >= 0:
            self.star_edit_requested.emit(idx)

    def _on_remove(self):
        idx = self.get_selected_index()
        if idx >= 0:
            self.star_remove_requested.emit(idx)

    def _on_clear(self):
        reply = QMessageBox.question(
            self,
            "確認",
            "全ての星を削除しますか？",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply == QMessageBox.StandardButton.Yes:
            self.clear_requested.emit()
