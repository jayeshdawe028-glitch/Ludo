$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Set-Location (Split-Path -Parent $PSScriptRoot)

docker compose up -d --build
Write-Host 'Aarohi deployment started.'
