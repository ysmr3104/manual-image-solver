//============================================================================
// wcs_math.js - WCS Math Library
//
// Provides TAN (gnomonic) projection, CD matrix fitting, and centroid computation.
// Pure JavaScript compatible with both PJSR and Node.js.
//
// Copyright (c) 2024-2025 Split Image Solver Project
//============================================================================

// Math is available by default in both PJSR and Node.js environments.

//----------------------------------------------------------------------------
// TAN (gnomonic) projection: celestial coordinates -> standard coordinates
//   crval: [ra0, dec0] in degrees
//   coord: [ra, dec] in degrees
//   Returns: [xi, eta] in degrees
//----------------------------------------------------------------------------
function tanProject(crval, coord) {
   var ra0  = crval[0] * Math.PI / 180.0;
   var dec0 = crval[1] * Math.PI / 180.0;
   var ra   = coord[0] * Math.PI / 180.0;
   var dec  = coord[1] * Math.PI / 180.0;

   var cosDec  = Math.cos(dec);
   var sinDec  = Math.sin(dec);
   var cosDec0 = Math.cos(dec0);
   var sinDec0 = Math.sin(dec0);
   var dRA     = ra - ra0;
   var cosDRA  = Math.cos(dRA);

   var D = sinDec0 * sinDec + cosDec0 * cosDec * cosDRA;
   if (D <= 0) {
      return null; // Cannot project (opposite hemisphere)
   }

   var xi  = (cosDec * Math.sin(dRA)) / D * (180.0 / Math.PI);
   var eta = (cosDec0 * sinDec - sinDec0 * cosDec * cosDRA) / D * (180.0 / Math.PI);

   return [xi, eta];
}

//----------------------------------------------------------------------------
// TAN inverse projection: standard coordinates -> celestial coordinates
//   crval: [ra0, dec0] in degrees
//   standard: [xi, eta] in degrees
//   Returns: [ra, dec] in degrees
//----------------------------------------------------------------------------
function tanDeproject(crval, standard) {
   var ra0  = crval[0] * Math.PI / 180.0;
   var dec0 = crval[1] * Math.PI / 180.0;
   var xi   = standard[0] * Math.PI / 180.0;
   var eta  = standard[1] * Math.PI / 180.0;

   var rho = Math.sqrt(xi * xi + eta * eta);

   if (rho === 0) {
      return [crval[0], crval[1]];
   }

   var c = Math.atan(rho);
   var cosC = Math.cos(c);
   var sinC = Math.sin(c);
   var cosDec0 = Math.cos(dec0);
   var sinDec0 = Math.sin(dec0);

   var dec = Math.asin(cosC * sinDec0 + eta * sinC * cosDec0 / rho);
   var ra  = ra0 + Math.atan2(xi * sinC, rho * cosDec0 * cosC - eta * sinDec0 * sinC);

   // Normalize RA to 0-360
   var raDeg = ra * 180.0 / Math.PI;
   while (raDeg < 0) raDeg += 360.0;
   while (raDeg >= 360.0) raDeg -= 360.0;

   return [raDeg, dec * 180.0 / Math.PI];
}

//----------------------------------------------------------------------------
// Angular separation (Vincenty formula)
//   coord1, coord2: [ra, dec] in degrees
//   Returns: angular separation in degrees
//----------------------------------------------------------------------------
function angularSeparation(coord1, coord2) {
   var ra1  = coord1[0] * Math.PI / 180.0;
   var dec1 = coord1[1] * Math.PI / 180.0;
   var ra2  = coord2[0] * Math.PI / 180.0;
   var dec2 = coord2[1] * Math.PI / 180.0;

   var dRA = ra2 - ra1;
   var cosDec1 = Math.cos(dec1);
   var sinDec1 = Math.sin(dec1);
   var cosDec2 = Math.cos(dec2);
   var sinDec2 = Math.sin(dec2);

   var num1 = cosDec2 * Math.sin(dRA);
   var num2 = cosDec1 * sinDec2 - sinDec1 * cosDec2 * Math.cos(dRA);
   var den  = sinDec1 * sinDec2 + cosDec1 * cosDec2 * Math.cos(dRA);

   return Math.atan2(Math.sqrt(num1 * num1 + num2 * num2), den) * 180.0 / Math.PI;
}

