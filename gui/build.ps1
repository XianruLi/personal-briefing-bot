# ============================================================
#  打包成单文件 exe
#
#  用法：右键 → 使用 PowerShell 运行，或在项目根目录执行：
#        powershell -ExecutionPolicy Bypass -File gui\build.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($m, $c = 'Cyan') { Write-Host $m -ForegroundColor $c }

Say '=============================================='
Say '  打包任务面板 exe'
Say '=============================================='

# 依赖检查
foreach ($p in @('customtkinter', 'pyinstaller')) {
  $v = python -c "import importlib.metadata as m; print(m.version('$p'))" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Say "缺少依赖：$p，请先运行  python -m pip install $p" 'Red'
    exit 1
  }
  Say "  $p $v"
}

Say ''
Say '正在调用 PyInstaller（首次约 1-2 分钟）...'

python -m PyInstaller `
  --noconfirm --clean --onefile --windowed `
  --name TaskPanel `
  --collect-all customtkinter `
  --paths gui `
  --distpath gui\dist --workpath gui\build --specpath gui `
  gui\app.py

if ($LASTEXITCODE -ne 0) { Say '打包失败' 'Red'; exit 1 }

$exe = Join-Path $root 'gui\dist\TaskPanel.exe'
if (-not (Test-Path $exe)) { Say '没有生成 exe' 'Red'; exit 1 }

$size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Say ''
Say "  ✅ 打包成功：$exe  ($size MB)" 'Green'

# 在项目根目录放一份，方便直接双击
$target = Join-Path $root '任务面板.exe'
Copy-Item $exe $target -Force
Say "  ✅ 已复制到项目根目录：$target" 'Green'
Say ''
Say '双击 任务面板.exe 即可运行（会自己找到同级目录的 tasks/tasks.md）'
