param(
  [string]$Target = "C:\Users\marze\Downloads\pazdzeirnik bez MM.xls",
  [string[]]$CompareWith = @(
    "C:\Users\marze\Downloads\czerwiec koniec bez MM.xls",
    "C:\Users\marze\Downloads\Lipiec 1-19 bez MM.xls",
    "C:\Users\marze\Downloads\Lipiec 20-31 bez MM.xls",
    "C:\Users\marze\Downloads\agromarbanka-1794939630.xls"
  )
)

function Normalize-DocNo($s) {
  if (-not $s) { return "" }
  return ($s -replace '\s+', '' -replace '\\', '/').Trim()
}

function Parse-PlDate($s) {
  $t = [string]$s
  if ($t -match '^(\d{4})-(\d{2})-(\d{2})') { return $matches[0] }
  if ($t -match '^(\d{1,2})\.(\d{1,2})\.(\d{4})') {
    $d = [int]$matches[1]; $m = [int]$matches[2]; $y = [int]$matches[3]
    return ('{0:0000}-{1:00}-{2:00}' -f $y, $m, $d)
  }
  if ($t -match '^(\d{1,2})\.(\d{1,2})\.(\d{2})$') {
    $d = [int]$matches[1]; $m = [int]$matches[2]; $y = 2000 + [int]$matches[3]
    return ('{0:0000}-{1:00}-{2:00}' -f $y, $m, $d)
  }
  return ""
}

function Find-DocInRow($cells) {
  foreach ($c in $cells) {
    $s = [string]$c
    if ($s -match '(?i)(PZ|WZ|RR|FV|FS)(\/[^\s,;]+)+') {
      return (Normalize-DocNo $matches[0])
    }
  }
  return ""
}

function Classify-Op($kind, $docNo) {
  $t = "$kind $docNo".ToUpper()
  if ($t -match '\bMM\b|^MM/' ) { return "mm" }
  if ($kind -match '(?i)^PZ' -or $t -match '\bPZ\b') { return "pz" }
  if ($kind -match '(?i)^WZ' -or $t -match '\bWZ\b|\bRR\b|\bFV\b|\bFS\b') { return "wz" }
  return "pz"
}

function Read-WarehouseXls($path) {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $wb = $excel.Workbooks.Open($path)
  $ws = $wb.Worksheets.Item(1)
  $maxRow = $ws.UsedRange.Rows.Count
  $maxCol = $ws.UsedRange.Columns.Count

  # Comarch 2026: kolumna „Do magazynu” przesuwa datę na 6, produkt na 16, ilość linii na 18
  $colKind = 2; $colNr = 3; $colDate = 6; $colQtyHdr = 9; $colProduct = 16; $colQtyLine = 18; $colPrice = 19

  $curKind = ""; $curDoc = ""; $curDate = ""
  $lines = [System.Collections.Generic.List[object]]::new()

  for ($r = 2; $r -le $maxRow; $r++) {
    $kind = [string]$ws.Cells.Item($r, $colKind).Text
    $nr = [string]$ws.Cells.Item($r, $colNr).Text
    $date = [string]$ws.Cells.Item($r, $colDate).Text
    $product = [string]$ws.Cells.Item($r, $colProduct).Text
    $qty = [string]$ws.Cells.Item($r, $colQtyLine).Text
    if (-not $qty -or $qty -eq "") { $qty = [string]$ws.Cells.Item($r, $colQtyHdr).Text }

    $rowCells = @()
    for ($c = 1; $c -le [Math]::Min(20, $maxCol); $c++) { $rowCells += $ws.Cells.Item($r, $c).Text }
    $scanned = Find-DocInRow $rowCells

    if ($kind) { $curKind = $kind }
    if ($scanned) { $curDoc = $scanned }
    elseif ($nr -match '(?i)(PZ|WZ)/') { $curDoc = (Normalize-DocNo $nr) }
    if ($date) { $curDate = $date }

    $qtyN = 0
    $qtyT = ($qty -replace '\s', '') -replace ',', '.'
    if ($qtyT -match '^-?\d') { [void][double]::TryParse($qtyT, [ref]$qtyN) }
    if ([Math]::Abs($qtyN) -lt 0.0001) { continue }
    if (-not $product) { continue }

    $doc = $curDoc
    if (-not $doc) { $doc = Find-DocInRow $rowCells }
    $op = Classify-Op $curKind $doc
    if ($op -eq "mm") { continue }

    $iso = Parse-PlDate $curDate
    $lines.Add([pscustomobject]@{
      Row = $r
      Op = $op
      Doc = $doc
      Product = $product.Trim()
      Qty = [Math]::Abs($qtyN)
      IssueDate = $iso
      Kind = $curKind
    }) | Out-Null
  }

  $wb.Close($false)
  $excel.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ws) | Out-Null
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
  return $lines
}

function BizKey($line) {
  $p = ($line.Product.ToLower() -replace 'ł','l' -replace '\s+',' ').Trim()
  $q = [Math]::Round($line.Qty, 3)
  return "$($line.Op)|$($line.Doc)|$p|$q"
}

