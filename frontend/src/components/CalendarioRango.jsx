import { useState } from 'react'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function parse(str) {
  if (!str) return null
  const m = String(str).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return isNaN(d.getTime()) ? null : d
}
function fmt(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}
const soloFecha = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const misma = (a, b) => a && b && a.getTime() === b.getTime()

export default function CalendarioRango({ desde, hasta, onAplicar, onCerrar }) {
  const dIni = parse(desde) || new Date()
  const [mes, setMes] = useState(new Date(dIni.getFullYear(), dIni.getMonth(), 1))
  const [selD, setSelD] = useState(parse(desde))
  const [selH, setSelH] = useState(parse(hasta))

  const anio = mes.getFullYear()
  const m = mes.getMonth()
  const primerDow = (new Date(anio, m, 1).getDay() + 6) % 7
  const diasEnMes = new Date(anio, m + 1, 0).getDate()

  const celdas = []
  for (let i = 0; i < primerDow; i++) celdas.push(null)
  for (let d = 1; d <= diasEnMes; d++) celdas.push(new Date(anio, m, d))

  function clickDia(dia) {
    const f = soloFecha(dia)
    if (!selD || (selD && selH)) { setSelD(f); setSelH(null); return }
    if (f.getTime() < selD.getTime()) { setSelD(f); setSelH(null); return }
    setSelH(f)
  }
  function enRango(dia) {
    if (!selD || !selH) return false
    const t = soloFecha(dia).getTime()
    return t > selD.getTime() && t < selH.getTime()
  }
  const cambiarMes = (delta) => setMes(new Date(anio, m + delta, 1))

  return (
    <div className="cal-overlay" onClick={onCerrar}>
      <div className="cal-card" onClick={(e) => e.stopPropagation()}>
        <div className="cal-head">
          <button type="button" className="cal-nav" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">‹</button>
          <span className="cal-title">{MESES[m]} {anio}</span>
          <button type="button" className="cal-nav" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">›</button>
        </div>

        <div className="cal-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>

        <div className="cal-grid">
          {celdas.map((dia, i) =>
            dia ? (
              <button
                type="button"
                key={i}
                className={
                  'cal-dia' +
                  (misma(soloFecha(dia), selD) ? ' ini' : '') +
                  (misma(soloFecha(dia), selH) ? ' fin' : '') +
                  (enRango(dia) ? ' rango' : '')
                }
                onClick={() => clickDia(dia)}
              >
                {dia.getDate()}
              </button>
            ) : (
              <span key={i} />
            )
          )}
        </div>

        <div className="cal-foot">
          <span className="cal-sel">
            {selD ? fmt(selD) : '—'} – {selH ? fmt(selH) : selD ? fmt(selD) : '—'}
          </span>
          <div className="cal-btns">
            <button type="button" className="secundario" onClick={onCerrar}>Cancelar</button>
            <button type="button" onClick={() => selD && onAplicar(fmt(selD), fmt(selH || selD))} disabled={!selD}>
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
