// Vista: Hidrometeorologia. Lee data/hidromet/<COD>.json (precalculado con
// Google Earth Engine por scripts/actualizar_hidromet.py) y consulta en vivo
// el pronostico de Open-Meteo para el punto del crater.
/* global maplibregl */

import { json, RUTAS, absoluta } from "../datos.js";
import { decimal, entero, esc, html, fecha, fechaHora, sumarDias, hoyISO, MESES_CORTOS, descargarCSV } from "../formato.js";
import { FUENTE_LLUVIA, RAMPA_LLUVIA, AMENAZA } from "../constantes.js";
import { crearMapa, listo } from "../mapas.js";
import { Graficos, ejeValor, ejeCategoria, filaTooltip } from "../graficos.js";

const FUENTES = ["imerg", "chirps", "era5"];
const VENTANAS = [30, 60, 90, 180, 365];

// ---------------------------------------------------------------- utilidades de series
function serieComoPares(s) {
  return s.mm.map((v, i) => [sumarDias(s.inicio, i), v]);
}
function enVentana(pares, desde) {
  return pares.filter(([d]) => d >= desde);
}
function agregar(pares, clave) {
  const m = new Map();
  for (const [d, v] of pares) {
    if (v === null) continue;
    const k = clave(d);
    m.set(k, (m.get(k) || 0) + v);
  }
  return m;
}
function lunes(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const dia = (d.getUTCDay() + 6) % 7;
  return sumarDias(iso, -dia);
}

// ---------------------------------------------------------------- color de grillas
function hexARgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const RAMPA_RGB = RAMPA_LLUVIA.map(hexARgb);
function colorRampa(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMPA_RGB.length - 1);
  const i = Math.min(Math.floor(x), RAMPA_RGB.length - 2);
  const f = x - i;
  return RAMPA_RGB[i].map((c, k) => Math.round(c + (RAMPA_RGB[i + 1][k] - c) * f));
}
function maxRedondo(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p * 2) / 2 * p;
}
// Dibuja la grilla (nx x ny) suavizada en un canvas del tamano pedido.
function grillaACanvas(valores, nx, ny, vmin, vmax, ancho, alto, alfa = 255) {
  const peq = document.createElement("canvas");
  peq.width = nx; peq.height = ny;
  const c = peq.getContext("2d");
  const img = c.createImageData(nx, ny);
  for (let i = 0; i < nx * ny; i++) {
    const v = valores[i];
    const o = i * 4;
    if (v === null || v === undefined) { img.data[o + 3] = 0; continue; }
    const [r, g, b] = colorRampa((v - vmin) / (vmax - vmin || 1));
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = alfa;
  }
  c.putImageData(img, 0, 0);
  const grande = document.createElement("canvas");
  grande.width = ancho; grande.height = alto;
  const g2 = grande.getContext("2d");
  g2.imageSmoothingEnabled = true;
  g2.imageSmoothingQuality = "high";
  g2.drawImage(peq, 0, 0, ancho, alto);
  return grande;
}
const gradienteCSS = () => `linear-gradient(to right, ${RAMPA_LLUVIA.join(",")})`;

