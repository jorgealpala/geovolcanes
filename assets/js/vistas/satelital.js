// Vista: Productos satelitales en vivo, sin servidor propio ni credenciales.
//  - Sentinel-2, Landsat 8/9 y Sentinel-1: catalogo STAC y teselas de
//    Microsoft Planetary Computer (busqueda por rango de fechas + calendario de
//    escenas + compuesto mediano del rango).
//  - GOES-Este (GOES-19) y MODIS/VIIRS diario: teselas de NASA GIBS.
/* global maplibregl */

import { RUTAS, absoluta } from "../datos.js";
import { entero, esc, html, fecha, hoyISO, sumarDias } from "../formato.js";
import { AMENAZA } from "../constantes.js";
import { crearMapa, listo, cuadroAlrededor } from "../mapas.js";

const PC = "https://planetarycomputer.microsoft.com/api";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

// ---------------------------------------------------------------- configuracion de sensores
// Sentinel-2 L2A: desde la linea base de procesamiento 04.00 (25-ene-2022) los
// numeros digitales traen +1000 de desplazamiento. Se corrige por escena.
const offsetS2 = (item) => (parseFloat(item?.properties?.["s2:processing_baseline"] || "0") >= 4 ? 1000 : 0);
const offsetRango = (f0) => (f0 >= "2022-01-25" ? 1000 : 0);

