// Vista: Exposicion territorial de un volcan. El usuario elige nivel de
// amenaza, tipo de unidad y metrica; el portal muestra los elementos expuestos
// (KPIs, graficos, tabla de municipios) y el mapa de interseccion amenaza x
// unidades DANE, leido de teselas vectoriales PMTiles precalculadas.
/* global maplibregl */

import { json, RUTAS, absoluta } from "../datos.js";
import { entero, decimal, esc, html, titulo, descargarCSV, compacto, fechaHora } from "../formato.js";
import { AMENAZA, TIPO, ALERTA, ESCALA, METODO, NIVELES, RAMPA_LLUVIA } from "../constantes.js";
import { crearMapa, listo } from "../mapas.js";
import { Graficos, ejeValor, ejeCategoria, filaTooltip } from "../graficos.js";

const ZOOM_URBANO = 11;  // debe coincidir con EXPORT_ZOOM_URBANO del exportador
const ZOOM_RURAL = 7;
const CORTES_VIV = [1, 5, 20, 50, 100, 250];  // viviendas expuestas por unidad (coloreo continuo)

function botonesSegmentado(id, opciones, actual, etiqueta) {
  return `<div class="segmentado" role="group" aria-label="${etiqueta}" id="${id}">
    ${opciones.map((o) => `<button type="button" data-v="${o.v}" aria-pressed="${o.v === actual}">${o.color ? `<span class="muestra" style="background:${o.color}"></span>` : ""}${o.t}</button>`).join("")}
  </div>`;
}

