"""matplotlib 画像ビューア（PyQt6 埋め込み）"""

import numpy as np
from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg, NavigationToolbar2QT
from matplotlib.figure import Figure
from PyQt6.QtWidgets import QWidget, QVBoxLayout
from PyQt6.QtCore import pyqtSignal


class ImageViewer(QWidget):
    """matplotlib imshow + クリック/ズーム/パン ビューア"""

    # クリックシグナル: (x, y) 0-based ピクセル座標
    image_clicked = pyqtSignal(float, float)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._image_data = None
        self._display_data = None
        self._star_markers = []  # [(x, y, name, index)]
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        # matplotlib Figure
        self.figure = Figure(figsize=(8, 6), dpi=100)
        self.figure.set_facecolor("#2b2b2b")
        self.canvas = FigureCanvasQTAgg(self.figure)
        self.ax = self.figure.add_subplot(111)
        self.ax.set_facecolor("#1a1a1a")
        self.ax.set_aspect("equal")

        # ナビゲーションツールバー
        self.toolbar = NavigationToolbar2QT(self.canvas, self)

        layout.addWidget(self.toolbar)
        layout.addWidget(self.canvas)

        # クリックイベント
        self.canvas.mpl_connect("button_press_event", self._on_click)

    def set_image(self, image_data, display_data=None):
        """画像データをセット

        Args:
            image_data: 2D numpy array (生データ)
            display_data: 2D numpy array (ストレッチ済み表示データ、Noneなら自動)
        """
        self._image_data = image_data
        if display_data is not None:
            self._display_data = display_data
        else:
            self._display_data = image_data

        self.ax.clear()
        if self._display_data.ndim == 3:
            self.ax.imshow(
                self._display_data,
                origin="upper",
                interpolation="nearest",
                aspect="equal",
            )
        else:
            self.ax.imshow(
                self._display_data,
                cmap="gray",
                origin="upper",
                interpolation="nearest",
                aspect="equal",
            )
        self.ax.set_xlabel("X (px)")
        self.ax.set_ylabel("Y (px)")
        self._redraw_markers()
        self.figure.tight_layout()
        self.canvas.draw()

    def set_star_markers(self, star_pairs, wcs_result=None):
        """星マーカーを設定"""
        self._star_markers = []
        for i, star in enumerate(star_pairs):
            name = star.get("name", f"Star {i + 1}") or f"Star {i + 1}"
            self._star_markers.append((star["px"], star["py"], name, i))

        if self._display_data is not None:
            self._redraw_markers()
            self.canvas.draw()

    def _redraw_markers(self):
        """マーカーを再描画（既存のアーティストを除去して再追加）"""
        # 既存マーカーの除去（imshow以外のアーティストを除去）
        artists_to_remove = []
        for artist in self.ax.lines + self.ax.texts:
            artists_to_remove.append(artist)
        for artist in artists_to_remove:
            artist.remove()
        # scatter も除去
        while len(self.ax.collections) > 0:
            self.ax.collections[0].remove()

        for x, y, name, idx in self._star_markers:
            # 赤十字
            marker_size = 15
            self.ax.plot(
                [x - marker_size, x + marker_size],
                [y, y],
                color="red",
                linewidth=1.0,
                alpha=0.8,
            )
            self.ax.plot(
                [x, x],
                [y - marker_size, y + marker_size],
                color="red",
                linewidth=1.0,
                alpha=0.8,
            )
            # 緑円
            circle = self.ax.plot([], [], color="lime", linewidth=1.0, alpha=0.7)
            theta = np.linspace(0, 2 * np.pi, 50)
            radius = 12
            cx = x + radius * np.cos(theta)
            cy = y + radius * np.sin(theta)
            self.ax.plot(cx, cy, color="lime", linewidth=1.0, alpha=0.7)
            # 黄番号
            self.ax.text(
                x + marker_size + 3,
                y - marker_size - 3,
                str(idx + 1),
                color="yellow",
                fontsize=9,
                fontweight="bold",
                alpha=0.9,
            )

    def _on_click(self, event):
        """マウスクリックイベント"""
        # ツールバーのモードチェック（ズーム/パン中はスキップ）
        if self.toolbar.mode != "":
            return
        # 画像領域外はスキップ
        if event.inaxes != self.ax:
            return
        if event.xdata is None or event.ydata is None:
            return
        # 左クリックのみ
        if event.button != 1:
            return

        self.image_clicked.emit(float(event.xdata), float(event.ydata))

    def fit_to_window(self):
        """画像全体を表示"""
        if self._display_data is not None:
            h, w = self._display_data.shape[:2]
            self.ax.set_xlim(-0.5, w - 0.5)
            self.ax.set_ylim(h - 0.5, -0.5)
            self.canvas.draw()
