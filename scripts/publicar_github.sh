#!/usr/bin/env bash
# GeoVolcanes-SCR web - Publica este repositorio en GitHub (portal oficial + replica).
# Equivalente de publicar_github.ps1 para Git Bash / Linux. Ver docs/SINCRONIZACION.md.
#
#   scripts/publicar_github.sh --simular
#   scripts/publicar_github.sh -m "datos: volcan VXX (Nombre)"
#   scripts/publicar_github.sh                  # publica commits ya hechos
#   scripts/publicar_github.sh --solo-oficial   # no toca la replica (origin)
#   scripts/publicar_github.sh --forzar-replica # iguala la replica al oficial (--force-with-lease)
set -uo pipefail
RAMA=main; OFICIAL=ungrd; REPLICA=origin
URL_OFICIAL=https://github.com/scr-ungrd/geovolcanes.git
MENSAJE=""; SOLO_OFICIAL=0; FORZAR=0; SIMULAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--mensaje) MENSAJE="$2"; shift 2 ;;
    --solo-oficial) SOLO_OFICIAL=1; shift ;;
    --forzar-replica) FORZAR=1; shift ;;
    --simular) SIMULAR=1; shift ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done
falla() { echo "ERROR: $*" >&2; exit 1; }
paso() { printf '\n== %s\n' "$*"; }
cd "$(dirname "$0")/.." || exit 1

paso "Comprobaciones"
[ "$(git rev-parse --abbrev-ref HEAD)" = "$RAMA" ] || falla "No esta en la rama $RAMA (git switch $RAMA)."
git remote | grep -qx "$OFICIAL" || falla "Falta el remoto $OFICIAL: git remote add $OFICIAL $URL_OFICIAL"
HAY_REPLICA=0
git remote | grep -qx "$REPLICA" && [ $SOLO_OFICIAL -eq 0 ] && HAY_REPLICA=1

paso "Validando data/"
python scripts/validar_datos.py || falla "validar_datos.py encontro errores."

if [ -n "$(git status --porcelain)" ]; then
  paso "Cambios sin confirmar"
  git status --short
  [ -n "$MENSAJE" ] || falla 'Hay cambios sin confirmar: use -m "descripcion" o haga git commit.'
  if [ $SIMULAR -eq 1 ]; then
    echo "(simulacion) Se confirmarian con el mensaje: $MENSAJE"
  else
    git add -A
    PROHIBIDOS=$(git diff --cached --name-only | grep -E '(gee-key|credentials|secret|\.pem$|\.env$|_pruebas/)' || true)
    if [ -n "$PROHIBIDOS" ]; then git reset -q; falla "Archivos que parecen credenciales: $PROHIBIDOS"; fi
    git commit -q -m "$MENSAJE" || falla "git commit fallo."
    git log --oneline -1
  fi
fi

paso "Trayendo $OFICIAL/$RAMA (commits diarios de lluvia)"
git fetch -q "$OFICIAL" || falla "No se pudo leer $OFICIAL."
if git rev-parse --verify -q "$OFICIAL/$RAMA" >/dev/null; then
  ATRAS=$(git rev-list --count "HEAD..$OFICIAL/$RAMA")
  if [ "$ATRAS" -gt 0 ]; then
    echo "El oficial tiene $ATRAS commit(s) nuevos; integrando con rebase..."
    if [ $SIMULAR -eq 0 ]; then
      git pull --rebase "$OFICIAL" "$RAMA" || { git rebase --abort; falla "Conflicto al integrar $OFICIAL/$RAMA."; }
      python scripts/validar_datos.py || falla "Tras integrar el oficial hay errores de validacion."
    fi
  else
    echo "Al dia con el oficial."
  fi
  paso "Commits por subir al oficial"; git log --oneline "$OFICIAL/$RAMA..HEAD"
fi
[ $SIMULAR -eq 1 ] && { echo; echo "(simulacion) No se subio nada."; exit 0; }

paso "Subiendo a $OFICIAL (portal oficial)"
git push "$OFICIAL" "$RAMA" || falla "Push rechazado: vuelva a ejecutar el script."

AVISO=""
if [ $HAY_REPLICA -eq 1 ]; then
  paso "Subiendo a $REPLICA (replica)"
  git fetch -q "$REPLICA"
  if ! git push "$REPLICA" "$RAMA"; then
    if [ $FORZAR -eq 1 ]; then
      git push --force-with-lease "$REPLICA" "$RAMA" || falla "No se pudo igualar la replica."
    else
      AVISO="La replica tiene commits propios y no se actualizo. Desactive alli la lluvia diaria y use --forzar-replica."
    fi
  fi
fi

paso "Estado final"
git fetch -q --all
echo "  local          $(git rev-parse --short HEAD)"
echo "  $OFICIAL/$RAMA    $(git rev-parse --short "$OFICIAL/$RAMA")"
git remote | grep -qx "$REPLICA" && echo "  $REPLICA/$RAMA   $(git rev-parse --short "$REPLICA/$RAMA")"
echo; echo "Portal oficial: https://scr-ungrd.github.io/geovolcanes/"
[ -n "$AVISO" ] && echo "AVISO: $AVISO"
exit 0
