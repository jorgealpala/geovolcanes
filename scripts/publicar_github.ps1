# =============================================================================
# GeoVolcanes-SCR web - Publica este repositorio en GitHub (portal oficial + replica)
#
# Remotos esperados (ver docs/SINCRONIZACION.md):
#   ungrd   https://github.com/scr-ungrd/geovolcanes.git    portal OFICIAL (UNGRD)
#   origin  https://github.com/jorgealpala/geovolcanes.git  replica de trabajo (opcional)
#
# Uso (PowerShell, desde la raiz de este repositorio):
#   .\scripts\publicar_github.ps1 -Simular                              # solo muestra que haria
#   .\scripts\publicar_github.ps1 -Mensaje "datos: volcan VXX (Nombre)" # confirma cambios y publica
#   .\scripts\publicar_github.ps1                                       # publica commits ya hechos
#   .\scripts\publicar_github.ps1 -SoloOficial                          # no toca la replica
#   .\scripts\publicar_github.ps1 -ForzarReplica                        # iguala la replica al oficial
#
# Pasos: valida data/ -> confirma cambios (si hay -Mensaje) -> trae los commits
# diarios de lluvia del oficial (pull --rebase) -> sube al oficial -> sube a la replica.
# Nunca fuerza el oficial. -ForzarReplica usa --force-with-lease solo sobre origin.
# =============================================================================
param(
  [string]$Mensaje,
  [switch]$SoloOficial,
  [switch]$ForzarReplica,
  [switch]$Simular
)
# "Continue": git escribe su progreso en stderr y en PowerShell 5.1 eso no es un error.
$ErrorActionPreference = "Continue"
$Rama = "main"
$Oficial = "ungrd"
$Replica = "origin"
$UrlOficial = "https://github.com/scr-ungrd/geovolcanes.git"

function Invoke-Git {
  $salida = & git @args 2>&1 | ForEach-Object { "$_" }
  $script:CodigoGit = $LASTEXITCODE
  return $salida
}
function Stop-Publicacion([string]$m) {
  Write-Host "ERROR: $m" -ForegroundColor Red
  exit 1
}
function Write-Paso([string]$m) { Write-Host "`n== $m" -ForegroundColor Cyan }

Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

# ---------------------------------------------------------------- comprobaciones
Write-Paso "Comprobaciones"
$rama = (Invoke-Git rev-parse --abbrev-ref HEAD) -join ""
if ($rama -ne $Rama) { Stop-Publicacion "Esta en la rama '$rama'. Cambie a '$Rama' (git switch $Rama)." }
$remotos = Invoke-Git remote
if ($remotos -notcontains $Oficial) {
  Stop-Publicacion "Falta el remoto '$Oficial'. Agreguelo con: git remote add $Oficial $UrlOficial"
}
$hayReplica = ($remotos -contains $Replica) -and -not $SoloOficial
Write-Host "Rama $Rama - oficial: $Oficial - replica: $(if ($hayReplica) { $Replica } else { '(no se usa)' })"

Write-Paso "Validando data/"
python (Join-Path $PSScriptRoot "validar_datos.py")
if ($LASTEXITCODE -ne 0) { Stop-Publicacion "validar_datos.py encontro errores. Corrijalos antes de publicar." }

