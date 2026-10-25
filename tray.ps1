# System tray launcher: runs server.js hidden and offers Open / Restart / Exit.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($env:PORT) { $env:PORT } else { '15180' }
$script:url = "http://localhost:$port"
$script:dir = $dir

$mutex = New-Object System.Threading.Mutex($false, 'Local\UpsConsumptionTray')
if (-not $mutex.WaitOne(0)) { exit }

$node = (Get-Command node -ErrorAction Stop).Source
$script:proc = $null

function Start-Server {
  # clear a leftover server from a previous tray instance so the port is free
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server\.js' -and $_.CommandLine -notmatch 'extensions' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node
  $psi.Arguments = 'server.js'
  $psi.WorkingDirectory = $dir
  $psi.CreateNoWindow = $true
  $psi.UseShellExecute = $false
  $script:proc = [System.Diagnostics.Process]::Start($psi)
}

function Stop-Server {
  if ($script:proc -and -not $script:proc.HasExited) {
    $script:proc.Kill()
    $script:proc.WaitForExit(5000) | Out-Null
  }
}

Start-Server

$bmp = New-Object System.Drawing.Bitmap 32, 32
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$g.FillEllipse([System.Drawing.Brushes]::DodgerBlue, 1, 1, 30, 30)
$bolt = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 18, 4), (New-Object System.Drawing.Point 8, 18), (New-Object System.Drawing.Point 15, 18),
  (New-Object System.Drawing.Point 13, 28), (New-Object System.Drawing.Point 24, 13), (New-Object System.Drawing.Point 17, 13))
$g.FillPolygon([System.Drawing.Brushes]::White, $bolt)
$g.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icon
$tray.Text = 'UPS Consumption'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Open dashboard')
$restart = $menu.Items.Add('Restart server')
$menu.Items.Add('-') | Out-Null
$exit = $menu.Items.Add('Exit')
$tray.ContextMenuStrip = $menu

$script:log = Join-Path $dir 'tray.log'
function Write-Log($m) { "$(Get-Date -Format s) $m" | Out-File -FilePath $script:log -Append }
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
[System.Windows.Forms.Application]::add_ThreadException({ param($s, $e) Write-Log "thread exception: $($e.Exception)" })

$openUrl = { try { Start-Process -FilePath $script:url } catch { Write-Log "open failed: $_" } }
$open.add_Click($openUrl)
$tray.add_DoubleClick($openUrl)
$restart.add_Click({ try { Stop-Server; Start-Server } catch { Write-Log "restart failed: $_" } })
$exit.add_Click({
  try { Stop-Server } catch { Write-Log "stop failed: $_" }
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

# restart the server if it dies unexpectedly
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000
$timer.add_Tick({ try { if ($script:proc -and $script:proc.HasExited) { Start-Server } } catch { Write-Log "timer failed: $_" } })
$timer.Start()

[System.Windows.Forms.Application]::Run()
$tray.Dispose()
$mutex.ReleaseMutex()