//----------------------------------------------------------------------------
// WCSFitter: Fit a TAN projection WCS from star pairs
//
//   starPairs: array of [{px, py, ra, dec, name}] (requires 4 or more)
//   imageWidth, imageHeight: image dimensions in pixels
//----------------------------------------------------------------------------
function WCSFitter(starPairs, imageWidth, imageHeight) {
   this.stars = starPairs;
   this.width = imageWidth;
   this.height = imageHeight;
   // CRPIX is the image center (FITS 1-based)
   this.crpix1 = imageWidth / 2.0 + 0.5;
   this.crpix2 = imageHeight / 2.0 + 0.5;
}

WCSFitter.prototype.solve = function () {
   var stars = this.stars;
   var nStars = stars.length;

   if (nStars < 4) {
      return {
         success: false,
         message: "At least 4 star pairs required (current: " + nStars + ")"
      };
   }

   // RA/DEC range check
   for (var i = 0; i < nStars; i++) {
      if (stars[i].ra < 0 || stars[i].ra >= 360) {
         return {
            success: false,
            message: "Star " + (i + 1) + " RA is out of range: " + stars[i].ra
         };
      }
      if (stars[i].dec < -90 || stars[i].dec > 90) {
         return {
            success: false,
            message: "Star " + (i + 1) + " DEC is out of range: " + stars[i].dec
         };
      }
   }

   var crpix1 = this.crpix1;
   var crpix2 = this.crpix2;

   // --- 1. CRVAL initial value = centroid of star celestial coordinates ---
   var crval1 = 0;
   var crval2 = 0;

   // Average RA using vector mean to handle wraparound
   var sumCosRA = 0, sumSinRA = 0;
   for (var i = 0; i < nStars; i++) {
      var raRad = stars[i].ra * Math.PI / 180.0;
      sumCosRA += Math.cos(raRad);
      sumSinRA += Math.sin(raRad);
      crval2 += stars[i].dec;
   }
   crval1 = Math.atan2(sumSinRA, sumCosRA) * 180.0 / Math.PI;
   if (crval1 < 0) crval1 += 360.0;
   crval2 /= nStars;

   // --- 2-4. Iterate: TAN projection -> CD matrix fit -> CRVAL update ---
   var cd = [[0, 0], [0, 0]];
   var maxIter = 5;

   for (var iter = 0; iter < maxIter; iter++) {
      var crval = [crval1, crval2];

      // Compute standard coordinates via TAN projection
      var projOk = true;
      var xiArr = [];
      var etaArr = [];
      for (var i = 0; i < nStars; i++) {
         var proj = tanProject(crval, [stars[i].ra, stars[i].dec]);
         if (proj === null) {
            projOk = false;
            break;
         }
         xiArr.push(proj[0]);
         etaArr.push(proj[1]);
      }

      if (!projOk) {
         return {
            success: false,
            message: "TAN projection failed (stars may be in the opposite hemisphere)"
         };
      }

      // Pixel offset u, v (relative to CRPIX)
      // Standard FITS coordinate system: y=1 is at the image bottom. fits_y = height - py.
      var uArr = [];
      var vArr = [];
      for (var i = 0; i < nStars; i++) {
         uArr.push((stars[i].px + 1.0) - crpix1);
         vArr.push((this.height - stars[i].py) - crpix2);
      }

      // Compute terms of the normal equations
      var sumUU = 0, sumUV = 0, sumVV = 0;
      var sumUXi = 0, sumVXi = 0;
      var sumUEta = 0, sumVEta = 0;
      for (var i = 0; i < nStars; i++) {
         sumUU += uArr[i] * uArr[i];
         sumUV += uArr[i] * vArr[i];
         sumVV += vArr[i] * vArr[i];
         sumUXi  += uArr[i] * xiArr[i];
         sumVXi  += vArr[i] * xiArr[i];
         sumUEta += uArr[i] * etaArr[i];
         sumVEta += vArr[i] * etaArr[i];
      }

      // Solve CD matrix using Cramer's rule
      var det = sumUU * sumVV - sumUV * sumUV;
      if (Math.abs(det) < 1e-30) {
         return {
            success: false,
            message: "Normal equation determinant is zero (stars may be collinear)"
         };
      }

      cd[0][0] = (sumUXi * sumVV - sumVXi * sumUV) / det;   // CD1_1
      cd[0][1] = (sumUU * sumVXi - sumUV * sumUXi) / det;   // CD1_2
      cd[1][0] = (sumUEta * sumVV - sumVEta * sumUV) / det;  // CD2_1
      cd[1][1] = (sumUU * sumVEta - sumUV * sumUEta) / det;  // CD2_2

      // Update CRVAL: inverse transform CRPIX (image center) -> celestial coords
      // Since the offset at CRPIX is (0, 0), standard coords are also (0, 0)
      // -> CRVAL doesn't change. But if CRPIX is offset from the pixel center, update it.
      // Here we use a fixed CRPIX with fine-tuned CRVAL:
      // Correct CRVAL using the centroid of all star residuals
      var sumDXi = 0, sumDEta = 0;
      for (var i = 0; i < nStars; i++) {
         var predXi  = cd[0][0] * uArr[i] + cd[0][1] * vArr[i];
         var predEta = cd[1][0] * uArr[i] + cd[1][1] * vArr[i];
         sumDXi  += xiArr[i] - predXi;
         sumDEta += etaArr[i] - predEta;
      }
      var meanDXi  = sumDXi / nStars;
      var meanDEta = sumDEta / nStars;

      // Inverse transform residual centroid to celestial coords and update CRVAL
      var newCrval = tanDeproject([crval1, crval2], [meanDXi, meanDEta]);
      crval1 = newCrval[0];
      crval2 = newCrval[1];
   }

   // --- 5. Compute residuals ---
   var crval = [crval1, crval2];
   var residuals = [];
   var totalResidSq = 0;

   for (var i = 0; i < nStars; i++) {
      var u = (stars[i].px + 1.0) - crpix1;
      var v = (this.height - stars[i].py) - crpix2;

      // Standard coordinates predicted by the CD matrix
      var predXi  = cd[0][0] * u + cd[0][1] * v;
      var predEta = cd[1][0] * u + cd[1][1] * v;

      // Inverse transform predicted standard coords -> celestial coords
      var predCoord = tanDeproject(crval, [predXi, predEta]);

      // Angular distance from input coordinates
      var resid = angularSeparation([stars[i].ra, stars[i].dec], predCoord);
      var residArcsec = resid * 3600.0;
      residuals.push({
         name: stars[i].name || ("Star " + (i + 1)),
         residual_arcsec: residArcsec
      });
      totalResidSq += residArcsec * residArcsec;
   }

   var rmsArcsec = Math.sqrt(totalResidSq / nStars);

   // Pixel scale computation (from CD matrix singular values)
   var pixelScaleArcsec = Math.sqrt(Math.abs(cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0])) * 3600.0;

   return {
      success: true,
      crval1: crval1,
      crval2: crval2,
      crpix1: crpix1,
      crpix2: crpix2,
      cd: cd,
      pixelScale_arcsec: pixelScaleArcsec,
      rms_arcsec: rmsArcsec,
      residuals: residuals,
      message: "WCS fit succeeded (RMS: " + rmsArcsec.toFixed(2) + " arcsec, "
         + "pixel scale: " + pixelScaleArcsec.toFixed(3) + " arcsec/px)"
   };
};

