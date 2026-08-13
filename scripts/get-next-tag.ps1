git fetch --tags > $null 2>&1
$latest = (git tag --sort=-v:refname | Select-Object -First 1)
if (-not $latest) {
    $latest = "v0.2.0"
}
$clean = $latest -replace '^v',''
$parts = $clean.Split('.')
$major = [int]$parts[0]
$minor = [int]$parts[1]
$patch = [int]$parts[2] + 1
$next = "v$major.$minor.$patch"
Write-Output $next
