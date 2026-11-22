param(
  [string]$Pz = "C:\Users\marze\Downloads\październik PZ.xls",
  [string]$Wz = "C:\Users\marze\Downloads\październik WZ.xls",
  [string]$Wzk = "C:\Users\marze\Downloads\Pażdziernik WZK.xls",
  [string]$Mm = "C:\Users\marze\Downloads\pazdzeirnik bez MM.xls",
  [string]$Cutoff = "2026-10-31",
  [switch]$SlimLayout
)

function Read-SlimLines($path, $label) {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false; $excel.DisplayAlerts = $false
  $ws = $excel.Workbooks.Open($path).Worksheets.Item(1)
  $max = $ws.UsedRange.Rows.Count
  $list = [System.Collections.Generic.List[object]]::new()
  for ($r = 2; $r -le $max; $r++) {
    $kind = [string]$ws.Cells.Item($r, 2).Text
    $doc = NormDoc ([string]$ws.Cells.Item($r, 3).Text)
    $prod = ([string]$ws.Cells.Item($r, 4).Text).Trim()
    $qtyS = [string]$ws.Cells.Item($r, 5).Text
    $qty = 0
    if (-not [double]::TryParse($qtyS.Replace(',', '.').Replace(' ', ''), [ref]$qty)) { continue }
    if (-not $prod -or $qty -eq 0) { continue }
    $date = InferDateFromDoc $doc
    $op = AppClassify $kind $doc
    if (-not $op) { continue }
    $qa = [math]::Round([math]::Abs($qty), 4)
    $list.Add([pscustomobject]@{
      Source = $label
      Kind = $kind
      Doc = $doc
      Product = $prod
      QtySigned = $qty
      Qty = $qa
      OpApp = $op
      IssueDate = $date
      Key = "$op|$doc|$prod|$qa"
    })
  }
  $ws.Parent.Close($false); $excel.Quit()
  return $list
}

function NormDoc($s) { if (-not $s) { return "" }; return ($s -replace '\s+','' -replace '\\','/').Trim() }
function InferDateFromDoc($doc) {
  if ($doc -match '/(\d{1,2})/(\d{1,2})/(\d{4})') {
    return ('{0:0000}-{1:00}-{2:00}' -f [int]$matches[3], [int]$matches[2], [int]$matches[1])
  }
  if ($doc -match '/(\d{1,2})/(\d{4})$') {
    $mo = [int]$matches[1]; $yr = [int]$matches[2]
    $last = [DateTime]::DaysInMonth($yr, $mo)
    return ('{0:0000}-{1:00}-{2:00}' -f $yr, $mo, $last)
  }
  return ''
}
function ParseDate($v) {
  if ($v -is [double]) { try { return [DateTime]::FromOADate($v).ToString('yyyy-MM-dd') } catch {} }
  $t = [string]$v
  if ($t -match '^(\d{1,2})\.(\d{1,2})\.(\d{4})') { return ('{0:0000}-{1:00}-{2:00}' -f [int]$matches[3],[int]$matches[2],[int]$matches[1]) }
  if ($t -match '^(\d{4})-(\d{2})-(\d{2})') { return $matches[0] }
  return ""
}
function AppClassify($kind, $doc) {
  $type = ([string]$kind).ToUpper().Trim()
  $text = ("$kind $doc").ToUpper()
  if ($text -match '\bMM\b|^MM/') { return $null }
  if ($type -eq 'PZ' -or $text -match 'PZ') { return 'pz' }
  if ($type -eq 'WZ' -or $text -match 'WZ|FV|FS|RR') { return 'wz' }
  return 'pz'
}
function ReadLines($path, $label) {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false; $excel.DisplayAlerts = $false
  $ws = $excel.Workbooks.Open($path).Worksheets.Item(1)
  $max = $ws.UsedRange.Rows.Count
  $list = [System.Collections.Generic.List[object]]::new()
  $curKind = ''; $curDoc = ''; $curDate = ''
  for ($r = 2; $r -le $max; $r++) {
    $kind = [string]$ws.Cells.Item($r, 2).Text
    $nr = [string]$ws.Cells.Item($r, 3).Text
    $date = $ws.Cells.Item($r, 6).Value2
    $prod = [string]$ws.Cells.Item($r, 16).Text
    $qtyS = [string]$ws.Cells.Item($r, 18).Text
    if (-not $qtyS) { $qtyS = [string]$ws.Cells.Item($r, 9).Text }
    if ($kind) { $curKind = $kind }
    if ($nr -match '(?i)(PZ|WZ|WZK|RR)/') { $curDoc = NormDoc $nr }
    $d = ParseDate $date; if ($d) { $curDate = $d }
    $qty = 0
    if (-not [double]::TryParse($qtyS.Replace(',','.').Replace(' ',''), [ref]$qty)) { continue }
    if ($qty -eq 0 -or -not $prod) { continue }
    $signed = $qty
    $qtyA = [math]::Abs($qty)
    $op = AppClassify $curKind $curDoc
    if (-not $op) { continue }
    $mv = $curDate
    if (-not $mv -and $curDoc -match '/10/2026') { $mv = '2026-10-31' }
    $list.Add([pscustomobject]@{
      Source = $label
      Row = $r
      Kind = $curKind
      Doc = $curDoc
      Product = $prod.Trim()
      QtySigned = $signed
      Qty = $qtyA
      OpApp = $op
      IssueDate = $mv
      Key = "$op|$curDoc|$($prod.Trim())|$qtyA"
      KeySigned = "$op|$curDoc|$($prod.Trim())|$signed"
    })
  }
  $ws.Parent.Close($false); $excel.Quit()
  return $list
}

