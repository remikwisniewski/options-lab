// @ts-check
// Standard normal distribution. The CDF uses Hart's double-precision rational
// approximation (as published by Graeme West, "Better approximations to cumulative
// normal functions", 2005), accurate to about 1e-14 across the whole real line.

const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/**
 * Standard normal density φ(x).
 *
 * @param {number} x
 */
export function normPdf(x) {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/**
 * Standard normal cumulative distribution Φ(x).
 *
 * @param {number} x
 */
export function normCdf(x) {
  const z = Math.abs(x);
  let tail = 0;

  if (z <= 37) {
    const e = Math.exp(-0.5 * z * z);
    if (z < 7.07106781186547) {
      let num = 3.52624965998911e-2 * z + 0.700383064443688;
      num = num * z + 6.37396220353165;
      num = num * z + 33.912866078383;
      num = num * z + 112.079291497871;
      num = num * z + 221.213596169931;
      num = num * z + 220.206867912376;
      let den = 8.83883476483184e-2 * z + 1.75566716318264;
      den = den * z + 16.064177579207;
      den = den * z + 86.7807322029461;
      den = den * z + 296.564248779674;
      den = den * z + 637.333633378831;
      den = den * z + 793.826512519948;
      den = den * z + 440.413735824752;
      tail = (e * num) / den;
    } else {
      // Continued fraction for the far tail.
      let cf = z + 0.65;
      cf = z + 4 / cf;
      cf = z + 3 / cf;
      cf = z + 2 / cf;
      cf = z + 1 / cf;
      tail = e / cf / 2.506628274631;
    }
  }

  return x > 0 ? 1 - tail : tail;
}
