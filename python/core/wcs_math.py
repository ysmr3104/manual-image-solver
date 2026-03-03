"""WCS 数学関数モジュール — TAN投影、角距離、WCSフィッティング。

javascript/wcs_math.js の Python 1:1 移植。
"""

from __future__ import annotations

import math
from typing import Optional


def tan_project(
    crval: tuple[float, float], coord: tuple[float, float]
) -> Optional[tuple[float, float]]:
    """TAN (gnomonic) 正投影: 天球座標 → 標準座標 (xi, eta)。

    Parameters
    ----------
    crval : (ra0, dec0) 投影中心 [度]
    coord : (ra, dec) 投影対象 [度]

    Returns
    -------
    (xi, eta) [度] または反対半球の場合 None
    """
    ra0 = math.radians(crval[0])
    dec0 = math.radians(crval[1])
    ra = math.radians(coord[0])
    dec = math.radians(coord[1])

    cos_dec = math.cos(dec)
    sin_dec = math.sin(dec)
    cos_dec0 = math.cos(dec0)
    sin_dec0 = math.sin(dec0)
    d_ra = ra - ra0
    cos_dra = math.cos(d_ra)

    D = sin_dec0 * sin_dec + cos_dec0 * cos_dec * cos_dra
    if D <= 0:
        return None  # 投影不可（反対半球）

    xi = (cos_dec * math.sin(d_ra)) / D * math.degrees(1.0)
    eta = (cos_dec0 * sin_dec - sin_dec0 * cos_dec * cos_dra) / D * math.degrees(1.0)

    return (xi, eta)


def tan_deproject(
    crval: tuple[float, float], standard: tuple[float, float]
) -> tuple[float, float]:
    """TAN (gnomonic) 逆投影: 標準座標 (xi, eta) → 天球座標。

    Parameters
    ----------
    crval : (ra0, dec0) 投影中心 [度]
    standard : (xi, eta) 標準座標 [度]

    Returns
    -------
    (ra, dec) [度]  RA は [0, 360) に正規化
    """
    ra0 = math.radians(crval[0])
    dec0 = math.radians(crval[1])
    xi = math.radians(standard[0])
    eta = math.radians(standard[1])

    rho = math.sqrt(xi * xi + eta * eta)

    if rho == 0:
        return (crval[0], crval[1])

    c = math.atan(rho)
    cos_c = math.cos(c)
    sin_c = math.sin(c)
    cos_dec0 = math.cos(dec0)
    sin_dec0 = math.sin(dec0)

    dec = math.asin(cos_c * sin_dec0 + eta * sin_c * cos_dec0 / rho)
    ra = ra0 + math.atan2(xi * sin_c, rho * cos_dec0 * cos_c - eta * sin_dec0 * sin_c)

    # RA を 0-360 に正規化
    ra_deg = math.degrees(ra)
    ra_deg %= 360.0
    if ra_deg < 0:
        ra_deg += 360.0

    return (ra_deg, math.degrees(dec))


def angular_separation(
    coord1: tuple[float, float], coord2: tuple[float, float]
) -> float:
    """2点間の角距離（Vincenty 公式）。

    Parameters
    ----------
    coord1 : (ra1, dec1) [度]
    coord2 : (ra2, dec2) [度]

    Returns
    -------
    角距離 [度]
    """
    ra1 = math.radians(coord1[0])
    dec1 = math.radians(coord1[1])
    ra2 = math.radians(coord2[0])
    dec2 = math.radians(coord2[1])

    d_ra = ra2 - ra1
    cos_dec1 = math.cos(dec1)
    sin_dec1 = math.sin(dec1)
    cos_dec2 = math.cos(dec2)
    sin_dec2 = math.sin(dec2)

    num1 = cos_dec2 * math.sin(d_ra)
    num2 = cos_dec1 * sin_dec2 - sin_dec1 * cos_dec2 * math.cos(d_ra)
    den = sin_dec1 * sin_dec2 + cos_dec1 * cos_dec2 * math.cos(d_ra)

    return math.degrees(math.atan2(math.sqrt(num1 * num1 + num2 * num2), den))


