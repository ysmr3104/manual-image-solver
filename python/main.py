#!/usr/bin/env python3
"""ManualImageSolver - 手動プレートソルブ Python GUI

Usage:
    python main.py [--input IMAGE_FILE] [--output JSON_PATH]
"""

import argparse
import sys


def main():
    parser = argparse.ArgumentParser(
        description="ManualImageSolver - 手動プレートソルブ GUI"
    )
    parser.add_argument(
        "--input",
        type=str,
        default=None,
        help="起動時に開く画像ファイル（.fits, .fit, .xisf）",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="WCS JSON 出力先パス（PJSR連携用）",
    )
    parser.add_argument(
        "--restore",
        type=str,
        default=None,
        help="前回セッションのWCS JSONパス（星ペア復元用）",
    )
    args = parser.parse_args()

    from PyQt6.QtWidgets import QApplication

    app = QApplication(sys.argv)
    app.setApplicationName("ManualImageSolver")

    from gui.main_window import MainWindow

    window = MainWindow(output_path=args.output)
    window.show()

    # 起動引数で画像を開く
    if args.input:
        try:
            from core.image_loader import load_image
            from core.auto_stretch import auto_stretch

            data, metadata = load_image(args.input)
            rgb_data = metadata.get("rgb_data")
            if rgb_data is not None:
                display = auto_stretch(data, rgb_data=rgb_data)
            else:
                display = auto_stretch(data)

            window._image_data = data
            window._display_data = display
            window._image_path = args.input
            window._image_width = metadata["width"]
            window._image_height = metadata["height"]

            window.file_edit.setText(args.input)
            window.image_info_label.setText(
                f"({metadata['width']} x {metadata['height']} px)"
            )
            window.image_viewer.set_image(data, display)
            window._update_buttons()
            window._update_status()
        except Exception as e:
            print(f"画像読み込みエラー: {e}", file=sys.stderr)

    # 星ペア復元
    if args.restore and args.input:
        try:
            from wcs_io.wcs_json import load_wcs_json

            restore_data = load_wcs_json(args.restore)
            for sp in restore_data.get("star_pairs", []):
                window._star_pairs.append(
                    {
                        "px": sp["px"],
                        "py": sp["py"],
                        "ra": sp["ra"],
                        "dec": sp["dec"],
                        "name": sp.get("name", ""),
                    }
                )
            window._refresh_all()
            print(
                f"前回の星ペアを復元しました: {len(restore_data.get('star_pairs', []))} 個",
                file=sys.stderr,
            )
        except Exception as e:
            print(f"星ペア復元エラー: {e}", file=sys.stderr)

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
