// Mapas: fabrica de mapas MapLibre con mapas base seleccionables, relieve 3D
// y el protocolo PMTiles para las teselas vectoriales de exposicion.
/* global maplibregl, pmtiles */

import { ALERTA } from "./constantes.js";

let protocoloRegistrado = false;
export function registrarPMTiles() {
  if (protocoloRegistrado) return;
  const protocolo = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocolo.tile);
  protocoloRegistrado = true;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATR = "Esri, Maxar, Earthstar Geographics, USGS, IGN y la comunidad de usuarios SIG";
const OSM_ATR = '© <a href="https://www.openstreetmap.org/copyright">Colaboradores de OpenStreetMap</a>';

export const MAPAS_BASE = {
  claro: {
    nombre: "Gris claro (Esri)",
    capas: [
      { tiles: [`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`], atr: "Esri, HERE, Garmin, OpenStreetMap", max: 16 },
      { tiles: [`${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`], atr: "Esri", max: 16 },
    ],
  },
  calles: {
    nombre: "Calles (OpenStreetMap)",
    capas: [{ tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], atr: OSM_ATR, max: 19 }],
  },
  satelite: {
    nombre: "Satelital (Esri)",
    capas: [
      { tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], atr: ESRI_ATR, max: 19 },
      { tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], atr: "Esri", max: 19 },
    ],
  },
  topografico: {
    nombre: "Topográfico (Esri)",
    capas: [{ tiles: [`${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`], atr: "Esri, HERE, Garmin, USGS, NGA", max: 19 }],
  },
  relieve: {
    nombre: "Relieve sombreado (Esri)",
    capas: [
      { tiles: [`${ESRI}/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`], atr: "Esri, USGS, NGA, NASA, CGIAR", max: 16 },
      { tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], atr: "Esri", max: 19 },
    ],
  },
  oscuro: {
    nombre: "Gris oscuro (Esri)",
    capas: [
      { tiles: [`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`], atr: "Esri, HERE, Garmin, OpenStreetMap", max: 16 },
      { tiles: [`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`], atr: "Esri", max: 16 },
    ],
  },
};

const DEM = {
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 14,
  attribution: "Relieve: Mapzen Terrain Tiles (AWS Open Data)",
};

function estiloBase(base) {
  const sources = { dem: DEM, "dem-sombra": { ...DEM } };
  const layers = [{ id: "fondo", type: "background", paint: { "background-color": "#e9ecef" } }];
  for (const [id, mb] of Object.entries(MAPAS_BASE)) {
    mb.capas.forEach((c, i) => {
      const sid = `base-${id}-${i}`;
      sources[sid] = { type: "raster", tiles: c.tiles, tileSize: 256, maxzoom: c.max, attribution: c.atr };
      layers.push({ id: sid, type: "raster", source: sid, layout: { visibility: id === base ? "visible" : "none" } });
    });
  }
  layers.push({
    id: "sombreado", type: "hillshade", source: "dem-sombra", layout: { visibility: "none" },
    paint: { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "#3d3d3d", "hillshade-highlight-color": "#ffffff" },
  });
  return { version: 8, sources, layers };
}

// Control para elegir mapa base y activar el sombreado del relieve.
class ControlMapaBase {
  constructor(base) { this.base = base; }
  onAdd(map) {
    this.map = map;
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl maplibregl-ctrl-group";
    el.style.position = "relative";
    el.innerHTML = `
      <button type="button" title="Mapa base" aria-label="Mapa base" aria-expanded="false" style="display:flex;align-items:center;justify-content:center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="1.8"><path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 13 10 5 10-5"/><path d="m2 17.5 10 5 10-5" opacity=".5"/></svg>
      </button>
      <div class="menu-base oculto" style="position:absolute;right:34px;top:0;background:#fff;border:1px solid #e3e6eb;border-radius:10px;box-shadow:0 4px 16px rgba(16,24,40,.12);padding:8px 10px;min-width:210px;font-size:12.5px">
        <div style="font-weight:650;margin-bottom:4px">Mapa base</div>
        ${Object.entries(MAPAS_BASE).map(([id, mb]) => `
          <label style="display:flex;gap:7px;align-items:center;padding:3px 0;cursor:pointer">
            <input type="radio" name="base-${map._container.id}" value="${id}" ${id === this.base ? "checked" : ""}> ${mb.nombre}
          </label>`).join("")}
        <hr style="border:0;border-top:1px solid #eef0f3;margin:6px 0">
        <label style="display:flex;gap:7px;align-items:center;cursor:pointer"><input type="checkbox" data-sombra> Sombreado del relieve</label>
      </div>`;
    const boton = el.querySelector("button");
    const menu = el.querySelector(".menu-base");
    boton.addEventListener("click", () => {
      menu.classList.toggle("oculto");
      boton.setAttribute("aria-expanded", String(!menu.classList.contains("oculto")));
    });
    menu.addEventListener("change", (e) => {
      if (e.target.name?.startsWith("base-")) cambiarBase(map, e.target.value);
      if (e.target.dataset.sombra !== undefined) {
        map.setLayoutProperty("sombreado", "visibility", e.target.checked ? "visible" : "none");
      }
    });
    this.cerrar = (e) => { if (!el.contains(e.target)) menu.classList.add("oculto"); };
    document.addEventListener("click", this.cerrar);
    this.el = el;
    return el;
  }
  onRemove() { document.removeEventListener("click", this.cerrar); this.el.remove(); }
}

