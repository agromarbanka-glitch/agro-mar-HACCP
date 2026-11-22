param(
  [string]$Path = "C:\Users\marze\Downloads\sierpień bez MM.xls",
  [double]$QtyHint = 4767
)

Get-Process EXCEL -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$ws = $excel.Workbooks.Open($Path).Worksheets.Item(1)
$max = $ws.UsedRange.Rows.Count

$noDate = [System.Collections.Generic.List[object]]::new()
$qtyHits = [System.Collections.Generic.List[object]]::new()
$curKind = ''
$curDoc = ''

for ($r = 2; $r -le $max; $r++) {
  $kind = [string]$ws.Cells.Item($r, 2).Text
  $nr = [string]$ws.Cells.Item($r, 3).Text
  $dt = $ws.Cells.Item($r, 6).Value2
  $prod = [string]$ws.Cells.Item($r, 16).Text
  $v18 = $ws.Cells.Item($r, 18).Value2
  $v9 = $ws.Cells.Item($r, 9).Value2
  if ($kind) { $curKind = $kind }
  if ($nr -match '(?i)(PZ|WZ|WZK)') { $curDoc = ($nr -replace '\s+', '') }

  $qty = 0
  if ($v18 -is [double]) { $qty = $v18 }
  elseif ($v9 -is [double]) { $qty = $v9 }
  if (-not $prod.Trim() -or [math]::Abs($qty) -lt 0.0001) { continue }

  $excelDate = ''
  if ($dt -is [double]) {
    try { $excelDate = [DateTime]::FromOADate($dt).ToString('yyyy-MM-dd') } catch {}
  }
  $docDate = ''
  if ($curDoc -match '/(\d{1,2})/(\d{1,2})/(\d{4})') {
    $docDate = ('{0:0000}-{1:00}-{2:00}' -f [int]$matches[3], [int]$matches[2], [int]$matches[1])
  }

  $moveDate = if ($excelDate) { $excelDate } elseif ($docDate) { $docDate } else { '' }
  if (-not $moveDate) {
    $noDate.Add([pscustomobject]@{
      Row = $r; Kind = $curKind; Doc = $curDoc; Product = $prod.Trim()
      Qty = [math]::Round([math]::Abs($qty), 4); ExcelDate = $excelDate; DocDate = $docDate
    })
  }

  if ([math]::Abs([math]::Abs($qty) - $QtyHint) -lt 0.05) {
    $qtyHits.Add([pscustomobject]@{
      Row = $r; Kind = $curKind; Doc = $curDoc; Product = $prod.Trim()
      Qty = [math]::Round([math]::Abs($qty), 4); Date = $moveDate
    })
  }
}

$ws.Parent.Close($false)
$excel.Quit()

Write-Host "Plik: $Path"
Write-Host "`n=== Odrzucone przy imporcie (brak daty ruchu) ==="
Write-Host "Liczba: $($noDate.Count)"
$noDate | Format-Table -AutoSize

Write-Host "`n=== Linie z ilością ~ $QtyHint kg (delta Malina PW Comarch 53410,5 vs raport 48643,5) ==="
$qtyHits | Format-Table -AutoSize