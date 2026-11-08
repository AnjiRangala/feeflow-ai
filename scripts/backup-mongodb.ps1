param(
  [Parameter(Mandatory = $true)][string]$MongoUri,
  [string]$OutputDirectory = ".\backups",
  [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$root = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $root -Force | Out-Null
$target = Join-Path $root "feeflow-$timestamp"
New-Item -ItemType Directory -Path $target -Force | Out-Null

& mongodump --uri $MongoUri --archive="$target\feeflow.archive.gz" --gzip --oplog
if ($LASTEXITCODE -ne 0) { throw "mongodump failed" }
& mongorestore --archive="$target\feeflow.archive.gz" --gzip --dryRun
if ($LASTEXITCODE -ne 0) { throw "Backup integrity check failed" }

Get-ChildItem $root -Directory |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
  Remove-Item -Recurse -Force
Write-Output "Backup created and integrity-checked: $target"
