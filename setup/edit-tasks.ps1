# ============================================================
#  桌面端改任务的一键脚本
#
#  做的事情：先同步云端 → 打开 tasks.md → 你改 → 显示改动 → 确认 → 提交推送
#  好处：不会忘记 git pull 导致推送被拒，也不用记 git 命令。
#
#  用法：右键此文件 → 使用 PowerShell 运行
# ============================================================

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 让中文在终端里正常显示
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Say($msg, $color = 'Cyan') { Write-Host $msg -ForegroundColor $color }

$taskFile = Join-Path $root 'tasks\tasks.md'
if (-not (Test-Path $taskFile)) { Say "找不到 tasks/tasks.md" 'Red'; exit 1 }

Say "=============================================="
Say "  编辑任务清单"
Say "=============================================="
Write-Host ""

# ---------- 1. 同步 ----------
Say "[1/4] 同步云端最新状态..."
$pullOut = (git pull --rebase --autostash 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
  Say "❌ 拉取失败，可能有冲突需要手动处理：" 'Red'
  Write-Host $pullOut
  exit 1
}
Say "      OK"

# ---------- 2. 打开编辑器 ----------
Say "[2/4] 打开 tasks.md ..."
$opened = $false
if (Get-Command code -ErrorAction SilentlyContinue) {
  Start-Process code -ArgumentList $taskFile
  $opened = $true
} elseif (Get-Command notepad -ErrorAction SilentlyContinue) {
  Start-Process notepad -ArgumentList $taskFile
  $opened = $true
} else {
  Invoke-Item $taskFile
  $opened = $true
}
if (-not $opened) { Say "   请手动打开：$taskFile" 'Yellow' }
Write-Host ""
Write-Host "   文件路径：$taskFile"
Write-Host ""
Write-Host "   提醒：" -ForegroundColor Yellow
Write-Host "     • 加任务：在「## 进行中」下面加一行  - [ ] 任务内容" -ForegroundColor Yellow
Write-Host "     • 完成任务：把 [ ] 改成 [x]" -ForegroundColor Yellow
Write-Host ""

Read-Host "改完并保存后，按回车继续"

# ---------- 3. 检查改动 ----------
Say "[3/4] 检查改动..."
$changed = (git status --porcelain -- tasks/tasks.md | Out-String).Trim()
if (-not $changed) {
  Say "没有检测到改动，结束。" 'Yellow'
  exit 0
}

Write-Host ""
git --no-pager diff -- tasks/tasks.md
Write-Host ""

# ---------- 4. 提交推送 ----------
$msg = Read-Host "确认提交并推送？（直接回车用默认说明，输入 n 取消）"
if ($msg -eq 'n' -or $msg -eq 'N') { Say "已取消，改动仍保留在本地文件里。" 'Yellow'; exit 0 }
if (-not $msg) { $msg = "task: 更新任务清单" }

Say "[4/4] 提交并推送..."
git add tasks/tasks.md
git commit -m $msg | Out-Null
git push 2>&1 | Out-String | Write-Host

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Say "✅ 完成！云端下次推送（早 7:00 / 晚 21:30）就会读到最新任务。" 'Green'
} else {
  Say "❌ 推送失败，请把上面的报错发给我。" 'Red'
  exit 1
}
