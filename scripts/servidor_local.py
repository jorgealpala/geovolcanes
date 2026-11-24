"""
Servidor local para probar el portal antes de publicarlo.

Igual que GitHub Pages, atiende peticiones HTTP Range (lecturas parciales).
Las teselas .pmtiles las necesitan: `python -m http.server` NO las soporta y
el mapa de exposicion quedaria vacio.

Uso (desde la raiz del repositorio):
    python scripts/servidor_local.py            # http://localhost:8765
    python scripts/servidor_local.py 9000       # otro puerto
"""
from __future__ import annotations

import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


class Manejador(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".pmtiles": "application/octet-stream",
                      ".geojson": "application/geo+json",
                      ".json": "application/json",
                      ".js": "text/javascript"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(RAIZ), **kw)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        rango = self.headers.get("Range")
        if not rango:
            return super().send_head()
        ruta = self.translate_path(self.path)
        if not os.path.isfile(ruta):
            return super().send_head()
        m = re.match(r"bytes=(\d*)-(\d*)$", rango.strip())
        tam = os.path.getsize(ruta)
        if not m:
            self.send_error(416)
            return None
        ini = int(m.group(1)) if m.group(1) else max(0, tam - int(m.group(2)))
        fin = int(m.group(2)) if (m.group(1) and m.group(2)) else tam - 1
        fin = min(fin, tam - 1)
        if ini > fin:
            self.send_error(416)
            return None
        fh = open(ruta, "rb")
        fh.seek(ini)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(ruta))
        self.send_header("Content-Range", f"bytes {ini}-{fin}/{tam}")
        self.send_header("Content-Length", str(fin - ini + 1))
        self.end_headers()
        self._resto = fin - ini + 1
        return fh

    def copyfile(self, source, outputfile):
        resto = getattr(self, "_resto", None)
        if resto is None:
            return super().copyfile(source, outputfile)
        while resto > 0:
            bloque = source.read(min(65536, resto))
            if not bloque:
                break
            outputfile.write(bloque)
            resto -= len(bloque)
        self._resto = None


if __name__ == "__main__":
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"GeoVolcanes-SCR web en http://localhost:{puerto}  (Ctrl+C para detener)")
    ThreadingHTTPServer(("127.0.0.1", puerto), Manejador).serve_forever()
