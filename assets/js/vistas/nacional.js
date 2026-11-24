// Vista: Panorama nacional. Mapa de los volcanes por nivel de alerta, KPIs del
// sistema, comparacion de viviendas en amenaza alta y ranking de exposicion.
/* global maplibregl */

import { json, RUTAS } from "../datos.js";
import { entero, esc, html, descargarCSV, compacto } from "../formato.js";
import { AMENAZA, ALERTA, ESCALA } from "../constantes.js";
import { crearMapa, listo, elementoVolcan } from "../mapas.js";
import { Graficos, ejeValor, ejeCategoria, filaTooltip } from "../graficos.js";

// Encuadre inicial: la franja andina donde estan los volcanes, con margen.
function limitesVolcanes(vs) {
  const lon = vs.map((v) => v.lon), lat = vs.map((v) => v.lat);
  return [[Math.min(...lon) - 3.2, Math.min(...lat) - 1.6], [Math.max(...lon) + 3.2, Math.max(...lat) + 1.6]];
}

function etiquetaAlerta(v) {
  const a = ALERTA[v.nivel_actividad] || { color: "#9aa1ad", nombre: v.nivel_actividad };
  return `<span class="etiqueta" title="${esc(a.desc || "")}"><span class="punto" style="background:${a.color}"></span>${esc(a.nombre)}</span>`;
}
function etiquetaEscala(esc_) {
  const e = ESCALA[esc_];
  return e ? `<span class="etiqueta etiqueta--${e.clase}" title="${esc(e.desc)}">${e.nombre}</span>` : "—";
}

