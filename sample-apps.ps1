# Prints per-application CPU % (of all cores) and GPU % over a short window as JSON.
$cores = [Environment]::ProcessorCount
$a = @{}; Get-Process | ForEach-Object { if ($null -ne $_.CPU) { $a[$_.Id] = $_.CPU } }
$t0 = Get-Date
Start-Sleep -Milliseconds 2000
$secs = ((Get-Date) - $t0).TotalSeconds
$apps = @{}
Get-Process | ForEach-Object {
  if ($null -ne $_.CPU -and $a.ContainsKey($_.Id)) {
    $pct = (($_.CPU - $a[$_.Id]) / $secs / $cores) * 100
    if ($pct -gt 0) {
      if (-not $apps.ContainsKey($_.ProcessName)) { $apps[$_.ProcessName] = @{ cpu = 0.0; gpu = 0.0 } }
      $apps[$_.ProcessName].cpu += $pct
    }
  }
}
try {
  $names = @{}; Get-Process | ForEach-Object { $names[$_.Id] = $_.ProcessName }
  (Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples | Where-Object { $_.CookedValue -gt 0.5 } | ForEach-Object {
    $m = [regex]::Match($_.InstanceName, 'pid_(\d+)')
    if ($m.Success) {
      $n = $names[[int]$m.Groups[1].Value]
      if ($n) {
        if (-not $apps.ContainsKey($n)) { $apps[$n] = @{ cpu = 0.0; gpu = 0.0 } }
        $apps[$n].gpu += $_.CookedValue
      }
    }
  }
} catch {}
$out = @($apps.GetEnumerator() | ForEach-Object { [pscustomobject]@{ n = $_.Key; cpu = [math]::Round($_.Value.cpu, 2); gpu = [math]::Round([math]::Min($_.Value.gpu, 100), 2) } })
ConvertTo-Json -InputObject $out -Compress
