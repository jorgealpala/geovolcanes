# =============================================================================
# GeoVolcanes-SCR web · Sincroniza los datos exportados por el proyecto de calculo
# (geovolcanes-scr) hacia este repositorio. Ejecutar en PowerShell desde la raiz
# de este repositorio:
#
#   .\scripts\sincronizar_desde_scr.ps1
#   .\scripts\sincronizar_desde_scr.ps1 -Origen "D:\otra\ruta\geovolcanes-scr" -ConHidromet
#
# Copia data\export_web\ del proyecto de calculo a data\ de este repositorio.
# Por defecto NO toca data\hidromet\ (la mantiene GitHub Actions); use -ConHidromet
# para copiarla tambien (por ejemplo al agregar un volcan nuevo).
# =============================================================================
param(
  [string]$Origen = "C:\geovolcanes\geovolcanes-scr",
  [switch]$ConHidromet
)
$ErrorActionPreference = "Stop"
$fuente = Join-Path $Origen "data\export_web"
$destino = Join-Path $PSScriptRoot "..\data"
if (-not (Test-Path (Join-Path $fuente "index.json"))) {
  throw "No existe $fuente\index.json. Ejecute primero scripts/exportar_web.py en el proyecto de calculo."
}
foreach ($f in @("index.json", "catalogo.json", "ranking.json", "colombia_departamentos.geojson")) {
  Copy-Item (Join-Path $fuente $f) (Join-Path $destino $f) -Force
}
# volcanes\: espejo exacto (borra en destino los volcanes que ya no se exportan)
robocopy (Join-Path $fuente "volcanes") (Join-Path $destino "volcanes") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy fallo con codigo $LASTEXITCODE" }
# nacional\: zonas de amenaza de todos los volcanes y municipios en amenaza
robocopy (Join-Path $fuente "nacional") (Join-Path $destino "nacional") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy fallo con codigo $LASTEXITCODE" }
if ($ConHidromet -and (Test-Path (Join-Path $fuente "hidromet"))) {
  robocopy (Join-Path $fuente "hidromet") (Join-Path $destino "hidromet") *.json /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy fallo con codigo $LASTEXITCODE" }
}
Write-Host "Datos sincronizados en $((Resolve-Path $destino).Path)"
python (Join-Path $PSScriptRoot "validar_datos.py")
