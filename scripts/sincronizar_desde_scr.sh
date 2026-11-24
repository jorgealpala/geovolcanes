#!/usr/bin/env bash
# GeoVolcanes-SCR web · Sincroniza los datos exportados por el proyecto de calculo.
# Uso (Git Bash, desde la raiz de este repositorio):
#   scripts/sincronizar_desde_scr.sh                       # origen por defecto
#   scripts/sincronizar_desde_scr.sh /c/ruta/geovolcanes-scr --con-hidromet
set -euo pipefail
ORIGEN="${1:-/c/geovolcanes/geovolcanes-scr}"
CON_HIDROMET="${2:-}"
FUENTE="$ORIGEN/data/export_web"
DESTINO="$(cd "$(dirname "$0")/.." && pwd)/data"
[ -f "$FUENTE/index.json" ] || { echo "No existe $FUENTE/index.json: ejecute scripts/exportar_web.py en el proyecto de calculo." >&2; exit 1; }
cp "$FUENTE"/{index.json,catalogo.json,ranking.json,colombia_departamentos.geojson} "$DESTINO/"
rm -rf "$DESTINO/volcanes" && cp -r "$FUENTE/volcanes" "$DESTINO/volcanes"
rm -rf "$DESTINO/nacional" && cp -r "$FUENTE/nacional" "$DESTINO/nacional"
if [ "$CON_HIDROMET" = "--con-hidromet" ] && [ -d "$FUENTE/hidromet" ]; then
  mkdir -p "$DESTINO/hidromet" && cp "$FUENTE"/hidromet/*.json "$DESTINO/hidromet/"
fi
echo "Datos sincronizados en $DESTINO"
python "$(dirname "$0")/validar_datos.py"
