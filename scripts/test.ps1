$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $root ".venv\Scripts\python.exe"

if (Test-Path -LiteralPath $venvPython) {
    & $venvPython -m unittest discover -s tests -v
} else {
    python -m unittest discover -s tests -v
}