// =====================================================================
export async function render(cont, ctx) {
  const { volcan, cod, params } = ctx;
  let datos;
  try {
    datos = await json(RUTAS.hidromet(cod));
  } catch {
    cont.append(html(`<div class="aviso aviso--error"><span class="icono">!</span><div><strong>Sin datos de lluvia para ${esc(volcan.nombre)}.</strong><br>
      Genere data/hidromet/${cod}.json con <code>python scripts/actualizar_hidromet.py --volcanes ${cod}</code> (ver docs/FLUJO_ACTUALIZACION.md).</div></div>`));
    return () => {};
  }
  const graficos = new Graficos();
  const est = {
    ventana: VENTANAS.includes(Number(params.dias)) ? Number(params.dias) : 90,
    fuentes: new Set((params.fuentes || "imerg,chirps,era5").split(",").filter((f) => FUENTES.includes(f))),
    gFuente: FUENTES.includes(params.gf) ? params.gf : "imerg",
    gModo: ["dias", "semanas", "meses"].includes(params.gm) ? params.gm : "dias",
    gSel: null,
  };
  if (!est.fuentes.size) FUENTES.forEach((f) => est.fuentes.add(f));
  const hoy = hoyISO();
  const pares = Object.fromEntries(FUENTES.map((f) => [f, serieComoPares(datos.series[f])]));

  cont.append(html(`
    <section>
      <div class="encabezado-vista">
        <div>
          <h2>Hidrometeorología · ${esc(volcan.nombre)}</h2>
          <p class="sub">Lluvia satelital sobre el cráter (${volcan.lat.toFixed(3)}°, ${volcan.lon.toFixed(3)}°) y su entorno. La lluvia intensa o
          acumulada sobre los flancos es el principal detonante de lahares secundarios y movimientos en masa.</p>
          <div class="etiquetas"><span class="etiqueta">Series y mapas calculados con Google Earth Engine: ${esc(fechaHora(datos.generado))}</span>
          <span class="etiqueta">Pronóstico: Open-Meteo, en vivo</span></div>
        </div>
      </div>

      <div class="controles">
        <div class="control"><span>Ventana de análisis</span>
          <div class="segmentado" id="f-ventana">${VENTANAS.map((d) => `<button type="button" data-v="${d}" aria-pressed="${d === est.ventana}">${d === 365 ? "1 año" : `${d} días`}</button>`).join("")}</div></div>
        <div class="control"><span>Fuentes</span>
          <div class="segmentado" id="f-fuentes">${FUENTES.map((f) => `<button type="button" data-v="${f}" aria-pressed="${est.fuentes.has(f)}"><span class="muestra" style="background:${FUENTE_LLUVIA[f].color}"></span>${FUENTE_LLUVIA[f].nombre}</button>`).join("")}</div></div>
        <button class="boton boton--chico derecha" id="csv-series">Descargar series (CSV)</button>
      </div>

      <div class="kpis" id="kpis-lluvia"></div>

      <div class="tarjeta">
        <div class="tarjeta__cabeza"><h3>Precipitación diaria sobre el cráter</h3><span class="nota">Arrastre el selector inferior para acercar un periodo</span></div>
        <div class="grafico grafico--alto" id="g-diaria"></div>
        <div class="aviso aviso--info" style="margin-top:10px"><span class="icono">i</span><div>
          Las diferencias entre fuentes son normales (resolución, algoritmo, latencia). <strong>ERA5-Land sobreestima la lluvia en alta montaña</strong>
          por su sesgo orográfico: úselo para patrones temporales, no para magnitudes. CHIRPS (calibrado con estaciones) e IMERG son más
          confiables para valores absolutos. Los días aún no publicados por cada fuente aparecen como vacíos, no como días secos.</div></div>
      </div>

      <div class="separador"></div>
      <div class="rejilla rejilla-2">
        <div class="tarjeta"><div class="tarjeta__cabeza"><h3>Acumulado semanal</h3><span class="nota">Semanas de lunes a domingo</span></div>
          <div class="grafico" id="g-semanal"></div></div>
        <div class="tarjeta"><div class="tarjeta__cabeza"><h3>Acumulado mensual</h3><span class="nota">El primer y el último mes pueden estar incompletos</span></div>
          <div class="grafico" id="g-mensual"></div></div>
      </div>

      <div class="separador"></div>
      <div class="rejilla rejilla-2">
        <div class="tarjeta"><div class="tarjeta__cabeza"><h3>Últimos 12 meses frente a la climatología</h3><span class="nota" id="nota-clim"></span></div>
          <div class="grafico" id="g-clim"></div></div>
        <div class="tarjeta"><div class="tarjeta__cabeza"><h3>Pronóstico de lluvia · próximos 7 días</h3><span class="nota">Modelo numérico vía Open-Meteo, consultado en vivo</span></div>
          <div class="grafico" id="g-pron"><div class="cargando"><span class="girador"></span> Consultando pronóstico…</div></div></div>
      </div>

      <div class="separador"></div>
      <div class="tarjeta">
        <div class="barra-herramientas" style="padding:0 0 12px">
          <div><h3>Mapas de lluvia acumulada por periodo</h3>
            <div class="nota">Cuadro de ~${Math.round(2 * 15)} × ${Math.round(2 * 15)} km centrado en el cráter, celdas de 1 km interpoladas. Escala de color común a los 8 periodos.
            El valor bajo cada mapa es la media en un radio de ${datos.grillas.radio_media_km} km. Clic en un periodo para verlo sobre el relieve.</div></div>
          <div class="flex">
            <div class="segmentado" id="g-fuente">${FUENTES.map((f) => `<button type="button" data-v="${f}" aria-pressed="${f === est.gFuente}">${FUENTE_LLUVIA[f].nombre.split(" ")[0]}</button>`).join("")}</div>
            <div class="segmentado" id="g-modo">${[["dias", "8 días"], ["semanas", "8 semanas"], ["meses", "8 meses"]].map(([k, t]) => `<button type="button" data-v="${k}" aria-pressed="${k === est.gModo}">${t}</button>`).join("")}</div>
          </div>
        </div>
        <div class="rejilla rejilla-mapa">
          <div><div class="mosaico" id="mosaico"></div>
            <div class="escala-color" style="margin-top:10px" id="escala-mosaico"></div></div>
          <div><div class="mapa mapa--medio" id="mapa-lluvia" style="border-radius:8px;overflow:hidden"></div>
            <div class="nota" id="lectura" style="margin-top:6px">Pase el cursor sobre el mapa para leer el valor de la celda.</div></div>
        </div>
      </div>

      <div class="separador"></div>
      <div class="rejilla rejilla-mapa">
        <div class="tarjeta tarjeta--sin-relleno">
          <div class="tarjeta__cabeza"><h3>Precipitación media anual · CHIRPS ${esc(datos.clim_mapa.periodo)}</h3><span class="nota">Gradiente orográfico de la lluvia</span></div>
          <div class="mapa mapa--medio" id="mapa-clim"></div>
          <div class="mapa-pie" id="pie-clim"></div>
        </div>
        <div class="tarjeta tarjeta--sin-relleno">
          <div class="tarjeta__cabeza"><h3>Datos recientes por fuente</h3><span class="nota">mm/día · últimos 14 días</span></div>
          <div class="tabla-contenedor" style="max-height:480px"><table class="tabla" id="t-recientes"></table></div>
          <div class="nota" style="padding:10px 18px">Latencia típica: IMERG ~2 días, ERA5-Land ~6 días, CHIRPS 3 a 8 semanas. Por eso cada fuente termina en una fecha distinta.</div>
        </div>
      </div>
    </section>`));

  const $ = (s) => cont.querySelector(s);

  // ---------------------------------------------------------------- KPIs
  function dibujarKPIs() {
    const desde = sumarDias(hoy, -est.ventana + 1);
    $("#kpis-lluvia").innerHTML = FUENTES.filter((f) => est.fuentes.has(f)).map((f) => {
      const s = datos.series[f];
      const p = enVentana(pares[f], desde).filter(([, v]) => v !== null);
      const total = p.reduce((a, [, v]) => a + v, 0);
      const max = p.reduce((a, x) => (x[1] > a[1] ? x : a), ["", -1]);
      return `<div class="kpi" style="border-top:3px solid ${FUENTE_LLUVIA[f].color}">
        <div class="kpi__etiqueta">${FUENTE_LLUVIA[f].nombre} · acumulado</div>
        <div class="kpi__valor">${entero(total)} <span style="font-size:15px;font-weight:600">mm</span></div>
        <div class="kpi__detalle">${p.length} días con dato · media ${decimal(p.length ? total / p.length : 0)} mm/día</div>
        <div class="kpi__detalle">Máximo: ${max[1] >= 0 ? `${decimal(max[1])} mm el ${fecha(max[0], false)}` : "—"} · último dato ${fecha(s.ultimo_dato, false)}</div>
      </div>`;
    }).join("");
  }

  // ---------------------------------------------------------------- series
  function dibujarSeries() {
    const desde = sumarDias(hoy, -est.ventana + 1);
    const activas = FUENTES.filter((f) => est.fuentes.has(f));
    const fechas = [];
    for (let d = desde; d <= hoy; d = sumarDias(d, 1)) fechas.push(d);
    const mapas = Object.fromEntries(activas.map((f) => [f, new Map(pares[f])]));
    graficos.crear($("#g-diaria"), {
      legend: { data: activas.map((f) => FUENTE_LLUVIA[f].nombre) },
      grid: { bottom: 56 },
      tooltip: {
        trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "#9aa1ad" } },
        formatter: (p) => `<b>${fecha(fechas[p[0].dataIndex])}</b><br>` + p.map((s) => filaTooltip(s.color, s.seriesName, s.value === null || s.value === undefined ? "sin dato" : `${decimal(s.value)} mm`)).join(""),
      },
      dataZoom: [{ type: "slider", height: 22, bottom: 8, borderColor: "#e3e6eb", fillerColor: "rgba(29,79,145,.12)", labelFormatter: (i) => fecha(fechas[i] || "", false) }, { type: "inside" }],
      xAxis: ejeCategoria(fechas, { axisLabel: { color: "#6f7785", formatter: (d) => fecha(d, false) } }),
      yAxis: ejeValor({ name: "mm/día" }),
      series: activas.map((f) => ({
        name: FUENTE_LLUVIA[f].nombre, type: "line", showSymbol: false, connectNulls: false,
        lineStyle: { width: 1.6, color: FUENTE_LLUVIA[f].color }, itemStyle: { color: FUENTE_LLUVIA[f].color },
        data: fechas.map((d) => (mapas[f].has(d) ? mapas[f].get(d) : null)),
      })),
    });

    // Semanal y mensual: barras agrupadas
    const barras = (el, clave, etiqueta, unidad) => {
      const grupos = activas.map((f) => agregar(enVentana(pares[f], desde), clave));
      const claves = [...new Set(grupos.flatMap((g) => [...g.keys()]))].sort();
      graficos.crear(el, {
        legend: { data: activas.map((f) => FUENTE_LLUVIA[f].nombre) },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
          formatter: (p) => `<b>${etiqueta(claves[p[0].dataIndex], true)}</b><br>` + p.map((s) => filaTooltip(s.color, s.seriesName, s.value === null ? "sin dato" : `${entero(s.value)} mm`)).join("") },
        xAxis: ejeCategoria(claves.map((k) => etiqueta(k, false))),
        yAxis: ejeValor({ name: unidad }),
        series: activas.map((f, i) => ({
          name: FUENTE_LLUVIA[f].nombre, type: "bar", barMaxWidth: 14, barGap: "15%",
          itemStyle: { color: FUENTE_LLUVIA[f].color, borderRadius: [3, 3, 0, 0] },
          data: claves.map((k) => (grupos[i].has(k) ? Math.round(grupos[i].get(k) * 10) / 10 : null)),
        })),
      });
    };
    barras($("#g-semanal"), lunes, (k, largo) => (largo ? `Semana del ${fecha(k)} al ${fecha(sumarDias(k, 6))}` : fecha(k, false)), "mm/semana");
    barras($("#g-mensual"), (d) => d.slice(0, 7), (k) => `${MESES_CORTOS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`, "mm/mes");
  }

  // ---------------------------------------------------------------- climatologia vs ultimos 12 meses
  function dibujarClimatologia() {
    const clim = datos.climatologia;
    $("#nota-clim").textContent = `Barras: promedio CHIRPS ${clim.periodo} · líneas: meses completos recientes`;
    // Totales de meses COMPLETOS por fuente (un mes incompleto no se compara con la climatologia).
    const completos = {};
    for (const f of ["chirps", "imerg"]) {
      const tot = agregar(pares[f], (d) => d.slice(0, 7));
      const cuenta = agregar(pares[f].map(([d, v]) => [d, v === null ? null : 1]), (d) => d.slice(0, 7));
      completos[f] = new Map();
      for (const [k, v] of tot) {
        const dias = new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 0)).getUTCDate();
        if (cuenta.get(k) === dias) completos[f].set(k, Math.round(v));
      }
    }
    // Eje: los 12 meses que terminan en el ultimo mes completo disponible (orden cronologico).
    const ultimo = [...completos.imerg.keys(), ...completos.chirps.keys()].sort().at(-1);
    const meses = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(Number(ultimo.slice(0, 4)), Number(ultimo.slice(5, 7)) - 1 - i, 1));
      meses.push(d.toISOString().slice(0, 7));
    }
    const etiqueta = (k) => `${MESES_CORTOS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
    graficos.crear($("#g-clim"), {
      legend: { data: ["Climatología CHIRPS", "CHIRPS", "IMERG"] },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (p) => `<b>${MESES_CORTOS[Number(meses[p[0].dataIndex].slice(5, 7)) - 1]} ${meses[p[0].dataIndex].slice(0, 4)}</b><br>` +
          p.map((x) => filaTooltip(x.color, x.seriesName, x.value === null || x.value === undefined ? "mes incompleto o sin dato" : `${entero(x.value)} mm`)).join("") },
      xAxis: ejeCategoria(meses.map(etiqueta)),
      yAxis: ejeValor({ name: "mm/mes" }),
      series: [
        { name: "Climatología CHIRPS", type: "bar", barMaxWidth: 26, itemStyle: { color: "#b7d3f6", borderRadius: [3, 3, 0, 0] },
          data: meses.map((k) => clim.mm[Number(k.slice(5, 7)) - 1]) },
        { name: "CHIRPS", type: "line", symbol: "circle", symbolSize: 8, lineStyle: { width: 2, color: FUENTE_LLUVIA.chirps.color },
          itemStyle: { color: FUENTE_LLUVIA.chirps.color, borderColor: "#fff", borderWidth: 2 }, data: meses.map((k) => completos.chirps.get(k) ?? null) },
        { name: "IMERG", type: "line", symbol: "circle", symbolSize: 8, lineStyle: { width: 2, color: FUENTE_LLUVIA.imerg.color },
          itemStyle: { color: FUENTE_LLUVIA.imerg.color, borderColor: "#fff", borderWidth: 2 }, data: meses.map((k) => completos.imerg.get(k) ?? null) },
      ],
    });
  }

  // ---------------------------------------------------------------- pronostico Open-Meteo (en vivo)
  async function dibujarPronostico() {
    const el = $("#g-pron");
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${volcan.lat}&longitude=${volcan.lon}&daily=precipitation_sum,precipitation_probability_max&past_days=7&forecast_days=7&timezone=America%2FBogota`;
      const r = await fetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const d = j.daily;
      const iHoy = d.time.indexOf(hoy);
      el.innerHTML = "";
      graficos.crear(el, {
        legend: { data: ["Últimos 7 días (modelo)", "Pronóstico"] },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
          formatter: (p) => {
            const i = p[0].dataIndex;
            return `<b>${fecha(d.time[i])}${i === iHoy ? " · hoy" : ""}</b><br>` +
              filaTooltip(p.find((s) => s.value !== null)?.color || "#3987e5", "Lluvia", `${decimal(d.precipitation_sum[i])} mm`) +
              (d.precipitation_probability_max[i] !== null ? filaTooltip("transparent", "Probabilidad máxima", `${entero(d.precipitation_probability_max[i])} %`) : "");
          } },
        xAxis: ejeCategoria(d.time.map((t, i) => (i === iHoy ? "Hoy" : fecha(t, false)))),
        yAxis: ejeValor({ name: "mm/día" }),
        series: [
          { name: "Últimos 7 días (modelo)", type: "bar", stack: "x", barMaxWidth: 22, itemStyle: { color: "#9ec5f4", borderRadius: [3, 3, 0, 0] },
            data: d.precipitation_sum.map((v, i) => (i < iHoy ? v : null)) },
          { name: "Pronóstico", type: "bar", stack: "x", barMaxWidth: 22, itemStyle: { color: "#256abf", borderRadius: [3, 3, 0, 0] },
            data: d.precipitation_sum.map((v, i) => (i >= iHoy ? v : null)),
            label: { show: true, position: "top", color: "#4a5260", fontSize: 11,
              formatter: (p) => (d.precipitation_probability_max[p.dataIndex] !== null ? `${d.precipitation_probability_max[p.dataIndex]} %` : "") } },
        ],
      });
      el.insertAdjacentHTML("afterend", `<p class="nota" style="margin-top:6px">Barras = lluvia diaria del modelo a ${entero(j.elevation)} m de altura; etiquetas = probabilidad máxima de lluvia.
        Los pronósticos en alta montaña tienen alta incertidumbre: úselos como alerta temprana, no como medición.</p>`);
    } catch (e) {
      el.innerHTML = `<div class="aviso"><span class="icono">!</span>No se pudo consultar Open-Meteo (${esc(e.message)}). El resto de la página usa datos precalculados.</div>`;
    }
  }

  // ---------------------------------------------------------------- mosaico de grillas
  const G = datos.grillas;
  const mapaLluvia = crearMapa($("#mapa-lluvia"), { limites: [[G.bbox[0], G.bbox[1]], [G.bbox[2], G.bbox[3]]], base: "topografico", pantallaCompleta: true });
  new maplibregl.Marker({ color: "#14181f", scale: 0.7 }).setLngLat([volcan.lon, volcan.lat]).addTo(mapaLluvia);
  let grillaActual = null;

  function dibujarMosaico() {
    const pers = G.fuentes[est.gFuente]?.[est.gModo] || [];
    const vals = pers.flatMap((p) => p.valores.filter((v) => v !== null));
    const vmax = maxRedondo(Math.max(...vals, 1));
    const unidad = { dias: "mm/día", semanas: "mm/semana", meses: "mm/mes" }[est.gModo];
    $("#mosaico").innerHTML = "";
    pers.forEach((p, i) => {
      const fig = document.createElement("figure");
      fig.setAttribute("role", "button");
      fig.setAttribute("tabindex", "0");
      fig.setAttribute("aria-pressed", "false");
      fig.title = `${p.desde === p.hasta ? fecha(p.desde) : `${fecha(p.desde)} – ${fecha(p.hasta)}`}`;
      const cv = grillaACanvas(p.valores, G.nx, G.ny, 0, vmax, 248, 248);
      const ctx2 = cv.getContext("2d");
      // punto del crater
      const fx = (volcan.lon - G.bbox[0]) / (G.bbox[2] - G.bbox[0]);
      const fy = (G.bbox[3] - volcan.lat) / (G.bbox[3] - G.bbox[1]);
      ctx2.fillStyle = "#14181f"; ctx2.strokeStyle = "#fff"; ctx2.lineWidth = 2;
      ctx2.beginPath(); ctx2.moveTo(fx * 248, fy * 248 - 7); ctx2.lineTo(fx * 248 - 6, fy * 248 + 5); ctx2.lineTo(fx * 248 + 6, fy * 248 + 5); ctx2.closePath(); ctx2.stroke(); ctx2.fill();
      fig.append(cv);
      fig.insertAdjacentHTML("beforeend", `<figcaption><span>${esc(p.etiqueta)}</span><span class="v">${p.media_mm === null ? "s/d" : `${decimal(p.media_mm)} mm`}</span></figcaption>`);
      const elegir = () => seleccionarPeriodo(i, vmax, unidad);
      fig.addEventListener("click", elegir);
      fig.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(); } });
      $("#mosaico").append(fig);
    });
    $("#escala-mosaico").innerHTML = `<span>0</span><span class="gradiente" style="background:${gradienteCSS()}"></span><span>${entero(vmax)} ${unidad}</span>
      <span class="nota">${FUENTE_LLUVIA[est.gFuente].nombre} · lluvia acumulada en cada periodo</span>`;
    if (pers.length) seleccionarPeriodo(est.gSel !== null && est.gSel < pers.length ? est.gSel : pers.length - 1, vmax, unidad);
  }

  function seleccionarPeriodo(i, vmax, unidad) {
    est.gSel = i;
    const p = G.fuentes[est.gFuente][est.gModo][i];
    $("#mosaico").querySelectorAll("figure").forEach((f, k) => f.setAttribute("aria-pressed", String(k === i)));
    grillaActual = { p, unidad };
    const cv = grillaACanvas(p.valores, G.nx, G.ny, 0, vmax, G.nx * 12, G.ny * 12, 205);
    ponerImagen(mapaLluvia, "lluvia", cv, G.bbox);
    $("#lectura").innerHTML = `<strong>${esc(p.etiqueta)}</strong> (${fecha(p.desde)}${p.hasta !== p.desde ? ` – ${fecha(p.hasta)}` : ""}) · media ${p.media_mm === null ? "s/d" : `${decimal(p.media_mm)} mm`}. Pase el cursor sobre el mapa para leer cada celda.`;
  }

  function ponerImagen(map, id, canvas, bbox) {
    const url = canvas.toDataURL("image/png");
    const coords = [[bbox[0], bbox[3]], [bbox[2], bbox[3]], [bbox[2], bbox[1]], [bbox[0], bbox[1]]];
    const aplicar = () => {
      if (!map.getStyle()) return;
      if (map.getSource(id)) {
        map.getSource(id).updateImage({ url, coordinates: coords });
      } else {
        map.addSource(id, { type: "image", url, coordinates: coords });
        map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0.85, "raster-fade-duration": 0, "raster-resampling": "linear" } });
        if (map.getLayer("contorno")) map.moveLayer("contorno");
      }
    };
    listo(map).then(aplicar);
  }

  function valorEn(lngLat, blk) {
    const [x0, y0, x1, y1] = blk.bbox;
    if (lngLat.lng < x0 || lngLat.lng > x1 || lngLat.lat < y0 || lngLat.lat > y1) return undefined;
    const i = Math.min(blk.nx - 1, Math.floor(((lngLat.lng - x0) / (x1 - x0)) * blk.nx));
    const j = Math.min(blk.ny - 1, Math.floor(((y1 - lngLat.lat) / (y1 - y0)) * blk.ny));
    return blk.valores[j * blk.nx + i];
  }
  mapaLluvia.on("mousemove", (e) => {
    if (!grillaActual) return;
    const v = valorEn(e.lngLat, { ...G, valores: grillaActual.p.valores });
    if (v === undefined) return;
    $("#lectura").innerHTML = `<strong>${esc(grillaActual.p.etiqueta)}</strong> · celda en ${e.lngLat.lat.toFixed(3)}°, ${e.lngLat.lng.toFixed(3)}°: <strong>${v === null ? "sin dato" : `${decimal(v)} ${grillaActual.unidad}`}</strong>`;
  });

  // ---------------------------------------------------------------- mapa climatologico
  const C = datos.clim_mapa;
  const mapaClim = crearMapa($("#mapa-clim"), { limites: [[C.bbox[0], C.bbox[1]], [C.bbox[2], C.bbox[3]]], base: "topografico" });
  new maplibregl.Marker({ color: "#14181f", scale: 0.7 }).setLngLat([volcan.lon, volcan.lat]).addTo(mapaClim);
  {
    const vs = C.valores.filter((v) => v !== null);
    const vmin = Math.floor(Math.min(...vs) / 100) * 100;
    const vmax = Math.ceil(Math.max(...vs) / 100) * 100;
    ponerImagen(mapaClim, "clim", grillaACanvas(C.valores, C.nx, C.ny, vmin, vmax, C.nx * 10, C.ny * 10, 205), C.bbox);
    $("#pie-clim").innerHTML = `<span class="escala-color"><span>${entero(vmin)}</span><span class="gradiente" style="background:${gradienteCSS()}"></span><span>${entero(vmax)} mm/año</span></span>
      <span class="leyenda-item"><span class="linea" style="border-color:${AMENAZA.alta.color}"></span>Amenaza alta (SGC)</span>
      <span class="nota" id="lectura-clim">Pase el cursor para leer el valor.</span>`;
    mapaClim.on("mousemove", (e) => {
      const v = valorEn(e.lngLat, C);
      if (v !== undefined) $("#lectura-clim").innerHTML = `Celda: <strong>${v === null ? "sin dato" : `${entero(v)} mm/año`}</strong>`;
    });
  }
  // Contorno de amenaza alta en ambos mapas (desde las teselas de exposicion)
  for (const m of [mapaLluvia, mapaClim]) {
    listo(m).then(() => {
      if (!m.getStyle()) return;
      m.addSource("exp", { type: "vector", url: `pmtiles://${absoluta(RUTAS.pmtiles(cod))}` });
      m.addLayer({ id: "contorno", type: "line", source: "exp", "source-layer": "amenaza_borde", filter: ["==", ["get", "nivel"], "alta"],
        paint: { "line-color": AMENAZA.alta.color, "line-width": 1.8 } });
    });
  }

  // ---------------------------------------------------------------- tabla de datos recientes
  function dibujarRecientes() {
    const fin = FUENTES.map((f) => datos.series[f].ultimo_dato).sort().at(-1);
    const filas = [];
    for (let i = 0; i < 14; i++) filas.push(sumarDias(fin, -i));
    const mapas = Object.fromEntries(FUENTES.map((f) => [f, new Map(pares[f])]));
    $("#t-recientes").innerHTML = `<thead><tr><th>Fecha</th>${FUENTES.map((f) => `<th class="num"><span class="leyenda-item"><span class="caja" style="background:${FUENTE_LLUVIA[f].color}"></span>${FUENTE_LLUVIA[f].nombre.split(" ")[0]}</span></th>`).join("")}</tr></thead>
      <tbody>${filas.map((d) => `<tr><td>${fecha(d)}</td>${FUENTES.map((f) => {
        const v = mapas[f].get(d);
        return `<td class="num">${v === undefined || v === null ? '<span class="secundario">pendiente</span>' : decimal(v)}</td>`;
      }).join("")}</tr>`).join("")}</tbody>`;
  }

  // ---------------------------------------------------------------- eventos
  $("#f-ventana").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    est.ventana = Number(b.dataset.v);
    $("#f-ventana").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    ctx.fijarParams({ dias: est.ventana === 90 ? undefined : est.ventana });
    dibujarKPIs(); dibujarSeries();
  });
  $("#f-fuentes").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const f = b.dataset.v;
    if (est.fuentes.has(f) && est.fuentes.size === 1) return;  // al menos una
    est.fuentes.has(f) ? est.fuentes.delete(f) : est.fuentes.add(f);
    b.setAttribute("aria-pressed", String(est.fuentes.has(f)));
    ctx.fijarParams({ fuentes: est.fuentes.size === 3 ? undefined : [...est.fuentes].join(",") });
    dibujarKPIs(); dibujarSeries();
  });
  const enlazarGrilla = (id, clave, param) => $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    est[clave] = b.dataset.v;
    est.gSel = null;
    $(id).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    ctx.fijarParams({ [param]: b.dataset.v });
    dibujarMosaico();
  });
  enlazarGrilla("#g-fuente", "gFuente", "gf");
  enlazarGrilla("#g-modo", "gModo", "gm");
  $("#csv-series").addEventListener("click", () => {
    const inicio = FUENTES.map((f) => datos.series[f].inicio).sort()[0];
    const fin = FUENTES.map((f) => datos.series[f].ultimo_dato).sort().at(-1);
    const mapas = Object.fromEntries(FUENTES.map((f) => [f, new Map(pares[f])]));
    const filas = [];
    for (let d = inicio; d <= fin; d = sumarDias(d, 1)) filas.push(d);
    descargarCSV(`lluvia_diaria_${cod}.csv`, [{ titulo: "fecha", valor: (d) => d },
      ...FUENTES.map((f) => ({ titulo: `${f}_mm`, valor: (d) => mapas[f].get(d) ?? "" }))], filas);
  });

  dibujarKPIs();
  dibujarSeries();
  dibujarClimatologia();
  dibujarMosaico();
  dibujarRecientes();
  dibujarPronostico();

  return () => { graficos.liberar(); mapaLluvia.remove(); mapaClim.remove(); };
}
