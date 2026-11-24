# Sincronización entre proyectos y con GitHub · GeoVolcanes-SCR

> Este documento existe en los dos proyectos, con el mismo contenido:
> `geovolcanes-scr/docs/SINCRONIZACION_WEB.md` y `geovolcanes-scr-web/docs/SINCRONIZACION.md`.
> Si cambia uno, copie el cambio al otro.

El geoportal se mantiene en **dos proyectos locales** y se publica en **dos repositorios de GitHub**. Los datos siempre van en un solo sentido: del proyecto de cálculo al portal web y de ahí a GitHub. Nunca se editan datos a mano en el portal web.

## 1. Dónde está cada cosa

| Lugar | Ruta o dirección | Qué contiene | Quién lo modifica |
|---|---|---|---|
| **SCR**: proyecto de cálculo | `C:\geovolcanes\geovolcanes-scr` | PostGIS + API + Streamlit (Docker). Mapas de amenaza, DANE, cálculo de exposición. | Usted (carga y recálculo) |
| Salida de la exportación | `C:\geovolcanes\geovolcanes-scr\data\export_web` | JSON y PMTiles listos para el portal | `publicar_web.ps1` / `exportar_web.py` |
| **WEB**: portal estático | `C:\geovolcanes\geovolcanes-scr-web` | HTML, JS, CSS y la carpeta `data/` | Usted (código) y `sincronizar_desde_scr` (datos) |
| **GitHub oficial** (remoto `ungrd`) | https://github.com/scr-ungrd/geovolcanes | Repositorio oficial de la UNGRD | `publicar_github`, GitHub Actions (lluvia diaria) |
| Portal oficial en línea | https://scr-ungrd.github.io/geovolcanes/ | GitHub Pages del repositorio oficial | GitHub, al recibir cada push |
| **GitHub réplica** (remoto `origin`) | https://github.com/jorgealpala/geovolcanes | Copia de trabajo, idéntica al oficial | `publicar_github` |

SCR **no** es un repositorio git ni se sube a GitHub. Solo se publica su resultado.

```
 SCR (PostGIS, Docker)                       WEB (repositorio git local)                 GitHub
 ┌──────────────────────────┐  exportar  ┌──────────────────────────┐  publicar   ┌──────────────────────────────┐
 │ cargar / recalcular      │──────────▶ │ data/  (JSON + PMTiles)   │───────────▶ │ ungrd : scr-ungrd/geovolcanes │──▶ Pages oficial
 │ data/export_web/         │ sincronizar│ index.html + assets/      │             │ origin: jorgealpala/geovolcanes│   (réplica)
 └──────────────────────────┘            └──────────────────────────┘ ◀─────────── └──────────────────────────────┘
        publicar_web.ps1                      publicar_github.ps1        pull --rebase   Actions: lluvia diaria (06:30)
```

## 2. Scripts

| Script | Proyecto | Se ejecuta en | Qué hace |
|---|---|---|---|
| `scripts/publicar_web.ps1` | SCR | PowerShell, raíz de SCR | Copia `exportar_web.py` al contenedor `api`, exporta (verifica contra la API), opcionalmente calcula la primera lluvia de un volcán nuevo y llama a `sincronizar_desde_scr.ps1`. No toca GitHub. |
| `scripts/exportar_web.py` | SCR | Dentro del contenedor `api` | Genera `data/export_web/`: catálogo, ranking, `volcanes/<COD>/`, `nacional/`. Termina en `Verificacion OK` o con código 1. |
| `scripts/fix_textos_catalogo.py` | SCR | Contenedor `api` | Corrige tildes dañadas del catálogo desde `config/volcanes.yaml` (solo si reaparecen textos como `Nari??o`). |
| `scripts/sincronizar_desde_scr.ps1` / `.sh` | WEB | PowerShell / Git Bash, raíz de WEB | Copia `data/export_web/` a `data/` (espejo de `volcanes/` y `nacional/`; `hidromet/` solo con `-ConHidromet`) y ejecuta `validar_datos.py`. |
| `scripts/validar_datos.py` | WEB | Python, raíz de WEB | Coherencia de cifras, PMTiles válidos, tabla territorial, tamaños (< 100 MB) y búsqueda de credenciales. |
| `scripts/publicar_github.ps1` / `.sh` | WEB | PowerShell / Git Bash, raíz de WEB | Valida, confirma cambios (`-Mensaje`), integra los commits diarios del oficial (`pull --rebase`), sube al oficial y luego a la réplica. Nunca fuerza el oficial. |
| `scripts/actualizar_hidromet.py` | WEB | GitHub Actions (diario) o contenedor `api` | Lluvia satelital con Earth Engine → `data/hidromet/`. |
| `scripts/servidor_local.py` | WEB | Python, raíz de WEB | Servidor de prueba con HTTP Range en http://localhost:8765. |