const SENSORES = {
  s2: {
    nombre: "Sentinel-2", coleccion: "sentinel-2-l2a", dias: 120, nubes: 60, km: 9,
    resumen: "Óptico multiespectral · 10 m · revisita ~5 días (2A, 2B y 2C)",
    nota: "El terreno andino es muy nuboso: si no hay escenas útiles, amplíe el rango de fechas o el umbral de nubes, o use el radar Sentinel-1.",
    vis: {
      color_real: { t: "Color real", d: "Composición natural (B4-B3-B2). Nieve, nubes, cenizas y flujos recientes resaltan.",
        p: () => "assets=visual&asset_bidx=visual%7C1,2,3&nodata=0" },
      falso_color: { t: "Falso color (vegetación)", d: "Infrarrojo cercano (B8-B4-B3): la vegetación sana aparece en rojo; suelo desnudo y depósitos, en tonos apagados.",
        p: (o) => `assets=B08&assets=B04&assets=B03&rescale=${o},${o + 4500}&color_formula=gamma%20RGB%201.25&nodata=0` },
      swir: { t: "SWIR (anomalías térmicas)", d: "Infrarrojo de onda corta (B12-B11-B4): resalta calor superficial intenso (lava, incendios), humedad y minerales. No es termometría.",
        p: (o) => `assets=B12&assets=B11&assets=B04&rescale=${o},${o + 4500}&color_formula=gamma%20RGB%201.2&nodata=0` },
      ndvi: { t: "NDVI (vegetación)", d: "Índice de vegetación normalizado (B8-B4). Caídas bruscas entre fechas pueden indicar afectación por ceniza o flujos.",
        p: (o) => `expression=(B08-B04)/(B08%2BB04-${2 * o})&asset_as_band=true&rescale=-0.1,0.9&colormap_name=rdylgn&nodata=0`, rampa: ["#a50026", "#f46d43", "#fee08b", "#a6d96a", "#1a9850"], rango: ["-0,1", "0,9"] },
    },
  },
  ls: {
    nombre: "Landsat 8/9", coleccion: "landsat-c2-l2", dias: 365, nubes: 70, km: 9,
    resumen: "Óptico y térmico · 30 m (térmico 100 m) · revisita ~8 días combinados",
    nota: "Archivo histórico largo y banda térmica propia. La fusión pancromática a 15 m del módulo anterior no está disponible en este catálogo (solo distribuye nivel 2).",
    filtro: { platform: { in: ["landsat-8", "landsat-9"] } },
    vis: {
      color_real: { t: "Color real", d: "Composición natural (rojo, verde, azul).",
        p: () => "assets=red&assets=green&assets=blue&rescale=7273,18182&color_formula=gamma%20RGB%201.3&nodata=0" },
      falso_color: { t: "Falso color (vegetación)", d: "Infrarrojo cercano: la vegetación sana aparece en rojo.",
        p: () => "assets=nir08&assets=red&assets=green&rescale=7273,21818&nodata=0" },
      swir: { t: "SWIR (anomalías térmicas)", d: "Infrarrojo de onda corta: sensible a calor superficial intenso, humedad y minerales.",
        p: () => "assets=swir22&assets=swir16&assets=red&rescale=7273,23636&nodata=0" },
      ndvi: { t: "NDVI (vegetación)", d: "Índice de vegetación normalizado calculado sobre reflectancia de superficie.",
        p: () => "expression=(nir08-red)/(nir08%2Bred-14545.45)&asset_as_band=true&rescale=-0.1,0.9&colormap_name=rdylgn&nodata=0", rampa: ["#a50026", "#f46d43", "#fee08b", "#a6d96a", "#1a9850"], rango: ["-0,1", "0,9"] },
      termica: { t: "Temperatura de superficie (°C)", d: "Banda térmica (ST_B10) convertida a °C. Útil para seguir anomalías térmicas persistentes en el cráter y fumarolas.",
        p: () => "expression=lwir11*0.00341802%2B149-273.15&asset_as_band=true&rescale=-10,40&colormap_name=inferno&nodata=0", rampa: ["#000004", "#57106e", "#bc3754", "#f98e09", "#fcffa4"], rango: ["−10 °C", "40 °C"] },
    },
  },
  s1: {
    nombre: "Sentinel-1 (radar)", coleccion: "sentinel-1-rtc", dias: 90, km: 9,
    resumen: "Radar de apertura sintética (banda C) · 10 m · con corrección radiométrica del terreno · ve a través de las nubes",
    nota: "El radar opera de día y de noche y atraviesa las nubes: es la fuente más confiable en temporada de lluvias. Cambios bruscos de retrodispersión entre pasadas de la misma órbita pueden indicar cambios en el edificio volcánico.",
    vis: {
      vv: { t: "Retrodispersión VV (dB)", d: "Polarización VV: sensible a la rugosidad y a la geometría del terreno.",
        p: () => "expression=10*log10(vv)&asset_as_band=true&rescale=-20,5&nodata=0", rampa: ["#000000", "#ffffff"], rango: ["−20 dB", "5 dB"] },
      vh: { t: "Retrodispersión VH (dB)", d: "Polarización cruzada VH: sensible a la estructura de la vegetación y a la dispersión de volumen.",
        p: () => "expression=10*log10(vh)&asset_as_band=true&rescale=-28,-5&nodata=0", rampa: ["#000000", "#ffffff"], rango: ["−28 dB", "−5 dB"] },
      color: { t: "Compuesto de color VV · VH · VV/VH", d: "Rojo = VV, verde = VH, azul = razón VV/VH. La vegetación tiende al verde; superficies desnudas y depósitos, al magenta.",
        p: () => "expression=10*log10(vv);10*log10(vh);10*log10(vv)-10*log10(vh)&asset_as_band=true&rescale=-20,0&rescale=-28,-8&rescale=0,15&nodata=0" },
    },
  },
};

const GOES = {
  geocolor: { t: "GeoColor (color natural de día, infrarrojo de noche)", capa: "GOES-East_ABI_GeoColor", nivel: 7 },
  ir: { t: "Infrarrojo banda 13 (topes de nube, día y noche)", capa: "GOES-East_ABI_Band13_Clean_Infrared", nivel: 6 },
  visible: { t: "Visible banda 2 (diurno, 1 km)", capa: "GOES-East_ABI_Band2_Red_Visible_1km", nivel: 7 },
};

const GIBS_DIARIO = {
  "VIIRS_NOAA20_CorrectedReflectance_TrueColor": { t: "VIIRS NOAA-20 · color real", res: "375 m", paso: "~13:30" },
  "VIIRS_SNPP_CorrectedReflectance_TrueColor": { t: "VIIRS Suomi-NPP · color real", res: "375 m", paso: "~13:30" },
  "MODIS_Terra_CorrectedReflectance_TrueColor": { t: "MODIS Terra · color real", res: "250 m", paso: "~10:30" },
  "MODIS_Aqua_CorrectedReflectance_TrueColor": { t: "MODIS Aqua · color real", res: "250 m", paso: "~13:30" },
  "MODIS_Terra_CorrectedReflectance_Bands721": { t: "MODIS Terra · falso color 7-2-1 (ceniza, quemas)", res: "500 m", paso: "~10:30" },
};