export function cambiarBase(map, base) {
  for (const [id, mb] of Object.entries(MAPAS_BASE)) {
    mb.capas.forEach((_, i) => map.setLayoutProperty(`base-${id}-${i}`, "visibility", id === base ? "visible" : "none"));
  }
}

let contador = 0;
export function crearMapa(el, { centro = [-74.3, 4.6], zoom = 5, base = "claro", limites, terreno = true, pantallaCompleta = true } = {}) {
  if (!el.id) el.id = `mapa-${++contador}`;
  const map = new maplibregl.Map({
    container: el,
    style: estiloBase(base),
    center: centro,
    zoom,
    bounds: limites,
    fitBoundsOptions: { padding: 30 },
    attributionControl: { compact: true },
    maxPitch: 75,
    dragRotate: true,
    locale: {
      "NavigationControl.ZoomIn": "Acercar", "NavigationControl.ZoomOut": "Alejar",
      "NavigationControl.ResetBearing": "Restablecer orientación",
      "FullscreenControl.Enter": "Pantalla completa", "FullscreenControl.Exit": "Salir de pantalla completa",
      "TerrainControl.Enable": "Activar relieve 3D", "TerrainControl.Disable": "Desactivar relieve 3D",
    },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  if (pantallaCompleta) map.addControl(new maplibregl.FullscreenControl(), "top-right");
  map.addControl(new ControlMapaBase(base), "top-right");
  if (terreno) map.addControl(new maplibregl.TerrainControl({ source: "dem", exaggeration: 1.4 }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  el.__mapa = map;  // acceso para depuracion desde la consola
  // "Listo" = estilo cargado. No se espera a "load", que MapLibre retrasa hasta que
  // TODAS las teselas visibles respondan: un mapa base lento bloquearia las capas.
  const marcar = () => {
    if (map.__cargado || !map.style?._loaded) return;
    map.__cargado = true;
    map.off("styledata", marcar);
    map.fire("gv:listo");
  };
  map.on("styledata", marcar);
  map.once("load", marcar);
  return map;
}

// Resuelve cuando el estilo del mapa ya cargo (evento "load", una sola vez).
// No usa map.loaded(), que vuelve a false mientras haya teselas descargandose.
export function listo(map) {
  return new Promise((res) => (map.__cargado ? res() : map.once("gv:listo", res)));
}

// Pin SVG del volcan coloreado con el nivel de alerta oficial del SGC.
export function elementoVolcan(v, { seleccionado = false, atenuado = false } = {}) {
  const color = atenuado ? "#9aa1ad" : (ALERTA[v.nivel_actividad]?.color || "#9aa1ad");
  const el = document.createElement("div");
  el.className = `marcador-volcan${seleccionado ? " sel" : ""}`;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", `${v.nombre} (${v.codigo})`);
  const t = atenuado ? 0.8 : 1;
  el.innerHTML = `<svg width="${26 * t}" height="${34 * t}" viewBox="0 0 26 34" aria-hidden="true">
    <path d="M13 1C6.4 1 1.3 6.1 1.3 12.6 1.3 21 13 33 13 33s11.7-12 11.7-20.4C24.7 6.1 19.6 1 13 1Z" fill="${color}" stroke="#1f2937" stroke-width="1.2" ${atenuado ? 'fill-opacity=".55"' : ""}/>
    <path d="M7.5 17 11.4 9.6 13 11.6 14.6 9.6 18.5 17Z" fill="#fff" fill-opacity=".92"/></svg>`;
  return el;
}

export function cuadroAlrededor(lat, lon, km) {
  const dlat = km / 111.32;
  const dlon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [[lon - dlon, lat - dlat], [lon + dlon, lat + dlat]];
}