## 3. Rutina normal (3 pasos)

PowerShell, con Docker levantado en SCR:

```powershell
# 1. SCR -> WEB: exportar y sincronizar (todo, ~3 min; o -Volcanes <COD> para uno)
cd C:\geovolcanes\geovolcanes-scr
.\scripts\publicar_web.ps1

# 2. Revisar en local
cd C:\geovolcanes\geovolcanes-scr-web
python scripts\servidor_local.py          # abrir http://localhost:8765, Ctrl+C para cerrar

# 3. WEB -> GitHub (oficial y réplica)
.\scripts\publicar_github.ps1 -Simular                                # opcional: ver qué haría
.\scripts\publicar_github.ps1 -Mensaje "datos: recálculo Cerro Machín"
```

Si `publicar_web.ps1` o `publicar_github.ps1` terminan en `ERROR`, no publique hasta corregir la causa.

## 4. Casos

| Caso | Paso 1 (SCR → WEB) | Paso 3 (WEB → GitHub) |
|---|---|---|
| **Volcán nuevo** (ya cargado y calculado en SCR, ver `ARCHITECTURE.md` §9) | `.\scripts\publicar_web.ps1 -Volcanes VXX -Hidromet VXX` | `-Mensaje "datos: volcán VXX (Nombre)"` |
| **Nuevo mapa de amenaza** de un volcán (recargar amenaza y recalcular exposición en SCR) | `.\scripts\publicar_web.ps1 -Volcanes VXX` | `-Mensaje "datos: nuevo mapa de amenaza VXX <año>"` |
| **Cambio de alerta, escala o año del mapa** (en `catalogo.volcanes`) | `.\scripts\publicar_web.ps1 -SinTeselas` (segundos) | `-Mensaje "datos: alerta VXX naranja"` |
| **Nueva versión del MGN del DANE** (recalcular todos en SCR) | `.\scripts\publicar_web.ps1` | `-Mensaje "datos: MGN <año>"` |
| **Cambio de código o textos del portal** (HTML, JS, CSS, docs) | — | `-Mensaje "portal: <qué cambió>"` |
| **Lluvia satelital** | Nada: GitHub Actions la actualiza a diario en el oficial | `publicar_github` la integra sola en la siguiente publicación |

`exportar_web.py` reconstruye siempre `catalogo.json`, `ranking.json` y `nacional/` con todos los volcanes, aunque se use `-Volcanes`; con `-SinTeselas` no regenera ningún `.pmtiles`.

## 5. GitHub

### 5.1 Remotos del repositorio WEB

```powershell
git remote -v
# ungrd   https://github.com/scr-ungrd/geovolcanes.git   (oficial)
# origin  https://github.com/jorgealpala/geovolcanes.git (réplica)
```

En un equipo nuevo:

```powershell
cd C:\geovolcanes
git clone https://github.com/scr-ungrd/geovolcanes.git geovolcanes-scr-web
cd geovolcanes-scr-web
git remote rename origin ungrd
git remote add origin https://github.com/jorgealpala/geovolcanes.git   # solo si se mantiene la réplica
```

Para subir hace falta permiso de escritura en `scr-ungrd/geovolcanes` (miembro de la organización con rol *Write* o superior) y haber iniciado sesión en GitHub desde git (Git Credential Manager lo pide la primera vez).

### 5.2 Configuración de cada repositorio (una sola vez, la hace un administrador)

