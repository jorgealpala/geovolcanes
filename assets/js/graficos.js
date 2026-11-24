// Graficos con Apache ECharts: tema comun (marcas finas, rejilla tenue,
// tooltip en todas las graficas) y ciclo de vida ligado a la vista.
/* global echarts */

import { entero } from "./formato.js";

const TEXTO = "#14181f";
const TEXTO_2 = "#4a5260";
const TEXTO_3 = "#6f7785";
const REJILLA = "#eef0f3";

export const BASE = {
  textStyle: { fontFamily: '"Segoe UI", system-ui, -apple-system, Arial, sans-serif', color: TEXTO_2, fontSize: 12 },
  animationDuration: 400,
  grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
  legend: { top: 0, right: 0, icon: "roundRect", itemWidth: 12, itemHeight: 12, itemGap: 16, textStyle: { color: TEXTO_2 } },
  tooltip: {
    backgroundColor: "#ffffff", borderColor: "#e3e6eb", borderWidth: 1, padding: [8, 12],
    textStyle: { color: TEXTO, fontSize: 12.5 },
    extraCssText: "box-shadow:0 4px 16px rgba(16,24,40,.12);border-radius:8px;",
  },
};

export function ejeValor(extra = {}) {
  return {
    type: "value",
    axisLine: { show: false }, axisTick: { show: false },
    splitLine: { lineStyle: { color: REJILLA } },
    axisLabel: { color: TEXTO_3, formatter: (v) => compactoEje(v) },
    nameTextStyle: { color: TEXTO_3, align: "left" },
    ...extra,
  };
}

export function ejeCategoria(datos, extra = {}) {
  return {
    type: "category", data: datos,
    axisLine: { lineStyle: { color: "#cdd2da" } }, axisTick: { show: false },
    axisLabel: { color: TEXTO_2 },
    ...extra,
  };
}

function compactoEje(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString("es-CO", { maximumFractionDigits: 0 })} mil`;
  return v.toLocaleString("es-CO", { maximumFractionDigits: 1 });
}

export function filaTooltip(color, nombre, valor) {
  return `<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;min-width:180px">
    <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:${color}"></span>${nombre}</span>
    <b style="font-variant-numeric:tabular-nums">${valor}</b></div>`;
}

// Gestor: crea graficos asociados a una vista y los libera al salir.
export class Graficos {
  constructor() {
    this.lista = new Set();
    this.obs = new ResizeObserver((entradas) => {
      for (const e of entradas) echarts.getInstanceByDom(e.target)?.resize();
    });
  }
  crear(el, opcion) {
    let g = echarts.getInstanceByDom(el);
    if (!g) {
      g = echarts.init(el, null, { renderer: "svg" });
      this.lista.add(g);
      this.obs.observe(el);
    }
    g.setOption({ ...BASE, ...opcion, tooltip: { ...BASE.tooltip, ...(opcion.tooltip || {}) },
      legend: opcion.legend === false ? { show: false } : { ...BASE.legend, ...(opcion.legend || {}) },
      grid: { ...BASE.grid, ...(opcion.grid || {}) } }, true);
    return g;
  }
  liberar() {
    this.obs.disconnect();
    for (const g of this.lista) g.dispose();
    this.lista.clear();
  }
}

export const fmtTooltipEntero = (v) => entero(v);