function Summarize-File($path) {
  Write-Host "`n======== FILE: $([IO.Path]::GetFileName($path)) ========"
  if (-not (Test-Path $path)) { Write-Host "BRAK PLIKU"; return $null }
  $lines = Read-WarehouseXls $path
  Write-Host "Linii PZ/WZ (z produktem): $($lines.Count)"

  $byMonth = $lines | Group-Object { if ($_.IssueDate.Length -ge 7) { $_.IssueDate.Substring(0,7) } else { '(brak daty)' } } |
    Sort-Object Name | ForEach-Object { [pscustomobject]@{ Month = $_.Name; Lines = $_.Count; PzKg = ($_.Group | Where-Object Op -eq 'pz' | Measure-Object Qty -Sum).Sum; WzKg = ($_.Group | Where-Object Op -eq 'wz' | Measure-Object Qty -Sum).Sum } }
  Write-Host "Ruch wg miesiaca (data wystawienia z forward-fill):"
  $byMonth | Format-Table -AutoSize

  $beforeOct = ($lines | Where-Object { $_.IssueDate -and $_.IssueDate -lt '2026-10-01' }).Count
  $octOnly = ($lines | Where-Object { $_.IssueDate -ge '2026-10-01' -and $_.IssueDate -le '2026-10-31' }).Count
  Write-Host "Linie z data PRZED 2026-10-01: $beforeOct (zbiorczy export = problem nakladki)"
  Write-Host "Linie w pazdzierniku 2026-10: $octOnly"

  $watch = @('jabłko przemysłowe','jabłko na obierkę','malina świeża pw','malina świeża 1')
  foreach ($w in $watch) {
    $sub = $lines | Where-Object { $_.Product.ToLower() -like "*$($w -replace 'świeża','swieza' -replace 'ł','l')*" }
    if (-not $sub.Count) {
      $sub = $lines | Where-Object { $_.Product -match '(?i)' + [regex]::Escape($w) }
    }
    $pz = ($sub | Where-Object Op -eq 'pz' | Measure-Object Qty -Sum).Sum
    $wz = ($sub | Where-Object Op -eq 'wz' | Measure-Object Qty -Sum).Sum
    Write-Host ("  {0}: PZ={1:N0} kg WZ={2:N0} kg (wszystkie daty w pliku)" -f $w, $pz, $wz)
    $oct = $sub | Where-Object { $_.IssueDate -ge '2026-10-01' -and $_.IssueDate -le '2026-10-31' }
    $pzO = ($oct | Where-Object Op -eq 'pz' | Measure-Object Qty -Sum).Sum
    $wzO = ($oct | Where-Object Op -eq 'wz' | Measure-Object Qty -Sum).Sum
    Write-Host ("    tylko 2026-10: PZ={0:N0} kg WZ={1:N0} kg ({2} linii)" -f $pzO, $wzO, $oct.Count)
  }

  $keys = @{}
  $internalDup = 0
  foreach ($l in $lines) {
    $k = BizKey $l
    if (-not $k) { continue }
    if ($keys.ContainsKey($k)) { $internalDup++ } else { $keys[$k] = 1 }
  }
  Write-Host "Wewnetrzne duplikaty (op|doc|produkt|qty) w pliku: $internalDup"

  return @{ Lines = $lines; Keys = $keys.Keys }
}

$targetData = Summarize-File $Target
if (-not $targetData) { exit 1 }

$targetKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]$targetData.Keys)
Write-Host "`n===== NAKLADKA Z PAZDZIERNIKA NA WCZESNIEJSZE PLIKI ====="
foreach ($cmp in $CompareWith) {
  if (-not (Test-Path $cmp)) { continue }
  $cmpName = [IO.Path]::GetFileName($cmp)
  $other = Read-WarehouseXls $cmp
  $overlap = 0
  $overlapWzKg = 0
  $overlapPzKg = 0
  $samples = [System.Collections.Generic.List[string]]::new()
  foreach ($l in $other) {
    $k = BizKey $l
    if ($targetKeys.Contains($k)) {
      $overlap++
      if ($l.Op -eq 'wz') { $overlapWzKg += $l.Qty } else { $overlapPzKg += $l.Qty }
      if ($samples.Count -lt 5) { $samples.Add("$($l.Doc) $($l.Product) $($l.Qty)kg $($l.IssueDate)") | Out-Null }
    }
  }
  Write-Host "$cmpName : $overlap wspolnych kluczy z pazdziernikiem (PZ $($overlapPzKg) kg, WZ $($overlapWzKg) kg)"
  if ($samples.Count) { Write-Host "  przyklady: $($samples -join '; ')" }
}

Write-Host "`n===== WZ w pazdzierniku z data listopad (clamp w aplikacji?) ====="
$novWz = $targetData.Lines | Where-Object { $_.Op -eq 'wz' -and $_.IssueDate -ge '2026-11-01' }
$octDocNovDate = $targetData.Lines | Where-Object { $_.Op -eq 'wz' -and $_.Doc -match '/10/2026' -and $_.IssueDate -ge '2026-11-01' }
Write-Host "WZ z data >= 2026-11-01: $($novWz.Count) linii, $($($novWz | Measure-Object Qty -Sum).Sum) kg"
Write-Host "Z nich numer WZ z /10/2026 a data listopad: $($octDocNovDate.Count) linii, $($($octDocNovDate | Measure-Object Qty -Sum).Sum) kg"