export async function render(cont, ctx) {
  const { catalogo, ranking, porCodigo, cod } = ctx;
  const filas = ranking.ranking.map((r) => ({ ...r, v: porCodigo.get(r.codigo) }));
  const graficos = new Graficos();
  let seleccion = cod;

  const totAlta = filas.reduce((a, r) => a + r.viv_alta, 0);
  const totPerAlta = filas.reduce((a, r) => a + r.per_alta, 0);
  const totUeAlta = filas.reduce((a, r) => a + (r.ue_alta || 0), 0);
  const nObs = Object.keys(catalogo.observatorios).length;
  const sinDatos = catalogo.volcanes.filter((v) => !v.tiene_exposicion);

  cont.append(html(`
    <section>
      <div class="encabezado-vista">
        <div>
          <h2>Panorama nacional de exposición volcánica</h2>
          <p class="sub">Volcanes activos monitoreados por el Servicio Geológico Colombiano y viviendas, población y unidades económicas
          dentro de sus zonas de amenaza. Seleccione un volcán en el mapa, en la gráfica o en la tabla para ver su detalle.</p>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi"><div class="kpi__etiqueta">Volcanes activos monitoreados</div>
          <div class="kpi__valor">${catalogo.volcanes.length}</div><div class="kpi__detalle">SGC · ${nObs} observatorios vulcanológicos</div></div>
        <div class="kpi"><div class="kpi__etiqueta">Con mapa de amenaza y exposición</div>
          <div class="kpi__valor">${filas.length}</div><div class="kpi__detalle">Todos los que tienen mapa publicado por el SGC</div></div>
        <div class="kpi kpi--destacado"><div class="kpi__etiqueta">Viviendas en amenaza alta</div>
          <div class="kpi__valor">${entero(totAlta)}</div><div class="kpi__detalle">Suma de los ${filas.length} volcanes · cifra comparable</div></div>
        <div class="kpi kpi--destacado"><div class="kpi__etiqueta">Personas en amenaza alta</div>
          <div class="kpi__valor">${entero(totPerAlta)}</div><div class="kpi__detalle">Viviendas × 3,0 (promedio DANE, CNPV 2018)</div></div>
        <div class="kpi kpi--destacado"><div class="kpi__etiqueta">Unidades económicas en amenaza alta</div>
          <div class="kpi__valor">${entero(totUeAlta)}</div><div class="kpi__detalle">Establecimientos con dirección DANE</div></div>
      </div>

      <div class="rejilla rejilla-mapa">
        <div class="tarjeta tarjeta--sin-relleno">
          <div class="tarjeta__cabeza">
            <h3>Mapa nacional · nivel de alerta del SGC</h3>
            <label class="casilla"><input type="checkbox" id="ver-sin-datos"> Mostrar los ${sinDatos.length} volcanes sin mapa de amenaza</label>
          </div>
          <div class="mapa mapa--alto" id="mapa-nacional"></div>
          <div class="mapa-pie">
            <span class="leyenda-titulo">Nivel de alerta</span>
            ${Object.values(ALERTA).map((a) => `<span class="leyenda-item" title="${esc(a.desc)}"><span class="caja" style="background:${a.color};border-radius:50%"></span>${a.nombre} · ${esc(a.desc)}</span>`).join("")}
          </div>
        </div>
        <div class="tarjeta">
          <div class="tarjeta__cabeza">
            <h3>Viviendas en amenaza alta por volcán</h3>
            <span class="nota">Métrica comparable entre todos los mapas</span>
          </div>
          <div class="grafico" id="g-alta" style="height:600px"></div>
        </div>
      </div>

      <div class="separador"></div>

      <div class="tarjeta tarjeta--sin-relleno">
        <div class="barra-herramientas">
          <div>
            <h3>Ranking de exposición por volcán</h3>
            <div class="nota">Personas = viviendas × 3,0. Las cifras de amenaza <strong>media y baja</strong> de los mapas
            <strong>regionales</strong> incluyen la dispersión extrema de ceniza y no son comparables con las de los mapas proximales.</div>
          </div>
          <div class="flex">
            <div class="segmentado" role="group" aria-label="Escala del mapa" id="f-escala">
              <button aria-pressed="true" data-v="">Todas</button>
              <button aria-pressed="false" data-v="influencia_proximal">Proximal</button>
              <button aria-pressed="false" data-v="influencia_regional">Regional</button>
            </div>
            <button class="boton boton--chico" id="csv-ranking">Descargar CSV</button>
          </div>
        </div>
        <div class="tabla-contenedor" style="max-height:none">
          <table class="tabla" id="t-ranking">
            <thead><tr>
              <th data-orden="nombre">Volcán</th>
              <th>Observatorio</th>
              <th>Alerta</th>
              <th>Escala del mapa</th>
              <th data-orden="anio_pub" class="num">Año mapa</th>
              <th data-orden="viv_alta" class="ordenado-desc">Viviendas alta</th>
              <th data-orden="viv_media" class="num">Viv. media</th>
              <th data-orden="viv_baja" class="num">Viv. baja</th>
              <th data-orden="viv_total" class="num">Viv. total</th>
              <th data-orden="per_alta" class="num">Personas alta</th>
              <th data-orden="per_total" class="num">Personas total</th>
              <th data-orden="n_municipios" class="num">Municipios</th>
              <th></th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </section>`));

  // ------------------------------------------------------------------ mapa
  const map = crearMapa(cont.querySelector("#mapa-nacional"), { limites: limitesVolcanes(catalogo.volcanes), base: "claro", terreno: false });
  const marcadores = new Map();
  const marcadoresSin = [];
  let popup = null;

  function contenidoPopup(v) {
    const r = filas.find((f) => f.codigo === v.codigo);
    const obs = catalogo.observatorios[v.observatorio];
    const cuerpo = r ? `
      <tr><td>Escala del mapa</td><td>${ESCALA[r.escala_mapa]?.nombre || "—"}${r.anio_pub ? ` · ${r.anio_pub}` : ""}</td></tr>
      <tr><td>Viviendas en amenaza alta</td><td>${entero(r.viv_alta)}</td></tr>
      <tr><td>Personas en amenaza alta</td><td>${entero(r.per_alta)}</td></tr>
      <tr><td>Viviendas en las 3 zonas</td><td>${entero(r.viv_total)}</td></tr>
      <tr><td>Municipios con exposición</td><td>${entero(r.n_municipios)}</td></tr>` :
      `<tr><td colspan="2" style="text-align:left;font-weight:400;color:#6f7785">Sin mapa de amenaza publicado por el SGC;<br>no tiene exposición calculada.</td></tr>`;
    return `<div class="popup">
      <h4>${esc(v.nombre)} <span class="secundario">· ${v.codigo}</span></h4>
      <div style="margin-bottom:6px">${etiquetaAlerta(v)} <span class="nota">${esc(obs?.ciudad ? `Observatorio de ${obs.ciudad}` : v.observatorio)}</span></div>
      <table>${cuerpo}<tr><td>Altitud</td><td>${v.altitud_m ? `${entero(v.altitud_m)} m s.n.m.` : "—"}</td></tr></table>
      ${r ? `<div class="acciones">
        <a class="boton boton--chico boton--primario" href="#/exposicion?v=${v.codigo}">Exposición</a>
        <a class="boton boton--chico" href="#/satelital?v=${v.codigo}">Satelital</a>
        <a class="boton boton--chico" href="#/hidromet?v=${v.codigo}">Lluvia</a></div>` : ""}
    </div>`;
  }

  function abrirPopup(v) {
    popup?.remove();
    popup = new maplibregl.Popup({ offset: 30, maxWidth: "300px" }).setLngLat([v.lon, v.lat]).setHTML(contenidoPopup(v)).addTo(map);
  }

  for (const r of filas) {
    const el = elementoVolcan(r.v, { seleccionado: r.codigo === seleccion });
    const m = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([r.v.lon, r.v.lat]).addTo(map);
    el.addEventListener("click", (e) => { e.stopPropagation(); elegir(r.codigo, { volar: false }); abrirPopup(r.v); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") { elegir(r.codigo); abrirPopup(r.v); } });
    el.title = `${r.v.nombre} (${r.codigo})`;
    marcadores.set(r.codigo, { m, el });
  }
  for (const v of sinDatos) {
    const el = elementoVolcan(v, { atenuado: true });
    el.title = `${v.nombre} (${v.codigo}) · sin mapa de amenaza`;
    const m = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([v.lon, v.lat]);
    el.addEventListener("click", (e) => { e.stopPropagation(); abrirPopup(v); });
    marcadoresSin.push(m);
  }
  cont.querySelector("#ver-sin-datos").addEventListener("change", (e) => {
    marcadoresSin.forEach((m) => (e.target.checked ? m.addTo(map) : m.remove()));
  });

  listo(map).then(async () => {
    const deptos = await json(RUTAS.departamentos).catch(() => null);
    if (!deptos || !map.getStyle()) return;
    map.addSource("deptos", { type: "geojson", data: deptos });
    map.addLayer({ id: "deptos-linea", type: "line", source: "deptos", paint: { "line-color": "#8a93a3", "line-width": 0.7, "line-opacity": 0.8 } });
  });

  // ------------------------------------------------------------------ grafico
  const gEl = cont.querySelector("#g-alta");
  function dibujarGrafico() {
    const orden = [...filas].sort((a, b) => a.viv_alta - b.viv_alta);
    const g = graficos.crear(gEl, {
      legend: false,
      grid: { top: 8, right: 70, left: 4, bottom: 4 },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (p) => {
          const r = orden[p[0].dataIndex];
          return `<b>${esc(r.nombre)}</b> · ${ESCALA[r.escala_mapa]?.nombre || ""}<br>` +
            filaTooltip(AMENAZA.alta.color, "Viviendas en amenaza alta", entero(r.viv_alta)) +
            filaTooltip("transparent", "Personas en amenaza alta", entero(r.per_alta)) +
            `<div class="nota" style="margin-top:4px">Clic para seleccionar</div>`;
        },
      },
      xAxis: ejeValor({ splitNumber: 4 }),
      yAxis: ejeCategoria(orden.map((r) => r.nombre), { axisLabel: { color: "#4a5260", width: 120, overflow: "truncate" } }),
      series: [{
        type: "bar", barMaxWidth: 18,
        data: orden.map((r) => ({
          value: r.viv_alta,
          itemStyle: {
            color: AMENAZA.alta.color,
            opacity: r.codigo === seleccion ? 1 : 0.78,
            borderRadius: [0, 4, 4, 0],
            borderColor: r.codigo === seleccion ? "#14181f" : "transparent", borderWidth: r.codigo === seleccion ? 1.5 : 0,
          },
        })),
        label: { show: true, position: "right", color: "#4a5260", formatter: (p) => compacto(p.value) },
      }],
    });
    g.off("click");
    g.on("click", (p) => elegir(orden[p.dataIndex].codigo));
  }

  // ------------------------------------------------------------------ tabla
  const tbody = cont.querySelector("#t-ranking tbody");
  let filtroEscala = "";
  let orden = { campo: "viv_alta", dir: -1 };
  const maxAlta = Math.max(1, ...filas.map((r) => r.viv_alta));

  function dibujarTabla() {
    const lista = filas.filter((r) => !filtroEscala || r.escala_mapa === filtroEscala)
      .sort((a, b) => {
        const x = a[orden.campo], y = b[orden.campo];
        return (typeof x === "string" ? x.localeCompare(y, "es") : (x ?? 0) - (y ?? 0)) * orden.dir;
      });
    tbody.innerHTML = lista.map((r) => {
      const obs = catalogo.observatorios[r.v.observatorio];
      return `<tr class="clicable${r.codigo === seleccion ? " seleccionada" : ""}" data-cod="${r.codigo}">
        <td><strong>${esc(r.nombre)}</strong> <span class="secundario">${r.codigo}</span></td>
        <td class="secundario">${esc(obs?.ciudad || r.v.observatorio)}</td>
        <td>${etiquetaAlerta(r.v)}</td>
        <td>${etiquetaEscala(r.escala_mapa)}</td>
        <td class="num">${r.anio_pub ?? "—"}</td>
        <td><div class="celda-barra"><div class="pista"><div class="relleno" style="width:${(100 * r.viv_alta) / maxAlta}%;background:${AMENAZA.alta.color}"></div></div><span class="valor">${entero(r.viv_alta)}</span></div></td>
        <td class="num">${entero(r.viv_media)}</td>
        <td class="num">${entero(r.viv_baja)}</td>
        <td class="num">${entero(r.viv_total)}</td>
        <td class="num">${entero(r.per_alta)}</td>
        <td class="num">${entero(r.per_total)}</td>
        <td class="num">${entero(r.n_municipios)}</td>
        <td><a class="boton boton--chico" href="#/exposicion?v=${r.codigo}">Ver detalle</a></td>
      </tr>`;
    }).join("");
  }
  tbody.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr[data-cod]");
    if (tr) elegir(tr.dataset.cod);
  });
  cont.querySelectorAll("#t-ranking th[data-orden]").forEach((th) => th.addEventListener("click", () => {
    const campo = th.dataset.orden;
    orden = { campo, dir: orden.campo === campo ? -orden.dir : (campo === "nombre" ? 1 : -1) };
    cont.querySelectorAll("#t-ranking th").forEach((t) => t.classList.remove("ordenado-asc", "ordenado-desc"));
    th.classList.add(orden.dir === 1 ? "ordenado-asc" : "ordenado-desc");
    dibujarTabla();
  }));
  cont.querySelector("#f-escala").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filtroEscala = b.dataset.v;
    cont.querySelectorAll("#f-escala button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    dibujarTabla();
  });
  cont.querySelector("#csv-ranking").addEventListener("click", () => {
    descargarCSV("geovolcanes_ranking_exposicion.csv", [
      { titulo: "codigo", valor: "codigo" }, { titulo: "volcan", valor: "nombre" },
      { titulo: "observatorio", valor: (r) => r.v.observatorio }, { titulo: "nivel_alerta", valor: (r) => r.v.nivel_actividad },
      { titulo: "escala_mapa", valor: (r) => ESCALA[r.escala_mapa]?.nombre }, { titulo: "anio_mapa", valor: "anio_pub" },
      { titulo: "viviendas_alta", valor: "viv_alta" }, { titulo: "viviendas_media", valor: "viv_media" },
      { titulo: "viviendas_baja", valor: "viv_baja" }, { titulo: "viviendas_total", valor: "viv_total" },
      { titulo: "personas_alta", valor: "per_alta" }, { titulo: "personas_media", valor: "per_media" },
      { titulo: "personas_baja", valor: "per_baja" }, { titulo: "personas_total", valor: "per_total" },
      { titulo: "municipios", valor: "n_municipios" }, { titulo: "unidades_economicas_alta", valor: "ue_alta" },
    ], filas);
  });

  function elegir(codigo, { volar = true } = {}) {
    seleccion = codigo;
    ctx.seleccionar(codigo);
    for (const [c, { el }] of marcadores) el.classList.toggle("sel", c === codigo);
    dibujarTabla();
    dibujarGrafico();
    const v = porCodigo.get(codigo);
    if (volar && v) map.flyTo({ center: [v.lon, v.lat], zoom: Math.max(map.getZoom(), 6.5), duration: 900 });
  }

  dibujarTabla();
  dibujarGrafico();

  return () => { popup?.remove(); graficos.liberar(); map.remove(); };
}
