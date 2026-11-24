# GeoVolcanes-SCR · Geoportal de exposición volcánica de Colombia (versión GitHub Pages)

Portal web estático de la **UNGRD** que muestra, para los volcanes activos monitoreados por el Servicio Geológico Colombiano (SGC), cuántas **viviendas, personas y unidades económicas** quedan dentro de cada zona de amenaza volcánica. Integra además **monitoreo satelital en vivo** y **lluvia satelital** sobre cada cráter.

Es la versión de publicación del proyecto de cálculo **GeoVolcanes-SCR** (PostGIS + FastAPI + Streamlit). Aquí no hay servidores: el navegador lee archivos precalculados de la carpeta `data/` y consulta servicios abiertos de imágenes.

- **En línea (portal oficial UNGRD):** https://scr-ungrd.github.io/geovolcanes/
- **Repositorio oficial:** https://github.com/scr-ungrd/geovolcanes (réplica de trabajo: https://github.com/jorgealpala/geovolcanes)
- **Punto de entrada:** `index.html`
- **Probar en local:** `python scripts/servidor_local.py` y abrir http://localhost:8765
- **Actualizar datos y publicar:** [docs/SINCRONIZACION.md](docs/SINCRONIZACION.md) (proyectos, scripts y GitHub) y [docs/FLUJO_ACTUALIZACION.md](docs/FLUJO_ACTUALIZACION.md) (casos en detalle)

---

## A. Qué muestra el portal

| Pestaña | Qué muestra | De dónde salen los datos |
|---|---|---|
| **Panorama nacional** | Mapa de los volcanes por nivel de alerta del SGC con las zonas de amenaza de todos los volcanes (todos los niveles, solo alta, media o baja), indicadores nacionales, comparación de viviendas en amenaza alta, departamentos y municipios en cada nivel de amenaza (resumen, detalle por departamento y CSV) y ranking de exposición. | `data/catalogo.json`, `data/ranking.json`, `data/nacional/` |
| **Exposición** | Para el volcán elegido y el nivel de amenaza (todos, alta, media o baja), el tipo de unidad (urbano o rural) y la métrica (viviendas o personas): indicadores, mapa de intersección amenaza × manzanas y secciones del DANE, gráficas, métricas por nivel, tabla de municipios con búsqueda y CSV, y metodología. | `data/volcanes/<COD>/resumen.json` y `exposicion.pmtiles` |
| **Satelital** | Sentinel-2, Landsat 8/9 y Sentinel-1 en vivo por rango de fechas con calendario de escenas y compuesto mediano; GOES-19 animado (últimas 2 horas); MODIS y VIIRS diarios. Contorno de la amenaza del SGC superpuesto. | Microsoft Planetary Computer y NASA GIBS (en vivo, sin claves) |
| **Hidrometeorología** | Lluvia diaria de IMERG, CHIRPS y ERA5-Land sobre el cráter (hasta 1 año), acumulados semanales y mensuales, últimos 12 meses frente a la climatología, pronóstico de 7 días, mapas de lluvia acumulada por periodo y mapa de lluvia media anual. | `data/hidromet/<COD>.json` (Earth Engine, diario) y Open-Meteo (en vivo) |

La URL guarda el estado completo (volcán, pestaña y filtros). Por ejemplo, `#/exposicion?v=VCM&nivel=alta&tipo=urbano` o `#/nacional?amenaza=media` se pueden compartir tal cual.

## B. Cómo funciona

```
 Proyecto de cálculo (geovolcanes-scr)                 Este repositorio (GitHub Pages)
 ┌──────────────────────────────────────┐             ┌─────────────────────────────────────────┐
 │ PostGIS: amenaza SGC × DANE MGN 2025 │  exportar   │ data/  (JSON + PMTiles, solo lectura)    │
 │ scripts/exportar_web.py  ────────────┼────────────▶│ index.html + assets/  (HTML, CSS, JS)    │
 │ (verifica cada cifra contra la API)  │ sincronizar │                                          │
 └──────────────────────────────────────┘             │ En vivo desde el navegador:              │
                                                      │  · Planetary Computer (Sentinel, Landsat)│
 GitHub Actions (cada día, 06:30)                     │  · NASA GIBS (GOES-19, MODIS, VIIRS)     │
  scripts/actualizar_hidromet.py ── Earth Engine ────▶│  · Open-Meteo (pronóstico de lluvia)     │
                                                      └─────────────────────────────────────────┘
```

