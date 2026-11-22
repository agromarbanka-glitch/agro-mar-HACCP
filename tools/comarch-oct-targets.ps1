# Σ PZ−WZ na 31.10.2026 — porównanie z Comarch (zestawienie użytkownika)
param(
  [string]$Cutoff = '2026-10-31',
  [string]$MonthStart = '2026-10-01'
)

$targets = @{
  'Jabłko na obierkę' = @{ final = 80458; opening = 56847; pz = 93701; wz = 70090 }
  'Jabłko przemysłowe' = @{ final = 11378; opening = 0; pz = 2757198; wz = 2745820 }
  'Malina świeża 1' = @{ final = 5589.5; opening = 0; pz = 18609.5; wz = 13020 }
  'Malina świeża PW' = @{ final = 53410.5; opening = 82663; pz = 640617.5; wz = 669870 }
}

function NormDoc($s) { if (-not $s) { return '' }; ($s -replace '\s+','' -replace '\\','/').Trim() }
function ParseExcelDate($v) {
  if ($v -is [double]) { try { return [DateTime]::FromOADate($v).ToString('yyyy-MM-dd') } catch {} }
  $t = [string]$v
  if ($t -match '^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$') { return ('{0:0000}-{1:00}-{2:00}' -f [int]$matches[3],[int]$matches[2],[int]$matches[1]) }
  if ($t -match '^(\d{4})-(\d{2})-(\d{2})') { return $matches[0] }
  return ''
}
function IsWzMonthYear($doc) { $doc -match '(?i)^WZ/\d+/\d{1,2}/\d{4}$' }
function InferDateFromDoc($doc) {
  if (IsWzMonthYear $doc) { return '' }
  if ($doc -match '/(\d{1,2})/(\d{1,2})/(\d{4})(?:/|$)') {
    return ('{0:0000}-{1:00}-{2:00}' -f [int]$matches[3],[int]$matches[2],[int]$matches[1])
  }
  return ''
}
function ResolveIssueDate($excelDate, $doc) {
  $parsed = ParseExcelDate $excelDate
  $fromDoc = InferDateFromDoc $doc
  if (IsWzMonthYear $doc) { return $(if ($parsed) { $parsed } else { '' }) }
  if ($fromDoc) { return $fromDoc }
  if ($parsed) { return $parsed }
  return ''
}
function ResolveMovementDate($excelDate, $doc, $op) {
  $resolved = ResolveIssueDate $excelDate $doc
  if ($op -ne 'wz') { return $resolved }
  if (-not (IsWzMonthYear $doc)) { return $resolved }
  if ($doc -notmatch '(?i)^WZ/\d+/(\d{1,2})/(\d{4})$') { return $resolved }
  $mo=[int]$matches[1]; $yr=[int]$matches[2]
  $docEnd = ('{0:0000}-{1:00}-{2:00}' -f $yr,$mo,[DateTime]::DaysInMonth($yr,$mo))
  if (-not $resolved) { return $docEnd }
  if ($resolved.Substring(0,7) -gt ('{0:0000}-{1:00}' -f $yr,$mo)) { return $docEnd }
  return $resolved
}
function ClassifyOp($kind, $doc, $qtySigned) {
  $t = "$kind $doc".ToUpper()
  if ($t -match '\bMM\b|^MM/') { return $null }
  if ($t -match 'WZK') {
    if ($qtySigned -lt 0) { return 'pz' }
    return 'wz'
  }
  if ($t -match '\bPZ\b' -and $t -notmatch 'WZK') { return 'pz' }
  if ($t -match '\bWZ\b|RR|FV|FS') { return 'wz' }
  return 'pz'
}
function ReportProduct($name) {
  $t = ($name -replace 'ł','l' -replace 'Ł','L').ToLower()
  if ($t -match 'malina.*pw|mpw') { return 'Malina świeża PW' }
  if ($t -match 'malina.*(klasa|swieza\s*1|^1\b)|\bm1\b') { return 'Malina świeża 1' }
  if ($t -match 'jabl.*obier|na obier') { return 'Jabłko na obierkę' }
  if ($t -match 'jabl.*przem|przemysl') { return 'Jabłko przemysłowe' }
  return $name.Trim()
}
function DedupKey($op, $doc, $prod, $qty) { "$op|$doc|$prod|$qty" }
function ReadFile($path) {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible=$false; $excel.DisplayAlerts=$false
  $ws = $excel.Workbooks.Open($path).Worksheets.Item(1)
  $max = $ws.UsedRange.Rows.Count
  $list = [System.Collections.Generic.List[object]]::new()
  $curKind=''; $curDoc=''; $id=0
  for ($r=2; $r -le $max; $r++) {
    $kind = [string]$ws.Cells.Item($r,2).Text
    $nr = [string]$ws.Cells.Item($r,3).Text
    $date = $ws.Cells.Item($r,6).Value2
    $prod = [string]$ws.Cells.Item($r,16).Text
    $qtyS = [string]$ws.Cells.Item($r,18).Text
    if (-not $qtyS) { $qtyS = [string]$ws.Cells.Item($r,9).Text }
    if ($kind) { $curKind = $kind }
    if ($nr -match '(?i)(PZ|WZ|WZK)/') { $curDoc = NormDoc $nr }
    $qty = 0
    if (-not [double]::TryParse($qtyS.Replace(',','.').Replace(' ',''), [ref]$qty)) { continue }
    if (-not $prod.Trim() -or $qty -eq 0) { continue }
    $label = ReportProduct $prod
    if (-not $targets.ContainsKey($label)) { continue }
    $rawOp = ClassifyOp $curKind $curDoc $qty
    if (-not $rawOp) { continue }
    $op = $rawOp
    $qtyA = [math]::Abs($qty)
    $mv = ResolveMovementDate $date $curDoc $op
    if (-not $mv) { continue }
    $id++
    $list.Add([pscustomobject]@{ Id=$id; Op=$op; Doc=$curDoc; Product=$label; Qty=$qtyA; Date=$mv; Key=DedupKey $op $curDoc $label $qtyA })
  }
  $ws.Parent.Close($false); $excel.Quit()
  return $list
}

