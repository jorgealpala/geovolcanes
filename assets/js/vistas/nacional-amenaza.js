// Panorama nacional: zonas de amenaza de todos los volcanes en el mapa y tabla de
// departamentos y municipios en amenaza. Lee data/nacional/amenaza.pmtiles y
// data/nacional/territorio.json (generados por exportar_web.py en el proyecto de calculo).
/* global maplibregl */

import { absoluta, RUTAS } from "../datos.js";
import { entero, decimal, esc, descargarCSV } from "../formato.js";
import { AMENAZA, NIVELES } from "../constantes.js";

// Modos del mapa: "todas" (nivel mas severo en cada punto), un nivel, o "ninguna".
export const MODOS_MAPA = ["todas", ...NIVELES, "ninguna"];

const BORDE = { alta: "#7a1710", media: "#a8470f", baja: "#8a6b00" };
const colorPorNivel = (paleta) => ["match", ["get", "nivel"], "alta", paleta.alta, "media", paleta.media, paleta.baja];
const PALETA = { alta: AMENAZA.alta.color, media: AMENAZA.media.color, baja: AMENAZA.baja.color };
const ORDEN_SEV = { alta: 0, media: 1, baja: 2 };

// --------------------------------------------------------------------------- mapa
export function agregarCapasAmenaza(map, { porCodigo, modo, antesDe, alAbrirPopup = () => {} }) {
  map.addSource("amz-nac", {
    type: "vector", url: `pmtiles://${absoluta(RUTAS.nacionalAmenaza)}`,
    attribution: "Amenaza: Servicio Geológico Colombiano",
  });
  const comun = { source: "amz-nac" };
  map.addLayer({ ...comun, id: "amz-nac-todos", type: "fill", "source-layer": "todos",
    paint: { "fill-color": colorPorNivel(PALETA), "fill-opacity": 0.42, "fill-antialias": false } }, antesDe);
  map.addLayer({ ...comun, id: "amz-nac-nivel", type: "fill", "source-layer": "nivel",
    paint: { "fill-color": colorPorNivel(PALETA), "fill-opacity": 0.48, "fill-antialias": false } }, antesDe);
  map.addLayer({ ...comun, id: "amz-nac-borde", type: "line", "source-layer": "borde",
    paint: {
      "line-color": colorPorNivel(BORDE), "line-opacity": 0.85,
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 8, 1, 11, 1.6],
    } }, antesDe);
  // Capa invisible con la zona de cada volcan: solo sirve para identificar al hacer clic.
  map.addLayer({ ...comun, id: "amz-nac-zona", type: "fill", "source-layer": "zona",
    paint: { "fill-color": "#000", "fill-opacity": 0 } }, antesDe);

  let modoActual = modo;
  function fijarModo(m) {
    modoActual = m;
    const vis = (id, si) => map.setLayoutProperty(id, "visibility", si ? "visible" : "none");
    vis("amz-nac-todos", m === "todas");
    vis("amz-nac-nivel", NIVELES.includes(m));
    vis("amz-nac-borde", m !== "ninguna");
    vis("amz-nac-zona", m !== "ninguna");
    const filtro = NIVELES.includes(m) ? ["==", ["get", "nivel"], m] : null;
    map.setFilter("amz-nac-nivel", filtro);
    map.setFilter("amz-nac-borde", filtro);
    map.setFilter("amz-nac-zona", filtro);
  }
  fijarModo(modo);

  // Clic sobre una zona: que volcanes y niveles cubren ese punto.
  let popup = null;
  const alClic = (e) => {
    if (modoActual === "ninguna") return;
    const feats = map.queryRenderedFeatures(e.point, { layers: ["amz-nac-zona"] });
    const vistos = new Map();
    for (const f of feats) {
      const { cod, nivel } = f.properties;
      const prev = vistos.get(cod);
      if (!prev || ORDEN_SEV[nivel] < ORDEN_SEV[prev]) vistos.set(cod, nivel);
    }
    if (!vistos.size) return;
    const filas = [...vistos].sort((a, b) => ORDEN_SEV[a[1]] - ORDEN_SEV[b[1]] || a[0].localeCompare(b[0]));
    popup?.remove();
    alAbrirPopup();
    popup = new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(`<div class="popup">
      <h4>Zona de amenaza volcánica</h4>
      <table>${filas.map(([cod, nivel]) => `<tr>
        <td>${esc(porCodigo.get(cod)?.nombre || cod)}</td>
        <td><span class="etiqueta"><span class="punto" style="background:${AMENAZA[nivel].color}"></span>${AMENAZA[nivel].nombre}</span></td>
        <td><a href="#/exposicion?v=${cod}&nivel=${nivel}">Ver</a></td></tr>`).join("")}</table>
      <div class="nota" style="margin-top:6px">Mapas de amenaza del SGC. "Ver" abre la exposición de ese volcán y nivel.</div>
    </div>`).addTo(map);
  };
  map.on("click", alClic);
  map.on("mousemove", "amz-nac-zona", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "amz-nac-zona", () => { map.getCanvas().style.cursor = ""; });

  return { fijarModo, quitarPopup: () => popup?.remove() };
}

