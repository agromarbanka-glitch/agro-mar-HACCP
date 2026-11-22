/**
 * Szybki test zasady FIFO R14 — node src/stockValueFifo.selftest.mjs
 */
import { runStockValueFifoSimulation } from './monthlyStockValueFromExcel.js'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

const pz = [
  { documentNo: 'PZ/A', issueDate: '2026-06-01', qty: 100, unitPriceNet: 10, rowNo: 1, lineId: '1' },
  { documentNo: 'PZ/B', issueDate: '2026-06-15', qty: 100, unitPriceNet: 12, rowNo: 2, lineId: '2' }
]
const wz = [
  { documentNo: 'WZ/1', issueDate: '2026-06-20', qty: 150, rowNo: 1, lineId: '3' }
]
const r = runStockValueFifoSimulation(pz, wz, '2026-06-30')

assert(r.remainingKg === 50, `remainingKg expected 50, got ${r.remainingKg}`)
assert(r.remainingValue === 600, `remainingValue expected 600 (50×12), got ${r.remainingValue}`)
assert(r.lot_lines.length === 1 && r.lot_lines[0].pz_no === 'PZ/B', 'remaining lot must be oldest unsold tail (PZ/B)')

console.log('OK: stockValueFifo.selftest — FIFO oldest PZ first')