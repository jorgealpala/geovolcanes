// Colores y etiquetas compartidos. Deben coincidir con las variables de estilos.css.
// Paletas validadas para daltonismo y vision normal (ver docs/DATOS.md, seccion Colores).

export const NIVELES = ["alta", "media", "baja"];

export const AMENAZA = {
  alta:  { color: "#b42318", nombre: "Alta",  desc: "Flujos piroclásticos, lahares, lava y proyectiles balísticos" },
  media: { color: "#e8681a", nombre: "Media", desc: "Caída de piroclastos y fenómenos proximales de menor alcance" },
  baja:  { color: "#d9a800", nombre: "Baja",  desc: "Caída de ceniza distal" },
};

export const TIPO = {
  urbano: { color: "#2a78d6", nombre: "Urbano", unidad: "manzana" },
  rural:  { color: "#1baf7a", nombre: "Rural",  unidad: "sección rural" },
};

export const ALERTA = {
  verde:    { color: "#16a34a", nombre: "Verde",    desc: "Volcán activo en reposo" },
  amarillo: { color: "#eab308", nombre: "Amarillo", desc: "Cambios en el comportamiento del nivel base" },
  naranja:  { color: "#ea580c", nombre: "Naranja",  desc: "Cambios importantes en los parámetros monitoreados" },
  rojo:     { color: "#dc2626", nombre: "Rojo",     desc: "Volcán en erupción" },
};

export const ESCALA = {
  influencia_proximal: { nombre: "Proximal", clase: "proximal",
    desc: "Mapa de zonificación proximal (flujos, lahares y caída cercana)." },
  influencia_regional: { nombre: "Regional", clase: "regional",
    desc: "El mapa modela además la dispersión regional de ceniza en escenarios extremos: sus cifras de amenaza media y baja no son comparables con las de mapas proximales." },
};

export const METODO = {
  placas_proxy: "Urbano con direcciones (placas como proxy de densidad)",
  area_fallback: "Urbano sin direcciones (ponderación por área)",
  area_ponderada_9377: "Rural (ponderación por área en EPSG:9377)",
};

export const FUENTE_LLUVIA = {
  imerg:  { color: "#2a78d6", nombre: "IMERG (NASA GPM)" },
  chirps: { color: "#eb6834", nombre: "CHIRPS (UCSB)" },
  era5:   { color: "#1baf7a", nombre: "ERA5-Land (ECMWF)" },
};

// Rampa secuencial de un solo tono (azul) para lluvia: claro = poco, oscuro = mucho.
export const RAMPA_LLUVIA = ["#f3f8fe", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

export const FACTOR_PERSONAS = 3.0;