// ---------------------------------------------------------------- STAC
const MAX_MEDIANA = 8;  // escenas que entran en el compuesto mediano (las mas recientes)

async function buscarEscenas(cfg, lat, lon, f0, f1, nubes) {
  const query = { ...(cfg.filtro || {}) };
  if (cfg.nubes !== undefined) query["eo:cloud_cover"] = { lte: nubes };
  const cuerpo = {
    collections: [cfg.coleccion],
    intersects: { type: "Point", coordinates: [lon, lat] },
    datetime: `${f0}T00:00:00Z/${f1}T23:59:59Z`,
    limit: 250,
    sortby: [{ field: "datetime", direction: "desc" }],
  };
  // Solo se envia "query" si tiene condiciones: desde nov. 2026 Planetary Computer
  // rechaza un "query" vacio con HTTP 400 ("The and operator requires an array of args").
  if (Object.keys(query).length) cuerpo.query = query;
  const r = await fetch(`${PC}/stac/v1/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  if (!r.ok) throw new Error(`Catálogo STAC respondió HTTP ${r.status}`);
  const j = await r.json();
  // Una escena por fecha: la de menor nubosidad.
  const porFecha = new Map();
  for (const it of j.features) {
    const dia = it.properties.datetime.slice(0, 10);
    const previa = porFecha.get(dia);
    const nb = it.properties["eo:cloud_cover"] ?? -1;
    if (!previa || nb < (previa.properties["eo:cloud_cover"] ?? -1)) porFecha.set(dia, it);
  }
  return [...porFecha.values()];
}

async function registrarMosaico(cfg, lat, lon, f0, f1, nubes) {
  const args = [
    { op: "=", args: [{ property: "collection" }, cfg.coleccion] },
    { op: "s_intersects", args: [{ property: "geometry" }, { type: "Point", coordinates: [lon, lat] }] },
    { op: "anyinteracts", args: [{ property: "datetime" }, { interval: [`${f0}T00:00:00Z`, `${f1}T23:59:59Z`] }] },
  ];
  if (cfg.nubes !== undefined) args.push({ op: "<=", args: [{ property: "eo:cloud_cover" }, nubes] });
  if (cfg.filtro?.platform) args.push({ op: "in", args: [{ property: "platform" }, cfg.filtro.platform.in] });
  const r = await fetch(`${PC}/data/v1/mosaic/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ "filter-lang": "cql2-json", filter: { op: "and", args }, sortby: [{ field: "datetime", direction: "desc" }] }),
  });
  if (!r.ok) throw new Error(`No se pudo registrar el compuesto (HTTP ${r.status})`);
  return (await r.json()).searchid;
}

function urlEscena(cfg, item, visKey) {
  const v = cfg.vis[visKey];
  return `${PC}/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@2x?collection=${cfg.coleccion}&item=${encodeURIComponent(item.id)}&${v.p(offsetS2(item))}`;
}
function urlMosaico(cfg, sid, visKey, f0) {
  const v = cfg.vis[visKey];
  // items_limit: mediana de las MAX_MEDIANA escenas mas recientes (con todas, cada tesela
  // tarda ~10 s; con 8, 2-5 s).
  // exitwhenfull/skipcovered=false: sin esto el mosaico se detiene en la primera escena que
  // cubre la tesela y la "mediana" es solo la escena mas reciente.
  return `${PC}/data/v1/mosaic/${sid}/tiles/WebMercatorQuad/{z}/{x}/{y}@2x?collection=${cfg.coleccion}&${v.p(offsetRango(f0))}&pixel_selection=median&exitwhenfull=false&skipcovered=false&items_limit=${MAX_MEDIANA}`;
}

