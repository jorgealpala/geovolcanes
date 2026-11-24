# Datos, metodología y convenciones · GeoVolcanes-SCR web

## 1. Archivos de `data/`

Todos los JSON están en UTF-8. Las coordenadas están en EPSG:4326 (lon, lat). Las áreas se midieron en EPSG:9377.

### `index.json` — manifiesto

| Campo | Contenido |
|---|---|
| `generado` | Fecha y hora de la exportación de exposición |
| `volcanes_con_exposicion` | Códigos con datos, ordenados por viviendas totales |
| `exportados_en_esta_corrida` | Códigos regenerados en la última exportación |
| `teselas` | Por volcán: número de teselas, bytes, tesela más pesada y segundos de cálculo |
| `archivos` | Ruta y tamaño de cada archivo exportado |

### `catalogo.json`

`volcanes[]`: los volcanes activos del catálogo con `codigo`, `nombre`, `observatorio`, `departamento[]`, `altitud_m`, `nivel_actividad` (verde, amarillo, naranja o rojo), `estado_proyecto`, `escala_mapa` (`influencia_proximal` o `influencia_regional`), `anio_pub`, `version_mapa`, `lat`, `lon`, `n_niveles` y `tiene_exposicion`. `observatorios{}` trae nombre, ciudad y departamento de cada observatorio. Los textos con tildes salen de `config/volcanes.yaml` del proyecto de cálculo.

### `ranking.json`

`ranking[]`: un registro por volcán con exposición, con `viv_alta`, `viv_media`, `viv_baja`, `viv_total`, sus equivalentes `per_*` en personas, `n_municipios` y `ue_alta` (unidades económicas en amenaza alta).

### `volcanes/<COD>/resumen.json`

| Bloque | Contenido |
|---|---|
| `niveles.alta`, `niveles.media`, `niveles.baja` | `viviendas`, `viviendas_urbano`, `viviendas_rural`, `personas*`, `manzanas`, `secciones`, `municipios`, `area_amenaza_km2`, `area_unidades_km2`, `placas`, `unidades_economicas` |
| `total` | Lo mismo para los tres niveles, **sin doble conteo** de manzanas, secciones ni municipios |
| `municipios[]` | `cod` (DIVIPOLA), `mpio`, `dpto`, viviendas por nivel (`alta`, `media`, `baja`) con desglose urbano (`_u`) y rural (`_r`), `total` y `bbox` |
| `metodos[]` | Unidades y viviendas por nivel, método y tipo |
| `fuentes`, `fechas` | Trazabilidad: versión del mapa SGC, insumos DANE, fecha del cruce |
| `bbox` | Extensión de la zonificación de amenaza |

### `volcanes/<COD>/exposicion.pmtiles`

Teselas vectoriales (Mapbox Vector Tiles, PMTiles v3, zoom 6 a 12; el navegador amplía más allá del 12). Capas:

| Capa | Geometría | Atributos | Visible desde |
|---|---|---|---|
| `amenaza` | Polígonos consolidados (subdivididos) | `nivel` | zoom 6 |
| `amenaza_borde` | Contorno de cada nivel | `nivel` | zoom 6 |
| `unidades` | Intersección de cada manzana o sección con la zona de amenaza | `nivel`, `tipo`, `metodo`, `mpio`, `unidad`, `viv` (viviendas expuestas, 1 decimal), `viv_tot`, `pct` (% del área de la unidad dentro de la zona), `placas` | rural zoom 7, urbano zoom 11 |
| `municipios` | Límites municipales | `mpio`, `nombre`, `dpto` | zoom 8 |
| `departamentos` | Límites departamentales | `dpto`, `nombre` | zoom 6 |

### `nacional/amenaza.pmtiles`

Zonas de amenaza de **todos** los volcanes con mapa del SGC, para el mapa del panorama nacional (PMTiles v3, zoom 3 a 11, geometría simplificada a un píxel por zoom). Capas:

| Capa | Contenido | Uso en el portal |
|---|---|---|
| `todos` | Unión nacional mutuamente excluyente (`nivel`): cada punto toma el nivel más severo de cualquier volcán | Botón "Todos los niveles" |
| `nivel` | Unión nacional de cada nivel por separado (`nivel`), sin restar los otros | Botones "Alta", "Media", "Baja" |
| `zona` | Zona de cada volcán y nivel (`cod`, `nivel`) | Invisible: identifica volcanes al hacer clic |
| `borde` | Contorno de cada volcán y nivel (`cod`, `nivel`) | Líneas del mapa |

### `nacional/territorio.json`

Municipios cuyo territorio interseca la zona de amenaza consolidada de algún volcán.

