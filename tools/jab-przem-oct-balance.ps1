# Σ PZ−WZ jabłko przemysłowe — logika zbliżona do monthlyStockValueFromExcel.js v2.10
param(
  [ValidateSet('all','sier-wrz-paz')]
  [string]$Set = 'all',
  [string[]]$Files = @(),
  [string]$Cutoff = "2026-10-31",
  [switch]$DedupeBusiness
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
  if ($t -match '^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$') {
    return ('{0:0000}-{1:00}-{2:00}' -f [int]$matches[3], [int]$matches[2], [int]$matches[1])
  }
  if ($t -match '^(\d{4})-(\d{2})-(\d{2})') { return $matches[0] }
  return ""
}
function IsWzMonthYear($doc) {
  return ($doc -match '(?i)^WZ/\d+/\d{1,2}/\d{4}$')
}
function DocHasExplicitDate($doc) {
  if (IsWzMonthYear $doc) { return $false }
  return ($doc -match '/(\d{1,2})/(\d{1,2})/(\d{4})(?:/|$)')
}
function InferDateFromDoc($doc) {
  if (IsWzMonthYear $doc) { return "" }
  if ($doc -match '/(\d{1,2})/(\d{1,2})/(\d{4})(?:/|$)') {
    $d = [int]$matches[1]; $m = [int]$matches[2]; $y = [int]$matches[3]
    if ($d -ge 1 -and $d -le 31 -and $m -ge 1 -and $m -le 12) {
      return ('{0:0000}-{1:00}-{2:00}' -f $y, $m, $d)
    }
  }
  if ($doc -match '/(\d{1,2})/(\d{4})$') {
    $m = [int]$matches[1]; $y = [int]$matches[2]
    if ($m -ge 1 -and $m -le 12) {
      $last = [DateTime]::DaysInMonth($y, $m)
      return ('{0:0000}-{1:00}-{2:00}' -f $y, $m, $last)
    }
  }
  return ""
}
function ResolveIssueDate($excelDate, $doc) {
  $parsed = ParseExcelDate $excelDate
  $fromDoc = InferDateFromDoc $doc
  if (IsWzMonthYear $doc) { return $(if ($parsed) { $parsed } else { "" }) }
  if ($fromDoc -and (DocHasExplicitDate $doc)) { return $fromDoc }
  if ($parsed) { return $parsed }
  if ($fromDoc) { return $fromDoc }
  return ""
}
function ResolveMovementDate($excelDate, $doc, $op) {
  $resolved = ResolveIssueDate $excelDate $doc
  if (-not $resolved) { $resolved = (ParseExcelDate $excelDate) }
  if ($op -ne 'wz') { return $resolved }
  if (-not (IsWzMonthYear $doc)) { return $resolved }
  if ($doc -notmatch '^WZ/\d+/(\d{1,2})/(\d{4})$') { return $resolved }
  $mo = [int]$matches[1]; $yr = [int]$matches[2]
  $docYm = '{0:0000}-{1:00}' -f $yr, $mo
  $last = [DateTime]::DaysInMonth($yr, $mo)
  $docEnd = '{0:0000}-{1:00}-{2:00}' -f $yr, $mo, $last
  if (-not $resolved) { return $docEnd }
  if ($resolved.Substring(0,7) -gt $docYm) { return $docEnd }
  return $resolved
}
function IsMM($doc, $kind) {
  $t = "$kind $doc".ToUpper()
  return ($t -match '\bMM\b|^MM/')
}
function ClassifyOp($kind, $doc) {
  if (IsMM $doc $kind) { return $null }
  $t = "$kind $doc".ToUpper()
  if ($t -match '\bPZ\b') { return 'pz' }
  if ($t -match '\bWZ\b|\bRR\b|\bFV\b|\bFS\b') { return 'wz' }
  return 'pz'
}
function IsJabPrzem($p) {
  $t = ($p -replace 'ł','l' -replace 'Ł','L').ToLower()
  return ($t -match 'jabl.*przem|przemysl')
}

if (-not $Files -or $Files.Count -eq 0) {
  if ($Set -eq 'sier-wrz-paz') {
    $Files = @(
      "C:\Users\marze\Downloads\sierpień bez MM.xls",
      "C:\Users\marze\Downloads\wrzesień bez MM.xls",
      "C:\Users\marze\Downloads\pazdzeirnik bez MM.xls"
    )
  } else {
    $Files = @(
      "C:\Users\marze\Downloads\czerwiec koniec bez MM.xls",
      "C:\Users\marze\Downloads\Lipiec 1-19 bez MM.xls",
      "C:\Users\marze\Downloads\Lipiec 20-31 bez MM.xls",
      "C:\Users\marze\Downloads\sierpień bez MM.xls",
      "C:\Users\marze\Downloads\wrzesień bez MM.xls",
      "C:\Users\marze\Downloads\pazdzeirnik bez MM.xls"
    )
  }
}