function Balance($lines, $product, $cutoff, $from, $to) {
  $sub = $lines | Where-Object { $_.Product -eq $product -and $_.Date -le $cutoff }
  $opPz=0; $opWz=0; $moPz=0; $moWz=0; $openPz=0; $openWz=0
  foreach ($l in $sub) {
    if ($l.Date -le (Get-Date $MonthStart).AddDays(-1).ToString('yyyy-MM-dd')) {
      if ($l.Op -eq 'pz') { $openPz += $l.Qty } else { $openWz += $l.Qty }
    }
    if ($l.Op -eq 'pz') { $opPz += $l.Qty } else { $opWz += $l.Qty }
    if ($l.Date -ge $from -and $l.Date -le $to) {
      if ($l.Op -eq 'pz') { $moPz += $l.Qty } else { $moWz += $l.Qty }
    }
  }
  $opening = [math]::Round($openPz - $openWz, 3)
  $final = [math]::Round($opPz - $opWz, 3)
  $moNet = [math]::Round($moPz - $moWz, 3)
  return @{ opening=$opening; final=$final; moPz=$moPz; moWz=$moWz; moNet=$moNet }
}

$sets = @(
  @{ name = 'czer-lip-wrzes'; files = @(
    'C:\Users\marze\Downloads\czerwiec koniec bez MM.xls',
    'C:\Users\marze\Downloads\Lipiec 1-19 bez MM.xls',
    'C:\Users\marze\Downloads\Lipiec 20-31 bez MM.xls',
    'C:\Users\marze\Downloads\sierpień bez MM.xls',
    'C:\Users\marze\Downloads\wrzesień bez MM.xls'
  )}
  @{ name = 'wrzes+oct-split'; files = @(
    'C:\Users\marze\Downloads\czerwiec koniec bez MM.xls',
    'C:\Users\marze\Downloads\Lipiec 1-19 bez MM.xls',
    'C:\Users\marze\Downloads\Lipiec 20-31 bez MM.xls',
    'C:\Users\marze\Downloads\sierpień bez MM.xls',
    'C:\Users\marze\Downloads\wrzesień bez MM.xls',
    'C:\Users\marze\Downloads\październik PZ.xls',
    'C:\Users\marze\Downloads\październik WZ.xls',
    'C:\Users\marze\Downloads\Pażdziernik WZK.xls'
  )}
  @{ name = 'all-bez-mm+pazdz'; files = @(
    'C:\Users\marze\Downloads\czerwiec koniec bez MM.xls',
    'C:\Users\marze\Downloads\Lipiec 1-19 bez MM.xls',
    'C:\Users\marze\Downloads\Lipiec 20-31 bez MM.xls',
    'C:\Users\marze\Downloads\sierpień bez MM.xls',
    'C:\Users\marze\Downloads\wrzesień bez MM.xls',
    'C:\Users\marze\Downloads\pazdzeirnik bez MM.xls'
  )}
)

foreach ($set in $sets) {
  Write-Host "`n=== $($set.name) ==="
  $all = [System.Collections.Generic.List[object]]::new()
  foreach ($f in $set.files) {
    if (-not (Test-Path $f)) { Write-Host "  BRAK: $f"; continue }
    $all.AddRange((ReadFile $f))
  }
  $seen = @{}
  $dedup = [System.Collections.Generic.List[object]]::new()
  foreach ($l in ($all | Sort-Object Id)) {
    if ($seen.ContainsKey($l.Key)) { continue }
    $seen[$l.Key] = $true
    $dedup.Add($l)
  }
  Write-Host "Linie po dedup: $($dedup.Count) (z $($all.Count))"
  foreach ($p in $targets.Keys) {
    $b = Balance @($dedup) $p $Cutoff $MonthStart $Cutoff
    $t = $targets[$p]
    $dFinal = [math]::Round($b.final - $t.final, 1)
    $ok = [math]::Abs($dFinal) -lt 1
    Write-Host ("  {0,-22} koniec={1,12} (cel {2,12}) delta={3,8} {4}" -f $p, $b.final, $t.final, $dFinal, $(if($ok){'OK'}else{'!'}))
    Write-Host ("    otwarcie 10: {0} (cel {1}) | ruch 10 PZ={2} WZ={3} net={4}" -f $b.opening, $t.opening, $b.moPz, $b.moWz, $b.moNet)
  }
}