function ProdKey($p) {
  $t = ($p -replace 'ł','l' -replace 'Ł','l').ToLower()
  if ($t -match 'malina.*pw|malina pw') { return 'malina_pw' }
  if ($t -match 'jabl.*przem|przemysl') { return 'jab_przem' }
  if ($t -match 'jab.*obier') { return 'jab_obier' }
  if ($t -match 'malina') { return 'malina' }
  return 'other'
}

function SumProd($lines, $prodKey, $octOnly) {
  $sub = $lines | Where-Object { ProdKey $_.Product -eq $prodKey }
  if ($octOnly) {
    $sub = $sub | Where-Object { $_.IssueDate -ge '2026-10-01' -and $_.IssueDate -le $Cutoff }
  }
  $pz = ($sub | Where-Object OpApp -eq 'pz' | Measure-Object Qty -Sum).Sum
  $wz = ($sub | Where-Object OpApp -eq 'wz' | Measure-Object Qty -Sum).Sum
  return @{ pz = [math]::Round($pz,3); wz = [math]::Round($wz,3); n = $sub.Count }
}

Write-Host "=== LICZBY LINII ==="
if ($SlimLayout) {
  $pzL = Read-SlimLines $Pz 'PZ'
  $wzL = Read-SlimLines $Wz 'WZ'
  $wzkL = Read-SlimLines $Wzk 'WZK'
  $mmL = ReadLines $Mm 'MM'
} else {
  $pzL = ReadLines $Pz 'PZ'
  $wzL = ReadLines $Wz 'WZ'
  $wzkL = ReadLines $Wzk 'WZK'
  $mmL = ReadLines $Mm 'MM'
}
$splitUnion = @($pzL) + @($wzL) + @($wzkL)
Write-Host "PZ file: $($pzL.Count) | WZ: $($wzL.Count) | WZK: $($wzkL.Count) | split sum: $($splitUnion.Count) | bez MM: $($mmL.Count)"

Write-Host "`n=== WZK (pierwsze 8) ==="
$wzkL | Select-Object -First 8 | ForEach-Object {
  Write-Host "$($_.Kind) $($_.Doc) $($_.Product) signed=$($_.QtySigned) op=$($_.OpApp) date=$($_.IssueDate)"
}

$splitKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($l in $splitUnion) { [void]$splitKeys.Add($l.Key) }
$mmKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($l in $mmL) { [void]$mmKeys.Add($l.Key) }

$onlySplit = 0; $onlyMm = 0
foreach ($k in $splitKeys) { if (-not $mmKeys.Contains($k)) { $onlySplit++ } }
foreach ($k in $mmKeys) { if (-not $splitKeys.Contains($k)) { $onlyMm++ } }
Write-Host "`n=== KLUCZ op|doc|produkt|qty (abs) ==="
Write-Host "Tylko w PZ+WZ+WZK: $onlySplit | Tylko w bez MM: $onlyMm | wspolne: $($splitKeys.Count - $onlySplit)"

if ($onlySplit -gt 0 -and $onlySplit -le 20) {
  foreach ($l in $splitUnion) { if (-not $mmKeys.Contains($l.Key)) { Write-Host "  +split: $($l.Source) $($l.Key) $($l.IssueDate)" } }
}
if ($onlyMm -gt 0) {
  $shown = 0
  foreach ($l in $mmL) {
    if (-not $splitKeys.Contains($l.Key)) {
      if ($shown -lt 15) { Write-Host "  +mm only: $($l.Kind) $($l.Key) $($l.IssueDate)"; $shown++ }
    }
  }
  if ($onlyMm -gt 15) { Write-Host "  ... i $($onlyMm - 15) wiecej" }
}

Write-Host "`n=== PAZDZIERNIK 2026-10 — ruch wg aplikacji (abs qty) ==="
foreach ($pk in @('malina_pw','jab_przem','jab_obier','malina')) {
  $s = SumProd $splitUnion $pk $true
  $m = SumProd $mmL $pk $true
  Write-Host "$pk : split PZ=$($s.pz) WZ=$($s.wz) net=$([math]::Round($s.pz-$s.wz,3)) ($($s.n) linii) | bezMM PZ=$($m.pz) WZ=$($m.wz) net=$([math]::Round($m.pz-$m.wz,3)) ($($m.n) linii)"
}

Write-Host "`n=== WZK w pazdzierniku (10/2026) ==="
$wzkOct = $wzkL | Where-Object { $_.IssueDate -ge '2026-10-01' -and $_.IssueDate -le $Cutoff }
Write-Host "Linii WZK w 10/2026: $($wzkOct.Count), kg (abs jako WZ): $($($wzkOct | Measure-Object Qty -Sum).Sum)"
$wzkOct | Group-Object { ProdKey $_.Product } | ForEach-Object {
  $pz=($_.Group|?{$_.OpApp-eq'pz'}|Measure-Object Qty -Sum).Sum
  $wz=($_.Group|?{$_.OpApp-eq'wz'}|Measure-Object Qty -Sum).Sum
  Write-Host "  $($_.Name): $($_.Count) linii, WZ-kg=$wz (app class)"
}

Write-Host "`n=== WZK vs ten sam doc w bez MM ==="
$wzkInMm = 0; $wzkMissingMm = 0
foreach ($l in $wzkL) {
  $hit = $mmL | Where-Object { $_.Doc -eq $l.Doc -and $_.Product -eq $l.Product -and $_.Qty -eq $l.Qty }
  if ($hit) { $wzkInMm++ } else { $wzkMissingMm++ }
}
Write-Host "WZK linie tez w bez MM (doc+prod+qty): $wzkInMm | brak w bez MM: $wzkMissingMm"