| Ajuste | Oficial (`scr-ungrd`) | Réplica (`jorgealpala`) |
|---|---|---|
| **Settings → Pages**: Deploy from a branch, `main` / `(root)` | Sí | Opcional |
| **Settings → Secrets and variables → Actions**: `GEE_SERVICE_ACCOUNT_KEY` con el contenido completo de `secrets/gee-key.json` de SCR | Sí | No |
| **Settings → Actions → General → Workflow permissions**: Read and write | Sí (si la organización lo bloquea, habilitarlo también en la organización) | — |
| **Actions → Actualizar lluvia satelital** | Activo | **Disable workflow** |

La lluvia diaria debe correr **solo en el oficial**. Si corre también en la réplica, cada repositorio crea sus propios commits, dejan de ser idénticos y la subida a la réplica se rechaza.

### 5.3 Qué hace `publicar_github` en orden

1. Comprueba que está en `main` y que existe el remoto `ungrd`.
2. Ejecuta `validar_datos.py`.
3. Si hay cambios sin confirmar: sin `-Mensaje` se detiene; con `-Mensaje` hace `git add -A` y `git commit`, y se niega si algún archivo parece una credencial.
4. `git fetch ungrd` y, si el oficial tiene commits nuevos (lluvia diaria), `git pull --rebase ungrd main` y vuelve a validar.
5. `git push ungrd main`.
6. `git push origin main`. Si la réplica tiene commits propios, avisa y no la toca; con `-ForzarReplica` la iguala al oficial con `--force-with-lease`.
7. Muestra el commit de local, oficial y réplica (deben coincidir).

Opciones: `-Simular` (no sube nada), `-SoloOficial` (no toca la réplica), `-ForzarReplica`. En Git Bash: `scripts/publicar_github.sh --simular | -m "..." | --solo-oficial | --forzar-replica`.

### 5.4 Después de publicar

- GitHub Pages tarda 1 o 2 minutos en desplegar.
- GitHub Pages permite al navegador reutilizar cada archivo hasta **10 minutos**. Si no ve el cambio, recargue con **Ctrl + F5**.

## 6. Reglas

- No publique si `exportar_web.py` no terminó en `Verificacion OK` o si `validar_datos.py` no terminó en `Validacion OK`.
- Nunca suba `secrets/gee-key.json` ni ningún JSON de cuenta de servicio. `.gitignore` los excluye, `validar_datos.py` busca claves privadas y `publicar_github` rechaza nombres sospechosos.
- Nunca use `git push --force` contra `ungrd`.
- No edite a mano `data/`: se sobrescribe en la siguiente sincronización.
- Si cambia este documento, copie el cambio a la otra copia (ver nota al inicio).

## 7. Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `publicar_web.ps1`: "El servicio 'api' no esta corriendo" | Docker detenido | `docker compose up -d` en SCR |
| `publicar_web.ps1`: "La exportacion termino con errores o diferencias" | La base cambió durante la exportación o falta recalcular | Recalcule y repita; no publique |
| `publicar_github`: "Hay cambios sin confirmar" | Sincronizó datos o editó código y no dio mensaje | Repita con `-Mensaje "..."` |
| `publicar_github`: "Conflicto al integrar ungrd/main" | Usted y GitHub Actions cambiaron el mismo archivo (casi siempre `data/hidromet/`) | `git pull --rebase ungrd main`; en conflictos de `data/hidromet/` quédese con la versión del oficial: `git checkout --ours data/hidromet` (durante un rebase, *ours* es el oficial), `git add data/hidromet`, `git rebase --continue`, y vuelva a ejecutar el script |
| `publicar_github`: AVISO "La replica tiene commits propios" | La lluvia diaria corre también en la réplica | Desactive el flujo en la réplica (§5.2) y ejecute `-ForzarReplica` |
| `git push ungrd` pide usuario o responde 403 | Sin sesión de GitHub o sin permiso en `scr-ungrd` | Inicie sesión en Git Credential Manager con una cuenta que tenga rol *Write* |
| El portal oficial muestra la versión anterior | Despliegue en curso o caché del navegador | Espere 2 min y recargue con Ctrl + F5 |
| La pestaña de lluvia dice "Sin datos" para un volcán nuevo | No se generó su primera lluvia | `publicar_web.ps1 -Volcanes VXX -Hidromet VXX`, o ejecute el flujo de Actions a mano |
