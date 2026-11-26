"""
GeoVolcanes-SCR web - Actualizacion de datos hidrometeorologicos (Google Earth Engine)
====================================================================================
Calcula UNA VEZ, para cada volcan con exposicion, la precipitacion satelital
que muestra la pestaña Hidromet del portal y la guarda en data/hidromet/<COD>.json.
El portal solo lee esos archivos: no necesita Earth Engine ni credenciales.

Contenido de cada archivo:
  * series      : lluvia diaria de los ultimos 365 dias sobre el crater,
                  fuentes IMERG V07 (NASA), CHIRPS (UCSB) y ERA5-Land (ECMWF).
  * climatologia: promedio mensual CHIRPS de 20 años completos.
  * grillas     : lluvia acumulada en 8 periodos (dias, semanas, meses) por
                  fuente, en una grilla de ~1 km sobre un cuadro de 30 x 30 km.
  * clim_mapa   : precipitacion media anual CHIRPS (20 años) en 50 x 50 km.

Credenciales (cuenta de servicio de GEE), en este orden:
  1. --key RUTA_AL_JSON
  2. variable de entorno GEE_SERVICE_ACCOUNT_KEY con el CONTENIDO del JSON
     (asi lo usa GitHub Actions, desde un secreto del repositorio)
  3. variable de entorno GEE_KEY_FILE con la ruta del JSON

Uso:
  python scripts/actualizar_hidromet.py                     # todos
  python scripts/actualizar_hidromet.py --volcanes VNR VGL  # algunos
  python scripts/actualizar_hidromet.py --key secrets/gee-key.json

Requiere: earthengine-api (pip install earthengine-api).
NUNCA suba el JSON de la cuenta de servicio al repositorio.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path

import ee

RAIZ = Path(__file__).resolve().parent.parent
DIAS_SERIE = 365
ANIOS_CLIM = 20
SEMI_LADO_GRILLA_KM = 15.0
SEMI_LADO_CLIM_KM = 25.0
CELDA_KM = 1.0
RADIO_MEDIA_KM = 5.0

FUENTES = {
    "imerg": {"coll": "NASA/GPM_L3/IMERG_V07", "band": "precipitation", "factor": 0.5,
              "scale": 11132, "horaria": True, "latencia": 2,
              "nombre": "IMERG V07 (NASA GPM)"},
    "chirps": {"coll": "UCSB-CHG/CHIRPS/DAILY", "band": "precipitation", "factor": 1.0,
               "scale": 5566, "horaria": False, "latencia": 20,
               "nombre": "CHIRPS Daily (UCSB)"},
    "era5": {"coll": "ECMWF/ERA5_LAND/DAILY_AGGR", "band": "total_precipitation_sum", "factor": 1000.0,
             "scale": 11132, "horaria": False, "latencia": 6,
             "nombre": "ERA5-Land Daily (ECMWF)"},
}
MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]


def log(msg: str) -> None:
    print(f"{dt.datetime.now():%H:%M:%S} {msg}", flush=True)


def iniciar_ee(key: str | None) -> None:
    ruta = key
    if not ruta and os.environ.get("GEE_SERVICE_ACCOUNT_KEY"):
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        tmp.write(os.environ["GEE_SERVICE_ACCOUNT_KEY"])
        tmp.close()
        ruta = tmp.name
    if not ruta:
        ruta = os.environ.get("GEE_KEY_FILE")
    if not ruta or not Path(ruta).exists():
        sys.exit("ERROR: no hay credenciales de GEE (use --key, GEE_SERVICE_ACCOUNT_KEY o GEE_KEY_FILE).")
    info = json.loads(Path(ruta).read_text(encoding="utf-8"))
    cred = ee.ServiceAccountCredentials(info["client_email"], ruta)
    ee.Initialize(cred, opt_url="https://earthengine-highvolume.googleapis.com")


def coleccion(f: str) -> ee.ImageCollection:
    c = FUENTES[f]
    return ee.ImageCollection(c["coll"]).select(c["band"])


def reintentar(fn, intentos: int = 4):
    for i in range(intentos):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            if i == intentos - 1:
                raise
            espera = 10 * (i + 1)
            log(f"   reintento en {espera}s: {str(exc)[:120]}")
            time.sleep(espera)


# ---------------------------------------------------------------------------
# Series diarias
# ---------------------------------------------------------------------------
def serie_diaria(f: str, punto: ee.Geometry, hoy: dt.date) -> dict:
    c = FUENTES[f]
    inicio = hoy - dt.timedelta(days=DIAS_SERIE)
    col = coleccion(f).filterBounds(punto).filterDate(inicio.isoformat(), (hoy + dt.timedelta(days=1)).isoformat())
    if c["horaria"]:
        start = ee.Date(inicio.isoformat())

        def por_dia(k):
            d0 = start.advance(ee.Number(k), "day")
            sub = col.filterDate(d0, d0.advance(1, "day"))
            # Solo dias completos (48 medias horas). Un dia incompleto o aun no
            # publicado queda sin dato (no como 0 mm, que parece un dia seco).
            val = ee.Algorithms.If(
                sub.size().gte(48),
                sub.sum().multiply(c["factor"]).reduceRegion(
                    ee.Reducer.first(), punto, c["scale"]).get(c["band"]),
                None)
            return ee.Feature(None, {"fecha": d0.format("YYYY-MM-dd"), "mm": val})

        fc = ee.FeatureCollection(ee.List.sequence(0, DIAS_SERIE).map(por_dia))
    else:
        def stat(img):
            val = img.multiply(c["factor"]).reduceRegion(ee.Reducer.first(), punto, c["scale"]).get(c["band"])
            return ee.Feature(None, {"fecha": img.date().format("YYYY-MM-dd"), "mm": val})

        fc = col.map(stat)
    feats = reintentar(lambda: fc.getInfo())["features"]
    por_fecha = {}
    for ft in feats:
        p = ft["properties"]
        if p.get("mm") is not None:
            por_fecha[p["fecha"]] = round(float(p["mm"]), 2)
    fechas = [(inicio + dt.timedelta(days=i)).isoformat() for i in range(DIAS_SERIE + 1)]
    valores = [por_fecha.get(d) for d in fechas]
    # Recortar los dias finales sin dato (latencia del producto)
    while valores and valores[-1] is None:
        valores.pop()
    return {"nombre": c["nombre"], "latencia_dias": c["latencia"], "coleccion": c["coll"],
            "inicio": inicio.isoformat(), "mm": valores,
            "ultimo_dato": fechas[len(valores) - 1] if valores else None}


def climatologia(punto: ee.Geometry, y0: int, y1: int) -> list[float]:
    c = FUENTES["chirps"]
    col = coleccion("chirps").filterBounds(punto).filterDate(f"{y0}-01-01", f"{y1 + 1}-01-01")

    def mes(m):
        m = ee.Number(m)
        anual = ee.List.sequence(y0, y1).map(lambda y: col.filter(ee.Filter.calendarRange(y, y, "year"))
                                             .filter(ee.Filter.calendarRange(m, m, "month")).sum()
                                             .reduceRegion(ee.Reducer.first(), punto, c["scale"]).get(c["band"]))
        return ee.List(anual).reduce(ee.Reducer.mean())

    vals = reintentar(lambda: ee.List.sequence(1, 12).map(mes).getInfo())
    return [round(float(v), 1) if v is not None else None for v in vals]


# ---------------------------------------------------------------------------
# Grillas (valores numericos; el portal los pinta)
# ---------------------------------------------------------------------------
def definir_grilla(lat: float, lon: float, semi_km: float) -> dict:
    dlat = CELDA_KM / 111.32
    dlon = CELDA_KM / (111.32 * math.cos(math.radians(lat)))
    n = int(round(2 * semi_km / CELDA_KM)) + 1
    x0 = lon - dlon * n / 2
    y1 = lat + dlat * n / 2
    return {"nx": n, "ny": n, "dlon": dlon, "dlat": dlat,
            "bbox": [round(x0, 6), round(y1 - dlat * n, 6), round(x0 + dlon * n, 6), round(y1, 6)]}


def muestrear(img: ee.Image, g: dict, nombres: list[str]) -> list[list[float]]:
    """Muestrea las bandas en la grilla fija de g (nx x ny celdas, origen arriba a la izquierda).

    Earth Engine puede devolver una fila o columna de mas o de menos segun el redondeo del
    borde. La grilla NO se ajusta a lo devuelto (si se ajustara, cada llamada siguiente usaria
    una extension distinta y los periodos quedarian de tamanos diferentes): se recorta o se
    rellena con None hasta nx x ny, y bbox queda fijo.
    """
    x0, y0, x1, y1 = g["bbox"]
    nx, ny = g["nx"], g["ny"]
    proj = ee.Projection("EPSG:4326", [g["dlon"], 0, x0, 0, -g["dlat"], y1])
    rect = ee.Geometry.Rectangle([x0, y0, x1, y1], proj=None, geodesic=False)
    arr = img.resample("bilinear").reproject(proj).sampleRectangle(region=rect, defaultValue=-9999)
    props = reintentar(lambda: arr.getInfo())["properties"]
    out = []
    for b in nombres:
        filas = [list(f[:nx]) + [None] * (nx - len(f[:nx])) for f in props[b][:ny]]
        filas += [[None] * nx for _ in range(ny - len(filas))]
        out.append([None if v is None or v <= -9998 else round(float(v), 1) for fila in filas for v in fila])
    return out


def periodos(modo: str, ultimo: dt.date) -> list[tuple[str, str, str]]:
    per = []
    if modo == "dias":
        for i in range(8):
            d = ultimo - dt.timedelta(days=i)
            per.append((d.isoformat(), (d + dt.timedelta(days=1)).isoformat(), f"{d.day} {MESES[d.month - 1]}"))
    elif modo == "semanas":
        # semanas completas lunes-domingo que terminan en o antes del ultimo dato
        fin = ultimo - dt.timedelta(days=(ultimo.weekday() + 1) % 7)  # ultimo domingo
        for i in range(8):
            f1 = fin - dt.timedelta(weeks=i)
            f0 = f1 - dt.timedelta(days=6)
            per.append((f0.isoformat(), (f1 + dt.timedelta(days=1)).isoformat(),
                        f"{f0.day} {MESES[f0.month - 1]} – {f1.day} {MESES[f1.month - 1]}"))
    else:
        # meses completos: si el ultimo dato no cierra el mes, se arranca en el anterior
        # (y, m) es el mes SIGUIENTE al ultimo mes completo; el bucle resta 1 antes de usarlo.
        mes_completo = (ultimo + dt.timedelta(days=1)).month != ultimo.month
        y, m = (ultimo.year, ultimo.month + 1) if mes_completo else (ultimo.year, ultimo.month)
        for _ in range(8):
            m -= 1
            if m == 0:
                m, y = 12, y - 1
            d0 = dt.date(y, m, 1)
            d1 = dt.date(y + (m == 12), m % 12 + 1, 1)
            per.append((d0.isoformat(), d1.isoformat(), f"{MESES[m - 1]} {y}"))
    return per[::-1]  # cronologico


def suma_periodo(f: str, d0: str, d1: str) -> ee.Image:
    c = FUENTES[f]
    col = coleccion(f).filterDate(d0, d1)
    proj = coleccion(f).first().projection()
    return col.sum().multiply(c["factor"]).setDefaultProjection(proj)


def media_radio(valores: list, g: dict, lat: float, lon: float) -> float | None:
    x0, _, _, y1 = g["bbox"]
    acc, n = 0.0, 0
    for j in range(g["ny"]):
        cy = y1 - (j + 0.5) * g["dlat"]
        for i in range(g["nx"]):
            cx = x0 + (i + 0.5) * g["dlon"]
            dkm = math.hypot((cx - lon) * 111.32 * math.cos(math.radians(lat)), (cy - lat) * 111.32)
            v = valores[j * g["nx"] + i]
            if dkm <= RADIO_MEDIA_KM and v is not None:
                acc += v
                n += 1
    return round(acc / n, 1) if n else None


def grillas(lat: float, lon: float, series: dict) -> dict:
    g = definir_grilla(lat, lon, SEMI_LADO_GRILLA_KM)
    out = {"bbox": g["bbox"], "celda_km": CELDA_KM, "radio_media_km": RADIO_MEDIA_KM, "fuentes": {}}
    for f in FUENTES:
        ultimo = series[f]["ultimo_dato"]
        if not ultimo:
            continue
        ult = dt.date.fromisoformat(ultimo)
        out["fuentes"][f] = {}
        for modo in ("dias", "semanas", "meses"):
            pers = periodos(modo, ult)
            bandas = [suma_periodo(f, d0, d1).rename(f"p{i}") for i, (d0, d1, _) in enumerate(pers)]
            img = ee.Image.cat(bandas)
            vals = muestrear(img, g, [f"p{i}" for i in range(len(pers))])
            out["fuentes"][f][modo] = [
                {"etiqueta": et, "desde": d0, "hasta": (dt.date.fromisoformat(d1) - dt.timedelta(days=1)).isoformat(),
                 "media_mm": media_radio(v, g, lat, lon), "valores": v}
                for (d0, d1, et), v in zip(pers, vals)
            ]
    out["nx"], out["ny"], out["bbox"] = g["nx"], g["ny"], g["bbox"]
    return out


def clim_mapa(lat: float, lon: float, y0: int, y1: int) -> dict:
    g = definir_grilla(lat, lon, SEMI_LADO_CLIM_KM)
    col = coleccion("chirps").filterDate(f"{y0}-01-01", f"{y1 + 1}-01-01")
    proj = coleccion("chirps").first().projection()
    img = col.sum().divide(y1 - y0 + 1).setDefaultProjection(proj).rename("anual")
    vals = muestrear(img, g, ["anual"])[0]
    return {"periodo": f"{y0}-{y1}", "nx": g["nx"], "ny": g["ny"], "bbox": g["bbox"],
            "celda_km": CELDA_KM, "valores": vals}


# ---------------------------------------------------------------------------
def procesar(v: dict, hoy: dt.date) -> dict:
    punto = ee.Geometry.Point([v["lon"], v["lat"]])
    y1 = hoy.year - 1
    y0 = y1 - ANIOS_CLIM + 1
    series = {}
    for f in FUENTES:
        log(f"   serie {f}")
        series[f] = serie_diaria(f, punto, hoy)
    log("   climatologia")
    clim = climatologia(punto, y0, y1)
    log("   grillas")
    gr = grillas(v["lat"], v["lon"], series)
    log("   mapa climatologico")
    cm = clim_mapa(v["lat"], v["lon"], y0, y1)
    return {
        "codigo": v["codigo"], "nombre": v["nombre"], "lat": v["lat"], "lon": v["lon"],
        "generado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "series": series,
        "climatologia": {"fuente": "chirps", "periodo": f"{y0}-{y1}", "mm": clim},
        "grillas": gr,
        "clim_mapa": cm,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--volcanes", nargs="*")
    ap.add_argument("--key")
    ap.add_argument("--datos", default=str(RAIZ / "data"))
    args = ap.parse_args()

    datos = Path(args.datos)
    cat = json.loads((datos / "catalogo.json").read_text(encoding="utf-8"))
    volcanes = [v for v in cat["volcanes"] if v.get("tiene_exposicion")]
    if args.volcanes:
        pedidos = {c.upper() for c in args.volcanes}
        volcanes = [v for v in volcanes if v["codigo"] in pedidos]
    iniciar_ee(args.key)
    hoy = dt.date.today()
    fallos = []
    for v in volcanes:
        log(f"{v['codigo']} · {v['nombre']}")
        try:
            res = procesar(v, hoy)
        except Exception as exc:  # noqa: BLE001
            log(f"   ERROR {v['codigo']}: {exc}")
            fallos.append(v["codigo"])
            continue
        destino = datos / "hidromet" / f"{v['codigo']}.json"
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        log(f"   ok {destino.stat().st_size / 1e3:.0f} KB")
    indice = datos / "hidromet" / "index.json"
    archivos = sorted(p.stem for p in (datos / "hidromet").glob("*.json") if p.stem != "index")
    indice.write_text(json.dumps({"generado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                                  "volcanes": archivos, "fallidos": fallos}, ensure_ascii=False), encoding="utf-8")
    if fallos:
        log(f"Terminado con fallos: {fallos}")
        return 1
    log("Terminado sin fallos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
