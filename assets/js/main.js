// Punto de entrada: carga el contexto, arma el selector de volcan y enruta
// entre vistas con el hash de la URL (#/vista?v=COD&...). La URL describe el
// estado completo, asi que cualquier vista se puede compartir como enlace.

import { cargarContexto, json, RUTAS } from "./datos.js";
import { esc, fechaHora } from "./formato.js";
import { ALERTA } from "./constantes.js";
import { registrarPMTiles } from "./mapas.js";

const VISTAS = {
  nacional: () => import("./vistas/nacional.js"),
  exposicion: () => import("./vistas/exposicion.js"),
  satelital: () => import("./vistas/satelital.js"),
  hidromet: () => import("./vistas/hidromet.js"),
};
const TITULOS = {
  nacional: "Panorama nacional", exposicion: "Exposición", satelital: "Satelital", hidromet: "Hidrometeorología",
};

const cont = document.getElementById("vista");
const selector = document.getElementById("selector-volcan");
const puntoAlerta = document.getElementById("selector-alerta");
let ctx;
let limpiezaActual = null;
let turno = 0;

function leerRuta() {
  const h = location.hash.replace(/^#\/?/, "");
  const [ruta, query = ""] = h.split("?");
  const params = Object.fromEntries(new URLSearchParams(query));
  return { ruta: VISTAS[ruta] ? ruta : "nacional", params };
}

export function irA(ruta, params = {}, { reemplazar = false } = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const destino = `#/${ruta}${q.toString() ? `?${q}` : ""}`;
  if (destino === location.hash) return;
  if (reemplazar) {
    history.replaceState(null, "", destino);
    renderizar();
  } else {
    location.hash = destino;
  }
}

// Actualiza parametros de la vista actual SIN re-renderizar (filtros).
export function fijarParams(cambios) {
  const { ruta, params } = leerRuta();
  const nuevos = { ...params, ...cambios };
  const q = new URLSearchParams(Object.entries(nuevos).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  history.replaceState(null, "", `#/${ruta}${q.toString() ? `?${q}` : ""}`);
}

function volcanActivo(params) {
  const validos = new Set(ctx.conDatos.map((v) => v.codigo));
  const cand = (params.v || localStorage.getItem("gv_volcan") || "VNR").toUpperCase();
  return validos.has(cand) ? cand : ctx.conDatos[0].codigo;
}

function armarSelector() {
  const grupos = {};
  for (const v of ctx.conDatos) (grupos[v.observatorio] ||= []).push(v);
  const obs = ctx.catalogo.observatorios;
  selector.innerHTML = Object.entries(grupos)
    .map(([o, vs]) => `<optgroup label="${esc(obs[o]?.ciudad ? `Observatorio de ${obs[o].ciudad} (${o})` : o)}">
      ${vs.sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((v) => `<option value="${v.codigo}">${esc(v.nombre)} · ${v.codigo}</option>`).join("")}
    </optgroup>`).join("");
  selector.addEventListener("change", () => {
    const { ruta, params } = leerRuta();
    localStorage.setItem("gv_volcan", selector.value);
    irA(ruta, { ...params, v: selector.value, mpio: undefined });
  });
}

function marcarSelector(cod) {
  selector.value = cod;
  const v = ctx.porCodigo.get(cod);
  puntoAlerta.style.background = ALERTA[v?.nivel_actividad]?.color || "#9aa1ad";
  puntoAlerta.title = v ? `Alerta ${ALERTA[v.nivel_actividad]?.nombre || ""}: ${ALERTA[v.nivel_actividad]?.desc || ""}` : "";
}

// Cambia el volcan activo sin redibujar la vista (la vista actualiza lo suyo).
function seleccionar(cod) {
  localStorage.setItem("gv_volcan", cod);
  marcarSelector(cod);
  fijarParams({ v: cod });
  document.querySelectorAll(".barra__nav a").forEach((a) => { a.href = `#/${a.dataset.ruta}?v=${cod}`; });
}

async function renderizar() {
  const mio = ++turno;
  const { ruta, params } = leerRuta();
  const cod = volcanActivo(params);
  localStorage.setItem("gv_volcan", cod);
  marcarSelector(cod);
  document.querySelectorAll(".barra__nav a").forEach((a) => {
    a.classList.toggle("activo", a.dataset.ruta === ruta);
    a.href = `#/${a.dataset.ruta}?v=${cod}`;
    if (a.dataset.ruta === ruta) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  document.title = `${TITULOS[ruta]} · ${ctx.porCodigo.get(cod)?.nombre || ""} · GeoVolcanes-SCR`;

  if (limpiezaActual) { try { limpiezaActual(); } catch (e) { console.warn(e); } limpiezaActual = null; }
  cont.innerHTML = '<div class="cargando" role="status"><span class="girador"></span> Cargando…</div>';
  try {
    const modulo = await VISTAS[ruta]();
    if (mio !== turno) return;
    cont.innerHTML = "";
    const limpiar = await modulo.render(cont, { ...ctx, cod, volcan: ctx.porCodigo.get(cod), params, irA, fijarParams, seleccionar });
    if (mio !== turno) { limpiar?.(); return; }
    limpiezaActual = limpiar || null;
  } catch (err) {
    console.error(err);
    if (mio === turno) {
      cont.innerHTML = `<div class="aviso aviso--error"><span class="icono">!</span><div><strong>No se pudo cargar esta vista.</strong><br>${esc(err.message)}</div></div>`;
    }
  }
}

async function iniciar() {
  try {
    registrarPMTiles();
    ctx = await cargarContexto();
  } catch (err) {
    cont.innerHTML = `<div class="aviso aviso--error"><span class="icono">!</span><div><strong>No se pudieron leer los datos del portal.</strong><br>${esc(err.message)}<br>
      Si abrió el archivo con doble clic, sírvalo por HTTP: <code>python scripts/servidor_local.py</code></div></div>`;
    return;
  }
  armarSelector();
  const pie = document.getElementById("pie-fechas");
  const hid = await json(RUTAS.hidrometIndice).catch(() => null);
  pie.innerHTML = `Exposición calculada: ${esc(fechaHora(ctx.indice.generado))}` +
    (hid ? ` · Lluvia satelital: ${esc(fechaHora(hid.generado))}` : "");
  window.addEventListener("hashchange", renderizar);
  if (!location.hash) history.replaceState(null, "", "#/nacional");
  renderizar();
}

iniciar();
