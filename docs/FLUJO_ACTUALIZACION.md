# Flujo de actualización · GeoVolcanes-SCR web

El geoportal web **no calcula** exposición: solo publica lo que calcula el proyecto **GeoVolcanes-SCR** (PostGIS). Por eso todo cambio de datos sigue el mismo orden:

```
1. Proyecto de cálculo         2. Exportar                      3. Sincronizar           4. Publicar
   (C:\geovolcanes\            scripts/exportar_web.py          sincronizar_desde_scr    git commit + push
    geovolcanes-scr)           → data/export_web/               → data/ de este repo     → GitHub Pages
   cargar / recalcular         (verifica contra la API)          + validar_datos.py
```

Convenciones de este documento:

- **SCR** es el proyecto de cálculo (`C:\geovolcanes\geovolcanes-scr`, con Docker).
- **WEB** es este repositorio (`C:\geovolcanes\geovolcanes-scr-web`).
- Los comandos `docker compose` se ejecutan en la raíz de SCR. En **PowerShell** se escriben tal cual. En **Git Bash** anteponga `MSYS_NO_PATHCONV=1`, porque Git Bash convierte `/tmp/...` en una ruta de Windows y el comando falla en silencio.

---

## 1. Requisitos (una sola vez)

En SCR:

1. Stack levantado: `docker compose up -d` (servicios `db` y `api` como mínimo).
2. Librería de teselas en la imagen de la API. Ya está en `requirements.txt`; si la imagen es anterior, instálela en el contenedor:
   ```
   docker compose exec api pip install "pmtiles==3.4.1"
   ```
   Esta instalación se pierde si el contenedor se recrea; reconstruir la imagen (`docker compose build api`) la deja permanente.

En WEB: Python 3.10 o superior para los scripts de validación, sincronización y servidor local.

---

## 2. Agregar un volcán nuevo

### 2.1 En SCR: cargar y calcular

Siga el checklist de `docs/ARCHITECTURE.md` (sección 9, "Checklist para un volcán nuevo"). En resumen:

1. Registrar el volcán en `config/volcanes.yaml` (fuente autoritativa de nombres y coordenadas) y en `catalogo.volcanes` (`scripts/registrar_volcan.py`).
2. Cargar la amenaza con `scripts/etl_amenaza_volcan.py` (primero `--listar-capas` y `--dry-run`).
3. Calcular la exposición. **Sin** `-1` si el geoportal Streamlit está en uso: con transacción única el cálculo bloquea las consultas de exposición durante todo el proceso.
   ```
   docker compose cp sql/calcular_exposicion.sql db:/tmp/exp.sql
   docker compose exec -T db psql -U geovolcanes_scr -d geovolcanes_scr -v vid=<ID> -f /tmp/exp.sql
   ```