//----------------------------------------------------------------------------
// Centroid computation (intensity-weighted center of gravity)
//
// Uses Image.sample(x, y, channel) in the PJSR environment.
// This function is PJSR-only.
//
//   image: PixInsight Image object
//   cx, cy: click position (0-based pixel coordinates)
//   radius: search radius in pixels (default 10)
//   Returns: {x, y} sub-pixel star center, or null on failure
//----------------------------------------------------------------------------
function computeCentroid(image, cx, cy, radius) {
   if (typeof radius === "undefined") radius = 10;

   var x0 = Math.max(0, Math.round(cx) - radius);
   var y0 = Math.max(0, Math.round(cy) - radius);
   var x1 = Math.min(image.width - 1, Math.round(cx) + radius);
   var y1 = Math.min(image.height - 1, Math.round(cy) + radius);

   // Use channel 0 (monochrome or R channel)
   var ch = 0;

   // Collect pixel values within the window for background estimation (median)
   var values = [];
   for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
         values.push(image.sample(x, y, ch));
      }
   }

   if (values.length === 0) return null;

   // Use median as background level
   values.sort(function (a, b) { return a - b; });
   var median = values[Math.floor(values.length / 2)];

   // Intensity-weighted centroid (background subtracted)
   var sumW = 0, sumWX = 0, sumWY = 0;
   for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
         var val = image.sample(x, y, ch) - median;
         if (val > 0) {
            sumW  += val;
            sumWX += val * x;
            sumWY += val * y;
         }
      }
   }

   if (sumW <= 0) return null;

   return {
      x: sumWX / sumW,
      y: sumWY / sumW
   };
}

// Export for Node.js environment (ignored in PJSR)
if (typeof module !== "undefined") {
   module.exports = {
      tanProject: tanProject,
      tanDeproject: tanDeproject,
      angularSeparation: angularSeparation,
      WCSFitter: WCSFitter,
      computeCentroid: computeCentroid
   };
}