- **Sin backend:** HTML, CSS y JavaScript (módulos ES) que leen `data/` con `fetch()`.
- **Librerías desde CDN, con versión fija:** MapLibre GL 4.7.1 (mapas y relieve 3D), PMTiles 3.2.1 (teselas vectoriales) y Apache ECharts 5.5.1 (gráficas).
- **Mapas de intersección rápidos:** las manzanas y secciones expuestas van en un archivo `exposicion.pmtiles` por volcán. El navegador descarga solo las teselas visibles mediante lecturas parciales (HTTP Range), que GitHub Pages soporta.
- **Sin credenciales en el navegador:** Earth Engine solo se usa al generar `data/hidromet/` (en local o en GitHub Actions con un secreto).

## C. Estructura de carpetas

```
geovolcanes-scr-web/
├── index.html                      ← punto de entrada (GitHub Pages lo sirve en la raíz)
├── .nojekyll                       ← sirve los archivos tal cual (desactiva Jekyll)
├── assets/
│   ├── css/estilos.css             ← estilos; colores definidos por rol
│   ├── img/ungrd_logo.png
│   └── js/
│       ├── main.js                 ← enrutador por hash y selector de volcán
│       ├── datos.js · formato.js · constantes.js · mapas.js · graficos.js
│       └── vistas/                 ← nacional.js (+ nacional-amenaza.js), exposicion.js, satelital.js, hidromet.js
├── data/                           ← DATOS (ver docs/DATOS.md)
│   ├── index.json                  ← manifiesto: fecha, volcanes, archivos
│   ├── catalogo.json · ranking.json · colombia_departamentos.geojson
│   ├── volcanes/<COD>/resumen.json + exposicion.pmtiles
│   ├── nacional/amenaza.pmtiles + territorio.json   ← mapa nacional y municipios en amenaza
│   └── hidromet/<COD>.json + index.json
├── scripts/
│   ├── actualizar_hidromet.py      ← lluvia con Earth Engine (local o Actions)
│   ├── sincronizar_desde_scr.ps1   ← copia data/export_web/ del proyecto de cálculo (PowerShell)
│   ├── sincronizar_desde_scr.sh    ← lo mismo para Git Bash
│   ├── validar_datos.py            ← revisa coherencia, tamaños y credenciales antes de publicar
│   ├── publicar_github.ps1         ← valida, confirma y sube al oficial (ungrd) y a la réplica (origin)
│   ├── publicar_github.sh          ← lo mismo para Git Bash
│   └── servidor_local.py           ← servidor de prueba con soporte de HTTP Range
├── .github/workflows/actualizar-hidromet.yml
└── docs/
    ├── SINCRONIZACION.md           ← proyectos, scripts y GitHub: la rutina de 3 pasos
    ├── FLUJO_ACTUALIZACION.md      ← paso a paso: volcán nuevo, recálculo, publicación
    └── DATOS.md                    ← formatos, fuentes, metodología y colores
```

## D. ¿Dónde se colocan los datos nuevos?

Nunca a mano. Todo dato de exposición lo genera el proyecto de cálculo: `scripts\publicar_web.ps1` (en SCR) exporta y sincroniza, y `scripts\publicar_github.ps1` (aquí) publica. Detalle en [docs/SINCRONIZACION.md](docs/SINCRONIZACION.md).

| Si cambió… | Haga esto | Archivos que se actualizan |
|---|---|---|
| Un volcán nuevo o un mapa de amenaza nuevo | Flujo completo de [FLUJO_ACTUALIZACION.md §2](docs/FLUJO_ACTUALIZACION.md) | `catalogo.json`, `ranking.json`, `volcanes/<COD>/`, `nacional/`, `hidromet/<COD>.json` |
| Un recálculo de exposición o el nivel de alerta de un volcán | Exportar y sincronizar ([§3](docs/FLUJO_ACTUALIZACION.md)) | `catalogo.json`, `ranking.json`, `volcanes/`, `nacional/` |
| La lluvia satelital | Nada: GitHub Actions la actualiza cada día ([§4](docs/FLUJO_ACTUALIZACION.md)) | `hidromet/` |

## E. Probar localmente

GitHub Pages es HTTP; con doble clic el navegador bloquea los `fetch()`. Además, `python -m http.server` **no** sirve lecturas parciales y el mapa de exposición quedaría vacío. Use el servidor incluido:

```
python scripts/servidor_local.py
```

y abra http://localhost:8765. Antes de publicar, ejecute siempre `python scripts/validar_datos.py`.

## F. Publicar en GitHub Pages

