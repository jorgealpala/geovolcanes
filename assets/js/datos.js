// Lectura de los datos consolidados (carpeta data/). El portal no calcula
// exposicion: solo lee lo que exporta el proyecto GeoVolcanes-SCR.

const cache = new Map();

export const RUTAS = {
  indice: "data/index.json",
  catalogo: "data/catalogo.json",
  ranking: "data/ranking.json",
  departamentos: "data/colombia_departamentos.geojson",
  resumen: (cod) => `data/volcanes/${cod}/resumen.json`,
  pmtiles: (cod) => `data/volcanes/${cod}/exposicion.pmtiles`,
  hidromet: (cod) => `data/hidromet/${cod}.json`,
  hidrometIndice: "data/hidromet/index.json",
};

export function json(ruta) {
  if (!cache.has(ruta)) {
    const p = fetch(ruta).then((r) => {
      if (!r.ok) throw new Error(`No se pudo leer ${ruta} (HTTP ${r.status})`);
      return r.json();
    });
    p.catch(() => cache.delete(ruta));
    cache.set(ruta, p);
  }
  return cache.get(ruta);
}

// URL absoluta (MapLibre/PMTiles necesitan URLs completas)
export function absoluta(ruta) {
  return new URL(ruta, document.baseURI).href;
}

// Contexto global cargado una vez al inicio.
export async function cargarContexto() {
  const [catalogo, ranking, indice] = await Promise.all([
    json(RUTAS.catalogo), json(RUTAS.ranking), json(RUTAS.indice),
  ]);
  const porCodigo = new Map(catalogo.volcanes.map((v) => [v.codigo, v]));
  const conDatos = ranking.ranking.map((r) => porCodigo.get(r.codigo)).filter(Boolean);
  return { catalogo, ranking, indice, porCodigo, conDatos };
}
