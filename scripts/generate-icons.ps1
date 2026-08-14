Add-Type -AssemblyName System.Drawing

function Resize-Image {
    param(
        [string]$SourcePath,
        [string]$TargetPath,
        [int]$Width,
        [int]$Height
    )
    $srcImg = [System.Drawing.Image]::FromFile($SourcePath)
    
    # Calculate aspect-ratio preserving dimensions (fit within target box)
    $srcWidth = $srcImg.Width
    $srcHeight = $srcImg.Height
    
    $scale = [Math]::Min($Width / $srcWidth, $Height / $srcHeight)
    $drawWidth = [int][Math]::Round($srcWidth * $scale)
    $drawHeight = [int][Math]::Round($srcHeight * $scale)
    
    $offsetX = [int][Math]::Round(($Width - $drawWidth) / 2)
    $offsetY = [int][Math]::Round(($Height - $drawHeight) / 2)

    $destImg = New-Object System.Drawing.Bitmap($Width, $Height)
    $graphics = [System.Drawing.Graphics]::FromImage($destImg)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    $graphics.DrawImage($srcImg, $offsetX, $offsetY, $drawWidth, $drawHeight)
    
    $targetDir = [System.IO.Path]::GetDirectoryName($TargetPath)
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    if (Test-Path $TargetPath) {
        Remove-Item -Path $TargetPath -Force
    }

    $destImg.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $destImg.Dispose()
    $srcImg.Dispose()
}

$src = Join-Path (Split-Path $PSScriptRoot -Parent) "ICON.png"
if (-not (Test-Path $src)) {
    $src = "C:\Users\soumy\Documents\Fuk-YT\ICON.png"
}
if (-not (Test-Path $src)) {
    Write-Error "ICON.png not found at $src"
    exit 1
}

$sizes = @(16, 32, 48, 128)
foreach ($s in $sizes) {
    $target1 = "$PSScriptRoot\..\extension\icons\icon$s.png"
    $target2 = "$PSScriptRoot\..\extension\public\icons\icon$s.png"
    Resize-Image -SourcePath $src -TargetPath $target1 -Width $s -Height $s
    Resize-Image -SourcePath $src -TargetPath $target2 -Width $s -Height $s
    Write-Host "Generated icon$s.png ($s x $s) with original aspect ratio"
}

# Also copy to favicon / assets if applicable
Resize-Image -SourcePath $src -TargetPath "$PSScriptRoot\..\extension\favicon.png" -Width 32 -Height 32
Resize-Image -SourcePath $src -TargetPath "$PSScriptRoot\..\extension\public\favicon.png" -Width 32 -Height 32
Write-Host "Generated favicon.png with original aspect ratio"