class WCSFitter:
    """星ペアからアフィン WCS (TAN + CD行列) をフィッティングする。

    Parameters
    ----------
    star_pairs : list[dict]
        各要素は {"px": float, "py": float, "ra": float, "dec": float, "name": str}
        px, py は 0-based ピクセル座標。
    image_width : int
    image_height : int
    """

    def __init__(
        self,
        star_pairs: list[dict],
        image_width: int,
        image_height: int,
    ) -> None:
        self.stars = star_pairs
        self.width = image_width
        self.height = image_height
        self.crpix1 = image_width / 2.0 + 0.5
        self.crpix2 = image_height / 2.0 + 0.5

    def solve(self) -> dict:
        """WCS フィットを実行して結果辞書を返す。"""
        stars = self.stars
        n_stars = len(stars)

        if n_stars < 4:
            return {
                "success": False,
                "message": f"最低4つの星ペアが必要です（現在: {n_stars}）",
            }

        # RA/DEC の範囲チェック
        for i, s in enumerate(stars):
            if s["ra"] < 0 or s["ra"] >= 360:
                return {
                    "success": False,
                    "message": f"星 {i + 1} の RA が範囲外です: {s['ra']}",
                }
            if s["dec"] < -90 or s["dec"] > 90:
                return {
                    "success": False,
                    "message": f"星 {i + 1} の DEC が範囲外です: {s['dec']}",
                }

        crpix1 = self.crpix1
        crpix2 = self.crpix2

        # --- 1. CRVAL 初期値 = 星の天球座標重心 ---
        # RA はラップアラウンドを考慮してベクトル平均
        sum_cos_ra = 0.0
        sum_sin_ra = 0.0
        crval2 = 0.0
        for s in stars:
            ra_rad = math.radians(s["ra"])
            sum_cos_ra += math.cos(ra_rad)
            sum_sin_ra += math.sin(ra_rad)
            crval2 += s["dec"]

        crval1 = math.degrees(math.atan2(sum_sin_ra, sum_cos_ra))
        if crval1 < 0:
            crval1 += 360.0
        crval2 /= n_stars

        # --- 2-4. 反復: TAN投影 → CD行列フィット → CRVAL更新 ---
        cd = [[0.0, 0.0], [0.0, 0.0]]
        max_iter = 5

        for _iter in range(max_iter):
            crval = (crval1, crval2)

            # TAN投影で標準座標計算
            xi_arr: list[float] = []
            eta_arr: list[float] = []
            proj_ok = True
            for s in stars:
                proj = tan_project(crval, (s["ra"], s["dec"]))
                if proj is None:
                    proj_ok = False
                    break
                xi_arr.append(proj[0])
                eta_arr.append(proj[1])

            if not proj_ok:
                return {
                    "success": False,
                    "message": "TAN投影に失敗しました（星が反対半球にある可能性）",
                }

            # ピクセルオフセット u, v（CRPIX 基準）
            # X: px は 0-based 左起点、FITS も左起点 → fits_x = px + 1
            # Y: py は 0-based 上起点、FITS は下起点 → fits_y = height - py
            u_arr = [(s["px"] + 1.0) - crpix1 for s in stars]
            v_arr = [(self.height - s["py"]) - crpix2 for s in stars]

            # 正規方程式の各項を計算
            sum_uu = 0.0
            sum_uv = 0.0
            sum_vv = 0.0
            sum_u_xi = 0.0
            sum_v_xi = 0.0
            sum_u_eta = 0.0
            sum_v_eta = 0.0

            for i in range(n_stars):
                sum_uu += u_arr[i] * u_arr[i]
                sum_uv += u_arr[i] * v_arr[i]
                sum_vv += v_arr[i] * v_arr[i]
                sum_u_xi += u_arr[i] * xi_arr[i]
                sum_v_xi += v_arr[i] * xi_arr[i]
                sum_u_eta += u_arr[i] * eta_arr[i]
                sum_v_eta += v_arr[i] * eta_arr[i]

            # クレーメルの公式で CD 行列を解く
            det = sum_uu * sum_vv - sum_uv * sum_uv
            if abs(det) < 1e-30:
                return {
                    "success": False,
                    "message": "正規方程式の行列式がゼロです（星が一直線上にある可能性）",
                }

            cd[0][0] = (sum_u_xi * sum_vv - sum_v_xi * sum_uv) / det  # CD1_1
            cd[0][1] = (sum_uu * sum_v_xi - sum_uv * sum_u_xi) / det  # CD1_2
            cd[1][0] = (sum_u_eta * sum_vv - sum_v_eta * sum_uv) / det  # CD2_1
            cd[1][1] = (sum_uu * sum_v_eta - sum_uv * sum_u_eta) / det  # CD2_2

            # CRVAL 更新
            sum_d_xi = 0.0
            sum_d_eta = 0.0
            for i in range(n_stars):
                pred_xi = cd[0][0] * u_arr[i] + cd[0][1] * v_arr[i]
                pred_eta = cd[1][0] * u_arr[i] + cd[1][1] * v_arr[i]
                sum_d_xi += xi_arr[i] - pred_xi
                sum_d_eta += eta_arr[i] - pred_eta

            mean_d_xi = sum_d_xi / n_stars
            mean_d_eta = sum_d_eta / n_stars

            new_crval = tan_deproject((crval1, crval2), (mean_d_xi, mean_d_eta))
            crval1 = new_crval[0]
            crval2 = new_crval[1]

        # --- 5. 残差計算 ---
        crval = (crval1, crval2)
        residuals = []
        total_resid_sq = 0.0

        for i, s in enumerate(stars):
            u = (s["px"] + 1.0) - crpix1
            v = (self.height - s["py"]) - crpix2

            pred_xi = cd[0][0] * u + cd[0][1] * v
            pred_eta = cd[1][0] * u + cd[1][1] * v

            pred_coord = tan_deproject(crval, (pred_xi, pred_eta))

            resid = angular_separation((s["ra"], s["dec"]), pred_coord)
            resid_arcsec = resid * 3600.0
            residuals.append(
                {
                    "name": s.get("name", f"Star {i + 1}"),
                    "residual_arcsec": resid_arcsec,
                }
            )
            total_resid_sq += resid_arcsec * resid_arcsec

        rms_arcsec = math.sqrt(total_resid_sq / n_stars)
        pixel_scale_arcsec = (
            math.sqrt(abs(cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0])) * 3600.0
        )

        return {
            "success": True,
            "crval1": crval1,
            "crval2": crval2,
            "crpix1": crpix1,
            "crpix2": crpix2,
            "cd": cd,
            "pixel_scale_arcsec": pixel_scale_arcsec,
            "rms_arcsec": rms_arcsec,
            "residuals": residuals,
            "message": (
                f"WCS フィット成功 (RMS: {rms_arcsec:.2f} arcsec, "
                f"ピクセルスケール: {pixel_scale_arcsec:.3f} arcsec/px)"
            ),
        }
