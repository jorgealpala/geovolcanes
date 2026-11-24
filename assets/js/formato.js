// Formatos y utilidades de presentacion.

const nf0 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const entero = (v) => (v === null || v === undefined || Number.isNaN(v) ? "—" : nf0.format(Math.round(v)));
export const decimal = (v) => (v === null || v === undefined || Number.isNaN(v) ? "—" : nf1.format(v));

export function compacto(v) {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf1.format(v / 1e6)} M`;
  if (a >= 1e4) return `${nf0.format(v / 1e3)} mil`;
  return nf0.format(v);
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function fecha(iso, conAnio = true) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MESES[m - 1]}${conAnio ? ` ${y}` : ""}`;
}

export function fechaHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });
}

const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en"]);
// "SAN JOSÉ DE CÚCUTA" -> "San José de Cúcuta"; respeta tildes y la "ñ".
export function titulo(txt) {
  if (!txt) return "";
  return txt
    .toLocaleLowerCase("es-CO")
    .split(/(\s+|-|\()/)
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toLocaleUpperCase("es-CO") + p.slice(1)))
    .join("");
}

export function esc(txt) {
  return String(txt ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Descarga un CSV (UTF-8 con BOM para que Excel respete las tildes).
export function descargarCSV(nombre, columnas, filas) {
  const celda = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [columnas.map((c) => celda(c.titulo)).join(";")];
  for (const f of filas) lineas.push(columnas.map((c) => celda(typeof c.valor === "function" ? c.valor(f) : f[c.valor])).join(";"));
  const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

export function html(cadena) {
  const t = document.createElement("template");
  t.innerHTML = cadena.trim();
  return t.content.firstElementChild;
}

export function diasEntre(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export function sumarDias(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function hoyISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