export async function render(cont, ctx) {
  const { volcan, cod, params, catalogo } = ctx;
  const res = await json(RUTAS.resumen(cod));
  const graficos = new Graficos();
  const estado = {
    nivel: NIVELES.includes(params.nivel) ? params.nivel : "todos",
    tipo: ["urbano", "rural"].includes(params.tipo) ? params.tipo : "todas",
    metrica: params.metrica === "personas" ? "personas" : "viviendas",
    color: params.color === "viv" ? "viv" : "tipo",
    mpio: params.mpio || null,
  };
  const escala = ESCALA[res.escala_mapa];
  const alerta = ALERTA[volcan.nivel_actividad];
  const obs = catalogo.observatorios[volcan.observatorio];
  const mpioPorCod = new Map(res.municipios.map((m) => [m.cod, m]));
  const factor = res.factor_personas;

  cont.append(html(`
    <section>
      <div class="encabezado-vista">
        <div>
          <h2>Exposición territorial · ${esc(volcan.nombre)}</h2>
          <p class="sub">Cruce de la zonificación oficial de amenaza volcánica del SGC con la base territorial del DANE (MGN 2025):
          manzanas urbanas, secciones rurales y direcciones georreferenciadas.</p>
          <div class="etiquetas">
            <span class="etiqueta" title="${esc(alerta?.desc || "")}"><span class="punto" style="background:${alerta?.color}"></span>Alerta ${esc(alerta?.nombre || volcan.nivel_actividad)}</span>
            ${escala ? `<span class="etiqueta etiqueta--${escala.clase}" title="${esc(escala.desc)}">Mapa ${escala.nombre.toLowerCase()}</span>` : ""}
            <span class="etiqueta">Mapa SGC ${volcan.anio_pub ?? "s. f."}${volcan.version_mapa && volcan.version_mapa !== String(volcan.anio_pub) ? ` · ${esc(volcan.version_mapa)}` : ""}</span>
            <span class="etiqueta">${esc(obs?.ciudad ? `Observatorio de ${obs.ciudad}` : volcan.observatorio)}</span>
            ${volcan.altitud_m ? `<span class="etiqueta">${entero(volcan.altitud_m)} m s.n.m.</span>` : ""}
            <span class="etiqueta">${esc((volcan.departamento || []).join(" · "))}</span>
          </div>
        </div>
      </div>
      ${res.escala_mapa === "influencia_regional" ? `<div class="aviso" style="margin-bottom:14px"><span class="icono">!</span><div>
        <strong>Mapa de escala regional.</strong> ${esc(escala.desc)} La cifra de amenaza <strong>alta</strong> sí es comparable con la de los demás volcanes.</div></div>` : ""}

      <div class="controles">
        <div class="control"><span>Nivel de amenaza</span>
          ${botonesSegmentado("f-nivel", [{ v: "todos", t: "Todos" }, ...NIVELES.map((n) => ({ v: n, t: AMENAZA[n].nombre, color: AMENAZA[n].color }))], estado.nivel, "Nivel de amenaza")}</div>
        <div class="control"><span>Tipo de unidad</span>
          ${botonesSegmentado("f-tipo", [{ v: "todas", t: "Todas" }, { v: "urbano", t: "Urbano", color: TIPO.urbano.color }, { v: "rural", t: "Rural", color: TIPO.rural.color }], estado.tipo, "Tipo de unidad")}</div>
        <div class="control"><span>Métrica</span>
          ${botonesSegmentado("f-metrica", [{ v: "viviendas", t: "Viviendas" }, { v: "personas", t: "Personas" }], estado.metrica, "Métrica")}</div>
      </div>

      <div class="kpis" id="kpis"></div>

      <div class="tarjeta tarjeta--sin-relleno">
        <div class="tarjeta__cabeza">
          <h3 id="titulo-mapa">Mapa de intersección: amenaza × unidades expuestas</h3>
          <span class="nota">Clic en una unidad para ver su detalle · el control <b>▤</b> cambia el mapa base y el relieve 3D</span>
        </div>
        <div class="mapa mapa--alto" id="mapa-exp">
          <details class="capas-mapa" open>
            <summary>Capas</summary>
            <div class="cuerpo">
              <label><input type="checkbox" data-capa="amenaza" checked> Zonas de amenaza</label>
              <label style="padding-left:22px;font-size:12px">Opacidad <input type="range" id="op-amenaza" min="0" max="80" value="28" style="width:90px"></label>
              <label><input type="checkbox" data-capa="unidades" checked> Unidades expuestas</label>
              <div class="grupo">Color de las unidades</div>
              <label><input type="radio" name="color-u" value="tipo" ${estado.color === "tipo" ? "checked" : ""}> Por tipo (urbano / rural)</label>
              <label><input type="radio" name="color-u" value="viv" ${estado.color === "viv" ? "checked" : ""}> Por viviendas expuestas</label>
              <div class="grupo">Límites</div>
              <label><input type="checkbox" data-capa="municipios" checked> Municipios</label>
              <label><input type="checkbox" data-capa="departamentos" checked> Departamentos</label>
            </div>
          </details>
          <div class="aviso-mapa oculto" id="aviso-zoom"></div>
        </div>
        <div class="mapa-pie" id="leyenda-mapa"></div>
      </div>

      <div class="separador"></div>

      <div class="rejilla rejilla-2">
        <div class="tarjeta">
          <div class="tarjeta__cabeza"><h3 id="t-g-niveles">Exposición por nivel de amenaza</h3><span class="nota">Urbano y rural apilados</span></div>
          <div class="grafico" id="g-niveles"></div>
        </div>
        <div class="tarjeta">
          <div class="tarjeta__cabeza"><h3 id="t-g-mpios">Municipios con mayor exposición</h3><span class="nota">10 primeros · niveles apilados</span></div>
          <div class="grafico" id="g-mpios"></div>
        </div>
      </div>

      <div class="separador"></div>

      <div class="tarjeta tarjeta--sin-relleno">
        <div class="tarjeta__cabeza"><h3>Métricas detalladas por nivel de amenaza</h3><span class="nota">Área de amenaza medida en EPSG:9377</span></div>
        <div class="tabla-contenedor" style="max-height:none"><table class="tabla" id="t-niveles"></table></div>
      </div>

      <div class="separador"></div>

      <div class="tarjeta tarjeta--sin-relleno">
        <div class="barra-herramientas">
          <div><h3>Municipios afectados</h3><div class="nota" id="nota-mpios"></div></div>
          <div class="flex">
            <div class="buscador"><input class="campo" type="search" id="buscar-mpio" placeholder="Buscar municipio o departamento" aria-label="Buscar municipio"></div>
            <button class="boton boton--chico" id="csv-mpios">Descargar CSV</button>
          </div>
        </div>
        <div class="tabla-contenedor"><table class="tabla" id="t-mpios"></table></div>
      </div>

      <div class="separador"></div>

      <details class="tarjeta plegable" id="metodologia">
        <summary>Metodología, fuentes y notas de interpretación</summary>
        <div class="separador"></div>
        <div id="cuerpo-metodologia"></div>
      </details>
    </section>`));

  // ======================================================================
  // Calculos de presentacion (todo sale de resumen.json; nada se recalcula)
  // ======================================================================
  const activos = () => (estado.nivel === "todos" ? NIVELES : [estado.nivel]);
  const sufijoTipo = () => (estado.tipo === "urbano" ? "_urbano" : estado.tipo === "rural" ? "_rural" : "");
  const campoMetrica = () => (estado.metrica === "personas" ? "personas" : "viviendas");
  const agregado = () => (estado.nivel === "todos" ? res.total : res.niveles[estado.nivel]);
  const valorNivel = (n) => res.niveles[n][campoMetrica() + sufijoTipo()];
  const valorMpio = (m, n) => {
    const base = estado.tipo === "urbano" ? m[`${n}_u`] : estado.tipo === "rural" ? m[`${n}_r`] : m[n];
    return estado.metrica === "personas" ? Math.round(base * factor) : base;
  };
  const etiquetaMetrica = () => (estado.metrica === "personas" ? "Personas" : "Viviendas");
  const textoNivel = () => (estado.nivel === "todos" ? "las tres zonas de amenaza" : `amenaza ${estado.nivel}`);
  const textoTipo = () => (estado.tipo === "todas" ? "" : estado.tipo === "urbano" ? " · solo urbano" : " · solo rural");

  function dibujarKPIs() {
    const a = agregado();
    const valor = a[campoMetrica() + sufijoTipo()];
    const otra = estado.metrica === "personas" ? a["viviendas" + sufijoTipo()] : a["personas" + sufijoTipo()];
    const nMpios = estado.tipo === "todas"
      ? a.municipios
      : res.municipios.filter((m) => activos().some((n) => valorMpio(m, n) > 0)).length;
    const colorBorde = estado.nivel === "todos" ? "var(--texto-3)" : AMENAZA[estado.nivel].color;
    cont.querySelector("#kpis").innerHTML = `
      <div class="kpi" style="border-top:3px solid ${colorBorde}"><div class="kpi__etiqueta">${etiquetaMetrica()} expuestas</div>
        <div class="kpi__valor">${entero(valor)}</div><div class="kpi__detalle">En ${textoNivel()}${textoTipo()}</div></div>
      <div class="kpi" style="border-top:3px solid ${colorBorde}"><div class="kpi__etiqueta">${estado.metrica === "personas" ? "Viviendas" : "Personas estimadas"}</div>
        <div class="kpi__valor">${entero(otra)}</div><div class="kpi__detalle">${estado.metrica === "personas" ? "Viviendas DANE (Recuento 2023)" : `Viviendas × ${decimal(factor)} hab./vivienda`}</div></div>
      <div class="kpi"><div class="kpi__etiqueta">Municipios afectados</div><div class="kpi__valor">${entero(nMpios)}</div>
        <div class="kpi__detalle">Con al menos una unidad expuesta</div></div>
      <div class="kpi"><div class="kpi__etiqueta">Manzanas urbanas</div><div class="kpi__valor">${estado.tipo === "rural" ? "—" : entero(a.manzanas)}</div>
        <div class="kpi__detalle">Intersecan la zona de amenaza</div></div>
      <div class="kpi"><div class="kpi__etiqueta">Secciones rurales</div><div class="kpi__valor">${estado.tipo === "urbano" ? "—" : entero(a.secciones)}</div>
        <div class="kpi__detalle">Intersecan la zona de amenaza</div></div>
      <div class="kpi"><div class="kpi__etiqueta">Unidades económicas</div><div class="kpi__valor">${estado.tipo === "rural" ? "—" : entero(a.unidades_economicas)}</div>
        <div class="kpi__detalle">${entero(a.placas)} direcciones urbanas</div></div>
      <div class="kpi"><div class="kpi__etiqueta">Área de amenaza</div><div class="kpi__valor">${entero(a.area_amenaza_km2)} <span style="font-size:15px;font-weight:600">km²</span></div>
        <div class="kpi__detalle">Polígonos consolidados del SGC</div></div>`;
  }

  // ---------------------------------------------------------------- graficos
  function dibujarGraficos() {
    const ns = activos();
    const met = etiquetaMetrica();
    cont.querySelector("#t-g-niveles").textContent = `${met} expuestas por nivel de amenaza`;
    const tipos = estado.tipo === "todas" ? ["urbano", "rural"] : [estado.tipo];
    graficos.crear(cont.querySelector("#g-niveles"), {
      legend: { data: tipos.map((t) => TIPO[t].nombre) },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (p) => `<b>Amenaza ${p[0].axisValue.toLowerCase()}</b><br>` +
          p.map((s) => filaTooltip(s.color, s.seriesName, entero(s.value))).join("") +
          (p.length > 1 ? filaTooltip("transparent", "Total", entero(p.reduce((a, s) => a + s.value, 0))) : ""),
      },
      xAxis: ejeCategoria(ns.map((n) => AMENAZA[n].nombre)),
      yAxis: ejeValor({ name: met.toLowerCase() }),
      series: tipos.map((t, i) => ({
        name: TIPO[t].nombre, type: "bar", stack: "u", barMaxWidth: 64,
        itemStyle: { color: TIPO[t].color, borderColor: "#fff", borderWidth: 1, borderRadius: i === tipos.length - 1 ? [4, 4, 0, 0] : 0 },
        data: ns.map((n) => res.niveles[n][`${campoMetrica()}_${t}`]),
        label: i === tipos.length - 1 ? {
          show: true, position: "top", color: "#4a5260", fontWeight: 600,
          formatter: (p) => compacto(tipos.reduce((a, tt) => a + res.niveles[ns[p.dataIndex]][`${campoMetrica()}_${tt}`], 0)),
        } : { show: false },
      })),
    });

    cont.querySelector("#t-g-mpios").textContent = `Municipios con más ${met.toLowerCase()} expuestas`;
    const top = res.municipios
      .map((m) => ({ m, total: ns.reduce((a, n) => a + valorMpio(m, n), 0) }))
      .filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, 10).reverse();
    const g = graficos.crear(cont.querySelector("#g-mpios"), {
      legend: { data: ns.map((n) => `Amenaza ${AMENAZA[n].nombre.toLowerCase()}`) },
      grid: { right: 60 },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (p) => {
          const x = top[p[0].dataIndex];
          return `<b>${esc(titulo(x.m.mpio))}</b> · ${esc(titulo(x.m.dpto))}<br>` +
            p.map((s) => filaTooltip(s.color, s.seriesName, entero(s.value))).join("") +
            filaTooltip("transparent", "Total", entero(x.total)) + `<div class="nota" style="margin-top:4px">Clic para ubicarlo en el mapa</div>`;
        },
      },
      xAxis: ejeValor({ splitNumber: 4 }),
      yAxis: ejeCategoria(top.map((x) => titulo(x.m.mpio)), { axisLabel: { color: "#4a5260", width: 110, overflow: "truncate" } }),
      series: ns.map((n, i) => ({
        name: `Amenaza ${AMENAZA[n].nombre.toLowerCase()}`, type: "bar", stack: "m", barMaxWidth: 16,
        itemStyle: { color: AMENAZA[n].color, borderColor: "#fff", borderWidth: 1, borderRadius: i === ns.length - 1 ? [0, 4, 4, 0] : 0 },
        data: top.map((x) => valorMpio(x.m, n)),
        label: i === ns.length - 1 ? { show: true, position: "right", color: "#4a5260", formatter: (p) => compacto(top[p.dataIndex].total) } : { show: false },
      })),
    });
    g.off("click");
    g.on("click", (p) => enfocarMunicipio(top[p.dataIndex].m.cod));
  }

  // ---------------------------------------------------------------- tabla por nivel
  function dibujarTablaNiveles() {
    const ns = activos();
    const fila = (nombre, color, a) => `<tr>
      <td>${color ? `<span class="leyenda-item"><span class="caja" style="background:${color}"></span><strong>${nombre}</strong></span>` : `<strong>${nombre}</strong>`}</td>
      <td class="num">${entero(a["viviendas" + sufijoTipo()])}</td>
      <td class="num">${entero(a["personas" + sufijoTipo()])}</td>
      <td class="num">${estado.tipo === "rural" ? "—" : entero(a.manzanas)}</td>
      <td class="num">${estado.tipo === "urbano" ? "—" : entero(a.secciones)}</td>
      <td class="num">${entero(a.municipios)}</td>
      <td class="num">${estado.tipo === "rural" ? "—" : entero(a.unidades_economicas)}</td>
      <td class="num">${estado.tipo === "rural" ? "—" : entero(a.placas)}</td>
      <td class="num">${decimal(a.area_amenaza_km2)}</td></tr>`;
    cont.querySelector("#t-niveles").innerHTML = `
      <thead><tr><th>Nivel de amenaza</th><th class="num">Viviendas</th><th class="num">Personas</th><th class="num">Manzanas</th>
        <th class="num">Secciones rurales</th><th class="num">Municipios</th><th class="num">Unidades económicas</th>
        <th class="num">Direcciones</th><th class="num">Área km²</th></tr></thead>
      <tbody>${ns.map((n) => fila(AMENAZA[n].nombre, AMENAZA[n].color, res.niveles[n])).join("")}</tbody>
      ${ns.length > 1 ? `<tfoot>${fila("Total (sin doble conteo)", null, res.total)}</tfoot>` : ""}`;
  }

  // ---------------------------------------------------------------- tabla municipios
  let ordenM = { campo: "total", dir: -1 };
  let busqueda = "";
  function filasMunicipios() {
    const ns = activos();
    const q = busqueda.trim().toLocaleLowerCase("es-CO").normalize("NFD").replace(/[̀-ͯ]/g, "");
    return res.municipios
      .map((m) => {
        const vals = Object.fromEntries(ns.map((n) => [n, valorMpio(m, n)]));
        return { m, vals, total: ns.reduce((a, n) => a + vals[n], 0) };
      })
      .filter((x) => x.total > 0)
      .filter((x) => !q || `${x.m.mpio} ${x.m.dpto}`.toLocaleLowerCase("es-CO").normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q));
  }
  function dibujarTablaMunicipios() {
    const ns = activos();
    const lista = filasMunicipios().sort((a, b) => {
      const va = ordenM.campo === "total" ? a.total : ordenM.campo === "mpio" ? a.m.mpio : ordenM.campo === "dpto" ? a.m.dpto : a.vals[ordenM.campo];
      const vb = ordenM.campo === "total" ? b.total : ordenM.campo === "mpio" ? b.m.mpio : ordenM.campo === "dpto" ? b.m.dpto : b.vals[ordenM.campo];
      return (typeof va === "string" ? va.localeCompare(vb, "es") : va - vb) * ordenM.dir;
    });
    const maxN = Object.fromEntries(ns.map((n) => [n, Math.max(1, ...lista.map((x) => x.vals[n]))]));
    const clase = (c) => (ordenM.campo === c ? (ordenM.dir === 1 ? "ordenado-asc" : "ordenado-desc") : "");
    const tabla = cont.querySelector("#t-mpios");
    tabla.innerHTML = `
      <thead><tr>
        <th data-orden="mpio" class="${clase("mpio")}">Municipio</th>
        <th data-orden="dpto" class="${clase("dpto")}">Departamento</th>
        ${ns.map((n) => `<th data-orden="${n}" class="${clase(n)}" style="color:${AMENAZA[n].color}">Amenaza ${AMENAZA[n].nombre.toLowerCase()}</th>`).join("")}
        <th data-orden="total" class="num ${clase("total")}">Total ${etiquetaMetrica().toLowerCase()}</th>
        <th></th>
      </tr></thead>
      <tbody>${lista.map((x) => `<tr class="clicable${x.m.cod === estado.mpio ? " seleccionada" : ""}" data-cod="${x.m.cod}">
        <td><strong>${esc(titulo(x.m.mpio))}</strong> <span class="secundario">${x.m.cod}</span></td>
        <td class="secundario">${esc(titulo(x.m.dpto))}</td>
        ${ns.map((n) => `<td><div class="celda-barra"><div class="pista"><div class="relleno" style="width:${(100 * x.vals[n]) / maxN[n]}%;background:${AMENAZA[n].color}"></div></div><span class="valor">${entero(x.vals[n])}</span></div></td>`).join("")}
        <td class="num"><strong>${entero(x.total)}</strong></td>
        <td><button class="boton boton--chico" data-ver="${x.m.cod}" title="Ubicar en el mapa">Ver en mapa</button></td>
      </tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="2">${entero(lista.length)} municipios</td>
        ${ns.map((n) => `<td class="num">${entero(lista.reduce((a, x) => a + x.vals[n], 0))}</td>`).join("")}
        <td class="num">${entero(lista.reduce((a, x) => a + x.total, 0))}</td><td></td></tr></tfoot>`;
    cont.querySelector("#nota-mpios").innerHTML =
      `${etiquetaMetrica()} en ${textoNivel()}${textoTipo()}. Las cifras municipales se redondean por separado: su suma puede diferir en pocas unidades del total del volcán.`;
  }
  cont.querySelector("#t-mpios").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-orden]");
    if (th) {
      const c = th.dataset.orden;
      ordenM = { campo: c, dir: ordenM.campo === c ? -ordenM.dir : (c === "mpio" || c === "dpto" ? 1 : -1) };
      dibujarTablaMunicipios();
      return;
    }
    const tr = e.target.closest("tr[data-cod]");
    if (tr) enfocarMunicipio(tr.dataset.cod);
  });
  cont.querySelector("#buscar-mpio").addEventListener("input", (e) => { busqueda = e.target.value; dibujarTablaMunicipios(); });
  cont.querySelector("#csv-mpios").addEventListener("click", () => {
    const col = [{ titulo: "codigo_dane", valor: (m) => m.cod }, { titulo: "municipio", valor: (m) => titulo(m.mpio) }, { titulo: "departamento", valor: (m) => titulo(m.dpto) }];
    for (const n of NIVELES) {
      col.push({ titulo: `viviendas_${n}`, valor: (m) => m[n] }, { titulo: `viviendas_${n}_urbano`, valor: (m) => m[`${n}_u`] },
        { titulo: `viviendas_${n}_rural`, valor: (m) => m[`${n}_r`] }, { titulo: `personas_${n}`, valor: (m) => Math.round(m[n] * factor) });
    }
    col.push({ titulo: "viviendas_total", valor: (m) => m.total }, { titulo: "personas_total", valor: (m) => Math.round(m.total * factor) });
    descargarCSV(`exposicion_municipios_${cod}.csv`, col, res.municipios);
  });

  // ---------------------------------------------------------------- metodologia
  const metodos = res.metodos;
  cont.querySelector("#cuerpo-metodologia").innerHTML = `
    <div class="metodologia">
      <div>
        <h4>Fórmulas de exposición</h4>
        <p><strong>Urbano con direcciones</strong> (método <code>placas_proxy</code>): las direcciones georreferenciadas del DANE indican dónde se concentra la ocupación dentro de la manzana.</p>
        <span class="formula">viv_expuestas = viv_manzana × placas_en_amenaza / placas_manzana</span>
        <p><strong>Urbano sin direcciones</strong> (<code>area_fallback</code>): reparto uniforme por área.</p>
        <span class="formula">viv_expuestas = viv_manzana × área_intersección / área_manzana</span>
        <p><strong>Rural</strong> (<code>area_ponderada_9377</code>): reparto por área medida en EPSG:9377.</p>
        <span class="formula">viv_expuestas = viv_sección × área_intersección / área_sección</span>
        <p><strong>Población:</strong> personas = viviendas × ${decimal(factor)} (promedio nacional de personas por hogar, DANE CNPV 2018).</p>
      </div>
      <div>
        <h4>Fuentes</h4>
        <ul>${Object.entries(res.fuentes).map(([k, v]) => `<li><strong>${esc(k.replace("_", " "))}:</strong> ${esc(v)}</li>`).join("")}</ul>
        <h4 style="margin-top:12px">Fechas del cálculo</h4>
        <ul>
          <li>Cruce de exposición: ${esc(fechaHora(res.fechas.calculo))}</li>
          <li>Carga de manzanas DANE: ${esc(fechaHora(res.fechas.manzanas))}</li>
          <li>Carga de direcciones DANE: ${esc(fechaHora(res.fechas.direcciones))}</li>
        </ul>
      </div>
      <div>
        <h4>Notas de interpretación</h4>
        <ul>
          <li>Los niveles son <strong>mutuamente excluyentes</strong>: media = media − alta; baja = baja − (alta ∪ media). Por eso los totales no tienen doble conteo.</li>
          <li>Una manzana partida por dos zonas aparece en ambas con su fracción; el total de manzanas cuenta cada una una sola vez.</li>
          <li>Las <strong>unidades económicas</strong> provienen de las direcciones urbanas del DANE; no existen para el área rural.</li>
          <li>${esc(ESCALA[res.escala_mapa]?.desc || "")}</li>
          <li>En el mapa, las secciones rurales aparecen desde el zoom ${ZOOM_RURAL} y las manzanas urbanas desde el zoom ${ZOOM_URBANO}.</li>
        </ul>
      </div>
    </div>
    <div class="separador"></div>
    <h4 style="font-size:13px;margin-bottom:6px">Métodos aplicados en este volcán</h4>
    <div class="tabla-contenedor" style="max-height:none;border:1px solid var(--borde);border-radius:8px">
      <table class="tabla"><thead><tr><th>Nivel</th><th>Método</th><th>Tipo</th><th class="num">Unidades</th><th class="num">Viviendas</th><th class="num">% del nivel</th></tr></thead>
      <tbody>${NIVELES.flatMap((n) => metodos.filter((m) => m.nivel === n).map((m) => `<tr>
        <td><span class="leyenda-item"><span class="caja" style="background:${AMENAZA[n].color}"></span>${AMENAZA[n].nombre}</span></td>
        <td>${esc(METODO[m.metodo] || m.metodo)}</td><td>${esc(TIPO[m.tipo]?.nombre || m.tipo)}</td>
        <td class="num">${entero(m.unidades)}</td><td class="num">${entero(m.viviendas)}</td>
        <td class="num">${res.niveles[n].viviendas ? decimal((100 * m.viviendas) / res.niveles[n].viviendas) : "—"} %</td></tr>`)).join("")}</tbody></table>
    </div>`;

  // ======================================================================
  // Mapa
  // ======================================================================
  const elMapa = cont.querySelector("#mapa-exp");
  const [x0, y0, x1, y1] = res.bbox;
  const map = crearMapa(elMapa, { limites: [[x0, y0], [x1, y1]], base: "topografico" });
  let popup = null;
  const marcador = new maplibregl.Marker({ color: "#14181f", scale: 0.8 })
    .setLngLat([volcan.lon, volcan.lat])
    .setPopup(new maplibregl.Popup({ offset: 24 }).setHTML(`<div class="popup"><h4>${esc(volcan.nombre)}</h4>${volcan.altitud_m ? `${entero(volcan.altitud_m)} m s.n.m.` : ""}</div>`))
    .addTo(map);

  const filtroNivel = () => (estado.nivel === "todos" ? ["has", "nivel"] : ["==", ["get", "nivel"], estado.nivel]);
  const filtroUnidades = () => {
    const f = ["all", filtroNivel()];
    if (estado.tipo !== "todas") f.push(["==", ["get", "tipo"], estado.tipo]);
    return f;
  };
  const colorNivel = ["match", ["get", "nivel"], "alta", AMENAZA.alta.color, "media", AMENAZA.media.color, "baja", AMENAZA.baja.color, "#888"];
  const colorUnidades = () => (estado.color === "viv"
    ? ["step", ["get", "viv"], RAMPA_LLUVIA[1], ...CORTES_VIV.flatMap((c, i) => [c, RAMPA_LLUVIA[Math.min(i + 2, RAMPA_LLUVIA.length - 1)]])]
    : ["match", ["get", "tipo"], "urbano", TIPO.urbano.color, "rural", TIPO.rural.color, "#888"]);

  listo(map).then(() => {
    if (!map.getStyle()) return;
    map.addSource("exp", { type: "vector", url: `pmtiles://${absoluta(RUTAS.pmtiles(cod))}`, attribution: "SGC · DANE MGN 2025" });
    map.addLayer({ id: "amz-relleno", type: "fill", source: "exp", "source-layer": "amenaza", filter: filtroNivel(),
      paint: { "fill-color": colorNivel, "fill-opacity": 0.28, "fill-antialias": false } });
    map.addLayer({ id: "uni-relleno", type: "fill", source: "exp", "source-layer": "unidades", filter: filtroUnidades(),
      paint: { "fill-color": colorUnidades(), "fill-opacity": 0.62 } });
    map.addLayer({ id: "uni-borde", type: "line", source: "exp", "source-layer": "unidades", filter: filtroUnidades(), minzoom: 12,
      paint: { "line-color": "#ffffff", "line-width": 0.4, "line-opacity": 0.7 } });
    map.addLayer({ id: "amz-borde", type: "line", source: "exp", "source-layer": "amenaza_borde", filter: filtroNivel(),
      paint: { "line-color": colorNivel, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.6, 12, 3] } });
    map.addLayer({ id: "uni-resalte", type: "line", source: "exp", "source-layer": "unidades", filter: ["==", ["get", "mpio"], "__ninguno__"],
      paint: { "line-color": "#14181f", "line-width": 1.6 } });
    map.addLayer({ id: "lim-mpio", type: "line", source: "exp", "source-layer": "municipios",
      paint: { "line-color": "#6d4bc4", "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.85 } });
    map.addLayer({ id: "lim-mpio-sel", type: "line", source: "exp", "source-layer": "municipios", filter: ["==", ["get", "mpio"], "__ninguno__"],
      paint: { "line-color": "#14181f", "line-width": 2.6 } });
    map.addLayer({ id: "lim-dpto", type: "line", source: "exp", "source-layer": "departamentos",
      paint: { "line-color": "#1f2937", "line-width": 1.6, "line-opacity": 0.9 } });

    map.on("mouseenter", "uni-relleno", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "uni-relleno", () => { map.getCanvas().style.cursor = ""; });
    map.on("click", "uni-relleno", (e) => {
      const p = e.features[0].properties;
      const m = mpioPorCod.get(p.mpio);
      popup?.remove();
      popup = new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(`<div class="popup">
        <h4>${esc(TIPO[p.tipo]?.nombre || p.tipo)} · ${esc(m ? titulo(m.mpio) : p.mpio)}</h4>
        <div style="margin-bottom:6px"><span class="etiqueta"><span class="punto" style="background:${AMENAZA[p.nivel]?.color}"></span>Amenaza ${esc(p.nivel)}</span></div>
        <table>
          <tr><td>Viviendas expuestas</td><td>${decimal(p.viv)}</td></tr>
          <tr><td>Personas estimadas</td><td>${entero(p.viv * factor)}</td></tr>
          <tr><td>Viviendas de la ${p.tipo === "urbano" ? "manzana" : "sección"}</td><td>${entero(p.viv_tot)}</td></tr>
          <tr><td>Área dentro de la zona</td><td>${entero(p.pct)} %</td></tr>
          ${p.tipo === "urbano" ? `<tr><td>Direcciones en la zona</td><td>${p.placas ? entero(p.placas) : "0"}</td></tr>` : ""}
          <tr><td>Método</td><td style="font-weight:500">${esc(p.metodo)}</td></tr>
          <tr><td>Departamento</td><td style="font-weight:500">${esc(m ? titulo(m.dpto) : "—")}</td></tr>
          <tr><td>Código DANE</td><td style="font-weight:500;font-family:var(--mono);font-size:11px">${esc(p.unidad)}</td></tr>
        </table></div>`).addTo(map);
    });
    map.on("zoomend", avisoZoom);
    avisoZoom();
    if (estado.mpio) resaltarMunicipio(estado.mpio, false);
  });

  function avisoZoom() {
    const z = map.getZoom();
    const aviso = cont.querySelector("#aviso-zoom");
    let txt = "";
    if (z < ZOOM_RURAL) txt = "Acerque el mapa para ver las unidades expuestas";
    else if (z < ZOOM_URBANO && estado.tipo !== "rural") txt = `Acerque el mapa (zoom ${ZOOM_URBANO}+) para ver las manzanas urbanas`;
    aviso.textContent = txt;
    aviso.classList.toggle("oculto", !txt || !cont.querySelector('[data-capa="unidades"]').checked);
  }

  function aplicarFiltrosMapa() {
    if (!map.getLayer("amz-relleno")) return;
    map.setFilter("amz-relleno", filtroNivel());
    map.setFilter("amz-borde", filtroNivel());
    map.setFilter("uni-relleno", filtroUnidades());
    map.setFilter("uni-borde", filtroUnidades());
    map.setPaintProperty("uni-relleno", "fill-color", colorUnidades());
    avisoZoom();
  }

  function dibujarLeyenda() {
    const ns = activos();
    const unidades = estado.color === "viv"
      ? `<span class="leyenda-titulo">Viviendas expuestas por unidad</span>${[["< 1", RAMPA_LLUVIA[1]], ...CORTES_VIV.map((c, i) => [`${c}${i === CORTES_VIV.length - 1 ? "+" : `–${CORTES_VIV[i + 1]}`}`, RAMPA_LLUVIA[Math.min(i + 2, RAMPA_LLUVIA.length - 1)]])]
        .map(([t, c]) => `<span class="leyenda-item"><span class="caja" style="background:${c}"></span>${t}</span>`).join("")}`
      : `<span class="leyenda-titulo">Unidades expuestas</span>
         ${(estado.tipo === "todas" ? ["urbano", "rural"] : [estado.tipo]).map((t) => `<span class="leyenda-item"><span class="caja" style="background:${TIPO[t].color}"></span>${TIPO[t].nombre} (${TIPO[t].unidad})</span>`).join("")}`;
    cont.querySelector("#leyenda-mapa").innerHTML = `
      <span class="leyenda-titulo">Amenaza</span>
      ${ns.map((n) => `<span class="leyenda-item" title="${esc(AMENAZA[n].desc)}"><span class="caja" style="background:${AMENAZA[n].color}55;border:2px solid ${AMENAZA[n].color}"></span>${AMENAZA[n].nombre}</span>`).join("")}
      <span style="width:12px"></span>${unidades}
      <span style="width:12px"></span><span class="leyenda-titulo">Límites</span>
      <span class="leyenda-item"><span class="linea" style="border-color:#1f2937"></span>Departamento</span>
      <span class="leyenda-item"><span class="linea" style="border-top-style:dashed;border-color:#6d4bc4"></span>Municipio</span>`;
  }

  function resaltarMunicipio(codMpio, volar = true) {
    if (!map.getLayer("uni-resalte")) return;
    const f = codMpio ? ["==", ["get", "mpio"], codMpio] : ["==", ["get", "mpio"], "__ninguno__"];
    map.setFilter("uni-resalte", f);
    map.setFilter("lim-mpio-sel", f);
    const m = mpioPorCod.get(codMpio);
    if (volar && m?.bbox) map.fitBounds([[m.bbox[0], m.bbox[1]], [m.bbox[2], m.bbox[3]]], { padding: 40, duration: 900, maxZoom: 14 });
  }

  function enfocarMunicipio(codMpio) {
    estado.mpio = codMpio;
    ctx.fijarParams({ mpio: codMpio });
    resaltarMunicipio(codMpio);
    dibujarTablaMunicipios();
    elMapa.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Capas: casillas y opacidad
  elMapa.querySelector(".capas-mapa").addEventListener("change", (e) => {
    const capa = e.target.dataset.capa;
    const vis = e.target.checked ? "visible" : "none";
    const grupos = { amenaza: ["amz-relleno", "amz-borde"], unidades: ["uni-relleno", "uni-borde", "uni-resalte"], municipios: ["lim-mpio", "lim-mpio-sel"], departamentos: ["lim-dpto"] };
    if (capa && map.getLayer(grupos[capa][0])) grupos[capa].forEach((l) => map.setLayoutProperty(l, "visibility", vis));
    if (e.target.name === "color-u") {
      estado.color = e.target.value;
      ctx.fijarParams({ color: estado.color === "viv" ? "viv" : undefined });
      aplicarFiltrosMapa();
      dibujarLeyenda();
    }
    avisoZoom();
  });
  elMapa.querySelector("#op-amenaza").addEventListener("input", (e) => {
    if (map.getLayer("amz-relleno")) map.setPaintProperty("amz-relleno", "fill-opacity", Number(e.target.value) / 100);
  });

  // ======================================================================
  // Filtros
  // ======================================================================
  function enlazar(id, clave) {
    cont.querySelector(`#${id}`).addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      estado[clave] = b.dataset.v;
      cont.querySelectorAll(`#${id} button`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      ctx.fijarParams({
        nivel: estado.nivel === "todos" ? undefined : estado.nivel,
        tipo: estado.tipo === "todas" ? undefined : estado.tipo,
        metrica: estado.metrica === "viviendas" ? undefined : estado.metrica,
      });
      actualizar();
    });
  }
  enlazar("f-nivel", "nivel");
  enlazar("f-tipo", "tipo");
  enlazar("f-metrica", "metrica");

  function actualizar() {
    dibujarKPIs();
    dibujarGraficos();
    dibujarTablaNiveles();
    dibujarTablaMunicipios();
    dibujarLeyenda();
    aplicarFiltrosMapa();
  }
  actualizar();

  return () => { popup?.remove(); marcador.remove(); graficos.liberar(); map.remove(); };
}