function ultimoGOES(desfaseMin = 40) {
  const d = new Date(Date.now() - desfaseMin * 60000);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 10) * 10, 0, 0);
  return d;
}
const isoGIBS = (d) => d.toISOString().slice(0, 19) + "Z";
const horaLocal = (d) => d.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// =====================================================================
export async function render(cont, ctx) {
  const { volcan, cod, params } = ctx;
  const LAT = volcan.lat, LON = volcan.lon;
  let sensor = ["s2", "ls", "s1", "goes", "gibs"].includes(params.sensor) ? params.sensor : "s2";

  cont.append(html(`
    <section>
      <div class="encabezado-vista">
        <div>
          <h2>Monitoreo satelital · ${esc(volcan.nombre)}</h2>
          <p class="sub">Imágenes en vivo sobre el cráter (${LAT.toFixed(3)}°, ${LON.toFixed(3)}°). Sentinel-2, Landsat y Sentinel-1 se consultan
          en el catálogo abierto de Microsoft Planetary Computer; GOES-Este, MODIS y VIIRS, en NASA GIBS. El contorno de la zona de amenaza del SGC
          se puede superponer para ubicar los fenómenos.</p>
        </div>
      </div>
      <div class="pestanas" role="tablist" id="pestanas-sat">
        <button role="tab" data-s="s2">Sentinel-2 · óptico 10 m</button>
        <button role="tab" data-s="ls">Landsat 8/9 · óptico y térmico</button>
        <button role="tab" data-s="s1">Sentinel-1 · radar</button>
        <button role="tab" data-s="goes">GOES-Este · cada 10 min</button>
        <button role="tab" data-s="gibs">MODIS / VIIRS · diario</button>
      </div>
      <div class="rejilla rejilla-mapa">
        <div class="tarjeta tarjeta--sin-relleno">
          <div class="mapa mapa--alto" id="mapa-sat"></div>
          <div class="mapa-pie" id="pie-sat"></div>
        </div>
        <div class="tarjeta" id="panel-sat"></div>
      </div>
    </section>`));

  const elMapa = cont.querySelector("#mapa-sat");
  const panel = cont.querySelector("#panel-sat");
  const pie = cont.querySelector("#pie-sat");
  const map = crearMapa(elMapa, { limites: cuadroAlrededor(LAT, LON, 9), base: "topografico" });
  new maplibregl.Marker({ color: "#14181f", scale: 0.75 }).setLngLat([LON, LAT]).addTo(map);
  let temporizador = null;
  let turno = 0;

  await listo(map);
  map.addSource("exp", { type: "vector", url: `pmtiles://${absoluta(RUTAS.pmtiles(cod))}` });
  map.addLayer({ id: "contorno-amenaza", type: "line", source: "exp", "source-layer": "amenaza_borde",
    paint: { "line-color": ["match", ["get", "nivel"], "alta", AMENAZA.alta.color, "media", AMENAZA.media.color, AMENAZA.baja.color], "line-width": 1.8 },
    layout: { visibility: "visible" } });

  // -------------------------------------------------------------- capa raster activa
  function quitarCapas() {
    clearInterval(temporizador);
    temporizador = null;
    for (const l of map.getStyle().layers) if (l.id.startsWith("sat-")) map.removeLayer(l.id);
    for (const s of Object.keys(map.getStyle().sources)) if (s.startsWith("sat-")) map.removeSource(s);
  }
  function ponerCapa(id, tiles, { maxzoom = 18, tileSize = 512, opacidad = 1, atr = "", limites } = {}) {
    map.addSource(id, { type: "raster", tiles: [tiles], tileSize, maxzoom, attribution: atr, ...(limites ? { bounds: limites } : {}) });
    map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": opacidad, "raster-fade-duration": 150 } }, "contorno-amenaza");
  }

  function piePorDefecto(extra = "") {
    pie.innerHTML = `${extra}<span class="leyenda-titulo">Contorno de amenaza SGC</span>
      ${["alta", "media", "baja"].map((n) => `<span class="leyenda-item"><span class="linea" style="border-color:${AMENAZA[n].color}"></span>${AMENAZA[n].nombre}</span>`).join("")}
      <label class="casilla derecha"><input type="checkbox" id="ver-contorno" ${map.getLayoutProperty("contorno-amenaza", "visibility") !== "none" ? "checked" : ""}> Mostrar contorno</label>`;
    pie.querySelector("#ver-contorno").addEventListener("change", (e) => map.setLayoutProperty("contorno-amenaza", "visibility", e.target.checked ? "visible" : "none"));
  }
  function rampaPie(v) {
    if (!v.rampa) return "";
    return `<span class="escala-color"><span class="leyenda-titulo">${esc(v.t)}</span><span>${v.rango[0]}</span>
      <span class="gradiente" style="width:160px;background:linear-gradient(to right, ${v.rampa.join(",")})"></span><span>${v.rango[1]}</span></span>`;
  }

  // -------------------------------------------------------------- sensores opticos / radar
  async function vistaCatalogo(clave) {
    const cfg = SENSORES[clave];
    ++turno;
    const hoy = hoyISO();
    const est = { f0: params.f0 || sumarDias(hoy, -cfg.dias), f1: params.f1 || hoy, nubes: Number(params.nubes) || cfg.nubes, vis: params.vis in cfg.vis ? params.vis : Object.keys(cfg.vis)[0], escena: params.escena || null };
    panel.innerHTML = `
      <h3>${esc(cfg.nombre)}</h3>
      <p class="nota" style="margin-top:2px">${esc(cfg.resumen)}</p>
      <div class="rejilla rejilla-2" style="gap:10px;margin-top:10px">
        <label class="control"><span>Desde</span><input class="campo" type="date" id="f0" value="${est.f0}" max="${hoy}"></label>
        <label class="control"><span>Hasta</span><input class="campo" type="date" id="f1" value="${est.f1}" max="${hoy}"></label>
      </div>
      ${cfg.nubes !== undefined ? `<label class="control" style="margin-top:10px"><span>Nubosidad máxima de la escena: <b id="nb-v">${est.nubes} %</b></span>
        <input type="range" id="nubes" min="5" max="100" step="5" value="${est.nubes}"></label>` : ""}
      <label class="control" style="margin-top:10px"><span>Visualización</span>
        <select class="campo" id="vis">${Object.entries(cfg.vis).map(([k, v]) => `<option value="${k}" ${k === est.vis ? "selected" : ""}>${esc(v.t)}</option>`).join("")}</select></label>
      <p class="nota" id="vis-desc" style="margin-top:6px"></p>
      <div class="flex" style="margin:12px 0 6px;justify-content:space-between">
        <strong id="n-escenas">Buscando escenas…</strong>
        <label class="casilla">Opacidad <input type="range" id="opac" min="20" max="100" value="100" style="width:90px"></label>
      </div>
      <div class="lista-escenas" id="lista" role="listbox" aria-label="Escenas disponibles"></div>
      <p class="nota" style="margin-top:10px">${esc(cfg.nota)}</p>`;
    const $ = (s) => panel.querySelector(s);
    let escenas = [];

    function pintar() {
      quitarCapas();
      const v = cfg.vis[est.vis];
      $("#vis-desc").textContent = v.d;
      const op = Number($("#opac").value) / 100;
      let etiqueta;
      if (!est.escena) {
        etiqueta = "";
      } else if (est.escena === "compuesto") {
        etiqueta = `Compuesto mediano ${fecha(est.f0)} – ${fecha(est.f1)}`;
        const tok = ++turno;
        registrarMosaico(cfg, LAT, LON, est.f0, est.f1, est.nubes).then((sid) => {
          if (tok !== turno) return;
          ponerCapa("sat-capa", urlMosaico(cfg, sid, est.vis, est.f0), { opacidad: op, atr: "Microsoft Planetary Computer" });
        }).catch((e) => { $("#n-escenas").textContent = e.message; });
      } else {
        const it = escenas.find((x) => x.id === est.escena);
        if (it) {
          ponerCapa("sat-capa", urlEscena(cfg, it, est.vis), { opacidad: op, atr: "Microsoft Planetary Computer", limites: it.bbox });
          etiqueta = `${fecha(it.properties.datetime)}${it.properties["eo:cloud_cover"] !== undefined ? ` · ${entero(it.properties["eo:cloud_cover"])} % nubes` : ""}`;
        }
      }
      piePorDefecto(`${etiqueta ? `<span class="leyenda-titulo">${esc(cfg.nombre)} · ${esc(etiqueta)}</span>` : ""}${rampaPie(v)}`);
      panel.querySelectorAll(".escena").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === est.escena)));
      ctx.fijarParams({ sensor: clave, vis: est.vis, escena: est.escena && est.escena !== escenas[0]?.id ? est.escena : undefined,
        f0: est.f0 !== sumarDias(hoy, -cfg.dias) ? est.f0 : undefined, f1: est.f1 !== hoy ? est.f1 : undefined,
        nubes: cfg.nubes !== undefined && est.nubes !== cfg.nubes ? est.nubes : undefined });
    }

    async function buscar() {
      const mioB = ++turno;
      $("#n-escenas").textContent = "Buscando escenas…";
      $("#lista").innerHTML = '<div class="cargando" style="padding:24px 0"><span class="girador"></span></div>';
      try {
        escenas = await buscarEscenas(cfg, LAT, LON, est.f0, est.f1, est.nubes);
      } catch (e) {
        if (mioB !== turno) return;
        $("#n-escenas").textContent = "Catálogo no disponible";
        $("#lista").innerHTML = `<div class="aviso aviso--error" style="margin:8px"><span class="icono">!</span>${esc(e.message)}. Intente de nuevo en unos minutos.</div>`;
        return;
      }
      if (mioB !== turno) return;
      $("#n-escenas").textContent = `${escenas.length} ${escenas.length === 1 ? "escena" : "escenas"} en el rango`;
      if (!escenas.length) {
        $("#lista").innerHTML = '<div class="aviso" style="margin:8px"><span class="icono">i</span>Sin escenas con esos filtros. Amplíe el rango de fechas o el umbral de nubes.</div>';
        est.escena = null;
        pintar();
        return;
      }
      $("#lista").innerHTML = `
        <button class="escena" data-id="compuesto" aria-pressed="false">
          <span class="fecha">Compuesto mediano del rango</span><span class="nubes">${Math.min(escenas.length, MAX_MEDIANA)} escenas</span>
          <span class="meta">Mediana píxel a píxel${escenas.length > MAX_MEDIANA ? ` de las ${MAX_MEDIANA} más recientes` : ""}: reduce nubes y ruido</span></button>
        ${escenas.map((it) => {
          const p = it.properties;
          const nb = p["eo:cloud_cover"];
          const meta = [p.platform?.replace("sentinel-", "Sentinel-").replace("landsat-", "Landsat "), p["s2:mgrs_tile"] ? `tesela ${p["s2:mgrs_tile"]}` : "",
            p["sat:orbit_state"] ? `órbita ${p["sat:orbit_state"] === "ascending" ? "ascendente" : "descendente"}` : ""].filter(Boolean).join(" · ");
          return `<button class="escena" data-id="${esc(it.id)}" aria-pressed="false">
            <span class="fecha">${fecha(p.datetime)}</span>${nb !== undefined ? `<span class="nubes">${entero(nb)} % nubes</span>` : "<span></span>"}
            <span class="meta">${esc(meta)}</span>
            ${nb !== undefined ? `<span class="medidor"><span style="width:${nb}%"></span></span>` : ""}</button>`;
        }).join("")}`;
      if (!est.escena || (est.escena !== "compuesto" && !escenas.some((x) => x.id === est.escena))) est.escena = escenas[0].id;
      pintar();
    }

    $("#lista").addEventListener("click", (e) => {
      const b = e.target.closest(".escena");
      if (!b) return;
      est.escena = b.dataset.id;
      pintar();
    });
    $("#vis").addEventListener("change", (e) => { est.vis = e.target.value; pintar(); });
    $("#opac").addEventListener("input", (e) => { if (map.getLayer("sat-capa")) map.setPaintProperty("sat-capa", "raster-opacity", Number(e.target.value) / 100); });
    $("#f0").addEventListener("change", (e) => { est.f0 = e.target.value; est.escena = null; buscar(); });
    $("#f1").addEventListener("change", (e) => { est.f1 = e.target.value; est.escena = null; buscar(); });
    $("#nubes")?.addEventListener("input", (e) => { $("#nb-v").textContent = `${e.target.value} %`; });
    $("#nubes")?.addEventListener("change", (e) => { est.nubes = Number(e.target.value); est.escena = null; buscar(); });
    $("#vis-desc").textContent = cfg.vis[est.vis].d;
    map.fitBounds(cuadroAlrededor(LAT, LON, cfg.km), { duration: 0 });
    buscar();
  }

  // -------------------------------------------------------------- GOES-Este (animacion)
  function vistaGOES() {
    ++turno;
    let prod = params.prod in GOES ? params.prod : "geocolor";
    const N = 13;  // 2 horas
    let fin = ultimoGOES();
    let idx = N - 1;
    panel.innerHTML = `
      <h3>GOES-Este (GOES-19)</h3>
      <p class="nota" style="margin-top:2px">Satélite geoestacionario a 75,2° O. Una imagen del disco completo cada 10 minutos, con 20 a 40 minutos de latencia. Resolución de 1 a 2 km: vista regional.</p>
      <label class="control" style="margin-top:10px"><span>Producto</span>
        <select class="campo" id="prod">${Object.entries(GOES).map(([k, v]) => `<option value="${k}" ${k === prod ? "selected" : ""}>${esc(v.t)}</option>`).join("")}</select></label>
      <div class="flex" style="margin-top:14px">
        <button class="boton" id="play" aria-pressed="false">▶ Animar 2 horas</button>
        <button class="boton" id="recargar">Actualizar</button>
      </div>
      <label class="control" style="margin-top:12px"><span>Hora de la imagen: <b id="hora"></b></span>
        <input type="range" id="cuadro" min="0" max="${N - 1}" value="${N - 1}"></label>
      <p class="nota" style="margin-top:10px">Útil para vigilar la convección que dispara aguaceros sobre el edificio volcánico y para detectar nubes de ceniza
      de gran altura (más frías que su entorno en el infrarrojo). Si el último cuadro aparece vacío, GIBS aún no lo publica: mueva el deslizador hacia atrás.</p>`;
    const $ = (s) => panel.querySelector(s);

    function montar() {
      quitarCapas();
      const g = GOES[prod];
      for (let i = 0; i < N; i++) {
        const t = new Date(fin.getTime() - (N - 1 - i) * 600000);
        ponerCapa(`sat-goes-${i}`, `${GIBS}/${g.capa}/default/${isoGIBS(t)}/GoogleMapsCompatible_Level${g.nivel}/{z}/{y}/{x}.png`,
          { maxzoom: g.nivel, tileSize: 256, opacidad: i === idx ? 0.92 : 0, atr: "NOAA · NASA GIBS" });
        map.setPaintProperty(`sat-goes-${i}`, "raster-fade-duration", 0);
      }
      mostrar(idx);
      piePorDefecto(`<span class="leyenda-titulo">${esc(g.t)}</span>`);
      ctx.fijarParams({ sensor: "goes", prod });
    }
    function mostrar(i) {
      idx = i;
      for (let k = 0; k < N; k++) if (map.getLayer(`sat-goes-${k}`)) map.setPaintProperty(`sat-goes-${k}`, "raster-opacity", k === i ? 0.92 : 0);
      const t = new Date(fin.getTime() - (N - 1 - i) * 600000);
      $("#hora").textContent = `${horaLocal(t)} (hora de Colombia)`;
      $("#cuadro").value = i;
    }
    $("#prod").addEventListener("change", (e) => { prod = e.target.value; montar(); });
    $("#cuadro").addEventListener("input", (e) => mostrar(Number(e.target.value)));
    $("#recargar").addEventListener("click", () => { fin = ultimoGOES(); idx = N - 1; montar(); });
    $("#play").addEventListener("click", (e) => {
      const b = e.currentTarget;
      if (temporizador) { clearInterval(temporizador); temporizador = null; b.textContent = "▶ Animar 2 horas"; b.setAttribute("aria-pressed", "false"); return; }
      b.textContent = "❚❚ Pausar"; b.setAttribute("aria-pressed", "true");
      temporizador = setInterval(() => mostrar((idx + 1) % N), 650);
    });
    map.fitBounds(cuadroAlrededor(LAT, LON, 320), { duration: 0 });
    montar();
  }

  // -------------------------------------------------------------- MODIS / VIIRS diario (GIBS)
  function vistaGIBS() {
    ++turno;
    const hoy = hoyISO();
    let capa = params.capa in GIBS_DIARIO ? params.capa : "VIIRS_NOAA20_CorrectedReflectance_TrueColor";
    let dia = params.dia || hoy;
    panel.innerHTML = `
      <h3>MODIS / VIIRS diario</h3>
      <p class="nota" style="margin-top:2px">Reflectancia corregida de NASA Worldview (GIBS): una imagen por día y satélite, publicada 3 a 5 horas después del paso.</p>
      <label class="control" style="margin-top:10px"><span>Satélite y producto</span>
        <select class="campo" id="capa">${Object.entries(GIBS_DIARIO).map(([k, v]) => `<option value="${k}" ${k === capa ? "selected" : ""}>${esc(v.t)}</option>`).join("")}</select></label>
      <div class="flex" style="margin-top:10px">
        <button class="boton boton--chico" id="ant" aria-label="Día anterior">◀</button>
        <input class="campo" type="date" id="dia" value="${dia}" max="${hoy}" min="${sumarDias(hoy, -365 * 3)}">
        <button class="boton boton--chico" id="sig" aria-label="Día siguiente">▶</button>
      </div>
      <p class="nota" id="info-gibs" style="margin-top:10px"></p>
      <p class="nota">Si la imagen del día aparece vacía o parcial, el satélite aún no ha pasado o GIBS no la ha publicado: elija el día anterior.
      Las franjas negras son zonas sin cobertura en ese paso.</p>`;
    const $ = (s) => panel.querySelector(s);
    function pintar() {
      quitarCapas();
      const info = GIBS_DIARIO[capa];
      ponerCapa("sat-gibs", `${GIBS}/${capa}/default/${dia}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, { maxzoom: 9, tileSize: 256, atr: "NASA EOSDIS GIBS / Worldview" });
      $("#info-gibs").innerHTML = `<strong>${esc(info.t)}</strong> · ${fecha(dia)} · resolución ${info.res} · paso ${info.paso} hora local`;
      $("#dia").value = dia;
      $("#sig").disabled = dia >= hoy;
      piePorDefecto(`<span class="leyenda-titulo">${esc(info.t)} · ${fecha(dia)}</span>`);
      ctx.fijarParams({ sensor: "gibs", capa, dia: dia !== hoy ? dia : undefined });
    }
    $("#capa").addEventListener("change", (e) => { capa = e.target.value; pintar(); });
    $("#dia").addEventListener("change", (e) => { if (e.target.value) { dia = e.target.value; pintar(); } });
    $("#ant").addEventListener("click", () => { dia = sumarDias(dia, -1); pintar(); });
    $("#sig").addEventListener("click", () => { if (dia < hoy) { dia = sumarDias(dia, 1); pintar(); } });
    map.fitBounds(cuadroAlrededor(LAT, LON, 45), { duration: 0 });
    pintar();
  }

  // -------------------------------------------------------------- pestanas
  function activar(s) {
    sensor = s;
    cont.querySelectorAll("#pestanas-sat button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.s === s)));
    if (s === "goes") vistaGOES();
    else if (s === "gibs") vistaGIBS();
    else vistaCatalogo(s);
  }
  cont.querySelector("#pestanas-sat").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.dataset.s === sensor) return;
    for (const k of ["vis", "escena", "f0", "f1", "nubes", "prod", "capa", "dia"]) delete params[k];
    ctx.fijarParams({ sensor: b.dataset.s, vis: undefined, escena: undefined, f0: undefined, f1: undefined, nubes: undefined, prod: undefined, capa: undefined, dia: undefined });
    activar(b.dataset.s);
  });
  activar(sensor);

  return () => { clearInterval(temporizador); turno++; map.remove(); };
}
