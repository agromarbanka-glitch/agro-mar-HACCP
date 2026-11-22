param(
  [string]$Path = "C:\Users\marze\Downloads\pazdzeirnik bez MM.xls",
  [string]$SourceFile = "pazdzeirnik bez MM.xls"
)

function NormDoc($s) {
  if (-not $s) { return "" }
  return ($s -replace '\s+', '' -replace '\\', '/').Trim()
}

function ParseExcelDate($v) {
  if ($v -is [double]) {
    try { return [DateTime]::FromOADate($v).ToString('yyyy-MM-dd') } catch {}
  }
  $t = [string]$v
  if ($t -match '^(\d{1,2})\.(\d{1,2})\.(\d{4})') {
    return ('{0:0000}-{1:00}-{2:00}' -f [int]$matches[3], [int]$matches[2], [int]$matches[1])
  }
  if ($t -match '^(\d{4})-(\d{2})-(\d{2})') { return $matches[0] }
  return ""
}

function IsWzMonthYear($doc) { return ($doc -match '(?i)^WZ/\d+/\d{1,2}/\d{4}$') }

function InferDateFromDoc($doc) {
  if (IsWzMonthYear $doc) { return "" }
  if ($doc -match '/(\d{1,2})/(\d{1,2})/(\d{4})(?:/|$)') {
    return ('{0:0000}-{1:00}-{2:00}' -f [int]$matches[3], [int]$matches[2], [int]$matches[1])
  }
  if ($doc -match '/(\d{1,2})/(\d{4})$') {
    $mo = [int]$matches[1]; $yr = [int]$matches[2]
    return ('{0:0000}-{1:00}-{2:00}' -f $yr, $mo, [DateTime]::DaysInMonth($yr, $mo))
  }
  return ""
}

function ResolveDocIssueDate($excelDate, $doc) {
  $fromExcel = ParseExcelDate $excelDate
  $fromDoc = InferDateFromDoc $doc
  if ($fromDoc -and -not (IsWzMonthYear $doc)) { return $fromDoc }
  if ($fromExcel) { return $fromExcel }
  if ($fromDoc) { return $fromDoc }
  return ""
}

function ResolveMovementDate($excelDate, $doc, $opKind) {
  $resolved = ResolveDocIssueDate $excelDate $doc
  if ($opKind -ne 'sprzedaz') { return $resolved }
  if (-not (IsWzMonthYear $doc)) { return $resolved }
  if ($doc -notmatch '(?i)^WZ/\d+/(\d{1,2})/(\d{4})$') { return $resolved }
  $mo = [int]$matches[1]; $yr = [int]$matches[2]
  $docYm = '{0:0000}-{1:00}' -f $yr, $mo
  $docEnd = ('{0:0000}-{1:00}-{2:00}' -f $yr, $mo, [DateTime]::DaysInMonth($yr, $mo))
  if (-not $resolved) { return $docEnd }
  if ($resolved.Substring(0, 7) -gt $docYm) { return $docEnd }
  return $resolved
}

function ClassifyOp($kind, $doc) {
  $t = "$kind $doc".ToUpper()
  if ($t -match '\bMM\b|^MM/') { return 'mm' }
  if ($t -match 'PZ') { return 'przyjecie' }
  if ($t -match 'WZ|WZK|FV|FS|RR') { return 'sprzedaz' }
  return 'przyjecie'
}

if (-not (Test-Path $Path)) { Write-Error "Brak pliku: $Path"; exit 1 }

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$ws = $excel.Workbooks.Open($Path).Worksheets.Item(1)
$max = $ws.UsedRange.Rows.Count

$curKind = ''; $curDoc = ''; $curDate = ''
$rejected = [System.Collections.Generic.List[object]]::new()
$accepted = 0

for ($r = 2; $r -le $max; $r++) {
  $kind = [string]$ws.Cells.Item($r, 2).Text
  $nr = [string]$ws.Cells.Item($r, 3).Text
  $date = $ws.Cells.Item($r, 6).Value2
  $prod = [string]$ws.Cells.Item($r, 16).Text
  $qtyS = [string]$ws.Cells.Item($r, 18).Text
  if (-not $qtyS) { $qtyS = [string]$ws.Cells.Item($r, 9).Text }

  if ($kind) { $curKind = $kind }
  if ($nr -match '(?i)(PZ|WZ|WZK|RR)/') { $curDoc = NormDoc $nr }
  $d = ParseExcelDate $date; if ($d) { $curDate = $d }

  $qty = 0
  if (-not [double]::TryParse(($qtyS -replace ',', '.').Replace(' ', ''), [ref]$qty)) {
    if ($prod.Trim() -and $qtyS) {
      $rejected.Add([pscustomobject]@{ Row = $r; Reason = 'invalid_qty'; Doc = $curDoc; Product = $prod; QtyRaw = $qtyS }) | Out-Null
    }
    continue
  }
  if (-not $prod.Trim() -or $qty -eq 0) { continue }

  $doc = $curDoc
  if (-not $doc) {
    $rejected.Add([pscustomobject]@{ Row = $r; Reason = 'no_doc'; Doc = ''; Product = $prod; Qty = [math]::Abs($qty) }) | Out-Null
    continue
  }

  $op = ClassifyOp $curKind $doc
  if ($op -eq 'mm') { continue }

  $opKind = if ($op -eq 'sprzedaz') { 'sprzedaz' } else { 'przyjecie' }
  $moveDate = ResolveMovementDate $date $doc $opKind
  if (-not $moveDate -or $moveDate -eq '0000-01-01') {
    $rejected.Add([pscustomobject]@{
      Row = $r; Reason = 'no_date'; Doc = $doc; Kind = $curKind; Product = $prod.Trim()
      Qty = [math]::Round([math]::Abs($qty), 4); ExcelDate = [string]$date
    }) | Out-Null
    continue
  }
  $accepted++
}

$ws.Parent.Close($false)
$excel.Quit()

Write-Host "=== Odrzucone przy imporcie (logika warehouseValueStore v2.10) ==="
Write-Host "Plik: $Path"
Write-Host "Zaakceptowanych linii produktowych: $accepted"
Write-Host "Odrzuconych: $($rejected.Count)"
Write-Host ""
$rejected | Sort-Object Row | Format-Table Row, Reason, Doc, Product, Qty, ExcelDate -AutoSize

if ($rejected.Count -eq 0) {
  Write-Host "W tym pliku nie ma wierszy odrzuconych przy zapisie (no_doc/no_date/invalid)."
}