export const KG_TO_LB = 2.20462;
export const round1 = (x) => (x == null || Number.isNaN(+x) ? null : Math.round(+x * 10) / 10);
export const kgToLb = (kg) => round1(kg * KG_TO_LB);
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