$allLines = [System.Collections.Generic.List[object]]::new()
foreach ($f in $Files) {
  if (-not (Test-Path $f)) { Write-Host "BRAK: $f"; continue }
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false; $excel.DisplayAlerts = $false
  $ws = $excel.Workbooks.Open($f).Worksheets.Item(1)
  $max = $ws.UsedRange.Rows.Count
  $curKind = ''; $curDoc = ''; $curDate = ''
  for ($r = 2; $r -le $max; $r++) {
    $kind = [string]$ws.Cells.Item($r, 2).Text
    $nr = [string]$ws.Cells.Item($r, 3).Text
    $date = $ws.Cells.Item($r, 6).Value2
    $prod = [string]$ws.Cells.Item($r, 16).Text
    $qtyS = [string]$ws.Cells.Item($r, 18).Text
    if (-not $qtyS) { $qtyS = [string]$ws.Cells.Item($r, 9).Text }
    if ($kind) { $curKind = $kind }
    if ($nr -match '(?i)(PZ|WZ)/') { $curDoc = NormDoc $nr }
    if (-not (IsJabPrzem $prod)) { continue }
    $qty = 0
    if (-not [double]::TryParse($qtyS.Replace(',', '.').Replace(' ', ''), [ref]$qty)) { continue }
    if ($qty -eq 0) { continue }
    $qty = [math]::Abs($qty)
    $op = ClassifyOp $curKind $curDoc
    if (-not $op) { continue }
    $mv = ResolveMovementDate $date $curDoc $op
    if (-not $mv) { continue }
    $allLines.Add([PSCustomObject]@{
      file = Split-Path $f -Leaf
      op = $op
      doc = $curDoc
      qty = $qty
      mv = $mv
      biz = "$op|$curDoc|jab_przem|$qty"
    })
  }
  $ws.Parent.Close($false); $excel.Quit()
}

function Balance($lines, $cutoff) {
  $pz = 0; $wz = 0; $skipped = 0
  foreach ($l in $lines) {
    if ($l.mv -gt $cutoff) { $skipped++; continue }
    if ($l.op -eq 'pz') { $pz += $l.qty } else { $wz += $l.qty }
  }
  return @{ pz = $pz; wz = $wz; rem = [math]::Round($pz - $wz, 3); skipped = $skipped; n = $lines.Count }
}

$lines = @($allLines)
if ($DedupeBusiness) {
  $seen = @{}
  $deduped = [System.Collections.Generic.List[object]]::new()
  foreach ($l in $lines) {
    if ($seen.ContainsKey($l.biz)) { continue }
    $seen[$l.biz] = $true
    $deduped.Add($l)
  }
  $lines = @($deduped)
  Write-Host "Dedupe: $($allLines.Count) -> $($lines.Count) linii"
} else {
  Write-Host "Bez dedupe: $($lines.Count) linii (nakładki między miesiącami wliczone)"
}

$bEndSep = Balance $lines "2026-09-30"
$bEndOct = Balance $lines $Cutoff

$octOnly = @($lines | Where-Object { $_.file -like 'pazdz*' })
$bOctFileAlone = Balance $octOnly $Cutoff

$withoutOct = @($lines | Where-Object { $_.file -notlike 'pazdz*' })
$bNoOct = Balance $withoutOct $Cutoff

Write-Host "=== Jabłko przemysłowe (logika dat jak aplikacja) ==="
Write-Host "30.09.2026: PZ=$($bEndSep.pz) WZ=$($bEndSep.wz) -> $($bEndSep.rem) kg"
Write-Host "31.10.2026: PZ=$($bEndOct.pz) WZ=$($bEndOct.wz) -> $($bEndOct.rem) kg (cel Comarch: 11378)"
Write-Host "Bez partii październik (same sier-wrzes + wcześniejsze): $($bNoOct.rem) kg"
Write-Host "Tylko plik październik (izolowany): $($bOctFileAlone.rem) kg"

$byFile = $lines | Group-Object file | ForEach-Object {
  $b = Balance $_.Group $Cutoff
  [PSCustomObject]@{ file = $_.Name; lines = $_.Count; rem_part = $b.rem }
}
Write-Host "`nLinie wg pliku (kumulacja NIE — sam plik do 31.10):"
$byFile | Format-Table -AutoSize

$noDate = ($allLines | Where-Object { -not $_.mv }).Count
Write-Host "Pominięte bez daty (raw): sprawdź w pętli — wczytane=$($allLines.Count)"