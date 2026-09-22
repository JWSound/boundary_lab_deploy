import type { EqualizerConfiguration, SourceConfiguration } from "./types";

type Complex = [number, number];
const mul = ([a,b]: Complex, [c,d]: Complex): Complex => [a*c-b*d, a*d+b*c];
const div = ([a,b]: Complex, [c,d]: Complex): Complex => [(a*c+b*d)/(c*c+d*d), (b*c-a*d)/(c*c+d*d)];

export function parseEqualizer(value: unknown): EqualizerConfiguration {
  if (value === undefined) return { filters: [] };
  if (!value || typeof value !== "object") throw new Error("Invalid equalizer");
  const bank = value as EqualizerConfiguration;
  if (!Array.isArray(bank.filters) || bank.filters.length > 64 || (bank.bypassed !== undefined && typeof bank.bypassed !== "boolean")) throw new Error("Invalid equalizer bank");
  const ids = new Set<string>();
  const filters = bank.filters.map(raw => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid filter");
    const f = { ...raw };
    if (typeof f.id !== "string" || !f.id.trim() || ids.has(f.id)) throw new Error("Filter ids must be nonempty and unique within a bank");
    ids.add(f.id);
    if (!["peq", "lowpass", "highpass", "low-shelf", "high-shelf", "allpass"].includes(f.type) || typeof f.enabled !== "boolean") throw new Error("Invalid filter type/enabled");
    for (const [key, low, high] of [["frequencyHz",1,100000],["gainDb",-60,60],["q",0.05,100]] as const) {
      if (typeof f[key] !== "number" || !Number.isFinite(f[key]) || f[key] < low || f[key] > high) throw new Error(`Invalid filter ${key}`);
    }
    if (f.type === "lowpass" || f.type === "highpass") {
      if (f.family === undefined) f.family = "butterworth";
      if (f.order === undefined) f.order = 2;
      if (!["butterworth", "linkwitz-riley"].includes(f.family) || !Number.isInteger(f.order) || f.order < 1 || f.order > 8 || (f.family === "linkwitz-riley" && f.order % 2 !== 0)) throw new Error("Invalid crossover family/order");
    } else if (f.family !== undefined || f.order !== undefined) throw new Error("family/order only apply to crossovers");
    return f;
  });
  return { filters, ...(bank.bypassed === undefined ? {} : { bypassed: bank.bypassed }) };
}

export function equalizerResponse(bank: EqualizerConfiguration, frequencyHz: number): Complex {
  if (!Number.isFinite(frequencyHz) || frequencyHz < 0) throw new Error("Evaluation frequency must be finite and nonnegative");
  let result: Complex = [1,0];
  if (bank.bypassed) return result;
  for (const f of bank.filters) {
    if (!f.enabled) continue;
    const x = frequencyHz/f.frequencyHz, a = 10 ** (f.gainDb/40), q = f.q;
    let h: Complex;
    if (f.type === "lowpass" || f.type === "highpass") {
      const lr = f.family === "linkwitz-riley", order = f.order ?? 2, n = lr ? order/2 : order;
      h = n % 2 ? div(f.type === "lowpass" ? [1,0] : [0,x], [1,x]) : [1,0];
      for (let k=0; k<Math.floor(n/2); k++) h = mul(h, div(f.type === "lowpass" ? [1,0] : [-x*x,0], [1-x*x, 2*Math.sin((2*k+1)*Math.PI/(2*n))*x]));
      if (lr) h = mul(h,h);
    } else if (f.type === "peq") h = div([1-x*x,a/q*x],[1-x*x,x/(a*q)]);
    else if (f.type === "allpass") h = div([1-x*x,-x/q],[1-x*x,x/q]);
    else if (f.type === "low-shelf") h = div([a*(a-x*x),a*Math.sqrt(a)/q*x],[1-a*x*x,Math.sqrt(a)/q*x]);
    else h = div([a*(1-a*x*x),a*Math.sqrt(a)/q*x],[a-x*x,Math.sqrt(a)/q*x]);
    result = mul(result,h);
  }
  return result;
}

export function sourceDrive(source: SourceConfiguration, frequencyHz: number): Complex {
  const h = mul(equalizerResponse(source.equalizer, frequencyHz), equalizerResponse(source.channelEqualizer ?? { filters: [] }, frequencyHz));
  if (source.muted) return [0,0];
  const level = source.polarity * 10 ** (source.levelDb/20), phase = -2*Math.PI*frequencyHz*source.delayMs/1000;
  return mul([level*Math.cos(phase),level*Math.sin(phase)],h);
}
