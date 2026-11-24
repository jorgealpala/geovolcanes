"""
GeoVolcanes-SCR web - Validacion de la carpeta data/ antes de publicar.

Revisa que los datos esten completos y sean coherentes entre si, y que no se
vaya a subir ninguna credencial. Termina con codigo 1 si encuentra errores.

Uso (desde la raiz del repositorio):
    python scripts/validar_datos.py
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
LIMITE_GITHUB = 95 * 1024 * 1024  # GitHub rechaza archivos de mas de 100 MB
NIVELES = ("alta", "media", "baja")
# Marcas de credenciales (armadas por partes para que este archivo no se detecte a si mismo)
MARCA_PEM = "-----BEGIN " + "PRIVATE KEY-----"
MARCA_JSON = '"private' + '_key"'

errores: list[str] = []
avisos: list[str] = []


def leer(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errores.append(f"falta {p.relative_to(RAIZ)}")
    except Exception as exc:  # noqa: BLE001
        errores.append(f"{p.relative_to(RAIZ)} no es JSON UTF-8 valido: {exc}")
    return None


def main() -> int:
    indice = leer(DATA / "index.json")
    cat = leer(DATA / "catalogo.json")
    ranking = leer(DATA / "ranking.json")
    leer(DATA / "colombia_departamentos.geojson")
    if not (indice and cat and ranking):
        return fin()

    por_cod = {v["codigo"]: v for v in cat["volcanes"]}
    cods = [r["codigo"] for r in ranking["ranking"]]
    con_exp = {v["codigo"] for v in cat["volcanes"] if v.get("tiene_exposicion")}
    if set(cods) != con_exp:
        errores.append(f"ranking {sorted(cods)} no coincide con catalogo (tiene_exposicion) {sorted(con_exp)}")

    for r in ranking["ranking"]:
        c = r["codigo"]
        v = por_cod.get(c)
        if not v:
            errores.append(f"{c}: esta en ranking pero no en catalogo")
            continue
        if v.get("lat") is None or v.get("lon") is None:
            errores.append(f"{c}: sin coordenadas de crater")
        res = leer(DATA / "volcanes" / c / "resumen.json")
        pm = DATA / "volcanes" / c / "exposicion.pmtiles"
        if not pm.exists():
            errores.append(f"{c}: falta volcanes/{c}/exposicion.pmtiles")
        else:
            with open(pm, "rb") as fh:
                cab = fh.read(8)
            if cab[:7] != b"PMTiles" or cab[7] != 3:
                errores.append(f"{c}: exposicion.pmtiles no es PMTiles v3")
        if not res:
            continue
        suma = sum(res["niveles"][n]["viviendas"] for n in NIVELES)
        if abs(suma - res["total"]["viviendas"]) > 2:
            errores.append(f"{c}: suma de niveles {suma} != total {res['total']['viviendas']}")
        for n in NIVELES:
            k = res["niveles"][n]
            if abs(k["viviendas_urbano"] + k["viviendas_rural"] - k["viviendas"]) > 1:
                errores.append(f"{c} {n}: urbano + rural != total")
            if r[f"viv_{n}"] != k["viviendas"]:
                errores.append(f"{c} {n}: ranking {r[f'viv_{n}']} != resumen {k['viviendas']}")
        mun = sum(m["total"] for m in res["municipios"])
        if abs(mun - res["total"]["viviendas"]) > max(10, 0.0005 * res["total"]["viviendas"]):
            avisos.append(f"{c}: suma municipal {mun} vs total {res['total']['viviendas']} (redondeo)")
        if len(res["bbox"]) != 4:
            errores.append(f"{c}: bbox invalido")

        hid = DATA / "hidromet" / f"{c}.json"
        if not hid.exists():
            avisos.append(f"{c}: sin data/hidromet/{c}.json (la pestaña de lluvia mostrara un aviso)")
        else:
            h = leer(hid)
            if h:
                gen = dt.datetime.fromisoformat(h["generado"])
                edad = (dt.datetime.now(dt.timezone.utc) - gen).days
                if edad > 7:
                    avisos.append(f"{c}: lluvia generada hace {edad} dias")
                g = h["grillas"]
                for f, modos in g["fuentes"].items():
                    for modo, pers in modos.items():
                        for p in pers:
                            if len(p["valores"]) != g["nx"] * g["ny"]:
                                errores.append(f"{c} hidromet {f}/{modo}: grilla con tamaño incorrecto")

    # Capa nacional: zonas de amenaza de todos los volcanes y municipios en amenaza
    pm = DATA / "nacional" / "amenaza.pmtiles"
    if not pm.exists():
        errores.append("falta nacional/amenaza.pmtiles (mapa nacional sin zonas de amenaza)")
    else:
        with open(pm, "rb") as fh:
            cab = fh.read(8)
        if cab[:7] != b"PMTiles" or cab[7] != 3:
            errores.append("nacional/amenaza.pmtiles no es PMTiles v3")
    terr = leer(DATA / "nacional" / "territorio.json")
    if terr:
        mp = terr["municipios"]
        for nivel in (*NIVELES, "cualquiera"):
            sel = [m for m in mp if not m.get("litigio") and (nivel == "cualquiera" or nivel in m["niveles"])]
            r = terr["resumen"][nivel]
            if r["municipios"] != len(sel) or r["departamentos"] != len({m["dpto_cod"] for m in sel}):
                errores.append(f"territorio.json: resumen de '{nivel}' no coincide con la lista de municipios")
        volc = {c for m in mp for n in m["niveles"].values() for c in n["volcanes"]}
        if volc != set(cods):
            errores.append(f"territorio.json cubre {sorted(volc)}, pero el ranking tiene {sorted(cods)}: reexporte")
        # Todo municipio con viviendas expuestas debe figurar en la tabla territorial
        en_terr = {m["cod"] for m in mp}
        for c in cods:
            res = leer(DATA / "volcanes" / c / "resumen.json")
            if res:
                faltan = {m["cod"] for m in res["municipios"] if m["total"] > 0} - en_terr
                if faltan:
                    errores.append(f"{c}: municipios con exposición ausentes de territorio.json: {sorted(faltan)}")

    # Tamaños y credenciales en todo el repositorio publicable
    for p in RAIZ.rglob("*"):
        if not p.is_file() or ".git" in p.parts or "_pruebas" in p.parts:
            continue
        if p.stat().st_size > LIMITE_GITHUB:
            errores.append(f"{p.relative_to(RAIZ)} pesa {p.stat().st_size / 1e6:.0f} MB (limite GitHub 100 MB)")
        if p.suffix in {".json", ".js", ".py", ".yml", ".md", ".html", ".txt"} and p.stat().st_size < 5_000_000:
            txt = p.read_text(encoding="utf-8", errors="ignore")
            if MARCA_PEM in txt or MARCA_JSON in txt:
                errores.append(f"{p.relative_to(RAIZ)} parece contener una CREDENCIAL. No la publique.")
    return fin(len(cods))


def fin(n: int = 0) -> int:
    for a in avisos:
        print(f"  aviso  {a}")
    for e in errores:
        print(f"  ERROR  {e}")
    if errores:
        print(f"Validacion: {len(errores)} errores. Corrija antes de publicar.")
        return 1
    print(f"Validacion OK: {n} volcanes con datos completos y coherentes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