// --------------------------------------------------------------------------- tabla
export function montarTablaTerritorio(raiz, datos, { porCodigo, nivel, alCambiarNivel, alVerMunicipio }) {
  const resumen = datos.resumen;
  const mpios = datos.municipios;
  const nombreVolcan = (c) => porCodigo.get(c)?.nombre || c;
  let filtro = nivel;          // "cualquiera" | "alta" | "media" | "baja"
  let busqueda = "";
  const abiertos = new Set();
  const normal = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  raiz.innerHTML = `
    <div class="barra-herramientas">
      <div>
        <h3>Departamentos y municipios en zona de amenaza</h3>
        <div class="nota">Municipios cuyo territorio toca la zona de amenaza de al menos uno de los ${resumen.cualquiera.volcanes} volcanes
        con mapa del SGC. Un municipio cuenta en cada nivel que toca, así que la suma de niveles supera el total.</div>
      </div>
      <div class="flex">
        <div class="segmentado" role="group" aria-label="Nivel de amenaza de la tabla" id="f-terr">
          <button data-v="cualquiera">Cualquier nivel</button>
          ${NIVELES.map((n) => `<button data-v="${n}"><span class="muestra" style="background:${AMENAZA[n].color}"></span>${AMENAZA[n].nombre}</button>`).join("")}
        </div>
        <div class="buscador"><input class="campo" type="search" id="buscar-terr" placeholder="Buscar municipio o departamento" aria-label="Buscar municipio o departamento"></div>
        <button class="boton boton--chico" id="csv-terr">Descargar CSV</button>
      </div>
    </div>
    <div class="territorio">
      <div class="territorio__resumen">
        <table class="tabla tabla--resumen" id="t-terr-resumen">
          <thead><tr><th>Nivel</th><th class="num">Departamentos</th><th class="num">Municipios</th></tr></thead>
          <tbody></tbody>
          <tfoot></tfoot>
        </table>
        <p class="nota">Se cuenta el municipio si al menos ${decimal(datos.umbral_km2 * 100)} ha de su territorio están en la zona.
        Los porcentajes son la parte del área municipal en cada nivel; pueden sumar más de 100 %
        donde se superponen las zonas de dos volcanes. Clic en una fila para filtrar el mapa y el detalle.
        ${resumen.cualquiera.areas_litigio ? `Las áreas en litigio entre departamentos (${resumen.cualquiera.areas_litigio}) se listan en el detalle, pero no se cuentan.` : ""}</p>
      </div>
      <div class="tabla-contenedor territorio__detalle">
        <table class="tabla" id="t-terr">
          <thead><tr>
            <th>Departamento · municipio</th>
            <th class="num">Municipios</th>
            ${NIVELES.map((n) => `<th class="num col-${n}">${AMENAZA[n].nombre}</th>`).join("")}
            <th>Volcanes</th>
            <th></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;

  const tbRes = raiz.querySelector("#t-terr-resumen tbody");
  const tfRes = raiz.querySelector("#t-terr-resumen tfoot");
  const tb = raiz.querySelector("#t-terr tbody");

  function dibujarResumen() {
    tbRes.innerHTML = NIVELES.map((n) => `
      <tr class="clicable${filtro === n ? " seleccionada" : ""}" data-v="${n}">
        <td><span class="etiqueta"><span class="punto" style="background:${AMENAZA[n].color}"></span>${AMENAZA[n].nombre}</span></td>
        <td class="num">${entero(resumen[n].departamentos)}</td>
        <td class="num">${entero(resumen[n].municipios)}</td>
      </tr>`).join("");
    tfRes.innerHTML = `<tr class="clicable${filtro === "cualquiera" ? " seleccionada" : ""}" data-v="cualquiera">
        <td>Cualquier nivel <span class="secundario">(distintos)</span></td>
        <td class="num">${entero(resumen.cualquiera.departamentos)}</td>
        <td class="num">${entero(resumen.cualquiera.municipios)}</td></tr>`;
  }

  const enFiltro = (m) => filtro === "cualquiera" || !!m.niveles[filtro];
  const coincide = (m) => !busqueda || normal(m.mpio).includes(busqueda) || normal(m.dpto).includes(busqueda);
  const volcanesDe = (m, n = null) => [...new Set(
    Object.entries(m.niveles).filter(([k]) => !n || k === n).flatMap(([, v]) => Object.keys(v.volcanes)))];

  function celdaNivel(m, n) {
    const v = m.niveles[n];
    if (!v) return `<td class="num vacio">—</td>`;
    const pct = v.pct >= 99.95 ? "100" : (v.pct < 0.1 ? "<0,1" : decimal(v.pct));
    return `<td class="num" title="${decimal(v.km2)} km² de ${decimal(m.area_km2)} km² del municipio · ${volcanesDe(m, n).map(nombreVolcan).join(", ")}">
      <span class="marca-nivel" style="--c:${AMENAZA[n].color}"></span>${pct} %</td>`;
  }

  function dibujarDetalle() {
    const lista = mpios.filter((m) => enFiltro(m) && coincide(m));
    const grupos = new Map();
    for (const m of lista) {
      if (!grupos.has(m.dpto)) grupos.set(m.dpto, []);
      grupos.get(m.dpto).push(m);
    }
    const ordenados = [...grupos].sort((a, b) => {
      const la = a[1][0].litigio, lb = b[1][0].litigio;
      return (la - lb) || (b[1].length - a[1].length) || a[0].localeCompare(b[0], "es");
    });
    const abrirTodo = !!busqueda;
    tb.innerHTML = ordenados.map(([dpto, ms]) => {
      const abierto = abrirTodo || abiertos.has(dpto);
      const litigio = ms[0].litigio;
      const cuenta = (n) => ms.filter((m) => m.niveles[n]).length;
      const vols = [...new Set(ms.flatMap((m) => volcanesDe(m, filtro === "cualquiera" ? null : filtro)))];
      const cab = `<tr class="fila-dpto clicable" data-dpto="${esc(dpto)}" aria-expanded="${abierto}">
        <td><span class="flecha">${abierto ? "▾" : "▸"}</span><strong>${esc(dpto)}</strong></td>
        <td class="num"><strong>${litigio ? "—" : entero(ms.length)}</strong></td>
        ${NIVELES.map((n) => `<td class="num col-${n}">${cuenta(n) ? entero(cuenta(n)) : "—"}</td>`).join("")}
        <td class="secundario">${vols.map(nombreVolcan).join(", ")}</td>
        <td></td></tr>`;
      if (!abierto) return cab;
      return cab + ms.map((m) => `<tr class="fila-mpio">
        <td><span class="sangria"></span>${esc(m.mpio)} <span class="secundario">${m.cod}</span></td>
        <td></td>
        ${NIVELES.map((n) => celdaNivel(m, n)).join("")}
        <td class="secundario">${volcanesDe(m, filtro === "cualquiera" ? null : filtro).map(nombreVolcan).join(", ")}</td>
        <td><button class="boton boton--chico" data-ver="${m.cod}">Ver en mapa</button></td></tr>`).join("");
    }).join("") || `<tr><td colspan="7" class="secundario">Ningún municipio coincide con la búsqueda.</td></tr>`;
    raiz.querySelectorAll("#t-terr .col-alta, #t-terr .col-media, #t-terr .col-baja").forEach((c) =>
      c.classList.toggle("col-activa", c.classList.contains(`col-${filtro}`)));
  }

  function fijarNivel(n, { avisar = false } = {}) {
    filtro = n;
    raiz.querySelectorAll("#f-terr button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === n)));
    dibujarResumen();
    dibujarDetalle();
    if (avisar) alCambiarNivel(n);
  }

  raiz.querySelector("#f-terr").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (b) fijarNivel(b.dataset.v, { avisar: true });
  });
  raiz.querySelector("#t-terr-resumen").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-v]");
    if (tr) fijarNivel(tr.dataset.v, { avisar: true });
  });
  raiz.querySelector("#buscar-terr").addEventListener("input", (e) => { busqueda = normal(e.target.value.trim()); dibujarDetalle(); });
  tb.addEventListener("click", (e) => {
    const ver = e.target.closest("button[data-ver]");
    if (ver) { alVerMunicipio(mpios.find((m) => m.cod === ver.dataset.ver)); return; }
    const tr = e.target.closest("tr.fila-dpto");
    if (!tr || busqueda) return;
    const d = tr.dataset.dpto;
    abiertos.has(d) ? abiertos.delete(d) : abiertos.add(d);
    dibujarDetalle();
  });
  raiz.querySelector("#csv-terr").addEventListener("click", () => {
    const filas = mpios.filter(enFiltro);
    const col = [
      { titulo: "codigo_dane", valor: "cod" }, { titulo: "municipio", valor: "mpio" },
      { titulo: "departamento", valor: "dpto" }, { titulo: "area_municipio_km2", valor: "area_km2" },
    ];
    for (const n of NIVELES) {
      col.push({ titulo: `${n}_km2`, valor: (m) => m.niveles[n]?.km2 ?? "" });
      col.push({ titulo: `${n}_pct_municipio`, valor: (m) => m.niveles[n]?.pct ?? "" });
      col.push({ titulo: `${n}_volcanes`, valor: (m) => volcanesDe(m, n).map(nombreVolcan).join(", ") });
    }
    col.push({ titulo: "area_en_litigio", valor: (m) => (m.litigio ? "si" : "no") });
    descargarCSV(`geovolcanes_municipios_en_amenaza_${filtro}.csv`, col, filas);
  });

  fijarNivel(filtro);
  return { fijarNivel };
}