# ---------------------------------------------------------------- cambios locales
$pendientes = Invoke-Git status --porcelain
if ($pendientes) {
  Write-Paso "Cambios sin confirmar"
  $pendientes | ForEach-Object { Write-Host "  $_" }
  if (-not $Mensaje) {
    Stop-Publicacion "Hay cambios sin confirmar. Vuelva a ejecutar con -Mensaje `"descripcion del cambio`" o confirmelos con git commit."
  }
  if ($Simular) {
    Write-Host "(simulacion) Se confirmarian con el mensaje: $Mensaje"
  } else {
    Invoke-Git add -A | Out-Null
    $prohibidos = Invoke-Git diff --cached --name-only | Where-Object { $_ -match '(gee-key|credentials|secret|\.pem$|\.env$|_pruebas/)' }
    if ($prohibidos) {
      Invoke-Git reset -q | Out-Null
      Stop-Publicacion "Archivos que parecen credenciales quedaron en el commit: $($prohibidos -join ', '). Agreguelos a .gitignore."
    }
    Invoke-Git commit -q -m $Mensaje | ForEach-Object { Write-Host "  $_" }
    if ($CodigoGit -ne 0) { Stop-Publicacion "git commit fallo." }
    Write-Host "Confirmado: $((Invoke-Git log --oneline -1) -join '')"
  }
}

# ---------------------------------------------------------------- traer el oficial
Write-Paso "Trayendo $Oficial/$Rama (commits diarios de lluvia de GitHub Actions)"
Invoke-Git fetch $Oficial | Out-Null
if ($CodigoGit -ne 0) { Stop-Publicacion "No se pudo leer $Oficial. Revise la conexion y sus permisos en GitHub." }
$existeOficial = [bool](Invoke-Git rev-parse --verify --quiet "$Oficial/$Rama")
if ($existeOficial) {
  $atras = [int]((Invoke-Git rev-list --count "HEAD..$Oficial/$Rama") -join "")
  if ($atras -gt 0) {
    Write-Host "El oficial tiene $atras commit(s) que no estan aqui. Integrando con rebase..."
    if ($Simular) {
      Write-Host "(simulacion) git pull --rebase $Oficial $Rama"
    } else {
      Invoke-Git pull --rebase $Oficial $Rama | ForEach-Object { Write-Host "  $_" }
      if ($CodigoGit -ne 0) {
        Invoke-Git rebase --abort | Out-Null
        Stop-Publicacion "Conflicto al integrar $Oficial/$Rama. Resuelvalo a mano (docs/SINCRONIZACION.md, Problemas frecuentes)."
      }
      python (Join-Path $PSScriptRoot "validar_datos.py")
      if ($LASTEXITCODE -ne 0) { Stop-Publicacion "Tras integrar el oficial, validar_datos.py encontro errores." }
    }
  } else {
    Write-Host "Al dia con el oficial."
  }
}

$porSubir = if ($existeOficial) { Invoke-Git log --oneline "$Oficial/$Rama..HEAD" } else { Invoke-Git log --oneline }
Write-Paso "Commits por subir al oficial"
if ($porSubir) { $porSubir | ForEach-Object { Write-Host "  $_" } } else { Write-Host "  (ninguno)" }

if ($Simular) {
  Write-Host "`n(simulacion) No se subio nada." -ForegroundColor Yellow
  exit 0
}

# ---------------------------------------------------------------- subir
Write-Paso "Subiendo a $Oficial (portal oficial)"
Invoke-Git push $Oficial $Rama | ForEach-Object { Write-Host "  $_" }
if ($CodigoGit -ne 0) { Stop-Publicacion "git push $Oficial $Rama fue rechazado. Vuelva a ejecutar este script (integra los cambios nuevos)." }

$avisoReplica = $null
if ($hayReplica) {
  Write-Paso "Subiendo a $Replica (replica de trabajo)"
  Invoke-Git fetch $Replica | Out-Null
  Invoke-Git push $Replica $Rama | ForEach-Object { Write-Host "  $_" }
  if ($CodigoGit -ne 0) {
    if ($ForzarReplica) {
      Write-Host "La replica tiene commits propios (normalmente lluvia diaria). Igualandola al oficial con --force-with-lease..."
      Invoke-Git push --force-with-lease $Replica $Rama | ForEach-Object { Write-Host "  $_" }
      if ($CodigoGit -ne 0) { Stop-Publicacion "No se pudo igualar la replica." }
    } else {
      $avisoReplica = "La replica ($Replica) tiene commits que no estan en el oficial y no se actualizo. " +
        "Si son solo de lluvia diaria, desactive ese flujo en la replica y ejecute: .\scripts\publicar_github.ps1 -ForzarReplica"
    }
  }
}

# ---------------------------------------------------------------- resumen
Write-Paso "Estado final"
Invoke-Git fetch --all --quiet | Out-Null
$local = (Invoke-Git rev-parse --short HEAD) -join ""
Write-Host "  local          $local"
Write-Host "  $Oficial/$Rama    $((Invoke-Git rev-parse --short "$Oficial/$Rama") -join '')"
if ($remotos -contains $Replica) { Write-Host "  $Replica/$Rama   $((Invoke-Git rev-parse --short "$Replica/$Rama") -join '')" }
Write-Host "`nPortal oficial: https://scr-ungrd.github.io/geovolcanes/ (GitHub Pages tarda 1-2 min; el navegador puede mostrar la version anterior hasta 10 min: Ctrl+F5)"
if ($avisoReplica) { Write-Host "`nAVISO: $avisoReplica" -ForegroundColor Yellow }