Este repositorio se publica en dos remotos: **`ungrd`** = https://github.com/scr-ungrd/geovolcanes (oficial, con GitHub Pages en https://scr-ungrd.github.io/geovolcanes/) y **`origin`** = https://github.com/jorgealpala/geovolcanes (réplica de trabajo). Cada publicación se hace con un solo comando:

```powershell
.\scripts\publicar_github.ps1 -Simular                         # ver qué haría
.\scripts\publicar_github.ps1 -Mensaje "portal: <qué cambió>"  # validar, confirmar y subir a ambos
```

Configuración inicial de cada repositorio (Pages, secreto `GEE_SERVICE_ACCOUNT_KEY`, permisos de Actions, lluvia diaria solo en el oficial) y cómo clonar en otro equipo: [docs/SINCRONIZACION.md §5](docs/SINCRONIZACION.md).

El repositorio pesa unos 75 MB, casi todo en los `.pmtiles`. Ningún archivo se acerca al límite de 100 MB de GitHub; `validar_datos.py` lo comprueba.

## G. Servicios externos que usa el navegador

| Servicio | Para qué | Clave | Nota |
|---|---|---|---|
| Esri ArcGIS Online (basemaps) | Mapas base gris, satelital, topográfico, relieve | No | Uso con atribución |
| OpenStreetMap | Mapa base de calles | No | Política de uso justo de tile.openstreetmap.org |
| AWS Terrain Tiles (Mapzen) | Relieve 3D y sombreado | No | Datos abiertos en AWS |
| Microsoft Planetary Computer | Catálogo STAC y teselas de Sentinel-2, Landsat y Sentinel-1 | No | Si responde lento, reintentar |
| NASA GIBS | GOES-19, MODIS y VIIRS | No | Latencia de 20 a 40 min (GOES) y de 3 a 5 h (diarios) |
| Open-Meteo | Pronóstico de lluvia de 7 días | No | Uso no comercial gratuito |

Si un servicio externo falla, la pestaña correspondiente muestra un aviso; la exposición nunca depende de ellos.

## H. Diferencias con el módulo Streamlit

- **Exposición:** mismas cifras, verificadas automáticamente contra la API (viviendas, personas, manzanas, secciones, placas, unidades económicas y municipios de los 13 volcanes). El mapa ya no se cae en mapas regionales grandes: Cerro Bravo y Cerro Machín se ven completos en todos los niveles. Se agregaron coloreo por viviendas expuestas, resaltado y zoom por municipio, relieve 3D, más mapas base, gráfica de municipios y totales sin doble conteo.
- **Satelital:** igual que antes (S2, Landsat, S1, GOES, MODIS/VIIRS con rango de fechas, calendario y compuesto mediano) pero sin Earth Engine. Se agregaron temperatura de superficie de Landsat, compuesto de color del radar y animación de GOES. **No está** la fusión pancromática a 15 m de Landsat: el catálogo abierto solo distribuye nivel 2.
- **Hidrometeorología:** mismas fuentes y productos, más pronóstico de 7 días y comparación con la climatología. Los mapas de lluvia se actualizan una vez al día y no al momento de consultar.
- **Escenarios y Reportes:** no se migraron (tampoco están en el módulo actual).

## I. Cómo citar

> Alpala, J. A., Franco, A. C. y Lima, M. C. (2026). *GeoVolcanes-SCR: geoportal libre y replicable para la evaluación de exposición y apoyo a la toma de decisiones ante amenaza volcánica. Estudio de caso: volcán Nevado del Ruiz* [Geoportal]. Subdirección para el Conocimiento del Riesgo, Unidad Nacional para la Gestión del Riesgo de Desastres (UNGRD). https://scr-ungrd.github.io/geovolcanes/

Autores: Jorge Armando Alpala¹, Aura Catalina Franco¹ y María Camila Lima¹.  
¹ Subdirección para el Conocimiento del Riesgo (SCR), Unidad Nacional para la Gestión del Riesgo de Desastres (UNGRD), Bogotá, Colombia. Contacto: jorge.alpala@gestiondelriesgo.gov.co

El archivo [`CITATION.cff`](CITATION.cff) activa el botón **Cite this repository** de GitHub (APA y BibTeX). El pie del geoportal tiene la misma cita con botones para copiarla.

## J. Créditos

Amenaza volcánica: **Servicio Geológico Colombiano**. Exposición: **DANE**, Marco Geoestadístico Nacional 2025. Imágenes: Copernicus (ESA), NASA, USGS y NOAA. Lluvia: NASA GPM IMERG, UCSB CHIRPS, ECMWF ERA5-Land y Open-Meteo. Desarrollo: UNGRD, Subdirección para el Conocimiento del Riesgo.