4. Clasificar la escala (`proximal` o `regional`), metadatos (`anio_pub`), nivel de alerta y `estado_proyecto = 'preparado'`.
5. Comprobar en el Streamlit (http://localhost:8501) que el volcán aparece con sus cifras.

### 2.2 En SCR: exportar

```
docker compose cp scripts/exportar_web.py api:/tmp/exportar_web.py
docker compose exec api python /tmp/exportar_web.py --volcanes <COD>
```

El script:

- escribe `data/export_web/volcanes/<COD>/resumen.json` y `exposicion.pmtiles`;
- **reconstruye** `catalogo.json`, `ranking.json` e `index.json` con todos los volcanes;
- compara cada cifra con la API en vivo y termina con `Verificacion OK`. Si muestra `ERROR`, **no publique**: hay una diferencia entre la base y lo exportado.

Para exportar todos los volcanes, omita `--volcanes` (tarda unos 2 minutos).

### 2.3 En SCR: lluvia del volcán nuevo

La lluvia de los volcanes existentes la actualiza GitHub Actions, pero un volcán nuevo necesita su primer archivo. Desde SCR, usando la cuenta de servicio que ya tiene la API:

```
docker compose cp C:/geovolcanes/geovolcanes-scr-web/scripts/actualizar_hidromet.py api:/tmp/hid.py
docker compose exec api python /tmp/hid.py --volcanes <COD> --key /run/secrets/gee_credentials.json --datos /app/data/export_web
```

(También puede omitir este paso y lanzar el flujo de Actions a mano después de publicar; ver §4.)

### 2.4 En WEB: sincronizar, validar y probar

PowerShell, en la raíz de WEB:

```
.\scripts\sincronizar_desde_scr.ps1 -ConHidromet
python scripts\servidor_local.py
```

El script copia `data/export_web/` a `data/` y ejecuta `validar_datos.py`. Abra http://localhost:8765, elija el volcán nuevo y revise las cuatro pestañas.

### 2.5 Publicar

```
git add data
git commit -m "datos: volcán <COD> (<nombre>)"
git push
```

GitHub Pages publica en 1 o 2 minutos. No hay que tocar código: el selector, el ranking y el mapa nacional se arman desde `catalogo.json` y `ranking.json`.

---

## 3. Recalcular un volcán existente o cambiar su nivel de alerta

| Caso | Pasos |
|---|---|
| Nuevo mapa de amenaza del SGC (como Cerro Machín 2026) | Recargar la amenaza, **recalcular la exposición** (el ETL de amenaza no lo hace solo), exportar con `--volcanes <COD>`, sincronizar, validar y publicar. |
| Cambio de nivel de alerta, escala del mapa o año del mapa | Actualizar `catalogo.volcanes` en SCR. Exportar con `--sin-teselas` (solo JSON, segundos). Sincronizar, validar y publicar. |
| Nueva versión del MGN del DANE | Recalcular todos los volcanes en SCR y exportar todo. |

---

## 4. Lluvia satelital: actualización automática

El flujo `.github/workflows/actualizar-hidromet.yml` corre todos los días a las 06:30 (hora de Colombia), recalcula `data/hidromet/*.json` con Earth Engine y publica el cambio.

Configuración (una sola vez):

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
2. Nombre: `GEE_SERVICE_ACCOUNT_KEY`. Valor: el **contenido completo** del JSON de la cuenta de servicio de Earth Engine (el mismo `secrets/gee-key.json` de SCR).
3. **Settings → Actions → General → Workflow permissions → Read and write permissions**.
4. Pestaña **Actions → Actualizar lluvia satelital → Run workflow** para probarlo.

El JSON de la cuenta de servicio **nunca** se sube al repositorio: `.gitignore` lo excluye y `validar_datos.py` falla si encuentra una clave privada.

Ejecución manual en un equipo con la clave:

```
pip install earthengine-api==1.1.2
python scripts/actualizar_hidromet.py --key C:\ruta\gee-key.json
python scripts/actualizar_hidromet.py --volcanes VNR VGL --key C:\ruta\gee-key.json
```

Cada volcán tarda unos 40 segundos.

---

## 5. Revisión antes de cada publicación

- `python scripts/validar_datos.py` termina en `Validacion OK`.
- El exportador terminó en `Verificacion OK` (cifras idénticas a la API).
- En el servidor local: el volcán cambiado carga en Exposición (mapa, tabla y KPIs), Satelital y Hidrometeorología, sin avisos rojos.
- `git status` no muestra archivos de credenciales.

## 6. Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| El mapa de exposición aparece vacío en local | Servidor sin HTTP Range (`python -m http.server`) | Use `python scripts/servidor_local.py` |
| `exportar_web.py` dice `No module named 'pmtiles'` | Imagen de la API anterior a este flujo | `docker compose exec api pip install "pmtiles==3.4.1"` |
| `docker compose cp` o `psql -f` no encuentran el archivo | Git Bash convirtió la ruta | Anteponga `MSYS_NO_PATHCONV=1` o use PowerShell |
| `Verificacion: N diferencias` | La base cambió después de exportar, o falta recalcular un volcán | Recalcule o reexporte; no publique hasta tener `Verificacion OK` |
| La pestaña Hidrometeorología muestra "Sin datos de lluvia" | Falta `data/hidromet/<COD>.json` | §2.3, o ejecutar el flujo de Actions a mano |
| El flujo de Actions falla con "Falta el secreto" | No se configuró `GEE_SERVICE_ACCOUNT_KEY` | §4 |
| Satelital no encuentra escenas | Nubosidad andina | Ampliar fechas o umbral de nubes, o usar Sentinel-1 |