| Bloque | Contenido |
|---|---|
| `resumen.<nivel>` | Para `alta`, `media`, `baja` y `cualquiera`: `departamentos`, `municipios`, `volcanes` y `areas_litigio` |
| `municipios[]` | `cod` (DIVIPOLA), `mpio`, `dpto`, `dpto_cod`, `area_km2`, `bbox`, `litigio` y `niveles.<nivel>` con `km2` (área de la unión de volcanes), `pct` (% del municipio) y `volcanes` (`{código: km²}`) |
| `umbral_km2` | Área mínima de intersección para contar un municipio (0,001 km² = 0,1 ha; descarta contactos de borde) |

Reglas:

- Un municipio se cuenta en **cada** nivel que toca, de uno o de varios volcanes; `cualquiera` cuenta municipios distintos. Por eso la suma de niveles supera el total.
- Los porcentajes por nivel pueden sumar más de 100 % donde se superponen zonas de dos volcanes (por ejemplo, la alta de uno con la baja de otro).
- Todo municipio con viviendas expuestas aparece en la lista (lo comprueban el exportador y `validar_datos.py`). Algunos municipios aparecen sin viviendas expuestas: su parte en la zona no tiene manzanas ni secciones con viviendas.
- Bogotá, D.C. (código 11) cuenta como departamento propio, como en DIVIPOLA.
- El área en litigio Cauca–Huila (código 00000) se lista, pero no se cuenta como municipio ni como departamento.

### `hidromet/<COD>.json`

| Bloque | Contenido |
|---|---|
| `series.imerg`, `series.chirps`, `series.era5` | Lluvia diaria (mm) sobre el punto del cráter: `inicio` y lista `mm` (un valor por día; `null` = sin dato). Últimos 365 días. `ultimo_dato` indica la latencia real. |
| `climatologia` | Promedio mensual CHIRPS de 20 años completos (`periodo`, `mm[12]`) |
| `grillas` | Cuadro de ~30 × 30 km (celdas de 1 km, interpolación bilineal): por fuente y modo (`dias`, `semanas`, `meses`) 8 periodos completos con `valores` (fila por fila desde el norte) y `media_mm` en 5 km alrededor del cráter |
| `clim_mapa` | Lluvia media anual CHIRPS en ~50 × 50 km |

IMERG solo cuenta días completos (48 medias horas). Un día aún no publicado queda como `null`, no como 0 mm. Los periodos semanales son lunes a domingo completos y los mensuales, meses completos.

## 2. Metodología de exposición (resumen)

La metodología completa está en el Documento Técnico v2.1 del proyecto de cálculo. En breve:

1. **Amenaza consolidada:** los niveles del SGC se hacen mutuamente excluyentes: alta; media − alta; baja − (alta ∪ media).
2. **Urbano con direcciones** (`placas_proxy`): `viv_manzana × placas_en_zona / placas_manzana`.
3. **Urbano sin direcciones** (`area_fallback`): `viv_manzana × área_intersección / área_manzana`.
4. **Rural** (`area_ponderada_9377`): `viv_sección × área_intersección / área_sección`, en EPSG:9377.
5. **Personas** = viviendas × 3,0 (promedio de personas por hogar, DANE CNPV 2018), redondeado al entero.
6. **Unidades económicas:** suma de `cant_ue` de las direcciones urbanas del DANE dentro de la zona.

Notas de interpretación:

- En los mapas de **escala regional** (Cerro Bravo, Chiles–Cerro Negro, Azufral y Cerro Machín 2026), las zonas media y baja incluyen la dispersión extrema de ceniza. Sus cifras no son comparables con las de mapas proximales. La amenaza **alta** sí es comparable entre todos.
- Las cifras municipales se redondean por separado, así que su suma puede diferir en pocas unidades del total del volcán.
- El número de municipios cuenta los municipios distintos con alguna unidad expuesta, sumando la parte urbana y la rural. El módulo Streamlit mostraba por nivel el máximo entre urbano y rural; los totales y el ranking coinciden en ambos.

## 3. Colores

Los colores se definen por rol en `assets/css/estilos.css` y `assets/js/constantes.js`. Las paletas categóricas se validaron con el verificador de daltonismo (diferencia perceptual ΔE ≥ 8 bajo protanopía, deuteranopía y tritanopía, y ≥ 15 con visión normal).

| Rol | Colores | Nota |
|---|---|---|
| Amenaza alta · media · baja | `#b42318` · `#e8681a` · `#d9a800` | Convención de severidad del SGC. El ocre tiene poco contraste con el blanco, por eso siempre va con etiqueta escrita. |
| Urbano · rural | `#2a78d6` · `#1baf7a` | |
| IMERG · CHIRPS · ERA5 | `#2a78d6` · `#eb6834` · `#1baf7a` | Validadas en todas las parejas |
| Alerta verde · amarillo · naranja · rojo | `#16a34a` · `#eab308` · `#ea580c` · `#dc2626` | Colores oficiales; siempre con su nombre |
| Lluvia (secuencial) | Azul de un solo tono, claro a oscuro | Claro = poca lluvia |
