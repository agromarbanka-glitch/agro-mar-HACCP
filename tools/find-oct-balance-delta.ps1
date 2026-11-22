# Dokładna analiza: co psuje stan na 31.10 (Malina PW, Jabłko przem.) vs import października
param(
  [string]$OctMm = "C:\Users\marze\Downloads\pazdzeirnik bez MM.xls",
  [string]$Cutoff = "2026-10-31",
  [string]$OpeningCutoff = "2026-09-30"
)

$MonthFiles = @(
  "C:\Users\marze\Downloads\czerwiec koniec bez MM.xls",
  "C:\Users\marze\Downloads\Lipiec 1-19 bez MM.xls",
  "C:\Users\marze\Downloads\Lipiec 20-31 bez MM.xls",
  "C:\Users\marze\Downloads\sierpień bez MM.xls",
  "C:\Users\marze\Downloads\wrzesień bez MM.xls"
) | Where-Object { Test-Path $_ }

if (-not (Test-Path $OctMm)) { Write-Host "Brak $OctMm"; exit 1 }

function NormDoc($s) { if (-not $s) { return "" }; return ($s -replace '\s+','' -replace '\\','/').Trim() }
function ParseExcelDate($v) {
  if ($v -is [double]) { try { return [DateTime]::FromOADate($v).ToString('yyyy-MM-dd') } catch {} }
  $t = [string]$v
  if ($t -match '^(\d{1,2})\.(\d{1,2})\.(\d{4})') { return ('{0:0000}-{1:00}-{2:00}' -f [int]$matches[3],[int]$matches[2],[int]$matches[1]) }
  if ($t -match '^(\d{4})-(\d{2})-(\d{2})') { return $matches[0] }
  return ""
}
function IsWzMonthYear($doc) { return ($doc -match '(?i)^WZ/\d+/\d{1,2}/\d{4}$') }
function DocHasExplicitDate($doc) {
  if (IsWzMonthYear $doc) { return $false }
  return ($doc -match '/(\d{1,2})/(\d{1,2})/(\d{4})(?:/|$)')
}
function InferDateFromDoc($doc) {
  if (IsWzMonthYear $doc) { return "" }
  if ($doc -match '/(\d{1,2})/(\d{1,2})/(\d{4})(?:/|$)') {
    return ('{0:0000}-{1:00}-{2:00}' -f [int]$matches[3],[int]$matches[2],[int]$matches[1])
  }
  if ($doc -match '/(\d{1,2})/(\d{4})$') {
    $mo=[int]$matches[1]; $yr=[int]$matches[2]
    return ('{0:0000}-{1:00}-{2:00}' -f $yr,$mo,[DateTime]::DaysInMonth($yr,$mo))
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
  if (-not $resolved) { $resolved = ParseExcelDate $excelDate }
  if ($op -ne 'wz') { return $resolved }
  if (-not (IsWzMonthYear $doc)) { return $resolved }
  if ($doc -notmatch '(?i)^WZ/\d+/(\d{1,2})/(\d{4})$') { return $resolved }
  $mo=[int]$matches[1]; $yr=[int]$matches[2]
  $docYm = '{0:0000}-{1:00}' -f $yr,$mo
  $docEnd = ('{0:0000}-{1:00}-{2:00}' -f $yr,$mo,[DateTime]::DaysInMonth($yr,$mo))
  if (-not $resolved) { return $docEnd }
  if ($resolved.Substring(0,7) -gt $docYm) { return $docEnd }
  return $resolved
}
function ClassifyOp($kind, $doc) {
  $t = "$kind $doc".ToUpper()
  if ($t -match '\bMM\b|^MM/') { return $null }
  if ($t -match '\bPZ\b' -and $t -notmatch 'WZK') { return 'pz' }
  if ($t -match 'WZK') { return 'wzk' }
  if ($t -match '\bWZ\b|FV|FS|RR') { return 'wz' }
  return 'pz'
}
function ReportProduct($name) {
  $t = ($name -replace 'ł','l').ToLower()
  if ($t -match 'malina.*pw') { return 'Malina świeża PW' }
  if ($t -match 'jabl.*przem') { return 'Jabłko przemysłowe' }
  return $name.Trim()
}
function ProductKey($label) { return ($label -replace '[^\w]+','_').ToLower() }

function ReadWarehouseMm($path, $sourceLabel) {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible=$false; $excel.DisplayAlerts=$false
  $ws = $excel.Workbooks.Open($path).Worksheets.Item(1)
  $max = $ws.UsedRange.Rows.Count
  $list = [System.Collections.Generic.List[object]]::new()
  $seq = 0
  $curKind=''; $curDoc=''; $curDate=''
  $noDateSkipped = 0
  for ($r=2; $r -le $max; $r++) {
    $kind = [string]$ws.Cells.Item($r,2).Text
    $nr = [string]$ws.Cells.Item($r,3).Text
    $date = $ws.Cells.Item($r,6).Value2
    $prod = [string]$ws.Cells.Item($r,16).Text
    $qtyS = [string]$ws.Cells.Item($r,18).Text
    if (-not $qtyS) { $qtyS = [string]$ws.Cells.Item($r,9).Text }
    if ($kind) { $curKind = $kind }
    if ($nr -match '(?i)(PZ|WZ|WZK|RR)/') { $curDoc = NormDoc $nr }
    $d = ParseExcelDate $date; if ($d) { $curDate = $d }
    $qty = 0
    if (-not [double]::TryParse($qtyS.Replace(',','.').Replace(' ',''), [ref]$qty)) { continue }
    if (-not $prod.Trim() -or $qty -eq 0) { continue }
    $rawOp = ClassifyOp $curKind $curDoc
    if (-not $rawOp) { continue }
    # jak aplikacja: WZK -> sprzedaz (wz), qty abs
    $op = if ($rawOp -eq 'wzk' -or $rawOp -eq 'wz') { 'wz' } else { 'pz' }
    $mv = ResolveMovementDate $date $curDoc $op
    if (-not $mv) { $noDateSkipped++; continue }
    $label = ReportProduct $prod
    $qtyA = [math]::Abs($qty)
    $seq++
    $biz = "$op|$curDoc|$(ProductKey $label)|$qtyA"
    $list.Add([pscustomobject]@{
      Id = $seq
      Source = $sourceLabel
      Row = $r
      Kind = $curKind
      Doc = $curDoc
      Product = $label
      QtySigned = $qty
      Qty = $qtyA
      Op = $op
      RawOp = $rawOp
      IssueDate = $mv
      BizKey = $biz
    })
  }
  $ws.Parent.Close($false); $excel.Quit()
  return @{ Lines = $list; NoDate = $noDateSkipped; File = [IO.Path]::GetFileName($path) }
}

function Balance($lines, $product, $cutoff, $useSignedWzk) {
  $sub = $lines | Where-Object { $_.Product -eq $product -and $_.IssueDate -le $cutoff }
  $pz=0; $wz=0; $octPz=0; $octWz=0
  foreach ($l in $sub) {
    $contrib = $l.Qty
    if ($useSignedWzk -and $l.RawOp -eq 'wzk') {
      if ($l.QtySigned -lt 0) { $contrib = $l.Qty; $wz += $contrib }
      else { $contrib = $l.Qty; $pz += $contrib }
      continue
    }
    if ($l.Op -eq 'pz') { $pz += $contrib } else { $wz += $contrib }
    if ($l.IssueDate -ge '2026-10-01') {
      if ($l.Op -eq 'pz') { $octPz += $contrib } else { $octWz += $contrib }
    }
  }
  return @{
    rem = [math]::Round($pz - $wz, 3)
    pz = $pz; wz = $wz
    octNet = [math]::Round($octPz - $octWz, 3)
    octPz = $octPz; octWz = $octWz
    n = $sub.Count
  }
}

function DedupeFirst($lines) {
  $sorted = $lines | Sort-Object Id
  $seen = @{}
  $out = [System.Collections.Generic.List[object]]::new()
  foreach ($l in $sorted) {
    if ($seen.ContainsKey($l.BizKey)) { continue }
    $seen[$l.BizKey] = $true
    $out.Add($l)
  }
  return $out
}

function FindDupImpact($lines, $product, $cutoff) {
  $sorted = $lines | Sort-Object Id
  $seen = @{}
  $extraPz=0; $extraWz=0
  $samples = [System.Collections.Generic.List[string]]::new()
  foreach ($l in $sorted) {
    if ($l.Product -ne $product -or $l.IssueDate -gt $cutoff) { continue }
    if ($seen.ContainsKey($l.BizKey)) {
      if ($l.Op -eq 'pz') { $extraPz += $l.Qty } else { $extraWz += $l.Qty }
      if ($samples.Count -lt 12) {
        $samples.Add("$($l.Source) $($l.Doc) $($l.Op) $($l.Qty)kg $($l.IssueDate) [duplikat]")
      }
    } else { $seen[$l.BizKey] = $l.Source }
  }
  return @{ extraPz = $extraPz; extraWz = $extraWz; netBias = $extraPz - $extraWz; samples = $samples }
}

Write-Host "=== WCZYTANIE (kolejnosc jak import: czerwiec -> pazdziernik) ==="
$all = [System.Collections.Generic.List[object]]::new()
$idBase = 0
foreach ($f in $MonthFiles) {
  $pack = ReadWarehouseMm $f ([IO.Path]::GetFileName($f))
  foreach ($l in $pack.Lines) {
    $idBase++
    $l.Id = $idBase
    $all.Add($l)
  }
  Write-Host "$($pack.File): $($pack.Lines.Count) linii, pominięte bez daty=$($pack.NoDate)"
}
$octPack = ReadWarehouseMm $OctMm "pazdzeirnik bez MM.xls"
foreach ($l in $octPack.Lines) {
  $idBase++
  $l.Id = $idBase
  $all.Add($l)
}
Write-Host "$($octPack.File): $($octPack.Lines.Count) linii, pominięte bez daty=$($octPack.NoDate)"
Write-Host "RAZEM do silnika: $($all.Count) linii"

$arr = @($all)
$deduped = @(DedupeFirst $arr)

foreach ($prod in @('Malina świeża PW', 'Jabłko przemysłowe')) {
  Write-Host "`n======== $prod ========"
  $bAll = Balance $arr $prod $Cutoff $false
  $bDed = Balance $deduped $prod $Cutoff $false
  $bSept = Balance $arr $prod $OpeningCutoff $false
  $dup = FindDupImpact $arr $prod $Cutoff
  Write-Host "Cel Comarch 31.10: $(if ($prod -match 'Malina') { '53 410,5' } else { '11 378' }) kg"
  Write-Host "30.09 stan (Σ do $($OpeningCutoff)): $($bSept.rem) kg ($($bSept.n) linii)"
  Write-Host "31.10 BEZ deduplikacji (jak domyslny raport): $($bAll.rem) kg | ruch 10: PZ=$($bAll.octPz) WZ=$($bAll.octWz) net=$($bAll.octNet)"
  Write-Host "31.10 Z deduplikacja (jedna operacja raz): $($bDed.rem) kg"
  Write-Host "Powtorzenia miedzy partiami: +$($dup.extraPz) kg PZ, +$($dup.extraWz) kg WZ -> bias salda +$($dup.netBias) kg (nadmiar WZ zaniża stan)"
  if ($dup.samples.Count) {
    Write-Host "Przykladowe KOPIE (drugi raz w bazie):"
    $dup.samples | ForEach-Object { Write-Host "  $_" }
  }
}

# Linie tylko z pazdziernika ktore SA duplikatem starszego importu (to glowny winowajca)
Write-Host "`n=== DUPLIKATY Z PARTII PAZDZIERNIK (juz bylo w czerwiec-wrzesien) ==="
$preOct = @{}
foreach ($l in $arr) {
  if ($l.Source -eq 'pazdzeirnik bez MM.xls') { continue }
  if (-not $preOct.ContainsKey($l.BizKey)) { $preOct[$l.BizKey] = $l }
}
$octDup = @($arr | Where-Object { $_.Source -eq 'pazdzeirnik bez MM.xls' -and $preOct.ContainsKey($_.BizKey) })
$byProd = $octDup | Group-Object Product
foreach ($g in $byProd) {
  $pz = ($g.Group | Where-Object Op -eq 'pz' | Measure-Object Qty -Sum).Sum
  $wz = ($g.Group | Where-Object Op -eq 'wz' | Measure-Object Qty -Sum).Sum
  Write-Host "$($g.Name): $($g.Count) zdublowanych linii w pliku pazdz (nadmiar PZ=$pz WZ=$wz net=$($pz-$wz))"
}
Write-Host "Razem zdublowanych linii w pazdzierniku vs starsze: $($octDup.Count)"

# WZ po 31.10 w pliku pazdziernik (nie powinny obnizac stanu 31.10)
$after = @($arr | Where-Object { $_.IssueDate -gt $Cutoff })
Write-Host "`nWZ/PZ z data > $Cutoff (nie wchodza w stan 31.10): $($after.Count) linii"
$afterMal = $after | Where-Object { $_.Product -eq 'Malina świeża PW' }
if ($afterMal.Count) {
  Write-Host "Malina PW po dacie stanu: $($afterMal.Count) linii, WZ=$($($afterMal|?{$_.Op-eq'wz'}|Measure-Object Qty -Sum).Sum) kg"
  $afterMal | Select-Object -First 5 | ForEach-Object { Write-Host "  $($_.Doc) $($_.IssueDate) $($_.Qty)kg $($_.Source)" }
}

# === Scenariusz „miesiące OK, doklejony październik” (bez nakładki kluczy lipiec↔lipiec) ===
$preOctOnly = @($arr | Where-Object { $_.Source -ne 'pazdzeirnik bez MM.xls' })
$withOct = $arr
Write-Host "`n=== SCENARIUSZ: tylko czerwiec–wrzesień vs +październik (31.10) ==="
foreach ($prod in @('Malina świeża PW', 'Jabłko przemysłowe')) {
  $s30 = Balance $preOctOnly $prod $OpeningCutoff $false
  $e30 = Balance $preOctOnly $prod $Cutoff $false
  $e31 = Balance $withOct $prod $Cutoff $false
  $octOnly = Balance @($arr | Where-Object { $_.Source -eq 'pazdzeirnik bez MM.xls' }) $prod $Cutoff $false
  Write-Host $prod
  Write-Host "  Do 30.09 (bez partii pazdz): $($s30.rem) kg"
  Write-Host "  Do 31.10 (bez partii pazdz): $($e30.rem) kg"
  Write-Host "  Sam plik pazdz (jak izolowany eksport): $($octOnly.rem) kg"
  Write-Host "  Do 31.10 (caly sezon + pazdz): $($e31.rem) kg"
  Write-Host "  Przyrost od doklejenia pazdz: $([math]::Round($e31.rem - $e30.rem, 3)) kg (Comarch: ok. $(if ($prod -match 'Malina') {'ruch mies. + otwarcie'} else {'11378 - stan 30.09'}))"
}

# Top WZ w pazdzierniku Malina PW (kolumna „Ubyło”) wpływające na rozjazd ~4767 kg
Write-Host "`n=== TOP WZ Malina PW tylko w partii pazdziernik (data <= 31.10) ==="
$octMalWz = @($arr | Where-Object {
  $_.Source -eq 'pazdzeirnik bez MM.xls' -and $_.Product -eq 'Malina świeża PW' -and $_.Op -eq 'wz' -and $_.IssueDate -le $Cutoff
}) | Sort-Object Qty -Descending | Select-Object -First 15
$octMalWz | ForEach-Object { Write-Host "  $($_.Doc) $($_.IssueDate) $($_.Qty)kg kind=$($_.Kind)" }

Write-Host "`n=== WZK Malina PW w pazdzierniku (liczone jak WZ w apce) ==="
$wzkOct = @($arr | Where-Object { $_.Source -eq 'pazdzeirnik bez MM.xls' -and $_.Product -eq 'Malina świeża PW' -and $_.RawOp -eq 'wzk' })
Write-Host "Linii: $($wzkOct.Count), suma abs=$($($wzkOct|Measure-Object Qty -Sum).Sum) kg, signed=$($($wzkOct|Measure-Object QtySigned -Sum).Sum) kg"