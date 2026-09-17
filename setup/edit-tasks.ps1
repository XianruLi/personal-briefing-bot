# ============================================================
#  桌面端改任务的一键脚本
#
#  流程：先同步云端 -> 打开 tasks.md -> 你改 -> 显示改动 -> 确认 -> 提交推送
#  好处：不会忘记 git pull 导致推送被拒，也不用记 git 命令。
#
#  用法：右键此文件 -> 使用 PowerShell 运行
#
#  ⚠️ 本文件必须保存为「UTF-8 带 BOM」。
#     Windows PowerShell 5.1 在没有 BOM 时按 ANSI(GBK) 读取脚本，
#     中文会变乱码导致语法错误、窗口一闪而过 —— 这正是最初版本的 bug。
# ============================================================

# 不用 Stop：git 会把正常进度写到 stderr，Stop 会把它误判成致命错误
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($msg, $color = 'Cyan') { Write-Host $msg -ForegroundColor $color }

# 安全地调用外部命令：收集输出和退出码，不会因 stderr 内容而中断
function Invoke-Native($file, [string[]]$arguments) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & $file @arguments 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return @{ Output = $out; Code = $code }
}

$exitCode = 0
try {
  Say '=============================================='
  Say '  编辑任务清单'
  Say '=============================================='
  Write-Host ''

  if (-not (Test-Path (Join-Path $root '.git'))) { throw ('这里不是 git 仓库：' + $root) }

  $taskFile = Join-Path $root 'tasks\tasks.md'
  if (-not (Test-Path $taskFile)) { throw ('找不到 ' + $taskFile) }

  Say '[1/4] 同步云端最新状态...'
  $pull = Invoke-Native 'git' @('pull', '--rebase', '--autostash')
  if ($pull.Code -ne 0) {
    Say '  同步失败。可能是本地改动和云端冲突了。' 'Red'
    Write-Host $pull.Output
    Write-Host ''
    Say '  在项目目录开一个 PowerShell 窗口，按顺序试试：' 'Yellow'
    Say '    git rebase --abort      回到同步前的状态' 'Yellow'
    Say '    git status              看看哪些文件有问题' 'Yellow'
    throw '同步失败，已停止（你的改动没有丢）'
  }
  Say '  OK'

  Say '[2/4] 打开 tasks.md ...'
  if (Get-Command code -ErrorAction SilentlyContinue) {
    Start-Process code -ArgumentList $taskFile
  } elseif (Get-Command notepad -ErrorAction SilentlyContinue) {
    Start-Process notepad -ArgumentList $taskFile
  } else {
    Invoke-Item $taskFile
  }
  Write-Host ''
  Write-Host ('  文件位置：' + $taskFile)
  Write-Host ''
  Write-Host '  写法提醒：' -ForegroundColor Yellow
  Write-Host '    加任务   ：在「## 进行中」下面加一行   - [ ] 任务内容' -ForegroundColor Yellow
  Write-Host '    完成任务 ：把 [ ] 改成 [x]' -ForegroundColor Yellow
  Write-Host '    可选标记 ：@2026-09-25 截止日期   !高 优先级   #标签' -ForegroundColor Yellow
  Write-Host ''
  Read-Host '改完并保存后，按回车继续'

  Say '[3/4] 检查改动...'
  $status = Invoke-Native 'git' @('status', '--porcelain', '--', 'tasks', 'config')
  if (-not $status.Output.Trim()) {
    Say '  没有检测到 tasks/ 或 config/ 下的改动，结束。' 'Yellow'
  } else {
    Write-Host ''
    $diff = Invoke-Native 'git' @('--no-pager', 'diff', '--', 'tasks', 'config')
    Write-Host $diff.Output
    Write-Host ''

    $msg = Read-Host '确认提交并推送？直接回车用默认说明，输入 n 取消'
    if ($msg -eq 'n' -or $msg -eq 'N') {
      Say '  已取消。改动仍保留在本地文件里，没有丢。' 'Yellow'
    } else {
      if (-not $msg) { $msg = 'task: 更新任务清单' }
      Say '[4/4] 提交并推送...'
      Invoke-Native 'git' @('add', 'tasks', 'config') | Out-Null
      $commit = Invoke-Native 'git' @('commit', '-m', $msg)
      if ($commit.Code -ne 0) { Write-Host $commit.Output }
      $push = Invoke-Native 'git' @('push')
      if ($push.Code -ne 0) {
        Write-Host $push.Output
        Say '  推送失败。再运行一次本脚本通常就能解决（它会先同步）。' 'Red'
        $exitCode = 1
      } else {
        Write-Host ''
        Say '  完成！云端下次推送（早 7:00 / 晚 21:30）就会读到最新任务。' 'Green'
      }
    }
  }
} catch {
  Write-Host ''
  Say ('出错了：' + $_.Exception.Message) 'Red'
  $exitCode = 1
} finally {
  # 关键：不管成功还是失败都停住，否则右键运行时窗口会直接关掉，什么也看不到
  Write-Host ''
  Read-Host '按回车关闭窗口' | Out-Null
}
exit $exitCode