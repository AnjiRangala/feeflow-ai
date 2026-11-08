param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$TargetMongoUri
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Archive)) { throw "Archive not found" }
& mongorestore --uri $TargetMongoUri --archive=$Archive --gzip --drop
if ($LASTEXITCODE -ne 0) { throw "Isolated restore failed" }
Write-Output "Restore completed against the supplied isolated target."
