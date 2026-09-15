# ============================================================
#  个人咨询管家 · 一次性激活脚本
#
#  作用：补 GitHub 权限 → 推送定时工作流 → 写入 Secrets → 跑一次测试
#  用法：右键此文件 → 使用 PowerShell 运行
#        （或在项目根目录执行： powershell -ExecutionPolicy Bypass -File setup\activate.ps1）
# ============================================================

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($msg, $color = 'Cyan') { Write-Host $msg -ForegroundColor $color }

Say "=============================================="
Say "  个人咨询管家 · 激活"
Say "=============================================="
Write-Host ""

# ---------- 1. 检查 .env ----------
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) {
  Say "❌ 找不到 .env 文件。请先复制 .env.example 为 .env 并填好内容。" 'Red'
  exit 1
}

function Get-EnvValue($key) {
  foreach ($line in (Get-Content -LiteralPath $envFile)) {
    $t = $line.Trim()
    if ($t.StartsWith("$key=")) { return $t.Substring($key.Length + 1).Trim() }
  }
  return ''
}

$webhook = Get-EnvValue 'DISCORD_WEBHOOK_URL'
$apiKey  = Get-EnvValue 'DEEPSEEK_API_KEY'
$webhookEvening = Get-EnvValue 'DISCORD_WEBHOOK_URL_EVENING'
$mention = Get-EnvValue 'DISCORD_MENTION'

if (-not $apiKey) { Say "❌ .env 里的 DEEPSEEK_API_KEY 是空的。" 'Red'; exit 1 }
if (-not $webhook) {
  Say "❌ .env 里的 DISCORD_WEBHOOK_URL 还是空的。" 'Red'
  Say "   请到 Discord 频道 → 齿轮 → 整合 → Webhook → 新建 → 复制 URL，填进 .env。" 'Yellow'
  exit 1
}
if ($webhook -notmatch '^https://(canary\.|ptb\.)?discord(app)?\.com/api/webhooks/') {
  Say "❌ DISCORD_WEBHOOK_URL 格式不对，应该形如 https://discord.com/api/webhooks/<id>/<token>" 'Red'
  exit 1
}
Say "✅ .env 检查通过（Webhook 长度 $($webhook.Length)，API Key 长度 $($apiKey.Length)）"

# ---------- 2. 确认仓库 ----------
$remote = (git remote get-url origin 2>$null)
if (-not $remote) { Say "❌ 当前目录没有配置 git remote。" 'Red'; exit 1 }
Say "✅ 仓库：$remote"

# ---------- 3. 补 workflow 权限 ----------
$authText = (gh auth status 2>&1 | Out-String)
if ($authText -notmatch 'workflow') {
  Write-Host ""
  Say "⚠️   GitHub 需要额外授权才能推送 workflow 文件。" 'Yellow'
  Say "    接下来浏览器会打开一个页面，请点「Authorize」。" 'Yellow'
  Write-Host ""
  Read-Host "按回车继续（会打开浏览器）"
  gh auth refresh -s workflow --hostname github.com
  if ($LASTEXITCODE -ne 0) { Say "❌ 授权没有完成，请重跑本脚本。" 'Red'; exit 1 }
  Say "✅ 权限已补上"
} else {
  Say "✅ 已有 workflow 权限"
}

# ---------- 4. 推送定时工作流 ----------
git add .github/workflows/briefing.yml
if (git diff --cached --quiet) {
  Say "✅ 工作流文件已在仓库中，无需重复推送"
} else {
  git commit -q -m "ci: 加入每日简报定时工作流"
  git push
  if ($LASTEXITCODE -ne 0) { Say "❌ 推送失败。" 'Red'; exit 1 }
  Say "✅ 定时工作流已推送"
}

# ---------- 5. 写入 Secrets ----------
Write-Host ""
Say "正在写入 GitHub Secrets..."
gh secret set DEEPSEEK_API_KEY --body $apiKey | Out-Null
gh secret set DISCORD_WEBHOOK_URL --body $webhook | Out-Null
if ($webhookEvening) { gh secret set DISCORD_WEBHOOK_URL_EVENING --body $webhookEvening | Out-Null }
if ($mention) { gh secret set DISCORD_MENTION --body $mention | Out-Null }
Say "✅ Secrets 已写入："
gh secret list

# ---------- 6. 跑一次测试 ----------
Write-Host ""
Say "正在触发一次早报测试（dry-run，只打印不推送）..."
gh workflow run briefing.yml -f mode=morning -f dry_run=true
Start-Sleep -Seconds 8
gh run list --workflow=briefing.yml --limit 1

Write-Host ""
Say "=============================================="
Say "  完成！"
Say "=============================================="
Write-Host ""
Write-Host "接下来："
Write-Host "  1. 等 1 分钟，看上面那次 dry-run 的日志： gh run view --log"
Write-Host "  2. 日志没问题后，正式发一次真消息："
Write-Host "       gh workflow run briefing.yml -f mode=morning -f dry_run=false"
Write-Host "  3. 去 Discord 看有没有收到早报"
Write-Host ""
Write-Host "之后每天早上 7:00 / 晚上 21:30（悉尼时间）会自动推送，不用管这台电脑开不开机。"
